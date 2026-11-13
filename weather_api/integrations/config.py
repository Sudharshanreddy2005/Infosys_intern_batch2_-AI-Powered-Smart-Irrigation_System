from pathlib import Path
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")

GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast"

REQUEST_TIMEOUT = 10
MAX_RETRIES = 2
RETRY_DELAY = 1
MAX_RETRY_DELAY = 4

CACHE_MINUTES = 15
MAX_STALE_MINUTES = 180
MAX_CACHE_ENTRIES = 512
import os


def get_location(location=None):
    configured_location = (
        location if location is not None else os.getenv("WEATHER_LOCATION")
    )

    if configured_location:
        configured_location = configured_location.strip()

    if not configured_location:
        raise ValueError(
            "Weather is unavailable because no location was provided."
        )

    return configured_location
def get_api_key():
    """Compatibility function for legacy tests; Open-Meteo needs no API key."""
    return None