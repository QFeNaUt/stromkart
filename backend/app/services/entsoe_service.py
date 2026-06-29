"""
ENTSO-E service
---------------
Henter day-ahead spotpriser fra ENTSO-E Transparency Platform.

Fra 2025 leverer ENTSO-E priser i 15-minutters intervaller (Market Time Unit,
MTU). Vi runder "nå" ned til nærmeste 15-min for å hente riktig pris.

Arkitektur:
    fetch_today_prices()     → spør ENTSO-E, parallelle kall, cachet i 1 time
    fetch_current_prices()   → utleder fra fetch_today_prices(), ingen egne
                               ENTSO-E-kall. Garanterer at /current og /today
                               alltid er konsistente.
"""
import concurrent.futures
import os
import time
import traceback
from typing import Optional

import pandas as pd
from dotenv import load_dotenv
from entsoe import EntsoePandasClient

from app.services import norges_bank_service
from app.services.secret_scrub import scrub_secrets

load_dotenv()

ZONE_CODES = {
    "NO1": "NO_1",
    "NO2": "NO_2",
    "NO3": "NO_3",
    "NO4": "NO_4",
    "NO5": "NO_5",
}

# 'today' cachet lenge fordi day-ahead-priser publiseres én gang per dag
# (~13:00 CET) og endres ikke etterpå.
TODAY_TTL_SECONDS = 3600       # 1 time
ZONE_FETCH_TIMEOUT = 15        # per-request timeout på klienten + maks ventetid i as_completed

# Enkel in-memory cache: {nøkkel: (tidsstempel, data)}
_cache: dict = {}


def _cache_get(key: str, ttl_seconds: int):
    """Returnerer cachet verdi hvis fortsatt fersk, ellers None."""
    entry = _cache.get(key)
    if entry is None:
        return None
    cached_at, data = entry
    if time.time() - cached_at > ttl_seconds:
        return None
    return data


def _cache_set(key: str, data) -> None:
    _cache[key] = (time.time(), data)


def _eur_mwh_to_ore_kwh(eur_mwh: float, rate: float) -> float:
    """
    Konverterer EUR/MWh → øre/kWh.

    Trinn for trinn:
        EUR/MWh ÷ 1000  → EUR/kWh   (1 MWh = 1000 kWh)
        EUR/kWh × rate  → NOK/kWh   (rate = antall NOK per 1 EUR)
        NOK/kWh × 100   → øre/kWh   (1 krone = 100 øre)

    Slått sammen blir det:  øre/kWh = EUR/MWh × rate ÷ 10

    Eksempel: 7.78 EUR/MWh × 11.50 ÷ 10 = 8.95 øre/kWh
    """
    return eur_mwh * rate / 10.0


_client: Optional[EntsoePandasClient] = None


def get_client() -> EntsoePandasClient:
    """Returnerer en cachet ENTSO-E-klient. Krever ENTSOE_API_TOKEN i .env."""
    global _client
    if _client is None:
        token = os.getenv("ENTSOE_API_TOKEN")
        if not token or token == "din_token_her":
            raise RuntimeError(
                "ENTSOE_API_TOKEN er ikke satt. "
                "Kopier .env.example til .env og fyll inn din token."
            )
        _client = EntsoePandasClient(api_key=token, timeout=ZONE_FETCH_TIMEOUT)
    return _client


def _fetch_zone_today(zone_name: str, code: str, start, end, rate: float) -> tuple:
    """
    Henter dagens (og morgendagens) priser for én sone fra ENTSO-E.
    Returnerer (zone_name, result_dict). Brukes som worker i ThreadPoolExecutor.

    `rate` er EUR→NOK-kursen, hentet én gang i fetch_today_prices() og sendt
    inn hit, så vi konverterer alle prispunkter til øre/kWh på samme kurs.
    """
    try:
        client = get_client()
        series = client.query_day_ahead_prices(code, start=start, end=end)

        if series is None or series.empty:
            raise ValueError("Tom prisserie returnert fra ENTSO-E")

        prices = [
            {
                "timestamp": ts.isoformat(),
                "price_eur_mwh": round(float(price), 2),
                "price_ore_kwh": round(_eur_mwh_to_ore_kwh(float(price), rate), 2),
            }
            for ts, price in series.items()
        ]

        return zone_name, {
            "zone": zone_name,
            "currency": "EUR/MWh",
            "eur_nok_rate": round(rate, 4),
            "resolution": _detect_resolution(series),
            "prices": prices,
        }
    except Exception as e:
        # Skrubb token før BÅDE logging og retur. ENTSO-E-feil (401/429/5xx)
        # bærer hele upstream-URL-en med securityToken i klartekst.
        safe_msg = scrub_secrets(e) or "(ingen feilmelding)"
        print(f"[entsoe_service] Feil for sone {zone_name} (today): {safe_msg}")
        print(scrub_secrets(traceback.format_exc()))
        return zone_name, {
            "zone": zone_name,
            "error_type": type(e).__name__,
            "error": safe_msg,
        }


