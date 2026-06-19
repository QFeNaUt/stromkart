# Strømkartet

Interaktiv visualisering av det norske strømnettet — priser, soner, produksjon.

## Status

Fase 2 under bygging: FastAPI backend + React/MapLibre frontend.

## Struktur

```
stromkart/
├── backend/             # FastAPI
│   ├── app/
│   │   ├── main.py
│   │   ├── routers/     # API-endepunkter
│   │   └── services/    # Logikk mot ENTSO-E
│   ├── requirements.txt
│   └── .env             # IKKE i Git! Lages fra .env.example
├── frontend/            # React (kommer)
├── data/
│   └── geojson/         # Cachet sone-GeoJSON
└── README.md
```

## Kjør backend lokalt (Windows / PowerShell)

```powershell
cd C:\Users\Vegard\Documents\Kodeprosjekter\stromkart\backend

# Lag og aktiver et virtuelt miljø
python -m venv .venv
.venv\Scripts\activate

# Installer avhengigheter
pip install -r requirements.txt

# Lag .env og legg inn ENTSO-E-token
copy .env.example .env
# Åpne .env i editor og bytt ut "din_token_her"

# Start serveren
uvicorn app.main:app --reload --port 8000
```

## Test at det funker

Åpne i nettleser:

- http://localhost:8000 — helsesjekk
- http://localhost:8000/docs — interaktiv API-dokumentasjon (Swagger UI)
- http://localhost:8000/api/zones — GeoJSON for NO1–NO5
- http://localhost:8000/api/prices/current — spotpriser akkurat nå

## API-endepunkter

| Metode | Path | Beskrivelse |
|--------|------|-------------|
| GET | `/` | Helsesjekk |
| GET | `/api/zones` | GeoJSON for de fem prissonene |
| POST | `/api/zones/refresh` | Tvinger ny nedlasting av GeoJSON |
| GET | `/api/prices/current` | Siste spotpris per sone |
