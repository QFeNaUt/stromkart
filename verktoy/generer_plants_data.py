# -*- coding: utf-8 -*-
"""
Strømkartet — kuratering av kraftverk, steg 2: GENERER plants-data.js

Leser de gjennomgåtte CSV-ene (behold=JA, kategori satt) og genererer den
frosne frontend-datamodulen:

    frontend/src/js/plants-data.js

To ting utover ren lesing:
  1. ENCODING-FALLBACK: Excel på Windows lagrer ofte semikolon-CSV som CP1252
     (ANSI), ikke UTF-8. Vi prøver utf-8-sig først, så cp1252.
  2. 500m-SAMMENSLÅING: anlegg som ligger nærmere enn 500 m slås sammen til én
     markør (summert MW/GWh), per kategori. «Flood-fill»-klynging: start med ett
     anlegg, dra inn alle innenfor bufferen, så alle innenfor bufferen av DEM,
     til klyngen er lukket. Hver sammenslåing RAPPORTERES så du kan godkjenne.

Kjøres fra verktoy/ (eller repo-roten):
    python generer_plants_data.py
"""

import csv
import datetime
import json
import math
import sys
import unicodedata
from pathlib import Path

# --- Stier (ankret til skriptets plassering, så cwd ikke spiller rolle) ----
HER = Path(__file__).resolve().parent
REPO = HER.parent
CSV_VANN = HER / "kandidater_vannkraft.csv"
CSV_VIND = HER / "kandidater_vindkraft.csv"
_maal = REPO / "frontend" / "src" / "js"
if not _maal.exists():
    raise SystemExit(f"Målmappen finnes ikke: {_maal} — er repo-strukturen endret?")
UTFIL = _maal / "plants-data.js"

BUFFER_M = 500  # sammenslåingsavstand

# Grov Norge-boks — fanger byttet lon/lat og tastefeil.
LON_MIN, LON_MAX = 4.0, 32.0
LAT_MIN, LAT_MAX = 57.5, 71.5

# Foretrukket navn på sammenslåtte klynger, nøklet på det STØRSTE medlemmet.
# Uten treff her brukes det største medlemmets navn direkte. Rapporten viser
# resultatet så du kan justere denne ordboka ved behov.
KLYNGE_NAVN = {
    "Sy-Sima":    "Sima",
    "Holen I-II": "Holen",
    "Suldal I":   "Suldal",
    "Matre H":    "Matre",
    "Bjerkreim":  "Bjerkreim",
}

# Rekkefølge på kategoriene i output.
TYPE_ORDER = {"magasin": 0, "elv": 1, "vind": 2}


# ---------------------------------------------------------------------------
# Lesing + validering
# ---------------------------------------------------------------------------
def les_csv(sti, gyldige_kategorier):
    """Leser en kandidat-CSV (behold=JA) med encoding-fallback og validerer."""
    rader = None
    for enc in ("utf-8-sig", "cp1252"):
        try:
            with open(sti, encoding=enc, newline="") as f:
                rader = list(csv.DictReader(f, delimiter=";"))
            break
        except FileNotFoundError:
            print(f"FEIL: fant ikke {sti} — kjør hent_kraftverk_kandidater.py først.",
                  file=sys.stderr)
            sys.exit(1)
        except UnicodeDecodeError:
            continue
    if rader is None:
        print(f"FEIL: klarte ikke dekode {sti} (verken utf-8 eller cp1252).",
              file=sys.stderr)
        sys.exit(1)

    valgte, feil = [], []
    for radnr, rad in enumerate(rader, start=2):
        if rad.get("behold", "").strip().upper() != "JA":
            continue
        navn = rad["navn"].strip()
        kategori = rad.get("kategori", "").strip().lower()
        if kategori not in gyldige_kategorier:
            feil.append(f"{sti.name} rad {radnr} ({navn}): kategori '{kategori}' "
                        f"ikke blant {sorted(gyldige_kategorier)}")
            continue
        try:
            lon = float(str(rad["lon"]).replace(",", "."))
            lat = float(str(rad["lat"]).replace(",", "."))
            mw = float(str(rad["mw"]).replace(",", "."))
            gwh_rå = str(rad.get("gwh", "")).replace(",", ".").strip()
            gwh = float(gwh_rå) if gwh_rå else None
        except ValueError:
            feil.append(f"{sti.name} rad {radnr} ({navn}): lon/lat/mw/gwh ikke tall")
            continue
        if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
            feil.append(f"{sti.name} rad {radnr} ({navn}): [{lon}, {lat}] "
                        f"utenfor Norge-boksen — byttet lon/lat?")
            continue
        valgte.append({
            "name": navn, "type": kategori, "mw": mw, "gwh": gwh,
            "owner": (rad.get("eier") or "").strip() or None,
            "municipality": (rad.get("kommune") or "").strip() or None,
            "zone": (rad.get("sone") or "").strip() or None,
            "coord": [round(lon, 6), round(lat, 6)],
        })

    if feil:
        print("Valideringsfeil — ingenting skrevet:", file=sys.stderr)
        for m in feil:
            print(f"  - {m}", file=sys.stderr)
        sys.exit(1)
    return valgte


# ---------------------------------------------------------------------------
# Klynging + sammenslåing
# ---------------------------------------------------------------------------
def haversine_m(a, b):
    """Avstand i meter mellom to [lon, lat]-punkter."""
    R = 6371000
    lon1, lat1, lon2, lat2 = *a, *b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    h = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(h))


