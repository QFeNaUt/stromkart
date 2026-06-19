"""
Strømkartet API
---------------
FastAPI-app som leverer data om norske strømsoner og spotpriser,
og serverer en enkel HTML-prototype fra frontend/prototype/.

Kjør lokalt:
    uvicorn app.main:app --reload --port 8000

URL-er:
    http://localhost:8000          → frontend-prototype (index.html)
    http://localhost:8000/api/...  → backend-endepunkter
    http://localhost:8000/docs     → Swagger UI
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routers import prices, zones

app = FastAPI(
    title="Strømkartet API",
    description="Norsk strømnett-visualisering: priser, soner, produksjon",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev: tillat alt. Stram inn i produksjon.
    allow_methods=["*"],
    allow_headers=["*"],
)

# API-endepunkter
app.include_router(prices.router, prefix="/api/prices", tags=["prices"])
app.include_router(zones.router, prefix="/api/zones", tags=["zones"])


@app.get("/api/health")
def health():
    """Helsesjekk."""
    return {"name": "Strømkartet API", "status": "ok"}


# Statisk frontend — serverer index.html på /
# NB: må monteres SIST, slik at /api/* fortsatt rutes til routerne over.
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend" / "prototype"
if FRONTEND_DIR.exists():
    app.mount(
        "/",
        StaticFiles(directory=FRONTEND_DIR, html=True),
        name="frontend",
    )
