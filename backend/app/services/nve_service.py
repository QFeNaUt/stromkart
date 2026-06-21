"""
NVE-magasinstatistikk-tjeneste
------------------------------
Henter fyllingsgrad i norske vannmagasiner per elspotområde (NO1–NO5)
fra NVE sin åpne Magasinstatistikk-API.

Datakilde:
    https://biapi.nve.no/magasinstatistikk/api/Magasinstatistikk/HentOffentligData

API-et returnerer hele tidsserien siden 1995 (~13 000 rader) i én respons.
Vi filtrerer på omrType="EL" (elspotområde, ikke landsdel-aggregat) og tar
siste publiserte uke per område 1-5.

Publiseringsrytme:
    Onsdag kl 13:00. Måling tatt søndag kveld. Vi cacher 24t fersk for å
    spare unødvendige kall, og holder 7 dager stale fallback hvis API-et
    er nede en periode.

Respons-felt fra NVE (per rad):
    dato_Id                  — "2026-06-14" (datoen målingen gjelder, søndag)
    omrType                  — "EL" (elspotområde) eller "NO" (hele Norge)
    omrnr                    — 1-5 for elspotområder
    iso_aar, iso_uke         — ISO-år og ukenummer
    fyllingsgrad             — decimal 0.0-1.0
    kapasitet_TWh            — total magasinkapasitet i området
    fylling_TWh              — faktisk lagret energi
    fyllingsgrad_forrige_uke — for å vise utvikling
    endring_fyllingsgrad     — fyllingsgrad - forrige_uke
    neste_Publiseringsdato   — når NVE neste publiserer
"""
import time
from typing import Optional

import httpx

NVE_URL = (
    "https://biapi.nve.no/magasinstatistikk/api/Magasinstatistikk/HentOffentligData"
)
CACHE_TTL_FRESH_SECONDS = 86400         # 24t — NVE oppdaterer kun onsdager
CACHE_TTL_STALE_SECONDS = 7 * 86400     # 7 dager — bruk siste kjente hvis API nede
REQUEST_TIMEOUT = 20

_cache: dict = {}


def fetch_reservoir_levels() -> dict:
    """
    Returnerer fyllingsgrad per elspotområde (NO_1 til NO_5).

    Returstruktur:
        {
            "areas": {
                "NO_1": {
                    "fill_percent": 68.7,
                    "fill_twh": 4.13,
                    "capacity_twh": 6.00,
                    "change_percent": 8.4,         # endring fra forrige uke
                    "previous_percent": 60.4,      # forrige ukes fylling
                    "week": 24,
                    "year": 2026,
                    "measurement_date": "2026-06-14",
                    "next_publication": "2026-06-24T13:00:00",
                },
                ...
            },
            "is_stale": false
        }

    Cache-strategi (samme mønster som norges_bank_service og flow_service):
      - Innen 24t: returner cache direkte (is_stale=False)
      - Etter 24t: prøv å oppdatere fra NVE
        - Hvis vellykket: cache på nytt og returner (is_stale=False)
        - Hvis feilet OG cache er under 7 dager: returner cache med
          is_stale=True
        - Hvis ingen cache: returner {"areas": {}, "is_stale": False}
    """
    # Fersk cache — returner uten å spørre NVE
    cached = _cache.get("current")
    if cached is not None:
        ts, data = cached
        if time.time() - ts <= CACHE_TTL_FRESH_SECONDS:
            return {**data, "is_stale": False}

    try:
        response = httpx.get(NVE_URL, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        rows = response.json()
    except Exception as e:
        print(f"[nve_service] Henting fra NVE feilet: {e}")
        # Stale fallback hvis cache er under 7 dager gammel
        if cached is not None:
            ts, data = cached
            age = time.time() - ts
            if age <= CACHE_TTL_STALE_SECONDS:
                print(
                    f"[nve_service] Bruker stale cache "
                    f"({round(age / 3600, 1)}t gammel)"
                )
                return {**data, "is_stale": True}
        return {"areas": {}, "is_stale": False}

    # Filtrer på elspotområde, finn siste uke per omrnr
    by_area: dict[int, dict] = {}
    for r in rows:
        if r.get("omrType") != "EL":
            continue
        nr = r.get("omrnr")
        if nr not in (1, 2, 3, 4, 5):
            continue
        year = r.get("iso_aar") or 0
        week = r.get("iso_uke") or 0
        sort_key = (year, week)

        existing = by_area.get(nr)
        if existing is None or sort_key > existing["_sort_key"]:
            fyll = r.get("fyllingsgrad")
            forrige = r.get("fyllingsgrad_forrige_uke")
            endring = r.get("endring_fyllingsgrad")
            by_area[nr] = {
                "_sort_key": sort_key,
                "fill_percent": round(float(fyll) * 100, 1) if fyll is not None else None,
                "capacity_twh": round(float(r.get("kapasitet_TWh", 0)), 2),
                "fill_twh": round(float(r.get("fylling_TWh", 0)), 2),
                "previous_percent": round(float(forrige) * 100, 1) if forrige is not None else None,
                "change_percent": round(float(endring) * 100, 1) if endring is not None else None,
                "week": int(week),
                "year": int(year),
                "measurement_date": r.get("dato_Id"),
                "next_publication": r.get("neste_Publiseringsdato"),
            }

    # Bygg resultat med NO_1...NO_5-nøkler (matcher resten av appen)
    areas: dict = {}
    for nr in range(1, 6):
        area = by_area.get(nr)
        if area is not None:
            area.pop("_sort_key", None)
            areas[f"NO_{nr}"] = area

    if areas:
        result = {"areas": areas, "is_stale": False}
        _cache["current"] = (time.time(), result)
        return result

    # Tomt resultat fra NVE → stale fallback hvis mulig
    if cached is not None:
        ts, data = cached
        age = time.time() - ts
        if age <= CACHE_TTL_STALE_SECONDS:
            print(
                f"[nve_service] NVE returnerte ingen EL-rader. Bruker stale cache."
            )
            return {**data, "is_stale": True}

    return {"areas": {}, "is_stale": False}