def klyngedel(anlegg, buffer_m):
    """Flood-fill-klynging: grupperer anlegg som (transitivt) ligger nærmere
    enn buffer_m. Returnerer en liste av klynger (hver klynge = liste anlegg)."""
    ubesokt = set(range(len(anlegg)))
    klynger = []
    while ubesokt:
        ko = [ubesokt.pop()]           # startfrø for en ny klynge
        klynge = list(ko)
        while ko:
            i = ko.pop()
            for j in list(ubesokt):
                if haversine_m(anlegg[i]["coord"], anlegg[j]["coord"]) <= buffer_m:
                    ubesokt.discard(j)
                    ko.append(j)
                    klynge.append(j)
        klynger.append([anlegg[k] for k in klynge])
    return klynger


def slaa_sammen(klynge):
    """Slår en klynge (≥1 anlegg) til ett anlegg. Summerer MW/GWh; posisjon,
    eier, kommune og sone arves fra det STØRSTE medlemmet."""
    storst = max(klynge, key=lambda a: a["mw"])
    if len(klynge) == 1:
        return dict(storst), None  # ingen merge-rapport

    navn = KLYNGE_NAVN.get(storst["name"], storst["name"])
    gwh_verdier = [a["gwh"] for a in klynge if a["gwh"] is not None]
    slaatt = {
        "name": navn, "type": storst["type"],
        "mw": round(sum(a["mw"] for a in klynge), 1),
        "gwh": round(sum(gwh_verdier)) if gwh_verdier else None,
        "owner": storst["owner"], "municipality": storst["municipality"],
        "zone": storst["zone"], "coord": storst["coord"],
        "members": [a["name"] for a in klynge],
    }
    rapport = (f"  {navn}: {' + '.join(a['name'] for a in klynge)} "
               f"-> {slaatt['mw']:.1f} MW"
               + (f", {slaatt['gwh']} GWh" if slaatt['gwh'] is not None else ""))
    return slaatt, rapport


# ---------------------------------------------------------------------------
# ID + skriving
# ---------------------------------------------------------------------------
def lag_id(navn):
    n = unicodedata.normalize("NFKC", navn).lower().strip()
    n = n.replace("æ", "ae").replace("ø", "o").replace("å", "a")
    n = "".join(c if c.isalnum() else "-" for c in n)
    while "--" in n:
        n = n.replace("--", "-")
    return n.strip("-")


def main():
    magasin_elv = les_csv(CSV_VANN, {"magasin", "elv"})
    vind = les_csv(CSV_VIND, {"vind"})
    alle = magasin_elv + vind

    # Klynging PER kategori (magasin/elv/vind slås aldri sammen på tvers).
    print(f"Sammenslåing innenfor {BUFFER_M} m (per kategori):")
    resultat, noen_merge = [], False
    for kategori in ("magasin", "elv", "vind"):
        gruppe = [a for a in alle if a["type"] == kategori]
        for klynge in klyngedel(gruppe, BUFFER_M):
            slaatt, rapport = slaa_sammen(klynge)
            resultat.append(slaatt)
            if rapport:
                print(rapport)
                noen_merge = True
    if not noen_merge:
        print("  (ingen klynger funnet)")

    # Tildel id (med duplikat-vakt) og sorter.
    sett = {}
    for a in resultat:
        a["id"] = lag_id(a["name"])
        if a["id"] in sett:
            a["id"] = f"{a['id']}-{lag_id(a['municipality'] or 'x')}"
        sett[a["id"]] = True
    resultat.sort(key=lambda a: (TYPE_ORDER[a["type"]], -a["mw"]))

    print("\nAntall markører per kategori (etter sammenslåing):")
    for kategori in ("magasin", "elv", "vind"):
        n = sum(1 for a in resultat if a["type"] == kategori)
        print(f"  {kategori:8s}: {n}")
    print(f"  {'SUM':8s}: {len(resultat)}")

    # --- Skriv modulen ------------------------------------------------------
    def rydd(a):
        # Fast nøkkelrekkefølge; dropp members hvis singel.
        d = {"id": a["id"], "name": a["name"], "type": a["type"],
             "mw": a["mw"],
             "gwh": round(a["gwh"]) if a["gwh"] is not None else None,
             "zone": a["zone"],
             "owner": a["owner"], "municipality": a["municipality"],
             "coord": a["coord"]}
        if a.get("members"):
            d["members"] = a["members"]
        return d

    poster = ",\n".join("  " + json.dumps(rydd(a), ensure_ascii=False) for a in resultat)
    dato = datetime.date.today().isoformat()
    innhold = f"""// plants-data.js — de største vann- og vindkraftverkene i Norge
//
// GENERERT FIL — ikke rediger for hånd. Regenereres med:
//   python hent_kraftverk_kandidater.py   (hent attributter)
//   python hent_koordinater.py            (fyll koordinater via OSM)
//   python generer_plants_data.py         (denne — kuratering + sammenslåing)
//
// Kilde: NVE (api.nve.no, NLOD) + OpenStreetMap (ODbL). Generert: {dato}
//
// type: 'magasin' | 'elv' | 'vind'   (styrer hvilket ikon markøren får)
// mw:   installert effekt (sum for sammenslåtte klynger)
// gwh:  midlere årsproduksjon (sum for sammenslåtte klynger)
// coord: [lon, lat] (WGS84) — for klynger: største anleggs posisjon
// members: kildeanleggene bak en sammenslått markør (utelatt for enkeltanlegg)

export const POWER_PLANTS = Object.freeze([
{poster}
]);
"""
    UTFIL.write_text(innhold, encoding="utf-8", newline="\n")
    print(f"\nSkrev {len(resultat)} markører -> {UTFIL}")


if __name__ == "__main__":
    main()
