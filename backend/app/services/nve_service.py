"""
NVE-magasinstatistikk-tjeneste
------------------------------
Henter fyllingsgrad i norske vannmagasiner per elspotområde (NO1–NO5)
fra NVE sin åpne Magasinstatistikk-API.

Datakilde:
    https://biapi.nve.no/magasinstatistikk/api/Magasinstatistikk/HentOffentligData

API-et returnerer hele tidsserien siden 1995 (~13 000 rader) i én respons.
Vi filtrerer på omrType="EL" (elspotområde, ikke landsdel-aggregat) og tar
siste publiserte uke per område 1-5. Samtidig beregner vi median/min/max
for samme ISO-uke over de siste 25 årene (transparent dekning hvis et
område mangler enkelte år).

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
import statistics
import time
from typing import Optional

import httpx

from app.services.reservoirs_static import TOP_RESERVOIRS

NVE_URL = (
    "https://biapi.nve.no/magasinstatistikk/api/Magasinstatistikk/HentOffentligData"
)
CACHE_TTL_FRESH_SECONDS = 86400         # 24t — NVE oppdaterer kun onsdager
CACHE_TTL_STALE_SECONDS = 7 * 86400     # 7 dager — bruk siste kjente hvis API nede
REQUEST_TIMEOUT = 20
HISTORICAL_WINDOW_YEARS = 25            # bakoverhorisont for median/min/max

_cache: dict = {}


def _compute_historical_stats(
    index: dict, omrnr: int, target_week: int, current_year: int
) -> Optional[dict]:
    """
    Beregn median/min/max for fyllingsgrad i ISO-uke `target_week` for
    område `omrnr` over de siste ~25 årene (eksklusiv dagens år).

    Designvalg:
      - Uke 53 (skuddår) mappes til uke 52 både for target og sample,
        så vi får sammenliknbare verdier mellom skuddår og vanlige år.
      - Tomme/manglende verdier hoppes over (kan gi <25 i sample).
      - `years_in_sample` og `reference_period` viser faktisk dekning,
        slik at frontend kan være ærlig om datagrunnlaget.

    Returnerer None hvis ingen historiske data finnes (typisk hvis NVE
    ikke hadde EL-områder definert det aktuelle året).
    """
    effective_target = 52 if target_week == 53 else target_week
    start_year = current_year - HISTORICAL_WINDOW_YEARS
    end_year = current_year - 1  # eksklusiv dagens år (vi sammenligner MOT historikken)

    # Behold én verdi per (år, uke 52/53-mapping) for å unngå dobbelt-
    # telling hvis NVE i et skuddår skulle ha registrert både uke 52 og 53.
    # Vi tar siste verdi som vinner — i praksis er det aldri begge.
    values_by_year: dict[int, float] = {}
    for (nr, year, week), pct in index.items():
        if nr != omrnr:
            continue
        if year < start_year or year > end_year:
            continue
        effective_week = 52 if week == 53 else week
        if effective_week != effective_target:
            continue
        values_by_year[year] = pct

    if not values_by_year:
        return None

    values = list(values_by_year.values())
    years_seen = sorted(values_by_year.keys())

    return {
        "median_percent": round(statistics.median(values), 1),
        "min_percent": round(min(values), 1),
        "max_percent": round(max(values), 1),
        "years_in_sample": len(values),
        "reference_period": f"{years_seen[0]}\u2013{years_seen[-1]}",
    }


def fetch_reservoir_levels() -> dict:
    """
    Returnerer fyllingsgrad per elspotområde (NO_1 til NO_5), beriket med
    historisk statistikk for samme uke (siste 25 år) og en kuratert liste
    over de 5 største magasinene per sone.

    Returstruktur:
        {
            "areas": {
                "NO_1": {
                    "fill_percent": 68.7,
                    "fill_twh": 4.13,
                    "capacity_twh": 6.00,
                    "change_percent": 8.4,
                    "previous_percent": 60.4,
                    "week": 24,
                    "year": 2026,
                    "measurement_date": "2026-06-14",
                    "next_publication": "2026-06-24T13:00:00",
                    "historical": {
                        "median_percent": 71.2,
                        "min_percent": 52.4,
                        "max_percent": 84.1,
                        "years_in_sample": 24,
                        "reference_period": "2001–2024"
                    },
                    "top_reservoirs": [
                        {"name": "Mjøsa", "volume_mill_m3": 1312, "note": "..."},
                        ...
                    ]
                },
                ...
            },
            "is_stale": false
        }

    `historical` kan mangle hvis NVE ikke har data for området bakover i tid.
    `top_reservoirs` mangler kun hvis sone-nøkkelen ikke finnes i den
    statiske listen (skal ikke skje i normal drift).

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

    # Iterer rows ÉN gang — bygg både siste-uke-aggregat og historisk index.
    # Historisk index er {(omrnr, år, uke): fyllingsgrad_prosent} og brukes
    # senere av _compute_historical_stats for hvert område.
    by_area: dict[int, dict] = {}
    historical_index: dict[tuple, float] = {}

    for r in rows:
        if r.get("omrType") != "EL":
            continue
        nr = r.get("omrnr")
        if nr not in (1, 2, 3, 4, 5):
            continue
        year = r.get("iso_aar")
        week = r.get("iso_uke")
        if year is None or week is None:
            continue
        year_i = int(year)
        week_i = int(week)
        fyll = r.get("fyllingsgrad")

        # Historisk-index for median/min/max-beregning
        if fyll is not None:
            historical_index[(int(nr), year_i, week_i)] = float(fyll) * 100

        # Spor siste uke per område (aktuell visning)
        sort_key = (year_i, week_i)
        existing = by_area.get(nr)
        if existing is None or sort_key > existing["_sort_key"]:
            forrige = r.get("fyllingsgrad_forrige_uke")
            endring = r.get("endring_fyllingsgrad")
            by_area[nr] = {
                "_sort_key": sort_key,
                "fill_percent": round(float(fyll) * 100, 1) if fyll is not None else None,
                "capacity_twh": round(float(r.get("kapasitet_TWh", 0)), 2),
                "fill_twh": round(float(r.get("fylling_TWh", 0)), 2),
                "previous_percent": round(float(forrige) * 100, 1) if forrige is not None else None,
                "change_percent": round(float(endring) * 100, 1) if endring is not None else None,
                "week": week_i,
                "year": year_i,
                "measurement_date": r.get("dato_Id"),
                "next_publication": r.get("neste_Publiseringsdato"),
            }

    # Bygg resultat med NO_1...NO_5-nøkler, beriket med historikk + topp 5 magasin
    areas: dict = {}
    for nr in range(1, 6):
        area = by_area.get(nr)
        if area is None:
            continue
        area.pop("_sort_key", None)
        zone_key = f"NO_{nr}"

        # Historisk statistikk for ukens uke i 25-årsvinduet
        historical = _compute_historical_stats(
            historical_index, nr, area["week"], area["year"]
        )
        if historical is not None:
            area["historical"] = historical

        # Statisk liste over de 5 største magasinene per sone
        top = TOP_RESERVOIRS.get(zone_key)
        if top is not None:
            area["top_reservoirs"] = top

        areas[zone_key] = area

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
