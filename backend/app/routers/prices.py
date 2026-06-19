"""
Prices router
-------------
Endepunkter for spotpriser.
"""
from fastapi import APIRouter, HTTPException

from app.services import entsoe_service

router = APIRouter()


@router.get("/current")
def get_current_prices():
    """
    Returnerer siste kjente spotpris (EUR/MWh) for alle norske prissoner.

    Eksempel-svar:
    {
        "NO1": {"zone": "NO1", "price_eur_mwh": 45.2, "currency": "EUR/MWh", "timestamp": "2026-06-19T14:00:00+02:00"},
        "NO2": {...}
    }
    """
    try:
        return entsoe_service.fetch_current_prices()
    except RuntimeError as e:
        # Konfigurasjonsfeil (mangler token) → 500
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/today")
def get_today_prices():
    """
    Returnerer dagens (og morgendagens, n\u00e5r tilgjengelig) spotpriser
    per sone som tidsserier.
    """
    try:
        return entsoe_service.fetch_today_prices()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))