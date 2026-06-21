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

    Response-format:
        {
          "edges": [
            {"id": "NO_2-NL", "from": "NO_2", "to": "NL",
             "from_point": [lon, lat], "to_point": [lon, lat],
             "via_points": [[lon, lat], ...],
             "mw": 700.0, "kind": "external", "cable": "NorNed",
             "timestamp": "2026-06-21T13:00:00+02:00"},
            ...
          ],
          "is_stale": false
        }

    `is_stale=true` signaliserer at responsen kommer fra cache fordi
    nytt forsøk feilet eller ga vesentlig færre edges enn cachen.
    Stale-fallback gjelder innenfor 24t (CACHE_TTL_STALE_SECONDS i
    flow_service.py). Frontend kan bruke flagget til å vise en
    "data fra cache"-indikator når relevant.
    """
    try:
        return flow_service.fetch_current_flows()
    except RuntimeError as e:
        # Konfigurasjonsfeil (mangler token) → 500
        raise HTTPException(status_code=500, detail=str(e))
