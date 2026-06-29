"""
balance_service.py — Forbruk (load) og produksjon (generation) per prisområde.

Henter parallelt fra ENTSO-E for alle 5 norske soner (NO_1..NO_5) i ett kall.
Returnerer per sone: forbruk i MW, produksjonsmiks (både aggregert "summary"
og rådata "detailed" per PSR-type), nettobalanse, og tidsstempler.

Mønster: identisk med flow_service.py — ThreadPoolExecutor med parallelle kall,
to-lags cache (1t fresh / 24t stale), 429-aware retry med 5s backoff,
robust cache-guard mot delvise utfall som ville overskrevet god cache.
"""

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Optional

import pandas as pd
from entsoe import EntsoePandasClient
from entsoe.exceptions import NoMatchingDataError

from app.services.secret_scrub import scrub_secrets

logger = logging.getLogger(__name__)

# ----- Konfigurasjon -----
ZONES = ["NO_1", "NO_2", "NO_3", "NO_4", "NO_5"]
FRESH_TTL = 3600          # 1 time
STALE_TTL = 86400         # 24 timer
RATE_LIMIT_BACKOFF = 5    # sekunder
REQUEST_TIMEOUT = 15      # sekunder — per-request timeout på ENTSO-E-klienten

# Human-readable PSR-navn (slik entsoe-py returnerer dem) -> summary-bøtte.
# Alt som ikke matcher eksplisitt havner i "annet".
#
# Summary-bøtter og fargepalett (referanse for frontend):
#   vann      → #3b82f6 (blå, matcher batteri-ikon)
#   vind      → #22c55e (grønn)
#   sol       → #eab308 (gul)
#   termisk   → varm oransje  — biomasse og avfall (fornybar termisk)
#   fossile   → #8F5342 (brun) — gass, kull, olje, torv, oljeskifer
#   annet     → #737373 (grå)  — geotermisk, marin, kjernekraft, øvrig
PSR_NAME_TO_SUMMARY = {
    # Vann
    "Hydro Water Reservoir":            "vann",
    "Hydro Run-of-river and poundage":  "vann",
    "Hydro Pumped Storage":             "vann",
    # Vind
    "Wind Onshore":                     "vind",
    "Wind Offshore":                    "vind",
    # Sol
    "Solar":                            "sol",
    # Termisk (fornybar/avfall)
    "Biomass":                          "termisk",
    "Waste":                            "termisk",
    # Fossile
    "Fossil Gas":                       "fossile",
    "Fossil Hard coal":                 "fossile",
    "Fossil Brown coal/Lignite":        "fossile",
    "Fossil Oil":                       "fossile",
    "Fossil Oil shale":                 "fossile",
    "Fossil Peat":                      "fossile",
    "Fossil Coal-derived gas":          "fossile",
    # Resten ("Geothermal", "Marine", "Nuclear", "Other renewable", "Other")
    # faller til "annet" via default i _summary_from_detailed().
}

# ----- In-memory cache -----
_cache: Dict[str, object] = {
    "data": None,         # siste vellykkede respons-dict
    "timestamp": 0.0,     # epoch-sekunder
}


def _get_client() -> EntsoePandasClient:
    token = os.getenv("ENTSOE_API_TOKEN")
    if not token:
        raise RuntimeError("ENTSOE_API_TOKEN ikke satt")
    return EntsoePandasClient(api_key=token, timeout=REQUEST_TIMEOUT)


def _summary_from_detailed(detailed: Dict[str, float]) -> Dict[str, float]:
    """Aggregér PSR-typer til 6 hovedbøtter for kompakt søyle."""
    summary = {
        "vann":    0.0,
        "vind":    0.0,
        "sol":     0.0,
        "termisk": 0.0,
        "fossile": 0.0,
        "annet":   0.0,
    }
    for psr_name, mw in detailed.items():
        bucket = PSR_NAME_TO_SUMMARY.get(psr_name, "annet")
        summary[bucket] += mw
    return summary


def _extract_latest(series_or_df) -> tuple:
    """
    Returnér (verdi/dict, iso-timestamp) for siste rad <= nå.
    Series -> (float, str). DataFrame -> (dict[col_name]=float, str).
    Returnerer (None, None) hvis tom.
    """
    if series_or_df is None or len(series_or_df) == 0:
        return None, None
    tz = series_or_df.index.tz
    now = pd.Timestamp.now(tz=tz)
    filtered = series_or_df[series_or_df.index <= now]
    if len(filtered) == 0:
        return None, None
    last = filtered.iloc[-1]
    ts_iso = filtered.index[-1].isoformat()
    if isinstance(last, pd.Series):
        # DataFrame-rad -> dict per kolonne
        out = {}
        for col, val in last.items():
            # col kan være tuple (multi-index) eller string
            name = col[0] if isinstance(col, tuple) else col
            if pd.notna(val) and val > 0:
                out[name] = float(val)
        return out, ts_iso
    return float(last), ts_iso


def _call_with_retry(fn, *args, **kwargs):
    """Kjør én ENTSO-E-call med én retry ved 429."""
    try:
        return fn(*args, **kwargs)
    except Exception as e:
        msg = str(e)
        if "429" in msg or "Too Many Requests" in msg:
            logger.info(f"[balance] 429 fra ENTSO-E, retry om {RATE_LIMIT_BACKOFF}s")
            time.sleep(RATE_LIMIT_BACKOFF)
            return fn(*args, **kwargs)
        raise