def fetch_today_prices() -> dict:
    """
    Hent alle spotpriser for i dag og (når tilgjengelig) i morgen,
    som tidsserier per sone.

    Returnerer:
    {
        "NO1": {
            "zone": "NO1",
            "currency": "EUR/MWh",
            "resolution": "15min",
            "prices": [
                {"timestamp": "2026-06-19T00:00:00+02:00", "price_eur_mwh": 42.15},
                ...
            ]
        },
        ...
    }
    """
    cached = _cache_get("today", ttl_seconds=TODAY_TTL_SECONDS)
    if cached is not None:
        return cached

    # Initialiser klienten i hovedtråden så vi unngår race condition når
    # 5 worker-tråder forsøker å lage den samtidig ved kald oppstart.
    get_client()

    # Hent valutakursen ÉN gang her (cachet 24t i norges_bank_service), og
    # send den inn i hver worker. Da konverteres alle 5 soner på nøyaktig
    # samme kurs, og vi unngår 5 separate oppslag.
    rate = norges_bank_service.get_eur_nok_rate()

    tz = "Europe/Oslo"
    now = pd.Timestamp.now(tz=tz)
    # Vindu: i dag 00:00 lokal tid → i overmorgen 00:00 lokal tid.
    # Dekker i dag + i morgen (når day-ahead er publisert ~13:00).
    start = now.normalize()
    end = start + pd.Timedelta(days=2)

    results: dict = {}

    # ENTSO-E-kall er I/O-bundet (vi venter på nettverket). Med 5 tråder
    # går wall-clock-tiden ned fra ~10 sek sekvensielt til ~2 sek totalt.
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [
            executor.submit(_fetch_zone_today, name, code, start, end, rate)
            for name, code in ZONE_CODES.items()
        ]
        try:
            for future in concurrent.futures.as_completed(
                futures, timeout=ZONE_FETCH_TIMEOUT
            ):
                zone_name, data = future.result()
                results[zone_name] = data
        except concurrent.futures.TimeoutError:
            # Noen sonekall ble ikke ferdige i tide — marker manglende soner.
            for name in ZONE_CODES:
                if name not in results:
                    results[name] = {
                        "zone": name,
                        "error_type": "TimeoutError",
                        "error": f"ENTSO-E svarte ikke innen {ZONE_FETCH_TIMEOUT} sek",
                    }

    # Cache bare hvis alle sonene gikk gjennom — ellers låser vi en
    # midlertidig feiltilstand inne i en time.
    has_errors = any("error" in v for v in results.values())
    if not has_errors:
        _cache_set("today", results)

    return results


def fetch_current_prices() -> dict:
    """
    Returnerer siste tilgjengelige spotpris per norsk prissone.

    Implementasjon: utleder fra fetch_today_prices() ved å plukke siste
    tidspunkt ≤ nå fra hver sones tidsserie. Ingen separat ENTSO-E-spørring,
    og /current og /today er garantert konsistente.

    Returnerer:
    {
        "NO1": {
            "zone": "NO1",
            "price_eur_mwh": 78.91,
            "currency": "EUR/MWh",
            "timestamp": "2026-06-19T05:15:00+02:00",
            "resolution": "15min",
        },
        ...
    }
    """
    today_data = fetch_today_prices()
    tz = "Europe/Oslo"
    now = pd.Timestamp.now(tz=tz)

    results: dict = {}
    for zone_name, data in today_data.items():
        # Propager feil videre uendret
        if "error" in data:
            results[zone_name] = data
            continue

        prices = data.get("prices", [])
        # Finn siste tidspunkt ≤ nå
        past = [p for p in prices if pd.Timestamp(p["timestamp"]) <= now]

        if past:
            current = past[-1]
        elif prices:
            # Fallback: hele serien er i fremtiden (skal ikke skje når
            # vinduet starter ved midnatt, men ikke krasj heller).
            current = prices[0]
        else:
            results[zone_name] = {
                "zone": zone_name,
                "error_type": "ValueError",
                "error": "Tom prisserie",
            }
            continue

        results[zone_name] = {
            "zone": zone_name,
            "price_eur_mwh": current["price_eur_mwh"],
            "price_ore_kwh": current["price_ore_kwh"],
            "currency": data["currency"],
            "eur_nok_rate": data.get("eur_nok_rate"),
            "timestamp": current["timestamp"],
            "resolution": data["resolution"],
        }

    return results


def _detect_resolution(series: pd.Series) -> str:
    """Returnerer noe sånt som '15min', '30min' eller '60min'."""
    if len(series) < 2:
        return "ukjent"
    delta = series.index[1] - series.index[0]
    minutes = int(delta.total_seconds() / 60)
    return f"{minutes}min"
