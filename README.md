# Strømkartet

**[stromkart.no](https://stromkart.no)** — et interaktivt kart over det
norske kraftsystemet, laget som folkeopplysning: spotpriser, kraftflyt,
magasinfylling og produksjonsmiks vist på en måte som ikke krever
forkunnskaper om kraftmarkedet.

Kartet viser de fem norske prissonene (NO1–NO5) med sanntids spotpris,
fysisk kraftflyt mellom landsdeler og over utenlandsforbindelsene
(inkludert HVDC-sjøkablene), magasinfylling per sone sammenlignet med
historisk normalnivå, forbruk og produksjonsmiks per sone, og de største
vann- og vindkraftverkene. En tidslinje lar deg spole gjennom døgnets
priser i 15-minutters steg (MTU).

Prisene vises i øre/kWh **eks. mva, nettleie og avgifter** — kartet
viser markedet (råvareprisen fra kraftbørsen), ikke sluttsummen på
strømregningen. Dette er et bevisst valg: målet er å gjøre selve
markedsmekanikken lesbar.

## Datakilder og attribusjon

| Kilde | Data | Lisens/vilkår |
|---|---|---|
| [ENTSO-E Transparency Platform](https://transparency.entsoe.eu/) | Spotpriser (Day-Ahead), kraftflyt, forbruk, produksjonsmiks | ENTSO-E-vilkår |
| [NVE Magasinstatistikk](https://www.nve.no/energi/analyser-og-statistikk/magasinstatistikk/) | Magasinfylling per prisområde | NLOD |
| [Norges Bank](https://www.norges-bank.no/tema/Statistikk/Valutakurser/) | Valutakurs EUR→NOK for øre/kWh-omregning | Åpne data |
| [Electricity Maps](https://github.com/electricitymaps) | Sonegeometri (GeoJSON) | Open source |
| [OpenStreetMap](https://www.openstreetmap.org/) | Koordinater for kraftverk og kabeltraséer | ODbL |
| [CARTO](https://carto.com/) / OpenStreetMap | Bakgrunnskart (Dark Matter) | CARTO-vilkår / ODbL |

Prisformel: `øre/kWh = EUR/MWh × dagskurs ÷ 10`.

## Arkitektur (blokknivå)

```
Nettleser
  ├── stromkart.no      → Cloudflare Pages   → frontend (React + Vite + MapLibre GL JS)
  └── api.stromkart.no  → Cloudflare Tunnel  → backend  (FastAPI/uvicorn, hjemmeserver)
```

- **Frontend:** React med MapLibre GL JS bak en imperativ kart-wrapper —
  React eier paneler, kontroller og tilstand; kartlagene er håndskrevet
  MapLibre-kode. Bygges med Vite og deployes automatisk til Cloudflare
  Pages ved push til `main`.
- **Backend:** FastAPI som henter, cacher og normaliserer data fra
  kildene over, og eksponerer et lite JSON-API. Kjører på en
  hjemmeserver (Proxmox LXC) bak Cloudflare Tunnel. API-dokumentasjon
  genereres automatisk på `/docs` (Swagger).

## Struktur (toppnivå)

```
backend/    FastAPI-app: routers, services, modeller
frontend/   Vite-prosjekt: index.html, src/ (React-komponenter + kartmoduler)
verktoy/    Python-ETL for kuratering av kraftverksdata (NVE + OSM)
data/       Statisk geodata
```

## Kjøre lokalt

Backend (krever egen ENTSO-E-API-token i `.env`, se `.env.example`):

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend (Node-versjon i `frontend/.nvmrc`):

```bash
cd frontend
npm install
npm run dev        # → http://localhost:5500
```

Dev-serveren er låst til port 5500 fordi backendens CORS-whitelist
forventer den. Pek `API_BASE` i `frontend/src/js/config.js` mot
`http://localhost:8000` for å kjøre mot lokal backend.

## Lisens og bruk

Koden er et hobbyprosjekt med folkeopplysning som formål. Dataene
tilhører sine respektive kilder (se tabellen over) og videreformidles i
henhold til deres vilkår. Tallene på kartet er ment som opplysning, ikke
som grunnlag for handel eller fakturakontroll.
