# -*- coding: utf-8 -*-
"""
Strømkartet — kuratering av kraftverk, steg 1: HENT KANDIDATER (attributter)

Henter vann- og vindkraftverk over angitt MW-terskel fra NVEs åpne attributt-API.
Skriptet er "merge-bevisst": det leser eksisterende CSV-filer for å bevare manuelt
arbeid (koordinater, klassifisering) og legger kun til NYE kraftverk som mangler.

Arbeidsflyt:
  1. python hent_kraftverk_kandidater.py   (denne — oppdaterer CSV-ene sikkert)
  2. python hent_koordinater.py            (fyller lon/lat for de nye radene)
  3. I CSV-ene: sett behold=JA og (vannkraft) kategori=magasin/elv
  4. python generer_plants_data.py         (skriver frontend-modulen)
"""

import csv
import sys
import os
import requests

# --- Konfigurasjon ---
MW_TERSKEL = 50  # Henter alle anlegg med installert effekt >= 50 MW

URL_VANN_ATTR = "https://api.nve.no/web/Powerplant/GetHydroPowerPlantsInOperation"
URL_VIND_ATTR = "https://api.nve.no/web/WindPowerplant/GetWindPowerPlantsInOperation"
TIMEOUT = 30


def les_eksisterende_csv(sti):
    """Leser eksisterende CSV for å bevare manuelt arbeid. Encoding-fallback
    som i generer_plants_data.py: Excel lagrer ofte tilbake som cp1252."""
    if not os.path.exists(sti):
        return []
    for enc in ("utf-8-sig", "cp1252"):
        try:
            with open(sti, "r", encoding=enc, newline="") as f:
                return list(csv.DictReader(f, delimiter=";"))
        except UnicodeDecodeError:
            continue
    raise SystemExit(f"Klarte ikke dekode {sti} (verken utf-8 eller cp1252).")

def skriv_csv(sti, kolonner, rader):
    """Skriver CSV (med BOM for Excel-kompatibilitet)."""
    with open(sti, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=kolonner, delimiter=";")
        w.writeheader()
        w.writerows(rader)

def flett_og_lagre(sti, api_kandidater, kolonner):
    """Fletter nye API-treff med eksisterende rader uten å overskrive data."""
    eksisterende_rader = les_eksisterende_csv(sti)
    
    # Lag et normalisert oppslag for rask duplikatsjekk
    eksisterende_navn = {rad["navn"].strip().lower() for rad in eksisterende_rader}

    nye_rader = []
    for kand in api_kandidater:
        navn_lower = kand["navn"].strip().lower()
        if navn_lower not in eksisterende_navn:
            nye_rader.append(kand)

    alle_rader = eksisterende_rader + nye_rader

    # Sorterer alt synkende på MW for ryddighetens skyld.
    def hent_mw(rad):
        try:
            return float(str(rad["mw"]).replace(",", "."))
        except ValueError:
            return 0.0

    alle_rader.sort(key=hent_mw, reverse=True)

    skriv_csv(sti, kolonner, alle_rader)
    print(f"  Resultat i {sti}:")
    print(f"    - Beholdt {len(eksisterende_rader)} eksisterende rader.")
    print(f"    - La til {len(nye_rader)} nye rader (>= {MW_TERSKEL} MW).")


def hent_vannkraft():
    print("\n=== VANNKRAFT ===")
    print(f"Henter attributter fra api.nve.no (Grense: {MW_TERSKEL} MW)...")
    resp = requests.get(URL_VANN_ATTR, timeout=TIMEOUT)
    resp.raise_for_status()
    verk = resp.json()

    api_kandidater = []
    for v in verk:
        # Pumper (som ikke produserer selv) filtreres vekk, men pumpekraftverk beholdes
        if v.get("VannKVType") in ("Kraftverk", "Pumpekraftverk"):
            mw = v.get("MaksYtelse")
            if mw and mw >= MW_TERSKEL:
                api_kandidater.append({
                    "behold": "",
                    "kategori": "",
                    "navn": v["Navn"],
                    "mw": mw,
                    "gwh": v.get("MidProd_91_20"),
                    "sone": f"NO{v.get('ElspotomraadeNummer')}",
                    "eier": v.get("HovedEier"),
                    "kommune": v.get("Kommune"),
                    "lon": "",
                    "lat": "",
                    "vannkvtype": v.get("VannKVType"),
                })

    kolonner = ["behold", "kategori", "navn", "mw", "gwh", "sone", "eier", "kommune", "lon", "lat", "vannkvtype"]
    flett_og_lagre("kandidater_vannkraft.csv", api_kandidater, kolonner)


def hent_vindkraft():
    print("\n=== VINDKRAFT ===")
    print(f"Henter attributter fra api.nve.no (Grense: {MW_TERSKEL} MW)...")
    resp = requests.get(URL_VIND_ATTR, timeout=TIMEOUT)
    resp.raise_for_status()
    verk = resp.json()

    api_kandidater = []
    for v in verk:
        mw = v.get("InstallertEffekt_MW")
        if mw and mw >= MW_TERSKEL:
            api_kandidater.append({
                "behold": "",
                "kategori": "vind",
                "navn": v["Navn"],
                "mw": mw,
                "gwh": v.get("NormalAArsproduksjon_GWh"),
                "sone": f"NO{v.get('ElspotomraadeNummer')}",
                "eier": v.get("HovedEierNavn"),
                "kommune": v.get("Kommune"),
                "lon": "",
                "lat": "",
            })

    kolonner = ["behold", "kategori", "navn", "mw", "gwh", "sone", "eier", "kommune", "lon", "lat"]
    flett_og_lagre("kandidater_vindkraft.csv", api_kandidater, kolonner)


if __name__ == "__main__":
    try:
        hent_vannkraft()
        hent_vindkraft()
    except requests.RequestException as e:
        print(f"\nHTTP-feil: {e}", file=sys.stderr)
        sys.exit(1)

    print("\nFerdig. Neste steg:")
    print("  python hent_koordinater.py   (fyller lon/lat kun for de radene som mangler det)")