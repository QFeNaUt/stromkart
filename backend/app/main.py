"""
Strømkartet API
---------------
Backend-API for Strømkartet: norsk strømnett-visualisering med 
priser, soner, og senere produksjon og avbrudd. Returnerer kun 
JSON — frontend leveres separat fra Cloudflare Pages.

Kjør lokalt:
    uvicorn app.main:app --reload --port 8000

URL-er:
    http://localhost:8000/api/...  → backend-endepunkter
    http://localhost:8000/docs     → Swagger UI
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import prices, zones

# Tillatte origins for CORS. Stramt definert i stedet for "*" 
# fordi vi nå serverer frontend fra en annen origin (Pages) 
# enn backend (api-subdomenet). Dev-origins beholdt for lokal 
# testing — kan fjernes/kommenteres ut i ren prod-deploy.
ALLOWED_ORIGINS = [
    "https://stromkart.no",          # prod (Cloudflare Pages)
    "http://localhost:5500",         # dev: lokal frontend (python http.server / Live Server)
    "http://127.0.0.1:5500",         # dev: samme, eksplisitt loopback
]

app = FastAPI(
    title="Strømkartet API",
    description="Norsk strømnett-visualisering: priser, soner, produksjon",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],   # vi serverer kun lesing — ingen POST/PUT/DELETE foreløpig
    allow_headers=["*"],
)

# API-endepunkter
app.include_router(prices.router, prefix="/api/prices", tags=["prices"])
app.include_router(zones.router, prefix="/api/zones", tags=["zones"])


@app.get("/api/health")
def health():
    """Helsesjekk."""
    return {"name": "Strømkartet API", "status": "ok"}