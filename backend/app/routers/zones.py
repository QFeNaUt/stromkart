"""
Zones router
------------
Endepunkter for geografiske strømsoner (NO1–NO5).

Henter polygoner fra Electricity Maps sitt open source-repo og caches lokalt
i data/geojson/ slik at vi slipper å treffe GitHub ved hvert kall.

Kildens struktur (https://raw.githubusercontent.com/electricitymaps/zone-finder/main/geo.generated.json):
  {
    "convexhulls": [...],            # forenklede ytterkonturer
    "zoneToGeometryFeatures": {      # detaljerte polygoner, dict per sone
        "NO-NO1": [Feature, ...],
        "NO-NO2": [...],
        ...
    },
    "zoneToLines": {...}             # interconnector-linjer
  }

Vi normaliserer "NO-NO1" → "NO1" i utdata, slik at sonenavnet matcher det
brukerne kjenner (Nord Pool-konvensjonen).
"""
import json
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException

router = APIRouter()

GEOJSON_URL = (
    "https://raw.githubusercontent.com/electricitymaps/zone-finder/"
    "main/geo.generated.json"
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
CACHE_PATH = PROJECT_ROOT / "data" / "geojson" / "no_zones.json"

# Hvilke soner vi vil ha med, og hvordan vi navngir dem i utdata
TARGET_ZONES = {
    "NO-NO1": "NO1",
    "NO-NO2": "NO2",
    "NO-NO3": "NO3",
    "NO-NO4": "NO4",
    "NO-NO5": "NO5",
}


def _extract_norwegian_zones(raw: dict) -> dict:
    """
    Pakker ut norske soner fra zone-finder-strukturen og bygger en
    standard GeoJSON FeatureCollection.

    For hver av NO1–NO5 setter vi 'zoneName' = "NO1" (ikke "NO-NO1")
    så frontenden kan matche direkte mot prisene fra /api/prices/current.
    """
    zone_dict = raw.get("zoneToGeometryFeatures", {})
    if not zone_dict:
        raise ValueError(
            "Forventet nøkkel 'zoneToGeometryFeatures' mangler i kildedata."
        )

    features = []
    for source_name, target_name in TARGET_ZONES.items():
        zone_features = zone_dict.get(source_name, [])
        for f in zone_features:
            # Lag en kopi så vi ikke endrer kildedata, og overskriv zoneName
            new_feature = {
                "type": "Feature",
                "properties": {
                    **f.get("properties", {}),
                    "zoneName": target_name,
                },
                "geometry": f.get("geometry"),
            }
            features.append(new_feature)

    return {"type": "FeatureCollection", "features": features}


def _fetch_and_cache() -> dict:
    """Last ned fra GitHub, pakk ut norske soner, lagre lokalt."""
    response = httpx.get(GEOJSON_URL, timeout=30)
    response.raise_for_status()
    raw = response.json()
    norwegian = _extract_norwegian_zones(raw)

    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(
        json.dumps(norwegian, ensure_ascii=False),
        encoding="utf-8",
    )
    return norwegian


def load_or_fetch_zones() -> dict:
    """Last fra cache hvis tilgjengelig, ellers hent fra nett."""
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return _fetch_and_cache()


@router.get("/")
def get_zones():
    """Returnerer GeoJSON for de fem norske prissonene NO1–NO5."""
    try:
        return load_or_fetch_zones()
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Klarte ikke å hente GeoJSON fra kilden: {e}",
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh")
def refresh_zones():
    """Tvinger ny nedlasting av GeoJSON (overskriver cache)."""
    try:
        data = _fetch_and_cache()
        return {"status": "ok", "feature_count": len(data["features"])}
    except (httpx.HTTPError, ValueError) as e:
        raise HTTPException(status_code=502, detail=str(e))
