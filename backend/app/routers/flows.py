"""
Flows router
------------
Endepunkter for kraftflyt mellom prisområder og over landegrenser.
"""
from fastapi import APIRouter, HTTPException

from app.services import flow_service

router = APIRouter()


@router.get("/current")
def get_current_flows():
    """
    Returnerer siste kjente nettoflyt for alle overvåkede grenser.

    Hver edge er orientert i flytretningen (positiv `mw`), og kommer
    med `kind` ("internal" eller "external") og evt. `cable`-navn.
    Endepunkts-koordinater følger med så frontend kan tegne pilene
    uten et eget oppslag.
    """
    try:
        return flow_service.fetch_current_flows()
    except RuntimeError as e:
        # Konfigurasjonsfeil (mangler token) → 500
        raise HTTPException(status_code=500, detail=str(e))
