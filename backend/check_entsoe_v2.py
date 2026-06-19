"""
Utvidet ENTSO-E diagnostikk
---------------------------
Tester:
1. Hva entsoe-py-versjonen er
2. Hva systemklokka tror datoen er
3. Om et kjent historisk tidsrom har data (jan 2024)
4. Om "i dag" har data
5. Om alle fem norske områdekoder svarer
"""
import os
import sys
import traceback
from datetime import datetime

import entsoe
import pandas as pd
from dotenv import load_dotenv
from entsoe import EntsoePandasClient

load_dotenv()

print("=" * 60)
print("SYSTEM")
print("=" * 60)
print(f"Python:         {sys.version.split()[0]}")
print(f"entsoe-py:      {entsoe.__version__ if hasattr(entsoe, '__version__') else '(ukjent)'}")
print(f"pandas:         {pd.__version__}")
print(f"System now:     {datetime.now()}")
print(f"Pandas now (Oslo): {pd.Timestamp.now(tz='Europe/Oslo')}")
print()

token = os.getenv("ENTSOE_API_TOKEN")
if not token:
    print("FEIL: Token mangler i .env")
    raise SystemExit(1)

client = EntsoePandasClient(api_key=token)
tz = "Europe/Oslo"


def try_query(label: str, area: str, start: pd.Timestamp, end: pd.Timestamp):
    print(f"--- {label} ---")
    print(f"  Area:  {area}")
    print(f"  Range: {start}  →  {end}")
    try:
        series = client.query_day_ahead_prices(area, start=start, end=end)
        if series is None or series.empty:
            print(f"  Resultat: tom serie")
        else:
            print(f"  SUKSESS! {len(series)} punkter, første verdi {series.iloc[0]:.2f} EUR/MWh")
            print(f"  Første tidspunkt: {series.index[0]}")
            print(f"  Siste tidspunkt:  {series.index[-1]}")
    except Exception as e:
        print(f"  FEIL: {type(e).__name__}: {e or '(tom melding)'}")
    print()


# Test 1: kjent historisk tidsrom (januar 2024)
print("=" * 60)
print("TEST 1: Kjent historisk tidsrom (jan 2024)")
print("=" * 60)
try_query(
    "Historisk: 1.–2. januar 2024",
    "NO_1",
    pd.Timestamp("2024-01-01", tz=tz),
    pd.Timestamp("2024-01-02", tz=tz),
)

# Test 2: dagen i går (mest sannsynlig å fungere — data garantert publisert)
print("=" * 60)
print("TEST 2: I går")
print("=" * 60)
now = pd.Timestamp.now(tz=tz).floor("h")
yesterday = now.normalize() - pd.Timedelta(days=1)
today = now.normalize()
try_query(
    f"I går: {yesterday.date()}",
    "NO_1",
    yesterday,
    today,
)

# Test 3: i dag og i morgen
print("=" * 60)
print("TEST 3: I dag og i morgen")
print("=" * 60)
tomorrow = today + pd.Timedelta(days=1)
day_after = today + pd.Timedelta(days=2)
try_query(
    f"I dag: {today.date()}",
    "NO_1",
    today,
    tomorrow,
)
try_query(
    f"I morgen: {tomorrow.date()}",
    "NO_1",
    tomorrow,
    day_after,
)

# Test 4: alle fem norske soner for i går (kjent å virke om token og kode er ok)
print("=" * 60)
print("TEST 4: Alle norske soner i går")
print("=" * 60)
for code in ["NO_1", "NO_2", "NO_3", "NO_4", "NO_5"]:
    try_query(f"Sone {code}", code, yesterday, today)
