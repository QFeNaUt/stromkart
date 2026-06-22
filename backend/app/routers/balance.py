"""
balance.py — router for forbruk + produksjon per prisområde.

Eksponerer ett endepunkt som returnerer en samlet snapshot per sone:
last (forbruk MW), produksjonsmiks (summary 4 bøtter + detailed PSR-typer),
nettobalanse, tidsstempler, og is_stale-flagg.

is_stale=True indikerer at responsen kommer fra fallback-cache (FRESH_TTL
utløpt eller ny henting feilet/delvis). Frontend kan dempe visuell vekt
tilsvarende kraftflyt-laget.
"""
from fastapi import APIRouter

from app.services.balance_service import fetch_current_balance

router = APIRouter()


@router.get("/current")
async def get_current_balance() -> dict:
    """
    Returnerer forbruk og produksjon per sone (NO_1..NO_5).

    Eksempel-respons:
    {
      "zones": {
        "NO_2": {
          "zone": "NO_2",
          "load_mw": 5234.0,
          "load_timestamp": "2026-06-22T11:45:00+02:00",
          "generation_mix": {
            "summary": {"vann": 4820.0, "vind": 312.0, "sol": 5.0, "termisk_annet": 18.0},
            "detailed": {"Hydro Water Reservoir": 4520.0, ...},
            "total_mw": 5155.0
          },
          "generation_timestamp": "2026-06-22T11:45:00+02:00",
          "net_balance_mw": -79.0
        },
        ...
      },
      "fetched_at": "2026-06-22T11:48:12+02:00",
      "is_stale": false
    }
    """
    return fetch_current_balance()
