"""
Diagnostikk for ENTSO-E
-----------------------
Standalone-skript som tester tokenen din mot ENTSO-E uten å gå
gjennom FastAPI. Kjør slik fra backend-mappa (med .venv aktivert):

    python check_entsoe.py

Hvis dette feiler, vet vi at problemet ligger i tokenen eller nettverket,
ikke i selve API-et vårt.
"""
import os
import traceback

import pandas as pd
from dotenv import load_dotenv
from entsoe import EntsoePandasClient

load_dotenv()

token = os.getenv("ENTSOE_API_TOKEN")
print(f"Token funnet: {'JA' if token else 'NEI'}")
if token:
    print(f"Token-lengde: {len(token)} tegn")
    print(f"Starter med:   {token[:8]}...")
    print(f"Slutter med:   ...{token[-4:]}")
print()

if not token or token == "din_token_her":
    print("FEIL: Tokenen er ikke satt i .env. Avslutter.")
    raise SystemExit(1)

client = EntsoePandasClient(api_key=token)
tz = "Europe/Oslo"
now = pd.Timestamp.now(tz=tz).floor("h")
start = now.normalize() - pd.Timedelta(days=1)
end = now.normalize() + pd.Timedelta(days=2)

print(f"Forespør priser for NO_1 mellom {start} og {end}")
print()

try:
    series = client.query_day_ahead_prices("NO_1", start=start, end=end)
    print("SUKSESS! Fikk en prisserie med", len(series), "punkter.")
    print()
    print("Første 5 punkter:")
    print(series.head())
    print()
    print("Siste 5 punkter:")
    print(series.tail())
except Exception as e:
    print(f"FEIL: {type(e).__name__}: {e}")
    print()
    print("Full traceback:")
    traceback.print_exc()
