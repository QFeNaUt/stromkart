"""
bygg_regime_base.py — Lag A: regime-basen. Rådata -> betingede mønstre.

Dette er steget der alle tolkningsbeslutningene faktisk påføres:

  U1  Kabelutnyttelse med EMPIRISK nevner: rullerende 365-dagers 99-persentil
      av |flyt| per retning (min 180 dagers grensehistorikk, min 60 retnings-
      observasjoner i vinduet). Ingen administrative kapasiteter — de sluttet
      å eksistere ved flowbasert go-live (okt 2024).
  R2  Bøtter som TERSILER (Lav/Normal/Høy) — dataene definerer sitt eget normalt.
  R3  Tersilene regnes PER SONE x SESONG — "høy last" betyr høy for årstiden.
  R5  Prisutfall som MULTIPLUM av samtidig sesongnormal (rullerende: median av
      samme-sesong-døgn siste 730 dager, min 60 obs) — nøytraliserer 2022-
      nivåskiftet. LAVTERSKEL-VAKT: er normalen under GULV_EUR, byttes framing
      til absolutt (NO4-2025-tilfellet: normal ~3.6 EUR gjør multiplum absurd).
  T1  Netto posisjon tersles som de andre fysiske variablene.
      Metning: per sone og døgn, maks util over sonens grenser; "mettet" hvis
      >= 0.95 — Euphemia-signalet som ÉN skalar, ikke 15.

Utdata: regime_dogn.parquet — én rad per (sone, døgn) med alle bøtte-etiketter
og prisutfall. Spørringen skjer med hent_monster() nederst: filtrer på et
UTVALG betingelser, aldri alle på én gang (N>=30-vakten avgjør).

Kjøring:
    python analyse\\bygg_regime_base.py     (bygger + kjører demospørringer)
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

# --- Konfig ------------------------------------------------------------------

PROXY_VINDU = "365D"      # rullerende vindu for empirisk kapasitet (U1)
PROXY_KVANTIL = 0.99
MIN_HISTORIKK_DAGER = 180  # grensens alder før noen util regnes
MIN_RETNINGS_OBS = 60      # observasjoner i vinduet per retning
METTET_GRENSE = 0.95

NORMAL_VINDU_DAGER = 730   # sesongnormal: samme-sesong-døgn siste 2 år (R5)
MIN_NORMAL_OBS = 60
GULV_EUR = 10.0            # under dette: absolutt framing, ikke multiplum

MIN_N = 30                 # utvalgsvakten i hent_monster

BUCKET_VARS = ["last", "vind", "magasin", "netto_posisjon"]
BUCKET_NAVN = ["Lav", "Normal", "Høy"]

# Hvilke soner hver grense berører (for metnings-skalaren).
GRENSE_SONER = {
    "NO_1|SE_3": ["NO_1"], "NO_2|NL": ["NO_2"], "NO_2|DE_LU": ["NO_2"],
    "NO_2|DK_1": ["NO_2"], "NO_2|GB": ["NO_2"], "NO_3|SE_2": ["NO_3"],
    "NO_4|SE_1": ["NO_4"], "NO_4|SE_2": ["NO_4"], "NO_4|FI": ["NO_4"],
    "NO_1|NO_2": ["NO_1", "NO_2"], "NO_1|NO_3": ["NO_1", "NO_3"],
    "NO_1|NO_5": ["NO_1", "NO_5"], "NO_2|NO_5": ["NO_2", "NO_5"],
    "NO_3|NO_4": ["NO_3", "NO_4"], "NO_3|NO_5": ["NO_3", "NO_5"],
}


def finn(navn: str) -> str | None:
    for k in [os.path.join(os.path.dirname(__file__), "..", "data", navn),
              os.path.join(os.path.dirname(__file__), "..", navn), navn]:
        if os.path.exists(k):
            return k
    return None


def sesong(mnd: pd.Series) -> pd.Series:
    return pd.cut(mnd % 12, bins=[-1, 1, 4, 7, 10, 11],
                  labels=["Vinter", "Vår", "Sommer", "Høst", "Vinter"],
                  ordered=False)


# --- U1: empirisk utnyttelse per grense --------------------------------------

def beregn_util(utv: pd.DataFrame) -> pd.DataFrame:
    """util = |flyt| / rullerende p99 av |flyt| i SAMME retning."""
    biter = []
    for gid, g in utv.groupby("grense"):
        g = g.sort_values("dato").set_index("dato")
        forste = g.index.min()
        abs_flyt = g["netto_mw"].abs()
        retning = np.sign(g["netto_mw"])

        proxy = pd.Series(index=g.index, dtype="float64")
        for r in (1.0, -1.0):
            m = retning == r
            if m.sum() == 0:
                continue
            p = (abs_flyt[m].rolling(PROXY_VINDU, min_periods=MIN_RETNINGS_OBS)
                 .quantile(PROXY_KVANTIL))
            proxy.loc[m] = p
        # Retning 0 (eksakt null flyt): util er 0 uansett nevner; bruk maks proxy.
        m0 = retning == 0
        if m0.any():
            proxy.loc[m0] = proxy.ffill().loc[m0]

        util = abs_flyt / proxy
        # Minimums-historikk: ingen util før grensen er 180 dager gammel.
        util[g.index < forste + pd.Timedelta(days=MIN_HISTORIKK_DAGER)] = np.nan

        biter.append(pd.DataFrame({"dato": g.index, "grense": gid,
                                   "util_emp": util.values}))
    return pd.concat(biter, ignore_index=True)


def sone_metning(util_df: pd.DataFrame) -> pd.DataFrame:
    """Per (sone, døgn): maks empirisk util over sonens grenser."""
    rader = []
    for gid, soner in GRENSE_SONER.items():
        d = util_df[util_df["grense"] == gid][["dato", "util_emp"]]
        for s in soner:
            rader.append(d.assign(sone=s))
    alle = pd.concat(rader, ignore_index=True)
    return (alle.groupby(["sone", "dato"], as_index=False)["util_emp"].max()
                .rename(columns={"util_emp": "maks_util"}))


# --- R2/R3: tersiler per sone x sesong ---------------------------------------

def legg_paa_botter(bred: pd.DataFrame) -> pd.DataFrame:
    for var in BUCKET_VARS:
        if var not in bred.columns:
            continue
        def tersle(g: pd.Series) -> pd.Series:
            gy = g.dropna()
            if len(gy) < 3 * MIN_N:          # for tynt til å tersle ærlig
                return pd.Series(pd.NA, index=g.index, dtype="object")
            q1, q2 = gy.quantile([1 / 3, 2 / 3])
            return pd.cut(g, bins=[-np.inf, q1, q2, np.inf], labels=BUCKET_NAVN
                          ).astype("object")
        bred[f"b_{var}"] = (bred.groupby(["sone", "sesong"], observed=True)[var]
                                .transform(tersle))
    return bred


# --- R5: relativ pris med lavterskel-vakt ------------------------------------

def legg_paa_prisutfall(bred: pd.DataFrame) -> pd.DataFrame:
    bred = bred.sort_values(["sone", "dato"]).reset_index(drop=True)
    normaler = np.full(len(bred), np.nan)
    for (_, ses), g in bred.groupby(["sone", "sesong"], observed=True):
        # Samme-sesong-døgn: rullerende median over 730 kalenderdager.
        s = g.set_index("dato")["pris"]
        norm = s.rolling(f"{NORMAL_VINDU_DAGER}D",
                         min_periods=MIN_NORMAL_OBS).median().shift(1)
        normaler[g.index] = norm.values
    bred["pris_normal"] = normaler
    bred["framing"] = np.where(bred["pris_normal"] < GULV_EUR,
                               "absolutt", "relativ")
    bred.loc[bred["pris_normal"].isna(), "framing"] = pd.NA
    bred["rel_pris"] = np.where(bred["framing"] == "relativ",
                                bred["pris"] / bred["pris_normal"], np.nan)
    return bred


# --- Bygging -----------------------------------------------------------------

def bygg() -> pd.DataFrame:
    hist_sti, utv_sti = finn("historikk_dogn.parquet"), finn("utveksling_dogn.parquet")
    if not hist_sti or not utv_sti:
        sys.exit("Fant ikke parquet-filene — kjør backfill/utveksling først.")

    hist = pd.read_parquet(hist_sti)
    hist["dato"] = pd.to_datetime(hist["dato"])
    bred = (hist.pivot_table(index=["dato", "sone"], columns="serie",
                             values="verdi").reset_index())

    utv = pd.read_parquet(utv_sti)
    utv["dato"] = pd.to_datetime(utv["dato"])
    metning = sone_metning(beregn_util(utv))
    bred = bred.merge(metning, on=["dato", "sone"], how="left")
    bred["mettet"] = np.where(bred["maks_util"].isna(), pd.NA,
                              bred["maks_util"] >= METTET_GRENSE)

    bred["sesong"] = sesong(bred["dato"].dt.month)
    bred = legg_paa_botter(bred)
    bred = legg_paa_prisutfall(bred)

    ut_sti = os.path.join(os.path.dirname(hist_sti), "regime_dogn.parquet")
    bred.to_parquet(ut_sti, index=False)
    print(f"Regime-basen skrevet: {ut_sti} ({len(bred)} sone-døgn)\n")
    return bred


# --- Spørring med N>=30-vakt -------------------------------------------------

def hent_monster(base: pd.DataFrame, sone: str, betingelser: dict,
                 min_n: int = MIN_N):
    """Betinget telling: filtrer på sone + et UTVALG bøtte-betingelser.
    Returnerer dict med median-utfall og N — eller None hvis N < min_n.
    betingelser: f.eks. {"sesong": "Vinter", "b_last": "Høy", "b_vind": "Lav"}
    """
    m = base["sone"] == sone
    for kol, verdi in betingelser.items():
        m &= base[kol] == verdi
    d = base[m]
    n = len(d)
    if n < min_n:
        return {"sone": sone, "betingelser": betingelser, "n": n,
                "svar": None,
                "melding": f"For tynt utvalg (N={n} < {min_n}) — ingen påstand."}

    rel = d["rel_pris"].dropna()
    abs_ = d["pris"].dropna()
    andel_abs = (d["framing"] == "absolutt").mean()
    if andel_abs > 0.5 or rel.empty:          # lavterskel-vakten dominerer
        svar = {"framing": "absolutt", "median_pris_eur": round(abs_.median(), 1)}
    else:
        svar = {"framing": "relativ",
                "median_multiplum": round(rel.median(), 2),
                "median_pris_eur": round(abs_.median(), 1)}
    return {"sone": sone, "betingelser": betingelser, "n": n, "svar": svar}


# --- Demo --------------------------------------------------------------------

if __name__ == "__main__":
    base = bygg()

    print("=== Bøtte-dekning (andel døgn med etikett) ===")
    for var in BUCKET_VARS + ["mettet"]:
        kol = f"b_{var}" if var in BUCKET_VARS else var
        if kol in base.columns:
            print(f"  {kol:20s} {base[kol].notna().mean():.1%}")
    print()

    demoer = [
        ("NO_2", {"sesong": "Vinter", "b_last": "Høy", "b_vind": "Lav"}),
        ("NO_2", {"sesong": "Vinter", "b_last": "Høy", "b_vind": "Lav",
                  "mettet": True}),
        ("NO_2", {"sesong": "Vinter", "b_last": "Høy", "b_vind": "Lav",
          "mettet": False}),          
        ("NO_4", {"sesong": "Sommer", "b_magasin": "Høy"}),
        ("NO_5", {"sesong": "Vinter", "b_magasin": "Lav", "b_last": "Høy"}),
        ("NO_1", {"sesong": "Høst", "b_last": "Høy", "b_vind": "Høy",
                  "b_magasin": "Lav"}),
    ]
    print("=== Demospørringer (betingede mønstre) ===")
    for sone_, bet in demoer:
        r = hent_monster(base, sone_, bet)
        print(f"\n{sone_} | {bet}")
        if r["svar"] is None:
            print(f"  -> {r['melding']}")
        else:
            print(f"  -> N={r['n']}: {r['svar']}")
