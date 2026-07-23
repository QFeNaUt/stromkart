"""
bygg_historikk.py — steg 1 i RAG-regime-basen: historisk backfill til Parquet.

HVA SKRIPTET GJØR
-----------------
Henter 5 år historikk fra ENTSO-E for de tre kildeseriene som IKKE har
topologi-tvetydighet — pris, last, vindproduksjon — for alle fem prissoner
(NO1–NO5), resampler til DØGN, og skriver alt til én Parquet-fil i langt
format. Magasin (fra NVE) og utveksling/kapasitet (som krever kabeltopologi)
kommer som egne inkrementer.

HVORFOR LANGT FORMAT ([dato, sone, serie, verdi, dekning])
----------------------------------------------------------
Én sannhetskilde, trivielt å appende, og regime-steget (neste skript) kan
pivotere fritt. En ny serie = bare nye rader, aldri en skjemaendring.

ROBUSTHET (jf. prosjektets ENTSO-E-lærdommer)
---------------------------------------------
* Måned-for-måned per (serie, sone) med pause mellom kall — sprer lasten så
  vi ikke trigger rate-grensa i én byge.
* GJENOPPTAKBAR: leser eksisterende Parquet, finner siste dato per serie, og
  fortsetter derfra. Et avbrudd (rate-grense, strømbrudd) starter aldri på null.
* 429/HTTP-feil → eksponentiell backoff. Tom respons (NoMatchingDataError)
  behandles som et ekte hull, ikke en krasj.
* DEKNINGSVAKT: hver døgnverdi får en dekningsgrad (andel reelle timer). Korte
  hull (<= INTERP_MAKS_TIMER) interpoleres lineært FØR snittet; dager under
  DEKNING_MIN forkastes helt. Vi regner aldri et døgnsnitt av nesten ingenting
  og later som det er data — sannhetsvakten fra 6. juli, flyttet til kilden.

KJØRING
-------
    pip install entsoe-py pandas pyarrow python-dotenv
    # ENTSOE_API_TOKEN må ligge i miljøet eller i en .env-fil i samme mappe.
    python bygg_historikk.py
"""

from __future__ import annotations

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


# --- Konfigurasjon (juster her) ----------------------------------------------

SONER = ["NO_1", "NO_2", "NO_3", "NO_4", "NO_5"]

# 5 år tilbake. Kabelæraen (NordLink/NSL) starter 2021 — men pris-TOLKNINGEN
# (relativt utfall + rullerende vindu, jf. R5) håndteres nedstrøms, så selve
# rådata-laget kan trygt gå så langt tilbake ENTSO-E serverer.
START = pd.Timestamp("2021-01-01", tz="Europe/Oslo")
SLUTT = pd.Timestamp(date.today(), tz="Europe/Oslo")

TIDSSONE = "Europe/Oslo"          # døgn = norsk kalenderdøgn (håndterer DST)
UTFIL = "historikk_dogn.parquet"

INTERP_MAKS_TIMER = 3             # lineær utfylling KUN for hull <= 3 timer
DEKNING_MIN = 0.90                # forkast døgn med under 90 % reelle timer
PAUSE_SEK = 1.5                   # pause mellom API-kall (snill mot ENTSO-E)
BACKOFF_START_SEK = 5             # første ventetid ved rate-grense/feil
BACKOFF_MAKS_FORSOK = 5           # antall forsøk før vi gir opp ett vindu

# Seriene dette skriptet dekker. psr_type "B19" = Wind Onshore (NO har praktisk
# talt ikke offshore i perioden). pris/last tar ikke psr_type.
SERIER = {
    "pris": {"metode": "query_day_ahead_prices", "psr": None},
    "last": {"metode": "query_load", "psr": None},
    "vind": {"metode": "query_generation", "psr": "B19"},
}


# --- Klient og token ---------------------------------------------------------

def lag_klient() -> EntsoePandasClient:
    token = os.environ.get("ENTSOE_API_TOKEN")
    if not token:
        try:
            from dotenv import load_dotenv
            load_dotenv()
            token = os.environ.get("ENTSOE_API_TOKEN")
        except ImportError:
            pass
    if not token:
        sys.exit("Fant ikke ENTSOE_API_TOKEN i miljøet eller i .env.")
    return EntsoePandasClient(api_key=token)


# --- Henting av ett vindu (med backoff) --------------------------------------

def _til_series(svar) -> pd.Series:
    """query_load/query_generation gir DataFrame; pris gir Series. Vi vil ha
    én rein tallserie uansett, tidssone-normalisert til Europe/Oslo."""
    if isinstance(svar, pd.Series):
        s = svar
    else:
        df = svar
        # Foretrekk kjente kolonnenavn; ellers første kolonne (gjelder vind).
        if "Actual Load" in df.columns:
            s = df["Actual Load"]
        elif "Actual Aggregated" in df.columns:
            s = df["Actual Aggregated"]
        else:
            s = df.iloc[:, 0]
    s = pd.to_numeric(s, errors="coerce")
    if s.index.tz is None:
        s.index = s.index.tz_localize(TIDSSONE)
    else:
        s.index = s.index.tz_convert(TIDSSONE)
    return s


