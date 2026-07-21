"""
routers/analysis.py — mottak og servering av daglig markedsanalyse (P3).

POST /api/analysis   Bearer-token (ANALYSE_TOKEN fra /home/stromkart/.env),
                     streng validering, ATOMISK skriv til disk.
GET  /api/analysis   serverer fila + is_stale (> 26 t siden generering) —
                     samme wrapper-mønster som /api/balance/current.

Stale-fallback er selve filsystemet: feiler dagens POST, ligger gårsdagens
fil urørt og serveres videre. Ingen egen fallback-logikk nødvendig.

INSTALLASJON (to linjer i backend/app/main.py — leveres som instruks, ikke
transformasjon, siden main.py ikke er baseline-låst i denne økta):
    from app.routers import analysis
    app.include_router(analysis.router)
Og i /home/stromkart/.env:  ANALYSE_TOKEN=<samme hex som på PC-en>
"""

import json
import os
import secrets
import tempfile
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Request

router = APIRouter(prefix="/api/analysis", tags=["analysis"])

FIL = "/home/stromkart/data/analyse.json"
GYLDIGE_SONER = {"NO_1", "NO_2", "NO_3", "NO_4", "NO_5"}
MAKS_BYTES = 65_536          # hele payloaden
MAKS_TEKST = 1_500           # tegn per sone
STALE_TIMER = 26             # 13:15-jobb + romslig margin


def _sjekk_token(authorization: str | None) -> None:
    fasit = os.environ.get("ANALYSE_TOKEN")
    if not fasit:
        raise HTTPException(503, "ANALYSE_TOKEN ikke konfigurert på serveren")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Mangler Bearer-token")
    # compare_digest: konstant-tid-sammenligning (ikke sårbar for timing).
    if not secrets.compare_digest(authorization.removeprefix("Bearer "), fasit):
        raise HTTPException(403, "Ugyldig token")


def _valider(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise HTTPException(422, "Payload må være et JSON-objekt")
    try:
        datetime.fromisoformat(payload["generert_utc"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(422, "generert_utc mangler eller er ugyldig ISO-tid")
    soner = payload.get("soner")
    if not isinstance(soner, dict) or not soner:
        raise HTTPException(422, "soner mangler eller er tom")
    if not set(soner) <= GYLDIGE_SONER:
        raise HTTPException(422, f"Ukjente sonenøkler: {set(soner) - GYLDIGE_SONER}")
    for sone, innhold in soner.items():
        tekst = (innhold or {}).get("tekst")
        if not isinstance(tekst, str) or not (1 <= len(tekst) <= MAKS_TEKST):
            raise HTTPException(422, f"{sone}: tekst mangler eller er for lang")
    # Kun kjente toppnivå-felt slipper gjennom (dropp alt annet stille).
    return {"generert_utc": payload["generert_utc"], "soner": soner}


@router.post("")
async def motta(request: Request, authorization: str | None = Header(None)):
    _sjekk_token(authorization)
    raadata = await request.body()
    if len(raadata) > MAKS_BYTES:
        raise HTTPException(413, f"Payload over {MAKS_BYTES} bytes")
    try:
        payload = json.loads(raadata)
    except json.JSONDecodeError:
        raise HTTPException(422, "Ugyldig JSON")
    ren = _valider(payload)

    # Atomisk skriv: tmp-fil i samme katalog + os.replace. En krasj midt i
    # skrivingen kan aldri etterlate en halv fil — gammel versjon står.
    os.makedirs(os.path.dirname(FIL), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(FIL), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(ren, f, ensure_ascii=False)
        os.replace(tmp, FIL)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return {"status": "ok", "soner": sorted(ren["soner"])}


@router.get("")
async def hent():
    if not os.path.exists(FIL):
        raise HTTPException(404, "Ingen analyse publisert ennå")
    with open(FIL, encoding="utf-8") as f:
        data = json.load(f)
    try:
        alder_t = (datetime.now(timezone.utc)
                   - datetime.fromisoformat(data["generert_utc"])
                   ).total_seconds() / 3600
        data["is_stale"] = alder_t > STALE_TIMER
    except (KeyError, ValueError):
        data["is_stale"] = True
    return data
