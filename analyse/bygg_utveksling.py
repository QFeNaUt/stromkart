"""
bygg_utveksling.py — inkrement 2, del 2: utveksling og kabelutnyttelse.

Produserer to ting fra ENTSO-E:

  1. NETTO POSISJON per sone  ->  historikk_dogn.parquet, serie "netto_posisjon"
     query_net_position (dagsavregnet). Positivt = netto eksport. Dette er T1
     ("er sonen netto eksportør eller importør i dag") i ETT kall per sone.

  2. Per GRENSE, per døgn      ->  utveksling_dogn.parquet
       netto_mw     : netto fysisk flyt i kanonisk retning (a->b positiv)
       ntc_fram_mw  : dag-ahead NTC a->b
       ntc_tilbake  : dag-ahead NTC b->a
       util         : |netto| / NTC i FLYTRETNINGEN   (T2, Euphemia-koblingen)
     Utfalls-/vedlikeholdsflagget (T3) utledes NEDSTRØMS i regime-steget, ved å
     se ntc mot dens egen historikk (5 %-gulv). Rådata-laget lagrer bare tall.

Topologi (låst 21.07): NSL ligger på NO2, ikke NO5. RU droppet (død etter 2022).
Interne NO-NO-snitt er med — de forklarer nord/sør-prissplittene (jf. 2022).

Chunking: ÅRSVIS (ikke månedsvis som backfillen) for å holde kallmengden nede —
mange grenser x fire serier. Resumbar: hopper over det som alt ligger i parquet.
Backoff ved rate-grense. Kjøretid grovt 10-15 min.

Kjøring:
    pip install entsoe-py pandas pyarrow python-dotenv
    python analyse\\bygg_utveksling.py
"""

import os
import sys
import time
from datetime import date

import pandas as pd

try:
    from entsoe import EntsoePandasClient
    from entsoe.exceptions import NoMatchingDataError
except ImportError:
    sys.exit("Mangler entsoe-py. Kjør: pip install entsoe-py")


# --- Konfig ------------------------------------------------------------------

TIDSSONE = "Europe/Oslo"
START = pd.Timestamp("2021-01-01", tz=TIDSSONE)
SLUTT = pd.Timestamp(date.today(), tz=TIDSSONE)

HIST_FIL = "historikk_dogn.parquet"      # per sone (deles med backfillen)
UTV_FIL = "utveksling_dogn.parquet"      # per grense (ny)

INTERP_MAKS_TIMER = 3
DEKNING_MIN = 0.90
PAUSE_SEK = 1.5
BACKOFF_START_SEK = 5
BACKOFF_MAKS_FORSOK = 5

SONER = ["NO_1", "NO_2", "NO_3", "NO_4", "NO_5"]

# Utenlandsgrenser (no_sone, utland). Merk kodene: Tyskland = DE_LU,
# Vest-Danmark = DK_1. NSL er NO_2<->GB.
UTENLANDS = [
    ("NO_1", "SE_3"),
    ("NO_2", "NL"), ("NO_2", "DE_LU"), ("NO_2", "DK_1"), ("NO_2", "GB"),
    ("NO_3", "SE_2"),
    ("NO_4", "SE_1"), ("NO_4", "SE_2"), ("NO_4", "FI"),
]
# Interne snitt (NO-NO), kanonisk retning.
INTERNE = [
    ("NO_1", "NO_2"), ("NO_1", "NO_3"), ("NO_1", "NO_5"),
    ("NO_2", "NO_5"), ("NO_3", "NO_4"), ("NO_3", "NO_5"),
]
GRENSER = UTENLANDS + INTERNE


# --- Klient og robust kall ---------------------------------------------------

def lag_klient() -> EntsoePandasClient:
    token = os.environ.get("ENTSOE_API_TOKEN")
    if not token:
        try:
            from dotenv import load_dotenv
            load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
            token = os.environ.get("ENTSOE_API_TOKEN")
        except ImportError:
            pass
    if not token:
        sys.exit("Fant ikke ENTSOE_API_TOKEN i miljøet eller ../.env")
    return EntsoePandasClient(api_key=token)


