"""
Kraftflyt-tjeneste
------------------
Henter fysisk flyt (MW) på tvers av grenser mellom norske prissoner,
nabolandene (Sverige, Finland, Danmark) og kontinentet (Tyskland, UK,
Nederland) fra ENTSO-E Transparency Platform.

ENTSO-E publiserer flyt som ENVEIS-serier: ett kall = én retning. For å
få nettoflyt på en grense må vi kalle begge veier og trekke den ene fra
den andre:
    netto(A→B) = flow(A→B) − flow(B→A)

Mens spotpriser har 5 sone-kall, har vi her 15 grenser × 2 retninger =
30 ENTSO-E-kall per oppdatering. Det krever:

  - Parallell henting (ThreadPoolExecutor, 10 tråder ≈ 3 sek wall-clock
    mot ~30 sek sekvensielt).
  - Isolert feilhåndtering per kall: hvis Skagerrak mangler data for én
    time, skal hele endepunktet IKKE krasje — den ene grensen blir bare
    droppet i svaret.
  - 429-aware retry: ENTSO-E har en udokumentert rate-grense. Ved 429
    sover vi 5 sek og prøver én gang til før vi gir opp grensen.
  - To-lags cache: 1t fersk (returneres direkte) + 24t stale fallback
    (returneres hvis nytt forsøk feiler eller blir tydelig dårligere
    enn forrige).
"""
import concurrent.futures
import os
import time
from typing import Optional

import pandas as pd
import requests
from entsoe import EntsoePandasClient

from app.services.secret_scrub import scrub_secrets

# --------------------------------------------------------------------------
# Sone-sentroider (NO1–NO5) — kun brukt for interne forbindelser
# --------------------------------------------------------------------------
ZONE_CENTROIDS = {
    "NO_1": [10.5, 60.5],   # Øst-Norge (Oslo-regionen)
    "NO_2": [7.5,  58.8],   # Sør-Norge (Agder/Rogaland)
    "NO_3": [10.5, 63.5],   # Midt-Norge (Trondheim-regionen)
    "NO_4": [18.0, 68.5],   # Nord-Norge (Tromsø-regionen)
    "NO_5": [6.5,  60.5],   # Vest-Norge (Bergen-regionen)
}


