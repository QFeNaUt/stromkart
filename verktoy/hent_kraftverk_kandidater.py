# -*- coding: utf-8 -*-
"""
Strømkartet — kuratering av kraftverk, steg 1: HENT KANDIDATER (attributter)

Henter de største vann- og vindkraftverkene fra NVEs åpne attributt-API og
skriver to CSV-filer for manuell gjennomgang:

    kandidater_vannkraft.csv   (topp N etter MaksYtelse)
    kandidater_vindkraft.csv   (topp N etter InstallertEffekt_MW)

MERK — koordinater hentes IKKE her.
  NVEs geometri-tjeneste (nve.geodataonline.no) svarte NXDOMAIN og er under
  omlegging (ny tjeneste ventet våren 2026). Vi henter derfor kun attributtene
  som virker (api.nve.no), og lar lon/lat stå tomme. Koordinatene fylles i
  neste steg med hent_koordinater.py (slår opp presis posisjon via OpenStreetMap).

  Dette er samme prinsipp som Promise.allSettled-fiksen i api.js: kjernedataene
  (navn/MW/GWh/sone) skal komme trygt gjennom selv om den skjøre kilden
  (geometri) svikter.

Arbeidsflyt:
  1. python hent_kraftverk_kandidater.py   (denne — skriver CSV-ene)
  2. python hent_koordinater.py            (fyller lon/lat interaktivt via OSM)
  3. I CSV-ene: sett behold=JA og (vannkraft) kategori=magasin/elv
  4. python generer_plants_data.py         (skriver frontend-modulen)

Kjøres lokalt på PC (krever kun `requests`):
    python hent_kraftverk_kandidater.py

Data: NVE, Norsk lisens for offentlige data (NLOD).
"""

import csv
import sys

import requests

# ---------------------------------------------------------------------------
# Konfigurasjon
# ---------------------------------------------------------------------------

# Romsligere enn de endelige listene (20+10 vann, 10 vind) så du har
# slingringsmonn under kurateringen — f.eks. hvis et anlegg viser seg å være
# pumpekraft du ikke vil ha, eller magasin/elv-klassifiseringen tvinger deg
# lenger ned på lista for å fylle elvekraft-kvoten.
ANTALL_VANN_KANDIDATER = 60
ANTALL_VIND_KANDIDATER = 18

# Verifiserte endepunkter (api.nve.no/doc, juli 2026) — disse svarer.
URL_VANN_ATTR = "https://api.nve.no/web/Powerplant/GetHydroPowerPlantsInOperation"
URL_VIND_ATTR = "https://api.nve.no/web/WindPowerplant/GetWindPowerPlantsInOperation"

TIMEOUT = 30  # sekunder — alle HTTP-kall skal ha timeout (lærdom fra backend-fiks #2)


# ---------------------------------------------------------------------------
# Hjelpefunksjon
# ---------------------------------------------------------------------------

def skriv_csv(sti, kolonner, rader):
    """Skriver CSV tilpasset norsk Excel: semikolon + UTF-8 med BOM.

    utf-8-sig gjør at Excel på Windows viser æøå riktig ved dobbeltklikk
    (samme encoding-hensyn som -F melding.txt-mønsteret i git).
    """
    with open(sti, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=kolonner, delimiter=";")
        w.writeheader()
        w.writerows(rader)
    print(f"  Skrev {len(rader)} rader -> {sti}")


# ---------------------------------------------------------------------------
# Vannkraft
# ---------------------------------------------------------------------------

def hent_vannkraft():
    print("\n=== VANNKRAFT ===")
    print("Henter attributter fra api.nve.no ...")
    resp = requests.get(URL_VANN_ATTR, timeout=TIMEOUT)
    resp.raise_for_status()
    verk = resp.json()
    print(f"  {len(verk)} vannkraftverk i drift totalt.")

    # Rene pumper produserer ikke kraft og filtreres bort. Pumpekraftverk
    # (f.eks. Saurdal) BEHOLDES — de er reelle produsenter og hører hjemme
    # i magasin-kategorien. Kolonnen 'vannkvtype' viser hvilke det gjelder,
    # så du ser dem når du klassifiserer.
    kandidater = [
        v for v in verk
        if v.get("VannKVType") in ("Kraftverk", "Pumpekraftverk")
        and v.get("MaksYtelse")
    ]
    kandidater.sort(key=lambda v: v["MaksYtelse"], reverse=True)
    kandidater = kandidater[:ANTALL_VANN_KANDIDATER]
    print(f"  Topp {len(kandidater)} etter MaksYtelse valgt som kandidater.")

    rader = [{
        "behold": "",            # <- fylles inn manuelt: JA
        "kategori": "",          # <- fylles inn manuelt: magasin / elv
        "navn": v["Navn"],
        "mw": v["MaksYtelse"],
        "gwh": v.get("MidProd_91_20"),
        "sone": f"NO{v.get('ElspotomraadeNummer')}",
        "eier": v.get("HovedEier"),
        "kommune": v.get("Kommune"),
        "lon": "",               # <- fylles av hent_koordinater.py
        "lat": "",               # <- fylles av hent_koordinater.py
        "vannkvtype": v.get("VannKVType"),
    } for v in kandidater]

    skriv_csv(
        "kandidater_vannkraft.csv",
        ["behold", "kategori", "navn", "mw", "gwh", "sone", "eier",
         "kommune", "lon", "lat", "vannkvtype"],
        rader,
    )


# ---------------------------------------------------------------------------
# Vindkraft
# ---------------------------------------------------------------------------

def hent_vindkraft():
    print("\n=== VINDKRAFT ===")
    print("Henter attributter fra api.nve.no ...")
    resp = requests.get(URL_VIND_ATTR, timeout=TIMEOUT)
    resp.raise_for_status()
    verk = resp.json()
    print(f"  {len(verk)} vindkraftverk i drift totalt.")

    kandidater = [v for v in verk if v.get("InstallertEffekt_MW")]
    kandidater.sort(key=lambda v: v["InstallertEffekt_MW"], reverse=True)
    kandidater = kandidater[:ANTALL_VIND_KANDIDATER]
    print(f"  Topp {len(kandidater)} etter InstallertEffekt_MW valgt som kandidater.")

    rader = [{
        "behold": "",
        "kategori": "vind",
        "navn": v["Navn"],
        "mw": v["InstallertEffekt_MW"],
        "gwh": v.get("NormalAArsproduksjon_GWh"),
        "sone": f"NO{v.get('ElspotomraadeNummer')}",
        "eier": v.get("HovedEierNavn"),
        "kommune": v.get("Kommune"),
        "lon": "",
        "lat": "",
    } for v in kandidater]

    skriv_csv(
        "kandidater_vindkraft.csv",
        ["behold", "kategori", "navn", "mw", "gwh", "sone", "eier",
         "kommune", "lon", "lat"],
        rader,
    )


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    try:
        hent_vannkraft()
        hent_vindkraft()
    except requests.RequestException as e:
        # NVE-attributt-API-ene er åpne og token-frie, så feilmeldingen kan
        # skrives rått (ingen hemmeligheter å skrubbe).
        print(f"\nHTTP-feil: {e}", file=sys.stderr)
        sys.exit(1)

    print("\nFerdig. Neste steg:")
    print("  python hent_koordinater.py   (fyller lon/lat via OpenStreetMap)")
