# -*- coding: utf-8 -*-
"""
Strømkartet — kuratering av kraftverk, MELLOMSTEG: FYLL KOORDINATER

Går gjennom kandidat-CSV-ene rad for rad, og for hver rad som mangler
lon/lat ber den deg lime inn en lenke. Skriptet gjenkjenner selv hva slags
lenke du limte inn og finner koordinaten:

  1. OpenStreetMap-objektlenke  -> presist oppslag via OSM-API (ANBEFALT)
     https://www.openstreetmap.org/way/123456789
     https://www.openstreetmap.org/node/987654321
     https://www.openstreetmap.org/relation/555

  2. OpenInfraMap-lenke (reserve) -> kartsentrum fra URL-hashen
     https://openinframap.org/#12.81/59.65117/6.81153
     (Bruk denne når anlegget ikke har et klikkbart OSM-objekt. Merk at
      dette er KARTSENTRUM, ikke selve anlegget — sentrer det på skjermen
      før du kopierer URL-en.)

Kommandoer under kjøring:
  - lim inn en lenke     -> henter og lagrer koordinaten
  - trykk Enter (tomt)   -> hopp over denne raden (fyll den senere)
  - skriv 'skip'         -> samme som Enter
  - skriv 'q'            -> lagre og avslutt

Framgang lagres til CSV etter HVER rad, så Ctrl+C eller 'q' aldri mister
det du alt har fylt inn. Du kan kjøre skriptet i flere økter.

Slik finner du OSM-lenken (presis metode):
  a. Åpne openinframap.org, finn anlegget.
  b. Klikk på kraftverkssymbolet -> infopanel åpnes.
  c. Følg lenken til OpenStreetMap ('View on OpenStreetMap' e.l.).
  d. Kopier URL-en fra nettleseren (den inneholder node/way/relation + ID).

Kjøres lokalt på PC (krever kun `requests`):
    python hent_koordinater.py

Data: OpenStreetMap-bidragsytere, ODbL.
"""

import csv
import re
import sys

import requests

# ---------------------------------------------------------------------------
# Konfigurasjon
# ---------------------------------------------------------------------------

CSV_FILER = ["kandidater_vannkraft.csv", "kandidater_vindkraft.csv"]

OSM_API = "https://api.openstreetmap.org/api/0.6"
TIMEOUT = 30

# OSM ber om en beskrivende User-Agent som identifiserer applikasjonen, så de
# kan kontakte deg ved misbruk. Dette er god skikk for ALLE API-kall du skriver.
HEADERS = {"User-Agent": "stromkart-koordinathjelper (github.com/QFeNaUt/stromkart)"}

# Samme grove Norge-boks som generer_plants_data.py bruker. Fanger den klassiske
# feilen: byttet lon/lat sender punktet ut i Det indiske hav.
LON_MIN, LON_MAX = 4.0, 32.0
LAT_MIN, LAT_MAX = 57.5, 71.5

# --- Regex-mønstre (kjernen i "parse en lenke") ----------------------------
# OSM: finn ett av de tre objekttypene fulgt av /<tall>.
#   (node|way|relation) fanger typen, (\d+) fanger ID-en.
OSM_MØNSTER = re.compile(r"openstreetmap\.org/(node|way|relation)/(\d+)")

# OpenInfraMap-hash: #<zoom>/<lat>/<lon>. Rekkefølgen i kart-hasher er
# ALLTID lat før lon. -? tillater negativ lengdegrad (vest for Greenwich).
OIM_MØNSTER = re.compile(r"#[\d.]+/(-?[\d.]+)/(-?[\d.]+)")


# ---------------------------------------------------------------------------
# Parsing + oppslag
# ---------------------------------------------------------------------------

def i_norge(lon, lat):
    """True hvis [lon, lat] ligger innenfor den grove Norge-boksen."""
    return LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX


def hent_osm_koordinat(objekttype, objektid):
    """Slår opp presis koordinat for et OSM-objekt.

    - node:            allerede et punkt -> returner lat/lon direkte.
    - way / relation:  en samling noder -> hent alle via /full og regn
                        SENTROIDE (enkelt gjennomsnitt av nodenes koordinater).

    Merk: gjennomsnitt av hjørnene er en tilnærmet sentroide, ikke den ekte
    arealsentroiden. For et kompakt kraftverksomriss er forskjellen ubetydelig
    for kartplassering.
    """
    if objekttype == "node":
        url = f"{OSM_API}/node/{objektid}.json"
    else:
        # /full gir way/relation MED alle nodene sine (som har lat/lon).
        # Uten /full får vi bare node-REFERANSER (ID-er, ingen koordinater).
        url = f"{OSM_API}/{objekttype}/{objektid}/full.json"

    resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    elementer = resp.json().get("elements", [])

    # Plukk ut alle elementer som faktisk har en koordinat (node-elementene).
    punkter = [(e["lon"], e["lat"]) for e in elementer
               if e.get("type") == "node" and "lat" in e and "lon" in e]
    if not punkter:
        raise ValueError("OSM-objektet hadde ingen node-koordinater.")

    lon = sum(p[0] for p in punkter) / len(punkter)
    lat = sum(p[1] for p in punkter) / len(punkter)
    return round(lon, 6), round(lat, 6)