# --------------------------------------------------------------------------
# Forbindelser med fysiske endepunkter
# --------------------------------------------------------------------------
CONNECTIONS = [
    # ----- Internt Norge — korte piler ved sonegrensene -----
    # Tidligere falt vi tilbake på ZONE_CENTROIDS, som ga lange grå streker
    # tvers gjennom Norge som konkurrerte visuelt med spotpris-fargingen.
    # Nå plasseres a_point/b_point eksplisitt nær den faktiske grensen
    # mellom hvert par av soner, à la Electricity Maps. Hver pil blir
    # ~50–100 km lang og sitter i grenseområdet, ikke tvers gjennom landet.
    {"a": "NO_1", "b": "NO_2", "kind": "internal", "cable": None,
     "a_point": [9.84, 59.72],   "b_point": [8.63, 59.5]},   # Telemark/Agder
    {"a": "NO_1", "b": "NO_3", "kind": "internal", "cable": None,
     "a_point": [9.3, 61.48],  "b_point": [9.08, 61.87]},  # Innlandet/Sør-Trøndelag
    {"a": "NO_1", "b": "NO_5", "kind": "internal", "cable": None,
     "a_point": [10.15, 60.25],   "b_point": [8.41, 60.57]},   # Hallingdal/Hardangervidda
    {"a": "NO_2", "b": "NO_5", "kind": "internal", "cable": None,
     "a_point": [6.33, 60.13],   "b_point": [5.84, 60.4]},   # Boknafjord/Ryfylke
    {"a": "NO_3", "b": "NO_4", "kind": "internal", "cable": None,
     "a_point": [11.77, 64.48],  "b_point": [12.83, 64.7]},  # Helgeland
    {"a": "NO_3", "b": "NO_5", "kind": "internal", "cable": None,
     "a_point": [6.15, 61.24],   "b_point": [7.02, 61.22]},   # Møre/Vestland-grensen

    # ----- AC mot Sverige — ender ved faktiske transformatorstasjoner -----
    {"a": "NO_1", "b": "SE_3", "kind": "external", "cable": None,
     "a_point": [11.39, 59.13],   "b_point": [13.04, 59.50]},
    {"a": "NO_3", "b": "SE_2", "kind": "external", "cable": None,
     "a_point": [11.92, 63.05],   "b_point": [13.50, 63.36]},
    {"a": "NO_4", "b": "SE_1", "kind": "external", "cable": None,
     "a_point": [17.32, 68.55],   "b_point": [17.46, 67.71]},
    {"a": "NO_4", "b": "SE_2", "kind": "external", "cable": None,
     "a_point": [13.40, 65.99],   "b_point": [15.46, 65.97]},

    # ----- AC mot Finland -----
    {"a": "NO_4", "b": "FI", "kind": "external", "cable": None,
     "a_point": [28.5444, 70.1703], "b_point": [27.5653, 68.6467]},

    # ----- HVDC-sjøkabler — ender ved faktiske omformerstasjoner -----
    # Mellompunkter (`sea_points`) gir hver kabel en geografisk plausibel
    # trasé i stedet for én rett linje fra omformerstasjon til omformer-
    # stasjon. For Skagerrak, NordLink og NSL bruker vi ett mellompunkt
    # for å bøye kabelen pent rundt landmasser. NorNed har flere punkter
    # som følger den faktiske traséen via Norskerenna og sørover gjennom
    # Nordsjøen, ned til Wadden-havet og Eemshaven.
    {"a": "NO_2", "b": "DK_1", "kind": "external", "cable": "Skagerrak 1-4",
     # Rett linje mellom omformerstasjonene (ingen mellompunkt) — ryddet opp
     # for færre knekkpunkter. Norsk ende: Kristiansand/Crosser. Dansk ende: Tjele.
     "a_point":    [8.167500, 58.129167],   "b_point": [9.066278, 57.126167],
     "sea_points": []},
    {"a": "NO_2", "b": "DE_LU", "kind": "external", "cable": "NordLink",
     "a_point":    [6.7525, 58.6676],   "b_point": [9.38, 53.93],
     "sea_points": [
         [6.7186, 58.6586],  # Fjord/kyst
         [6.6649, 58.4266],  # Kyst/Nordsjøen
         [6.6815, 58.2022],  # Ut i Nordsjøen
         [7.6307, 54.9317],  # Midt-Nordsjøen
         [8.7276, 53.9726]   # Tyskebukta/inn mot land
     ]},
    {"a": "NO_2", "b": "GB", "kind": "external", "cable": "North Sea Link",
     # Ryddet opp til 5 knekkpunkter: 3 på norsk side (Kvilldal + 2), 2 på
     # engelsk side (Blyth). Lang rett linje mellom siste norske punkt og
     # første britiske punkt gjennom Nordsjøen.
     "a_point":    [6.654306, 59.530306],   "b_point": [-1.540639, 55.146333],
     "sea_points": [
         [6.597361, 59.558972],   # Norsk side
         [6.265778, 59.513500],   # Siste norske punkt (rett linje herfra til UK)
         [-1.430056, 55.146722],  # Første britiske punkt (Blyth)
     ]},
    {"a": "NO_2", "b": "NL", "kind": "external", "cable": "NorNed",
     # Ryddet opp: norsk side har nå kun Feda-endepunktet + ett punkt nordvest
     # for Lista fyr, som kobles direkte mot de to gjenværende nederlandske
     # knekkpunktene og videre til Eemshaven.
     "a_point":    [6.890083, 58.278861],   "b_point": [6.8640152, 53.4348021],
     "sea_points": [
         [6.501833, 58.149667],  # NV for Lista fyr
         [5.50, 54.00],          # Sørlig Nordsjøen
         [6.00, 53.65],          # Innsving mot Eemshaven
     ]},
]


# --------------------------------------------------------------------------
# Cache og klient
# --------------------------------------------------------------------------
CACHE_TTL_FRESH_SECONDS = 3600   # 1 time — returneres direkte
CACHE_TTL_STALE_SECONDS = 86400  # 24 timer — fallback hvis ENTSO-E feiler
REQUEST_TIMEOUT = 20             # sekunder per kall

