"""
Norges Bank-tjeneste
--------------------
Henter EUR→NOK-valutakurs fra Norges Banks åpne data-API, slik at vi kan
konvertere ENTSO-E sine EUR/MWh-priser til øre/kWh — enheten nordmenn
kjenner igjen fra strømregningen.

Datakilde:
    https://data.norges-bank.no/api/data/EXR/B.EUR.NOK.SP?format=csv&lastNObservations=1
    - EXR        = exchange rates (valutakurser)
    - B.EUR.NOK  = daglig (Business), fra EUR til NOK
    - SP         = spot (midtkurs)
    - CSV-format = semikolon-separert, robust og enkelt å parse
    - lastNObservations=1 = bare siste publiserte kurs

Robusthet i tre lag:
    1. In-memory cache (24t TTL). Kursen publiseres ~16:00 på hverdager,
       så det er ingen vits i å spørre oftere enn én gang i døgnet.
    2. Stale fallback. Hvis API-et er nede, brukes siste kjente kurs selv
       om den er eldre enn 24t — en litt gammel kurs er langt bedre enn
       ingen pris i det hele tatt.
    3. Hardkodet bunnverdi. Hvis vi aldri har klart å hente en ekte kurs
       (f.eks. API nede ved aller første kall etter oppstart), faller vi
       tilbake på en rimelig konstant så hele pris-pipelinen ikke kræsjer.
"""
import time

import httpx

# Norges Bank: EUR→NOK, spot, kun siste observasjon, som CSV.
NORGES_BANK_URL = (
    "https://data.norges-bank.no/api/data/EXR/B.EUR.NOK.SP"
    "?format=csv&lastNObservations=1"
)

RATE_TTL_SECONDS = 24 * 3600     # 24 timer
REQUEST_TIMEOUT = 10.0           # sekunder å vente på Norges Bank

# Siste utvei, brukes BARE hvis vi aldri har klart å hente en ekte kurs.
# Et grovt anslag på EUR/NOK — oppdater gjerne om den driver langt unna.
FALLBACK_RATE = 11.50

# Cache: (tidsstempel_hentet, kurs). None betyr "ingen kurs hentet ennå".
_cache = None


def _parse_csv(text: str) -> float:
    """
    Parser Norges Bank sin CSV og returnerer kursen fra siste rad.

    Formatet er semikolon-separert med én header-rad øverst. Kursen ligger
    i kolonnen OBS_VALUE. Vi slår opp kolonneindeksen via header-navnet i
    stedet for å hardkode en posisjon, så koden ikke knekker hvis Norges
    Bank legger til/flytter kolonner senere.

    Eksempel på respons (forkortet):
        FREQ;...;TIME_PERIOD;OBS_VALUE
        B;...;2026-06-20;11.7234
    """
    lines = [ln for ln in text.strip().splitlines() if ln.strip()]
    if len(lines) < 2:
        raise ValueError("Norges Bank CSV hadde ingen datarader")

    header = lines[0].split(";")
    value_idx = header.index("OBS_VALUE")  # ValueError hvis kolonnen mangler
    last_row = lines[-1].split(";")
    return float(last_row[value_idx])


def get_eur_nok_rate() -> float:
    """
    Returnerer gjeldende EUR→NOK-kurs (NOK per 1 EUR).

    Henter fra Norges Bank ved behov, ellers fra cache. Faller tilbake på
    siste kjente (stale) kurs, og til slutt en hardkodet konstant, hvis
    nettverket svikter. Kaster aldri — pris-pipelinen skal alltid få et tall.
    """
    global _cache

    # 1) Fersk cache? Bruk den uten å spørre Norges Bank.
    if _cache is not None:
        cached_at, rate = _cache
        if time.time() - cached_at <= RATE_TTL_SECONDS:
            return rate

    # 2) Prøv å hente en ny kurs.
    try:
        resp = httpx.get(NORGES_BANK_URL, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        rate = _parse_csv(resp.text)
        _cache = (time.time(), rate)
        return rate
    except Exception as e:
        print(f"[norges_bank_service] Klarte ikke hente kurs: {e}")

    # 3a) Stale fallback: bruk siste kjente kurs selv om den er for gammel.
    if _cache is not None:
        _, rate = _cache
        print(f"[norges_bank_service] Bruker stale kurs: {rate}")
        return rate

    # 3b) Siste utvei: hardkodet konstant.
    print(f"[norges_bank_service] Bruker hardkodet fallback: {FALLBACK_RATE}")
    return FALLBACK_RATE
