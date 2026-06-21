"""
Reservoirs router
-----------------
Endepunkter for vannmagasin-fyllingsgrad per elspotområde.
Data hentes fra NVE sin åpne Magasinstatistikk-API (ukentlig oppdatert).
"""
from fastapi import APIRouter, HTTPException

from app.services import nve_service

router = APIRouter()


@router.get("/current")
def get_current_reservoir_levels():
    """
    Returnerer siste publiserte fyllingsgrad per elspotområde (NO_1–NO_5).

    NVE publiserer ny statistikk onsdager kl 13:00, basert på måling
    søndag kveld. Dataene cacher backend i 24t fersk + 7 dager stale
    fallback, så normal lasttid er null overfor NVE.

    Response-format:
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
              "next_publication": "2026-06-24T13:00:00"
            },
            ...
          },
          "is_stale": false
        }

    `is_stale=true` betyr at NVE-API var nede ved siste forsøk og at
    backend serverer cache (inntil 7 dager gammel). Frontend kan vise
    en indikator hvis ønsket.
    """
    try:
        return nve_service.fetch_reservoir_levels()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