_cache: dict = {}
_client: Optional[EntsoePandasClient] = None


def get_client() -> EntsoePandasClient:
    """Lazy-init av ENTSO-E-klient (samme mønster som entsoe_service)."""
    global _client
    if _client is None:
        token = os.getenv("ENTSOE_API_TOKEN")
        if not token:
            raise RuntimeError("ENTSOE_API_TOKEN mangler i miljøet")
        _client = EntsoePandasClient(api_key=token, timeout=REQUEST_TIMEOUT)
    return _client


def _endpoint(conn: dict, side: str) -> Optional[list]:
    """
    Returnerer koordinat for "a"- eller "b"-siden av en forbindelse.
    Prøver først eksplisitt a_point/b_point, faller tilbake på sone-sentroid.
    """
    point_key = f"{side}_point"
    if point_key in conn:
        return conn[point_key]
    zone = conn[side]
    return ZONE_CENTROIDS.get(zone)


# --------------------------------------------------------------------------
# Worker: ett retningskall, med 429-aware retry
# --------------------------------------------------------------------------
def _fetch_one_direction(
    from_code: str, to_code: str, start: pd.Timestamp, end: pd.Timestamp
) -> tuple:
    """
    Henter flyt-serien for én retning (from_code → to_code).

    ENTSO-E har en udokumentert rate-grense (~400 req/min per token). Når
    vi traff den under utvikling med hyppige cache-tømninger, droppet vi
    12 av 15 grenser. Løsning: hvis et kall feiler med HTTP 429, sov 5
    sek og prøv én gang til. Alle andre exceptions oppfører seg som før
    (logges, returnerer None, grensen droppes i denne runden).

    Returnerer (from_code, to_code, series_eller_None).
    """
    client = get_client()

    for attempt in range(2):
        try:
            series = client.query_crossborder_flows(
                from_code, to_code, start=start, end=end
            )
            if series is None or series.empty:
                return from_code, to_code, None
            # Dropper NaN-rader så aggregeringen kan se kun timer som faktisk
            # har data. ENTSO-E returnerer ofte hull i datasettet.
            series = series.dropna()
            if series.empty:
                return from_code, to_code, None
            return from_code, to_code, series

        except requests.exceptions.HTTPError as e:
            # 429 = rate limit. Gi det 5 sek og prøv ett retry.
            status = e.response.status_code if e.response is not None else None
            if status == 429 and attempt == 0:
                print(f"[flow_service] 429 rate limit for {from_code}→{to_code}, venter 5s og prøver igjen")
                time.sleep(5)
                continue
            print(f"[flow_service] {from_code} → {to_code} feilet (HTTP {status}): {scrub_secrets(e)}")
            return from_code, to_code, None

        except Exception as e:
            print(f"[flow_service] {from_code} → {to_code} feilet: {scrub_secrets(e)}")
            return from_code, to_code, None

    # Falt gjennom alle attempts (f.eks. 429 på begge forsøk)
    return from_code, to_code, None


# --------------------------------------------------------------------------
# Aggregering: én forbindelse → én netto-edge
# --------------------------------------------------------------------------
def _net_flow(
    conn: dict,
    series_a_to_b: Optional[pd.Series],
    series_b_to_a: Optional[pd.Series],
) -> Optional[dict]:
    """
    Regner netto flyt på grensen ut fra de to enveis-seriene.

    For at netto skal være meningsfullt må vi sammenligne SAMME time i
    begge retninger. Vi finner siste tidsstempel som finnes i BEGGE
    seriene.

    Returnerer en orientert edge med korrekte from/to-koordinater i
    flytretningen, eller None hvis det ikke finnes overlappende data.
    """
    if series_a_to_b is None or series_b_to_a is None:
        return None

    common_index = series_a_to_b.index.intersection(series_b_to_a.index)
    if common_index.empty:
        return None

    latest = common_index.max()
    flow_a_to_b = float(series_a_to_b.loc[latest])
    flow_b_to_a = float(series_b_to_a.loc[latest])
    net = flow_a_to_b - flow_b_to_a

    sone_a, sone_b = conn["a"], conn["b"]
    point_a = _endpoint(conn, "a")
    point_b = _endpoint(conn, "b")

    via_a_to_b = list(conn.get("sea_points", []))

    if net >= 0:
        from_zone, to_zone = sone_a, sone_b
        from_point, to_point = point_a, point_b
        via_points = via_a_to_b
        mw = net
    else:
        from_zone, to_zone = sone_b, sone_a
        from_point, to_point = point_b, point_a
        via_points = list(reversed(via_a_to_b))
        mw = -net

    return {
        "id": f"{sone_a}-{sone_b}",
        "from": from_zone,
        "to": to_zone,
        "from_point": from_point,
        "to_point": to_point,
        "via_points": via_points,
        "mw": round(mw, 1),
        "kind": conn["kind"],
        "cable": conn["cable"],
        "timestamp": latest.isoformat(),
    }


