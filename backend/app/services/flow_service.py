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
  - Aggressiv cache (1t TTL): flyt-data er hourly og oppdateres relativt
    sjelden. Vi bryr oss om "sist publiserte time", ikke realtid.

Endepunktene er fysisk realistiske: HVDC-kabler ender ved faktiske
omformerstasjoner/landtak (Feda, Eemshaven, Tonstad, Wilster osv.),
AC-forbindelser ender ved de norske og svenske/finske transformator-
stasjonene som faktisk er knyttet sammen. Dette gir et kart som speiler
hvor kraftutvekslingen geografisk skjer, ikke bare hvilke soner som
utveksler.
"""
import concurrent.futures
import os
import time
from typing import Optional

import pandas as pd
from entsoe import EntsoePandasClient

# --------------------------------------------------------------------------
# Sone-sentroider (NO1–NO5) — kun brukt for interne forbindelser
# --------------------------------------------------------------------------
# Koordinater i [lengdegrad, breddegrad] (GeoJSON-konvensjon). Disse er
# fritt valgte sentralpunkter som gir pene linjer mellom sonene på et
# oversiktskart. Eksterne forbindelser bruker IKKE disse — de har sine
# egne fysiske endepunkter (se CONNECTIONS).
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
# Hver forbindelse er en dict med:
#   a, b      — ENTSO-E Area-koder (NO_1, SE_3 osv.)
#   kind      — "internal" (NO-NO) eller "external" (NO ↔ utland)
#   cable     — kabelnavn (kun eksterne), eller None
#   a_point   — koordinat for endepunkt på A-siden (valgfritt for interne)
#   b_point   — koordinat for endepunkt på B-siden (valgfritt for interne)
#
# Når a_point/b_point mangler, faller vi tilbake på ZONE_CENTROIDS.
# Det gjør interne forbindelser kompakte i konfig, mens eksterne kan
# peke til faktiske landtak/transformatorstasjoner.
#
# Eksterne forbindelser har den NORSKE SIDEN som "a", så samme konvensjon
# gjelder overalt: når frontend bestemmer eksport/import-farge, sjekker
# den om edge.from starter med "NO_".
CONNECTIONS = [
    # ----- Internt Norge — bruker sone-sentroider -----
    {"a": "NO_1", "b": "NO_2", "kind": "internal", "cable": None},
    {"a": "NO_1", "b": "NO_3", "kind": "internal", "cable": None},
    {"a": "NO_1", "b": "NO_5", "kind": "internal", "cable": None},
    {"a": "NO_2", "b": "NO_5", "kind": "internal", "cable": None},
    {"a": "NO_3", "b": "NO_4", "kind": "internal", "cable": None},
    {"a": "NO_3", "b": "NO_5", "kind": "internal", "cable": None},

    # ----- AC mot Sverige — ender ved faktiske transformatorstasjoner -----
    # NO_1 ↔ SE_3: Hasle-korridoren, Norges viktigste eksportkanal til Sverige
    {"a": "NO_1", "b": "SE_3", "kind": "external", "cable": None,
     "a_point": [11.39, 59.13],   # Hasle transformatorstasjon, Halden
     "b_point": [13.04, 59.50]},  # Borgvik, Värmland

    # NO_3 ↔ SE_2: Nea–Järpströmmen-linjen
    {"a": "NO_3", "b": "SE_2", "kind": "external", "cable": None,
     "a_point": [11.92, 63.05],   # Nea kraftverk, Tydal
     "b_point": [13.50, 63.36]},  # Järpströmmen, Åre

    # NO_4 ↔ SE_1: Ofoten–Ritsem
    {"a": "NO_4", "b": "SE_1", "kind": "external", "cable": None,
     "a_point": [17.32, 68.55],   # Ofoten transformatorstasjon, Bjerkvik
     "b_point": [17.46, 67.71]},  # Ritsem

    # NO_4 ↔ SE_2: Røssåga–Ajaure
    {"a": "NO_4", "b": "SE_2", "kind": "external", "cable": None,
     "a_point": [13.40, 65.99],   # Røssåga, sør for Mo i Rana
     "b_point": [15.46, 65.97]},  # Ajaure

    # ----- AC mot Finland -----
    # NO_4 ↔ FI: Varangerbotn–Ivalo, eneste direkte AC-sammenkobling
    # mellom Norge og Finland (220 kV-linje). Eier Statnett på norsk
    # side, Fingrid på finsk.
    {"a": "NO_4", "b": "FI", "kind": "external", "cable": None,
     "a_point": [28.5444, 70.1703],   # Varangerbotn transformatorstasjon, Nesseby
     "b_point": [27.5653, 68.6467]},  # Ivalo sähköasema, Inari/Enare

    # ----- HVDC-sjøkabler — ender ved faktiske omformerstasjoner -----
    # Skagerrak 1–4: NO_2 ↔ DK_1
    {"a": "NO_2", "b": "DK_1", "kind": "external", "cable": "Skagerrak",
     "a_point":   [8.05,  58.13],   # Kristiansand-området (Kvarenesfjorden)
     "b_point":   [9.59,  56.49],   # Tjele, Jylland
     "sea_point": [8.70,  57.50]},  # Skagerrak, nord-vest for Jylland

    # NordLink: NO_2 ↔ DE_LU
    {"a": "NO_2", "b": "DE_LU", "kind": "external", "cable": "NordLink",
     "a_point":   [6.71,  58.66],   # Tonstad, Sirdal
     "b_point":   [9.38,  53.93],   # Wilster, Schleswig-Holstein
     "sea_point": [6.50,  56.50]},  # Nordsjøen, vest for Jylland

    # North Sea Link: NO_2 ↔ GB
    {"a": "NO_2", "b": "GB", "kind": "external", "cable": "North Sea Link",
     "a_point":   [6.83,  59.49],   # Kvilldal, Suldal
     "b_point":   [-1.51, 55.13],   # Blyth, Northumberland
     "sea_point": [2.00,  57.00]},  # Midt i Nordsjøen

    # NorNed: NO_2 ↔ NL
    {"a": "NO_2", "b": "NL", "kind": "external", "cable": "NorNed",
     "a_point":   [6.79,  58.31],   # Feda, Kvinesdal
     "b_point":   [6.83,  53.45],   # Eemshaven, Groningen
     "sea_point": [5.00,  56.00]},  # Nordsjøen, vest for Danmark
]


# --------------------------------------------------------------------------
# Cache og klient
# --------------------------------------------------------------------------
CACHE_TTL_SECONDS = 3600  # 1 time — flyt-data oppdateres hourly
REQUEST_TIMEOUT = 20      # sekunder per ENTSO-E-kall

_cache: dict = {}
_client: Optional[EntsoePandasClient] = None


def get_client() -> EntsoePandasClient:
    """Lazy-init av ENTSO-E-klient (samme mønster som entsoe_service)."""
    global _client
    if _client is None:
        token = os.getenv("ENTSOE_API_TOKEN")
        if not token:
            raise RuntimeError("ENTSOE_API_TOKEN mangler i miljøet")
        _client = EntsoePandasClient(api_key=token)
    return _client


def _endpoint(conn: dict, side: str) -> Optional[list]:
    """
    Returnerer koordinat for "a"- eller "b"-siden av en forbindelse.
    Prøver først eksplisitt a_point/b_point, faller tilbake på sone-sentroid.
    """
    point_key = f"{side}_point"     # "a_point" eller "b_point"
    if point_key in conn:
        return conn[point_key]
    zone = conn[side]
    return ZONE_CENTROIDS.get(zone)


# --------------------------------------------------------------------------
# Worker: ett retningskall
# --------------------------------------------------------------------------
def _fetch_one_direction(
    from_code: str, to_code: str, start: pd.Timestamp, end: pd.Timestamp
) -> tuple:
    """
    Henter flyt-serien for én retning (from_code → to_code).

    Returnerer (from_code, to_code, series_eller_None). Fanger ALLE
    exceptions lokalt og returnerer None for serien hvis noe feiler —
    det er hele poenget med å isolere per grense. En død grense skal
    aldri trekke ned hele endepunktet.
    """
    try:
        client = get_client()
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
    except Exception as e:
        print(f"[flow_service] {from_code} → {to_code} feilet: {e}")
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

    # Valgfrie mellompunkter (kun definert for HVDC-sjøkabler). Lagres
    # som liste — gjør det trivielt å utvide til flere "knekkpunkter"
    # senere uten å endre datastrukturen. Tomt for AC og interne forb.
    via_a_to_b = [conn["sea_point"]] if conn.get("sea_point") else []

    # Orienter edge i flytretningen så `mw` alltid er positiv. Bytt også
    # endepunktene så from_point matcher from-sonen og to_point matcher
    # to-sonen. Da kan frontend bare lese koordinatene rett ut.
    # Mellompunktene reverseres ved retning-flip — for én havpunkt spiller
    # det ingen rolle, men det er korrekt og fremtidssikkert.
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
        "id": f"{sone_a}-{sone_b}",       # kanonisk uavhengig av retning
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
# Hovedfunksjon: fetch_current_flows()
# --------------------------------------------------------------------------
def fetch_current_flows() -> dict:
    """
    Henter siste kjente nettoflyt for alle 15 grenser, parallelt.

    Returstruktur:
        {
            "edges": [
                {
                    "id": "NO_2-NL",
                    "from": "NO_2",
                    "to":   "NL",
                    "from_point": [6.79, 58.31],
                    "to_point":   [6.83, 53.45],
                    "mw": 700.0,
                    "kind": "external",
                    "cable": "NorNed",
                    "timestamp": "2026-06-21T13:00:00+02:00",
                },
                ...
            ]
        }

    Tidligere returnerte vi også en separat `endpoints`-dict, men nå
    ligger koordinatene innebygd per edge — det er enklere for frontend
    og lar oss ha ulike endepunkter for f.eks. NO_4→SE_1 vs NO_4→SE_2.
    """
    cached = _cache.get("current")
    if cached is not None:
        ts, data = cached
        if time.time() - ts <= CACHE_TTL_SECONDS:
            return data

    get_client()

    tz = "Europe/Oslo"
    now = pd.Timestamp.now(tz=tz)
    start = now - pd.Timedelta(hours=6)
    end = now

    # 30 kall (15 forbindelser × 2 retninger)
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
        # Begge endepunkter må være kjente koordinater
        if edge["from_point"] is None or edge["to_point"] is None:
            print(f"[flow_service] Mangler koordinat for {conn['a']}↔{conn['b']}, hopper over")
            continue
        edges.append(edge)

    result = {"edges": edges}

    if edges:
        _cache["current"] = (time.time(), result)

    return result