def _hent_raatt(klient, serie, sone, start, slutt) -> pd.Series:
    """Ett API-kall for ett (serie, sone, måned)-vindu. Returnerer en
    time-Series (kan være tom ved ekte hull). Håndterer rate-grense med
    eksponentiell backoff."""
    spec = SERIER[serie]
    metode = getattr(klient, spec["metode"])
    ventetid = BACKOFF_START_SEK
    for forsok in range(1, BACKOFF_MAKS_FORSOK + 1):
        try:
            if spec["psr"]:
                svar = metode(sone, start=start, end=slutt, psr_type=spec["psr"])
            else:
                svar = metode(sone, start=start, end=slutt)
            return _til_series(svar)
        except NoMatchingDataError:
            return pd.Series(dtype="float64")  # ekte hull, ikke en feil
        except Exception as e:  # 429/HTTP/timeout fanges bredt med vilje
            if forsok == BACKOFF_MAKS_FORSOK:
                print(f"    ! ga opp {serie}/{sone} {start:%Y-%m} "
                      f"etter {forsok} forsøk: {e}")
                return pd.Series(dtype="float64")
            print(f"    · backoff {ventetid}s ({serie}/{sone} {start:%Y-%m}): {e}")
            time.sleep(ventetid)
            ventetid *= 2
    return pd.Series(dtype="float64")


# --- Time -> døgn med dekningsvakt --------------------------------------------

def til_dogn(time_serie: pd.Series) -> pd.DataFrame:
    """Time -> døgn. Returnerer DataFrame med 'verdi' og 'dekning', indeksert
    på dato. Dager under DEKNING_MIN forkastes."""
    if time_serie.empty:
        return pd.DataFrame(columns=["verdi", "dekning"])

    # Normaliser til time-oppløsning: kollapser 15-min MTU (pris fra 2025) uten
    # datatap, og er en no-op for time-serier. Manglende timer blir NaN.
    t = time_serie.resample("h").mean()

    # Dekning FØR interpolering: andel reelle timer per døgn (23/24/25 v/ DST).
    reelle = t.notna().groupby(t.index.date).sum()
    forventet = t.groupby(t.index.date).size()
    dekning = reelle / forventet

    # Interpoler bare korte, indre hull, så snittet ikke skjevfordeles av lange.
    t_fylt = t.interpolate(limit=INTERP_MAKS_TIMER, limit_area="inside")
    snitt = t_fylt.groupby(t_fylt.index.date).mean()

    ut = pd.DataFrame({"verdi": snitt, "dekning": dekning})
    ut.index = pd.to_datetime(ut.index)
    ut.index.name = "dato"
    return ut[ut["dekning"] >= DEKNING_MIN]


# --- Månedsiterator og gjenopptakelse ----------------------------------------

def maaneder(fra: pd.Timestamp, til: pd.Timestamp):
    """Gir (start, slutt) for hver måned i [fra, til)."""
    cur = fra.normalize().replace(day=1)
    while cur < til:
        neste = cur + pd.offsets.MonthBegin(1)
        yield cur, min(neste, til)
        cur = neste


def les_eksisterende(sti: str) -> pd.DataFrame:
    if os.path.exists(sti):
        return pd.read_parquet(sti)
    return pd.DataFrame(columns=["dato", "sone", "serie", "verdi", "dekning"])


def siste_dato(df: pd.DataFrame, serie: str):
    d = df[df["serie"] == serie]
    if d.empty:
        return None
    return pd.to_datetime(d["dato"]).max()


def _skriv(df: pd.DataFrame, nye: list) -> pd.DataFrame:
    """Slår sammen nye bolker med eksisterende, dedupliserer og lagrer.
    Siste skriving vinner (keep='last'), så re-henting av en delvis måned er
    trygt."""
    tillegg = pd.concat(nye, ignore_index=True)
    samlet = pd.concat([df, tillegg], ignore_index=True)
    samlet["dato"] = pd.to_datetime(samlet["dato"])
    samlet = (samlet
              .drop_duplicates(subset=["dato", "sone", "serie"], keep="last")
              .sort_values(["serie", "sone", "dato"])
              .reset_index(drop=True))
    samlet.to_parquet(UTFIL, index=False)
    return samlet


# --- Hovedløkke --------------------------------------------------------------

def kjor():
    klient = lag_klient()
    df = les_eksisterende(UTFIL)

    for serie in SERIER:
        # Gjenoppta: start måneden etter siste lagrede dato for denne serien.
        sist = siste_dato(df, serie)
        if sist is None:
            serie_start = START
        else:
            neste = (sist + pd.Timedelta(days=1)).replace(day=1)
            serie_start = pd.Timestamp(neste).tz_localize(TIDSSONE)

        if serie_start >= SLUTT:
            print(f"[{serie}] à jour (siste: {sist:%Y-%m-%d}) — hopper over")
            continue

        print(f"[{serie}] backfill fra {serie_start:%Y-%m}")
        nye = []
        for m_start, m_slutt in maaneder(serie_start, SLUTT):
            for sone in SONER:
                raatt = _hent_raatt(klient, serie, sone, m_start, m_slutt)
                dogn = til_dogn(raatt)
                if not dogn.empty:
                    d = dogn.reset_index()
                    d["sone"] = sone
                    d["serie"] = serie
                    nye.append(d)
                time.sleep(PAUSE_SEK)
            print(f"    {m_start:%Y-%m} ferdig")

            # Skriv per måned → gjenoppisk-trygt selv midt i en kjøring.
            if nye:
                df = _skriv(df, nye)
                nye = []

    print(f"Ferdig. Skrevet til {UTFIL}: {len(df)} rader totalt.")


if __name__ == "__main__":
    kjor()