def tolk_lenke(tekst):
    """Gjenkjenner lenketypen og returnerer (lon, lat).

    Prøver OSM først (presis), faller tilbake på OpenInfraMap-hash (kartsentrum).
    Kaster ValueError hvis ingen av mønstrene passer.
    """
    osm = OSM_MØNSTER.search(tekst)
    if osm:
        objekttype, objektid = osm.group(1), osm.group(2)
        lon, lat = hent_osm_koordinat(objekttype, objektid)
        return lon, lat, f"osm-{objekttype}"

    oim = OIM_MØNSTER.search(tekst)
    if oim:
        # Gruppe 1 = lat, gruppe 2 = lon (hash-rekkefølge zoom/lat/lon).
        lat, lon = float(oim.group(1)), float(oim.group(2))
        return round(lon, 6), round(lat, 6), "openinframap-sentrum"

    raise ValueError("Ukjent lenke — forventet openstreetmap.org/.../<id> "
                     "eller openinframap.org/#zoom/lat/lon.")


# ---------------------------------------------------------------------------
# CSV-flyt
# ---------------------------------------------------------------------------

def les_csv(sti):
    """Leser hele CSV-en inn i minnet (kolonneliste + radliste)."""
    with open(sti, encoding="utf-8-sig", newline="") as f:
        leser = csv.DictReader(f, delimiter=";")
        return leser.fieldnames, list(leser)


def skriv_csv(sti, kolonner, rader):
    """Skriver hele CSV-en tilbake (samme format som steg 1)."""
    with open(sti, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=kolonner, delimiter=";")
        w.writeheader()
        w.writerows(rader)


def mangler_koordinat(rad):
    """True hvis raden ikke har både lon og lat fylt inn."""
    return not (str(rad.get("lon", "")).strip() and str(rad.get("lat", "")).strip())


def behandle_fil(sti):
    """Går gjennom én CSV interaktivt. Returnerer 'q' hvis brukeren avsluttet."""
    try:
        kolonner, rader = les_csv(sti)
    except FileNotFoundError:
        print(f"  Hopper over {sti} (finnes ikke ennå).")
        return None

    manglende = [r for r in rader if mangler_koordinat(r)]
    print(f"\n=== {sti} ===")
    print(f"  {len(manglende)} av {len(rader)} rader mangler koordinat.")
    if not manglende:
        return None

    for nr, rad in enumerate(manglende, start=1):
        # Vis nok kontekst til at du finner riktig anlegg på OpenInfraMap.
        print(f"\n[{nr}/{len(manglende)}] {rad['navn']}"
              f"  ({rad.get('mw')} MW, {rad.get('sone')}, {rad.get('kommune')})")
        while True:
            svar = input("  Lenke (Enter=hopp over, q=avslutt): ").strip()

            if svar == "":
                print("  -> hoppet over.")
                break
            if svar.lower() in ("q", "quit", "exit"):
                return "q"
            if svar.lower() == "skip":
                print("  -> hoppet over.")
                break

            try:
                lon, lat, kilde = tolk_lenke(svar)
            except ValueError as e:
                print(f"  ! {e} Prøv igjen.")
                continue
            except requests.RequestException as e:
                print(f"  ! Nettverksfeil mot OSM: {e} Prøv igjen.")
                continue

            if not i_norge(lon, lat):
                print(f"  ! [{lon}, {lat}] ligger utenfor Norge — "
                      f"byttet lat/lon? Prøv igjen.")
                continue

            rad["lon"] = lon
            rad["lat"] = lat
            # Skriv tilbake UMIDDELBART, så framgang aldri går tapt.
            skriv_csv(sti, kolonner, rader)
            print(f"  -> lagret [{lon}, {lat}]  (kilde: {kilde})")
            break

    return None


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("Koordinat-hjelper — lim inn OSM- eller OpenInfraMap-lenke per anlegg.")
    print("Framgang lagres etter hver rad. 'q' for å avslutte når som helst.\n")

    try:
        for sti in CSV_FILER:
            if behandle_fil(sti) == "q":
                print("\nAvsluttet på forespørsel. Framgang er lagret.")
                break
        else:
            print("\nGjennomgang fullført.")
    except KeyboardInterrupt:
        # Ctrl+C: siste lagrede rad er allerede på disk (vi skriver per rad).
        print("\n\nAvbrutt. Alt som ble bekreftet før dette er lagret.")
        sys.exit(0)

    print("Neste steg (når behold=JA og kategori er satt):")
    print("  python generer_plants_data.py")