def _fetch_one_zone(zone: str, start: pd.Timestamp, end: pd.Timestamp) -> Optional[dict]:
    """
    Hent load + generation for én sone. Isolert feilhåndtering:
    returnerer None hvis BÅDE load og gen feiler, ellers en dict med det vi fikk.
    """
    client = _get_client()
    result: Dict[str, object] = {"zone": zone}

    # --- Load ---
    try:
        load_series = _call_with_retry(client.query_load, zone, start=start, end=end)
        # query_load returnerer noen ganger DataFrame (kolonne 'Actual Load'), noen ganger Series
        if isinstance(load_series, pd.DataFrame):
            load_series = load_series.iloc[:, 0]
        load_mw, load_ts = _extract_latest(load_series)
        result["load_mw"] = load_mw
        result["load_timestamp"] = load_ts
    except NoMatchingDataError:
        logger.warning(f"[balance] {zone}: ingen load-data tilgjengelig")
        result["load_mw"] = None
        result["load_timestamp"] = None
    except Exception as e:
        logger.warning(f"[balance] {zone}: load-henting feilet: {scrub_secrets(e)}")
        result["load_mw"] = None
        result["load_timestamp"] = None

    # --- Generation ---
    try:
        gen_df = _call_with_retry(client.query_generation, zone, start=start, end=end)
        detailed, gen_ts = _extract_latest(gen_df)
        if detailed is None:
            detailed = {}
        result["generation_mix"] = {
            "summary": _summary_from_detailed(detailed),
            "detailed": detailed,
            "total_mw": sum(detailed.values()) if detailed else 0.0,
        }
        result["generation_timestamp"] = gen_ts
    except NoMatchingDataError:
        logger.warning(f"[balance] {zone}: ingen generation-data tilgjengelig")
        result["generation_mix"] = None
        result["generation_timestamp"] = None
    except Exception as e:
        logger.warning(f"[balance] {zone}: generation-henting feilet: {scrub_secrets(e)}")
        result["generation_mix"] = None
        result["generation_timestamp"] = None

    # --- Nettobalanse ---
    load = result.get("load_mw")
    gen_mix = result.get("generation_mix")
    if load is not None and gen_mix is not None:
        result["net_balance_mw"] = gen_mix["total_mw"] - load
    else:
        result["net_balance_mw"] = None

    # Hvis begge feilet, returnér None (la cache-guarden vurdere)
    if result["load_mw"] is None and result["generation_mix"] is None:
        return None
    return result


def _zones_with_data(data: dict) -> int:
    """Tell soner der vi har minst én av load/generation."""
    return sum(
        1 for z in data.get("zones", {}).values()
        if z.get("load_mw") is not None or z.get("generation_mix") is not None
    )


def fetch_current_balance() -> dict:
    """
    Hovedfunksjon. Returnerer dict med forbruk + produksjon per sone.
    Cache-strategi identisk med flow_service:
    - Fersk cache (< FRESH_TTL): returnér direkte, is_stale=False
    - Stale cache (< STALE_TTL): brukes hvis ny henting feiler eller blir delvis
    - Ellers: ny henting, cache hvis vellykket
    """
    now_t = time.time()
    cached = _cache.get("data")
    cache_age = now_t - _cache.get("timestamp", 0.0)

    # Fersk cache → returnér direkte
    if cached is not None and cache_age < FRESH_TTL:
        return {**cached, "is_stale": False}

    # Forsøk ny henting
    end = pd.Timestamp.now(tz="Europe/Oslo")
    start = end - pd.Timedelta(hours=4)  # buffer for å garantere data tilgjengelig

    zones_data: Dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(_fetch_one_zone, z, start, end): z for z in ZONES}
        for fut in as_completed(futures):
            zone = futures[fut]
            try:
                res = fut.result()
                if res is not None:
                    zones_data[zone] = res
            except Exception as e:
                logger.error(f"[balance] {zone}: uforventet feil: {scrub_secrets(e)}")

    new_data = {
        "zones": zones_data,
        "fetched_at": pd.Timestamp.now(tz="Europe/Oslo").isoformat(),
    }
    new_count = _zones_with_data(new_data)
    prev_count = _zones_with_data(cached) if cached else 0

    # Guard: ikke overskriv god cache med delvis utfall
    if cached is not None and new_count < prev_count:
        logger.warning(
            f"[balance] Ny henting ga {new_count}/5 soner, cache har {prev_count}/5. "
            f"Returnerer cache (stale={cache_age >= FRESH_TTL})."
        )
        if cache_age < STALE_TTL:
            return {**cached, "is_stale": True}
        # Cache er for gammel — returnér det vi har likevel
        _cache["data"] = new_data
        _cache["timestamp"] = now_t
        return {**new_data, "is_stale": False}

    # Vellykket nok henting → oppdatér cache
    if new_count > 0:
        _cache["data"] = new_data
        _cache["timestamp"] = now_t
        return {**new_data, "is_stale": False}

    # Totalt utfall — fallback til stale cache hvis vi har den
    if cached is not None and cache_age < STALE_TTL:
        logger.warning(f"[balance] Total utfall, returnerer stale cache (alder {cache_age:.0f}s)")
        return {**cached, "is_stale": True}

    # Ingenting å returnere
    return {"zones": {}, "fetched_at": new_data["fetched_at"], "is_stale": False}