def _kall(metode, *a, **kw) -> pd.Series:
    """Ett entsoe-kall med backoff. Normaliserer til en tz-satt tallserie.
    Tom respons (NoMatchingDataError) -> tom serie (ekte hull, ikke feil)."""
    ventetid = BACKOFF_START_SEK
    for forsok in range(1, BACKOFF_MAKS_FORSOK + 1):
        try:
            svar = metode(*a, **kw)
            s = svar if isinstance(svar, pd.Series) else svar.iloc[:, 0]
            s = pd.to_numeric(s, errors="coerce")
            if s.index.tz is None:
                s.index = s.index.tz_localize(TIDSSONE)
            else:
                s.index = s.index.tz_convert(TIDSSONE)
            return s
        except NoMatchingDataError:
            return pd.Series(dtype="float64")
        except Exception as e:
            if forsok == BACKOFF_MAKS_FORSOK:
                print(f"      ! ga opp: {e}")
                return pd.Series(dtype="float64")
            print(f"      · backoff {ventetid}s: {e}")
            time.sleep(ventetid)
            ventetid *= 2
    return pd.Series(dtype="float64")


# --- Time -> døgn ------------------------------------------------------------

def til_dogn_maalt(s: pd.Series) -> pd.DataFrame:
    """For MÅLINGER (flyt, netto posisjon): time -> døgn med dekningsvakt.
    Speiler backfillens til_dogn."""
    if s.empty:
        return pd.DataFrame(columns=["verdi", "dekning"])
    t = s.resample("h").mean()
    reelle = t.notna().groupby(t.index.date).sum()
    forventet = t.groupby(t.index.date).size()
    dekning = reelle / forventet
    t = t.interpolate(limit=INTERP_MAKS_TIMER, limit_area="inside")
    snitt = t.groupby(t.index.date).mean()
    ut = pd.DataFrame({"verdi": snitt, "dekning": dekning})
    ut.index = pd.to_datetime(ut.index)
    ut.index.name = "dato"
    return ut[ut["dekning"] >= DEKNING_MIN]


def til_dogn_ntc(s: pd.Series) -> pd.Series:
    """For NTC: enkelt døgnsnitt, INGEN dekningsvakt. NTC er en administrativ
    kapasitetsverdi (ofte glissen), ikke en måling med time-hull å vokte."""
    if s.empty:
        return pd.Series(dtype="float64", name="ntc")
    d = s.resample("D").mean()
    d.index = pd.to_datetime(d.index.date)
    d.index.name = "dato"
    return d


# --- Årsvindu og gjenopptakelse ----------------------------------------------

def aar_vindu(fra: pd.Timestamp, til: pd.Timestamp):
    cur = max(fra, pd.Timestamp(year=fra.year, month=1, day=1, tz=TIDSSONE))
    while cur < til:
        neste = pd.Timestamp(year=cur.year + 1, month=1, day=1, tz=TIDSSONE)
        yield cur, min(neste, til)
        cur = neste


def les(sti: str):
    if not os.path.exists(sti):
        return None
    df = pd.read_parquet(sti)
    if "dato" in df.columns:
        df["dato"] = pd.to_datetime(df["dato"])
    return df


def start_fra(sist) -> pd.Timestamp:
    """Gjenoppta fra 1. januar i året til siste lagrede dato (re-henter den
    delvise årsbolken; dedup keep='last' rydder overlappet)."""
    if sist is None:
        return START
    return pd.Timestamp(year=pd.Timestamp(sist).year, month=1, day=1, tz=TIDSSONE)


# --- Prosessering ------------------------------------------------------------

def grense_id(a: str, b: str) -> str:
    return f"{a}|{b}"


def prosesser_netto_posisjon(klient, sone, fra) -> pd.DataFrame:
    biter = []
    for y_start, y_slutt in aar_vindu(fra, SLUTT):
        s = _kall(klient.query_net_position, sone, start=y_start, end=y_slutt,
                  dayahead=True)
        time.sleep(PAUSE_SEK)
        d = til_dogn_maalt(s)
        if not d.empty:
            d = d.reset_index()
            d["sone"] = sone
            biter.append(d)
        print(f"    netto_posisjon {sone} {y_start:%Y} ferdig")
    if not biter:
        return pd.DataFrame()
    ut = pd.concat(biter, ignore_index=True)
    ut["serie"] = "netto_posisjon"
    return ut[["dato", "sone", "serie", "verdi", "dekning"]]


