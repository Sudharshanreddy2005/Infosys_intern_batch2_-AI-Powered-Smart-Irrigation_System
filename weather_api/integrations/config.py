import os
from dotenv import load_dotenv

# Load variables from the .env file (searches this file's folder and its parents)
load_dotenv()

# --- API settings ---
TOMORROW_API_KEY = os.getenv("TOMORROW_API_KEY")
BASE_URL = "https://api.tomorrow.io/v4"


#--- Endpoints (must come after BASE_URL) ---
REALTIME_ENDPOINT = f"{BASE_URL}/weather/realtime"
FORECAST_ENDPOINT = f"{BASE_URL}/weather/forecast"
 
# --- Location settings ---
LOCATION = "26.12,85.39"   # lat,lon -> change to your field/area coordinates
UNITS = "metric"           # metric = Celsius, mm

# --- Request settings ---
REQUEST_TIMEOUT = 5      # seconds to wait before giving up on a request
MAX_RETRIES = 3          # how many times to retry a failed request
RETRY_DELAY = 2          # seconds to wait between retries

# --- Cache settings ---
CACHE_MINUTES = 15       # how long saved weather data stays valid

MAX_STALE_MINUTES = 180   # 3 hours


def get_api_key():
    """Return the Tomorrow.io API key, or raise an error if it is missing."""
    if not TOMORROW_API_KEY:
        raise ValueError(
            "TOMORROW_API_KEY not found. "
            "Please add it to your .env file."
        )

    return TOMORROW_API_KEY