# --------------------------------------------------------------------------
# Hovedfunksjon: fetch_current_flows() med stale-fallback
# --------------------------------------------------------------------------
def fetch_current_flows() -> dict:
    """
    Henter siste kjente nettoflyt for alle 15 grenser, parallelt.

    Cache-policy:
      - Innen FRESH_TTL (1t): returner cache direkte, is_stale=False
      - Etter FRESH_TTL: prøv å hente på nytt
        - Hvis nytt forsøk gir minst like fyldig resultat som cachen:
          cache det og returner med is_stale=False
        - Hvis nytt forsøk gir vesentlig dårligere resultat (eller 0)
          OG cachen er under STALE_TTL (24t): returner cache med
          is_stale=True. Forhindrer at delvis ENTSO-E-utfall regredierer
          en god cache til en nesten-tom respons.
      - Hvis ingen cache og nytt forsøk feiler: returner tomt array.

    Returstruktur:
        {
            "edges": [...],
            "is_stale": bool,
        }
    """
    cached = _cache.get("current")

    # Fersk cache — returner uten å spørre ENTSO-E
    if cached is not None:
        ts, data = cached
        age = time.time() - ts
        if age <= CACHE_TTL_FRESH_SECONDS:
            # Shallow copy så vi ikke muterer det cachelagrede objektet
            return {**data, "is_stale": False}

    get_client()

    tz = "Europe/Oslo"
    now = pd.Timestamp.now(tz=tz)
    start = now - pd.Timedelta(hours=6)
    end = now

    jobs = []
    for conn in CONNECTIONS:
        jobs.append((conn["a"], conn["b"]))
        jobs.append((conn["b"], conn["a"]))

    raw: dict[tuple, Optional[pd.Series]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        futures = [
            ex.submit(_fetch_one_direction, frm, to, start, end)
            for frm, to in jobs
        ]
        for future in concurrent.futures.as_completed(futures):
            frm, to, series = future.result()
            raw[(frm, to)] = series

    edges = []
    for conn in CONNECTIONS:
        edge = _net_flow(
            conn,
            raw.get((conn["a"], conn["b"])),
            raw.get((conn["b"], conn["a"])),
        )
        if edge is None:
            print(f"[flow_service] Ingen data for {conn['a']}↔{conn['b']}, hopper over")
            continue
        if edge["from_point"] is None or edge["to_point"] is None:
            print(f"[flow_service] Mangler koordinat for {conn['a']}↔{conn['b']}, hopper over")
            continue
        edges.append(edge)

    # Stale fallback: hvis nytt resultat er tydelig dårligere enn cache,
    # og cache er under STALE_TTL, foretrekk cache. Dekker både totalt
    # utfall (0 edges) og delvis utfall (få edges pga rate limit).
    if cached is not None:
        prev_ts, prev_data = cached
        prev_count = len(prev_data["edges"])
        cache_age = time.time() - prev_ts
        if len(edges) < prev_count and cache_age <= CACHE_TTL_STALE_SECONDS:
            print(
                f"[flow_service] Nytt forsøk ga {len(edges)} edges, cache har "
                f"{prev_count} ({round(cache_age/3600, 1)}t gammel). Bruker stale cache."
            )
            return {**prev_data, "is_stale": True}

    result = {"edges": edges, "is_stale": False}

    if edges:
        _cache["current"] = (time.time(), result)

    return result
