"""
Finn siste tilgjengelige dato for norske spotpriser
---------------------------------------------------
Går bakover i tid med eksponentielt voksende steg til vi finner data,
deretter snevrer inn for å finne den siste dagen som faktisk har priser.

Dette forteller oss om data mangler bare for noen dager (forsinkelse),
eller om "i dag" på systemet ditt rett og slett er framtiden.
"""
import os

import pandas as pd
from dotenv import load_dotenv
from entsoe import EntsoePandasClient
from entsoe.exceptions import NoMatchingDataError

load_dotenv()
token = os.getenv("ENTSOE_API_TOKEN")
client = EntsoePandasClient(api_key=token)
tz = "Europe/Oslo"


def has_data(date: pd.Timestamp) -> bool:
    """Returnerer True hvis ENTSO-E har priser for denne dagen."""
    start = date.normalize()
    end = start + pd.Timedelta(days=1)
    try:
        series = client.query_day_ahead_prices("NO_1", start=start, end=end)
        return series is not None and not series.empty
    except NoMatchingDataError:
        return False
    except Exception as e:
        print(f"  (uventet feil: {type(e).__name__}: {e})")
        return False


now = pd.Timestamp.now(tz=tz)
print(f"Systemets nåtid: {now}")
print(f"Søker bakover etter siste dato med data...\n")

# Eksponentielt voksende steg bakover: 1, 2, 4, 8, 16, 32, 64, 128, 256 dager
days_back = 0
step = 1
found_date = None

while days_back < 1000:
    candidate = now.normalize() - pd.Timedelta(days=days_back)
    print(f"  Prøver {candidate.date()} ({days_back} dager tilbake)...", end=" ")
    if has_data(candidate):
        print("HAR DATA")
        found_date = candidate
        break
    else:
        print("ingen data")
    days_back += step
    step = min(step * 2, 64)  # tak på 64 dagers steg så vi ikke hopper for langt

if found_date is None:
    print("\nFant ingen data innen 1000 dager. Det ville vært veldig rart.")
    raise SystemExit(1)

print(f"\nSiste dato med data: {found_date.date()}")
print(f"Det er {(now.normalize() - found_date).days} dager bakover fra systemets 'i dag'.")
print()

# Hent og vis prisene
print("Faktiske priser for den dagen, NO_1:")
series = client.query_day_ahead_prices(
    "NO_1",
    start=found_date.normalize(),
    end=found_date.normalize() + pd.Timedelta(days=1),
)
print(series.head(24))
