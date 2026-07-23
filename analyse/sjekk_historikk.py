"""
sjekk_historikk.py — kvalitetssjekk av HELE rådata-fundamentet (v2).

Utvidet etter inkrement 2: sjekker nå begge parquet-filene —
  historikk_dogn.parquet   (per sone:  pris, last, vind, magasin, netto_posisjon)
  utveksling_dogn.parquet  (per grense: netto_mw, ntc_fram, ntc_tilbake, util)

Svarer fortsatt på "er rådataen sunn?" — ikke på "holder N>=30?" (det avgjøres
i regime-steget når bøttene er definert).

Kjøring:
    python analyse\\sjekk_historikk.py
"""

import os
import pandas as pd

pd.set_option("display.width", 120)


def finn(navn: str):
    for k in [os.path.join(os.path.dirname(__file__), "..", "data", navn),
              os.path.join(os.path.dirname(__file__), "..", navn),
              navn]:
        if os.path.exists(k):
            return k
    return None


# ============================================================
# DEL 1 — historikk_dogn.parquet (per sone)
# ============================================================
STI = finn("historikk_dogn.parquet")
if STI is None:
    raise SystemExit("Fant ikke historikk_dogn.parquet.")
print(f"Leser: {os.path.abspath(STI)}\n")

df = pd.read_parquet(STI)
df["dato"] = pd.to_datetime(df["dato"])

print("=== Grunnform ===")
print(f"Rader totalt: {len(df):,}")
print(f"Serier:       {sorted(df['serie'].unique())}")
print()

print("=== Datospenn per serie ===")
print(df.groupby("serie")["dato"].agg(["min", "max", "count"]))
print()

print("=== Antall døgn per serie x sone ===")
print(df.groupby(["serie", "sone"]).size().unstack("sone"))
print()

# Magasin-fornuft: fyllingsgrad skal ligge i [0, 1] (eller [0, 100] hvis NVE
# gir prosent — sjekken avslører hvilken skala vi faktisk fikk).
if "magasin" in df["serie"].values:
    mag = df[df["serie"] == "magasin"]
    print("=== Magasin: verdiområde per sone (skala-sjekk) ===")
    print(mag.groupby("sone")["verdi"].agg(["min", "median", "max"]).round(3))
    print()

# Netto posisjon-fornuft: NO4 bør være tungt positiv (overskudd i nord),
# NO1 typisk negativ (forbrukstung). Fortegnene er selve sanity-sjekken.
if "netto_posisjon" in df["serie"].values:
    np_ = df[df["serie"] == "netto_posisjon"]
    print("=== Netto posisjon (MW, + = eksport): median per sone per år ===")
    np_ = np_.assign(år=np_["dato"].dt.year)
    print(np_.pivot_table(values="verdi", index="år", columns="sone",
                          aggfunc="median").round(0))
    print()

print("=== Median pris (EUR/MWh) per år per sone ===")
pris = df[df["serie"] == "pris"].assign(år=lambda d: d["dato"].dt.year)
print(pris.pivot_table(values="verdi", index="år", columns="sone",
                       aggfunc="median").round(1))
print()

# ============================================================
# DEL 2 — utveksling_dogn.parquet (per grense)
# ============================================================
STI2 = finn("utveksling_dogn.parquet")
if STI2 is None:
    print("(utveksling_dogn.parquet ikke funnet — hopper over del 2)")
    raise SystemExit(0)
print(f"Leser: {os.path.abspath(STI2)}\n")

utv = pd.read_parquet(STI2)
utv["dato"] = pd.to_datetime(utv["dato"])

print("=== Døgn og datospenn per grense ===")
print(utv.groupby("grense")["dato"].agg(["min", "max", "count"]))
print()

# NTC-tilgjengelighet: andelen døgn der util faktisk kunne beregnes. Dette
# tallet avgjør om T2 (utnyttelse) bærer for hver grense, eller om noen
# (GB er kandidaten) må klare seg med bare netto flyt i regime-steget.
print("=== NTC-tilgjengelighet: andel døgn med beregnbar util ===")
tilg = utv.groupby("grense").agg(
    dogn=("dato", "size"),
    med_util=("util", lambda s: s.notna().sum()),
)
tilg["andel_util"] = (tilg["med_util"] / tilg["dogn"]).round(3)
print(tilg.sort_values("andel_util"))
print()

# Util-fordeling: median og andel "mettede" døgn (util >= 0.95). Metnings-
# andelen er selve Euphemia-signalet — grenser som ofte er bindende.
print("=== Utnyttelse: median og andel døgn >= 95 % (der util finnes) ===")
u = utv.dropna(subset=["util"])
oppsum = u.groupby("grense").agg(
    median_util=("util", "median"),
    andel_mettet=("util", lambda s: (s >= 0.95).mean()),
).round(3)
print(oppsum.sort_values("andel_mettet", ascending=False))
print()

# Advarsel hvis util > 1.2 forekommer ofte — tegn på at flyt og NTC ikke er
# på samme skala/retning for en grense (dataproblem verdt å se på).
rare = u[u["util"] > 1.2].groupby("grense").size()
if len(rare):
    print("ADVARSEL — døgn med util > 1.2 (flyt/NTC-mismatch?):")
    print(rare)
else:
    print("Ingen grenser med util > 1.2 — flyt og NTC ser konsistente ut.")
