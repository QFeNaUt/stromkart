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

Returnerer en liste av "edges" der hver edge er orientert i flytretningen
(positivt MW-tall, `from` = der strømmen kommer fra, `to` = der den går),
pluss et endepunkts-kart med koordinater for tegning i frontend.
"""
import concurrent.futures
import os
import time
from typing import Optional

import pandas as pd
from entsoe import EntsoePandasClient

# --------------------------------------------------------------------------
# Forbindelser (15 stk)
# --------------------------------------------------------------------------
# Hver tuple: (sone_a, sone_b, kind, navn)
#   - sone_a/sone_b: ENTSO-E Area-koder (de bruker underscore, f.eks. NO_1)
#   - kind: "internal" (NO-NO) eller "external" (NO ↔ utland)
#   - navn: valgfritt kabelnavn for utenlandske forbindelser, ellers None
#
# For interne forbindelser (NO_x ↔ NO_y) er retning vilkårlig.
# For eksterne er den norske siden alltid sone_a — det forenkler
# import/eksport-logikken i frontend (positiv "fra norsk side" = eksport).
CONNECTIONS = [
    # Internt Norge
    ("NO_1", "NO_2", "internal", None),
    ("NO_1", "NO_3", "internal", None),
    ("NO_1", "NO_5", "internal", None),
    ("NO_2", "NO_5", "internal", None),
    ("NO_3", "NO_4", "internal", None),
    ("NO_3", "NO_5", "internal", None),

    # Sverige
    ("NO_1", "SE_3", "external", None),
    ("NO_3", "SE_2", "external", None),
    ("NO_4", "SE_1", "external", None),
    ("NO_4", "SE_2", "external", None),

    # Finland
    ("NO_4", "FI",   "external", None),

    # Sjøkabler til kontinentet og UK
    ("NO_2", "DK_1", "external", "Skagerrak"),
    ("NO_2", "DE_LU","external", "NordLink"),
    ("NO_2", "GB",   "external", "North Sea Link"),
    ("NO_2", "NL",   "external", "NorNed"),
]


# --------------------------------------------------------------------------
# Endepunktskoordinater [lengdegrad, breddegrad] — GeoJSON-konvensjon
# --------------------------------------------------------------------------
# Norske soner: omtrentlige sentroider, valgt så pilene tegnes pent på
# kartet. Kan finjusteres senere uten databasebytte — bare en konstant.
# Utenlandske kabel-endepunkter: faktiske ilandføringssteder.
# Utenlandske naboland (SE/FI/DK): omtrentlige sentroider av sonene.
ENDPOINTS = {
    # Norge — omtrentlige sone-sentroider
    "NO_1": [10.5, 60.5],   # Øst-Norge (Oslo-regionen)
    "NO_2": [7.5,  58.8],   # Sør-Norge (Agder/Rogaland)
    "NO_3": [10.5, 63.5],   # Midt-Norge (Trondheim-regionen)
    "NO_4": [18.0, 68.5],   # Nord-Norge (Tromsø-regionen)
    "NO_5": [6.5,  60.5],   # Vest-Norge (Bergen-regionen)

    # Sverige — sone-sentroider
    "SE_1": [19.0, 67.0],   # Nord-Sverige (Kiruna-regionen)
    "SE_2": [17.0, 64.0],   # Mellom-nord Sverige (Sundsvall-regionen)
    "SE_3": [16.0, 59.5],   # Sør-midt Sverige (Stockholm-regionen)

    # Finland — landssentroid (FI er én sone)
    "FI":   [26.0, 62.0],

    # Danmark — DK1 (Jylland) sentroid
    "DK_1": [9.5,  56.0],

    # Sjøkabel-endepunkter: faktiske ilandføringssteder i utlandet
    "DE_LU": [9.38,  53.93],  # Wilster, Tyskland (NordLink)
    "GB":    [-1.51, 55.13],  # Blyth, England (North Sea Link)
    "NL":    [6.84,  53.45],  # Eemshaven, Nederland (NorNed)
}


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
    sone_a: str, sone_b: str,
    series_a_to_b: Optional[pd.Series],
    series_b_to_a: Optional[pd.Series],
) -> Optional[dict]:
    """
    Regner netto flyt på grensen (sone_a, sone_b) ut fra de to enveis-seriene.

    For at netto skal være meningsfullt må vi sammenligne SAMME time i
    begge retninger. Ellers sammenligner vi epler og pærer (f.eks. eksport
    kl 14:00 mot import kl 13:00). Vi finner siste tidsstempel som finnes
    i BEGGE seriene.

    Returnerer en orientert edge:
        - `from`/`to` peker i flytretningen (netto positiv)
        - `mw` er absolutt verdi
        - `timestamp` er den felles timen vi brukte
    Eller None hvis det ikke finnes overlappende data.
    """
    # Begge retninger må ha minst én datarad for at netto skal gi mening
    if series_a_to_b is None or series_b_to_a is None:
        return None

    # Tidsstempler som finnes i begge → siste felles time
    common_index = series_a_to_b.index.intersection(series_b_to_a.index)
    if common_index.empty:
        return None

    latest = common_index.max()
    flow_a_to_b = float(series_a_to_b.loc[latest])
    flow_b_to_a = float(series_b_to_a.loc[latest])

    # Netto: positiv betyr at A → B er den dominerende retningen
    net = flow_a_to_b - flow_b_to_a

    # Orienter edge i flytretningen så `mw` alltid er positiv. Da slipper
    # frontend å håndtere fortegn — den tegner bare pilen fra → to.
    if net >= 0:
        from_zone, to_zone, mw = sone_a, sone_b, net
    else:
        from_zone, to_zone, mw = sone_b, sone_a, -net

    return {
        "from": from_zone,
        "to": to_zone,
        "mw": round(mw, 1),
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
                    "id": "NO_1-NO_2",          # uavhengig av retning
                    "from": "NO_1",             # flytretning
                    "to":   "NO_2",
                    "mw": 234.5,                # absolutt netto MW
                    "kind": "internal",         # eller "external"
                    "cable": null,              # eller "NordLink" osv.
                    "timestamp": "2026-06-21T13:00:00+02:00",
                },
                ...
            ],
            "endpoints": {
                "NO_1": [10.5, 60.5],
                ...
            }
        }
    """
    # 1) Cache?
    cached = _cache.get("current")
    if cached is not None:
        ts, data = cached
        if time.time() - ts <= CACHE_TTL_SECONDS:
            return data

    # 2) Forbered: klient + tidsvindu
    get_client()  # init i hovedtråden, unngå race i workers

    tz = "Europe/Oslo"
    now = pd.Timestamp.now(tz=tz)
    # Vi henter siste 6 timer. ENTSO-E publiserer flyt med noen timers
    # forsinkelse, og 6t-vinduet sikrer at vi har overlapp i begge retninger
    # selv om en time er forsinket. Kostnaden er minimal — vi får uansett
    # bare tilbake en kort serie per kall.
    start = now - pd.Timedelta(hours=6)
    end = now

    # 3) Lag jobbliste: 30 kall (15 forbindelser × 2 retninger)
    jobs = []
    for sone_a, sone_b, _kind, _cable in CONNECTIONS:
        jobs.append((sone_a, sone_b))  # A → B
        jobs.append((sone_b, sone_a))  # B → A

    # 4) Hent alt parallelt
    raw: dict[tuple, Optional[pd.Series]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        futures = [
            ex.submit(_fetch_one_direction, frm, to, start, end)
            for frm, to in jobs
        ]
        for future in concurrent.futures.as_completed(futures):
            frm, to, series = future.result()
            raw[(frm, to)] = series

    # 5) Aggreger til edges (én per forbindelse)
    edges = []
    for sone_a, sone_b, kind, cable in CONNECTIONS:
        edge = _net_flow(
            sone_a, sone_b,
            raw.get((sone_a, sone_b)),
            raw.get((sone_b, sone_a)),
        )
        if edge is None:
            # Grensen droppes — ingen overlappende data
            print(f"[flow_service] Ingen data for {sone_a}↔{sone_b}, hopper over")
            continue
        edge["id"] = f"{sone_a}-{sone_b}"  # kanonisk ID uavhengig av retning
        edge["kind"] = kind
        edge["cable"] = cable
        edges.append(edge)

    # 6) Bygg endepunkt-kart kun for soner som faktisk er i bruk
    used_zones = {z for e in edges for z in (e["from"], e["to"])}
    endpoints = {z: ENDPOINTS[z] for z in used_zones if z in ENDPOINTS}

    result = {
        "edges": edges,
        "endpoints": endpoints,
    }

    # 7) Cache hvis vi fikk minst én edge. Ved fullstendig API-stopp lar
    #    vi neste request prøve igjen i stedet for å cache en tom liste.
    if edges:
        _cache["current"] = (time.time(), result)

    return result
