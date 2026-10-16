import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")

BASE_URL = "https://api.tomorrow.io/v4"
REALTIME_ENDPOINT = f"{BASE_URL}/weather/realtime"
FORECAST_ENDPOINT = f"{BASE_URL}/weather/forecast"
UNITS = "metric"
REQUEST_TIMEOUT = 5
MAX_RETRIES = 3
RETRY_DELAY = 2
CACHE_MINUTES = 15
MAX_STALE_MINUTES = 180


def get_api_key():
    api_key = os.getenv("TOMORROW_API_KEY")
    if not api_key:
        raise ValueError(
            "Tomorrow.io is unavailable because TOMORROW_API_KEY is not configured."
        )
    api_key = api_key.strip()
    if not api_key:
        raise ValueError(
            "Tomorrow.io is unavailable because TOMORROW_API_KEY is not configured."
        )
    return api_key


def get_location(location=None):
    configured_location = location if location is not None else os.getenv("WEATHER_LOCATION")
    if configured_location:
        configured_location = configured_location.strip()
    if not configured_location:
        raise ValueError(
            "Weather is unavailable because WEATHER_LOCATION is not configured."
        )
    return configured_location