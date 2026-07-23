"""
hent_magasin.py — inkrement 2, del 1: magasinfylling fra NVE.

NVE publiserer UKENTLIG fyllingsgrad per elspotområde (NO1-NO5). Vi henter hele
den offentlige historikken i ett kall (ingen API-nøkkel), plukker ut
elspotområdene (omrType == "EL"), bygger en dato fra (ISO-år, ISO-uke), og
FORWARD-FYLLER den ukentlige verdien ned til døgn — hver dag arver forrige
søndagsmåling til neste kommer. Standard praksis for å slå ukentlig magasindata
sammen med de daglige seriene.

Resultatet legges inn i historikk_dogn.parquet som serie "magasin", ved siden av
pris/last/vind fra backfillen. Kjøres den på nytt, ERSTATTES magasin-radene reint
(idempotent) — resten av parquet-en røres ikke.

Kjøring:
    pip install requests pandas pyarrow
    python analyse\\hent_magasin.py
"""

import os
import sys

import pandas as pd

try:
    import requests
except ImportError:
    sys.exit("Mangler requests. Kjør: pip install requests")

URL = "https://biapi.nve.no/magasinstatistikk/api/Magasinstatistikk/HentOffentligData"

# Fila deles med backfillen. Vi leter på de samme stedene.
KANDIDATER = [
    os.path.join(os.path.dirname(__file__), "..", "data", "historikk_dogn.parquet"),
    os.path.join(os.path.dirname(__file__), "..", "historikk_dogn.parquet"),
    "historikk_dogn.parquet",
]
START = pd.Timestamp("2021-01-01")

# NVE bruker omrnr 1-5 for elspotområdene NO1-NO5 (omrType == "EL").
OMR_TIL_SONE = {1: "NO_1", 2: "NO_2", 3: "NO_3", 4: "NO_4", 5: "NO_5"}


def finn_parquet() -> str:
    for k in KANDIDATER:
        if os.path.exists(k):
            return k
    # Fila finnes ikke ennå — skriv til data/ hvis mappa finnes, ellers repo-rot.
    data_mappe = os.path.dirname(KANDIDATER[0])
    return KANDIDATER[0] if os.path.isdir(data_mappe) else KANDIDATER[2]


def hent_nve() -> pd.DataFrame:
    print("Henter offentlig magasinstatistikk fra NVE ...")
    r = requests.get(URL, timeout=60)
    r.raise_for_status()
    df = pd.DataFrame(r.json())

    # Defensiv: bekreft at feltnavnene er som forventet før vi bruker dem.
    forventet = {"omrType", "omrnr", "iso_aar", "iso_uke", "fyllingsgrad"}
    if not forventet.issubset(df.columns):
        sys.exit(f"Uventede feltnavn fra NVE. Fikk: {list(df.columns)}\n"
                 f"Forventet minst: {sorted(forventet)}")

    df = df[df["omrType"] == "EL"].copy()
    df["omrnr"] = df["omrnr"].astype(int)
    df = df[df["omrnr"].isin(OMR_TIL_SONE)]
    df["sone"] = df["omrnr"].map(OMR_TIL_SONE)

    # ISO-år + ISO-uke -> dato. %G=ISO-år, %V=ISO-uke, %u=7 gir søndag (ukeslutt).
    # errors="coerce": én ugyldig (år, uke)-kombinasjon (f.eks. uke 53 i et
    # 52-ukers år) skal forkastes SYNLIG, ikke krasje hele importen.
    df["dato"] = pd.to_datetime(
        df["iso_aar"].astype(int).astype(str) + "-W"
        + df["iso_uke"].astype(int).astype(str).str.zfill(2) + "-7",
        format="%G-W%V-%u", errors="coerce",
    )
    ugyldige = int(df["dato"].isna().sum())
    if ugyldige:
        print(f"ADVARSEL: {ugyldige} rader med ugyldig (iso_aar, iso_uke) "
              f"forkastet fra NVE-responsen.")
        df = df.dropna(subset=["dato"])
    return df[["dato", "sone", "fyllingsgrad"]].sort_values(["sone", "dato"])


def til_dogn(df: pd.DataFrame) -> pd.DataFrame:
    """Ukentlig -> daglig per sone, ved forward-fill."""
    biter = []
    i_dag = pd.Timestamp.today().normalize()
    for sone, g in df.groupby("sone"):
        uke = g.set_index("dato")["fyllingsgrad"].astype(float).sort_index()
        dag = pd.date_range(uke.index.min(), i_dag, freq="D")
        fylt = uke.reindex(dag).ffill()
        d = pd.DataFrame({"dato": fylt.index, "verdi": fylt.values})
        d["sone"] = sone
        biter.append(d)

    res = pd.concat(biter, ignore_index=True)
    res = res[res["dato"] >= START].copy()
    res["serie"] = "magasin"
    # NB: dekning = 1.0 er en formalitet — magasin er offisiell ukesdata som
    # forward-fylles, ikke en time-måling. Den har ingen time-dekning å vokte.
    res["dekning"] = 1.0
    return res[["dato", "sone", "serie", "verdi", "dekning"]]


def skriv(res: pd.DataFrame) -> None:
    sti = finn_parquet()
    if os.path.exists(sti):
        gammel = pd.read_parquet(sti)
        gammel["dato"] = pd.to_datetime(gammel["dato"])
        gammel = gammel[gammel["serie"] != "magasin"]      # erstatt magasin reint
        samlet = pd.concat([gammel, res], ignore_index=True)
    else:
        samlet = res
    samlet = (samlet
              .drop_duplicates(["dato", "sone", "serie"], keep="last")
              .sort_values(["serie", "sone", "dato"])
              .reset_index(drop=True))
    samlet.to_parquet(sti, index=False)
    print(f"Skrevet 'magasin' til {sti}: {len(res)} rader "
          f"({res['sone'].nunique()} soner, "
          f"{res['dato'].min():%Y-%m-%d} → {res['dato'].max():%Y-%m-%d}).")


if __name__ == "__main__":
    skriv(til_dogn(hent_nve()))