def prosesser_grense(klient, a, b, fra) -> pd.DataFrame:
    biter = []
    for y_start, y_slutt in aar_vindu(fra, SLUTT):
        fab = _kall(klient.query_crossborder_flows, a, b, start=y_start, end=y_slutt)
        time.sleep(PAUSE_SEK)
        fba = _kall(klient.query_crossborder_flows, b, a, start=y_start, end=y_slutt)
        time.sleep(PAUSE_SEK)
        nab = _kall(klient.query_net_transfer_capacity_dayahead, a, b,
                    start=y_start, end=y_slutt)
        time.sleep(PAUSE_SEK)
        nba = _kall(klient.query_net_transfer_capacity_dayahead, b, a,
                    start=y_start, end=y_slutt)
        time.sleep(PAUSE_SEK)

        dab = til_dogn_maalt(fab).rename(columns={"verdi": "fab", "dekning": "dek_ab"})
        dba = til_dogn_maalt(fba).rename(columns={"verdi": "fba", "dekning": "dek_ba"})
        d_nab = til_dogn_ntc(nab).rename("ntc_fram")
        d_nba = til_dogn_ntc(nba).rename("ntc_tilbake")

        df = dab.join(dba, how="outer").join(d_nab, how="outer").join(d_nba, how="outer")
        # Bare døgn med minst én reell flytretning (ikke rene NTC-rader).
        df = df.dropna(subset=["fab", "fba"], how="all")
        if df.empty:
            print(f"    {a}|{b} {y_start:%Y} tomt")
            continue

        df["netto_mw"] = df["fab"].fillna(0) - df["fba"].fillna(0)
        ntc_i_retning = df["ntc_fram"].where(df["netto_mw"] >= 0, df["ntc_tilbake"])
        df["util"] = (df["netto_mw"].abs() / ntc_i_retning)
        df["util"] = df["util"].replace([float("inf"), float("-inf")], pd.NA)
        # Minst én velfylt retning holder (flyt er som regel enveis).
        df["dekning"] = df[["dek_ab", "dek_ba"]].max(axis=1)
        df = df.dropna(subset=["dekning"])

        biter.append(df[["netto_mw", "ntc_fram", "ntc_tilbake", "util", "dekning"]])
        print(f"    {a}|{b} {y_start:%Y} ferdig")

    if not biter:
        return pd.DataFrame()
    ut = pd.concat(biter).reset_index()
    ut["grense"] = grense_id(a, b)
    return ut


# --- Upsert (merge + dedup, bevarer tidligere år og andre serier) ------------

def upsert_hist(hist, ny) -> pd.DataFrame:
    samlet = ny if hist is None else pd.concat([hist, ny], ignore_index=True)
    samlet["dato"] = pd.to_datetime(samlet["dato"])
    samlet = (samlet.drop_duplicates(["dato", "sone", "serie"], keep="last")
                    .sort_values(["serie", "sone", "dato"]).reset_index(drop=True))
    samlet.to_parquet(HIST_FIL, index=False)
    return samlet


def upsert_utv(utv, ny) -> pd.DataFrame:
    samlet = ny if utv is None else pd.concat([utv, ny], ignore_index=True)
    samlet["dato"] = pd.to_datetime(samlet["dato"])
    samlet = (samlet.drop_duplicates(["dato", "grense"], keep="last")
                    .sort_values(["grense", "dato"]).reset_index(drop=True))
    samlet.to_parquet(UTV_FIL, index=False)
    return samlet


def siste_np(hist, sone):
    if hist is None or "serie" not in hist.columns:
        return None
    d = hist[(hist["serie"] == "netto_posisjon") & (hist["sone"] == sone)]
    return None if d.empty else d["dato"].max()


def siste_grense(utv, gid):
    if utv is None:
        return None
    d = utv[utv["grense"] == gid]
    return None if d.empty else d["dato"].max()


# --- Hovedløkke --------------------------------------------------------------

def kjor():
    klient = lag_klient()

    print("=== T1: Netto posisjon per sone ===")
    hist = les(HIST_FIL)
    nye_np = []
    for sone in SONER:
        fra = start_fra(siste_np(hist, sone))
        if fra >= SLUTT:
            print(f"  {sone} à jour")
            continue
        print(f"  {sone} fra {fra:%Y}")
        d = prosesser_netto_posisjon(klient, sone, fra)
        if not d.empty:
            nye_np.append(d)
    if nye_np:
        hist = upsert_hist(hist, pd.concat(nye_np, ignore_index=True))
        print(f"  -> netto_posisjon skrevet til {HIST_FIL}")

    print("=== T2/T3: Grenseflyt + NTC + utnyttelse ===")
    utv = les(UTV_FIL)
    for a, b in GRENSER:
        gid = grense_id(a, b)
        fra = start_fra(siste_grense(utv, gid))
        if fra >= SLUTT:
            print(f"  {gid} à jour")
            continue
        print(f"  {gid} fra {fra:%Y}")
        d = prosesser_grense(klient, a, b, fra)
        if not d.empty:
            utv = upsert_utv(utv, d)          # skriv per grense -> resumbart
            print(f"  -> {gid} skrevet ({len(d)} døgn)")

    print("Ferdig.")


if __name__ == "__main__":
    kjor()
