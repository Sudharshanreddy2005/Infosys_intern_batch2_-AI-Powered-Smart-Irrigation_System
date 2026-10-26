import logging
import math
import threading
import time
from collections import OrderedDict

import requests

logger = logging.getLogger(__name__)

_ENDPOINT = "https://nominatim.openstreetmap.org/reverse"
_USER_AGENT = "JalSaathi Smart Irrigation/1.0 (weather locality lookup)"
_REQUEST_TIMEOUT = 3
_CACHE_TTL_SECONDS = 24 * 60 * 60
_NEGATIVE_CACHE_TTL_SECONDS = 15 * 60
_CACHE_CAPACITY = 512
_MIN_REQUEST_INTERVAL_SECONDS = 1
_cache = OrderedDict()
_lock = threading.Lock()
_last_request_time = 0.0


def get_locality(latitude, longitude):
    global _last_request_time

    if (
        not isinstance(latitude, (int, float))
        or isinstance(latitude, bool)
        or not math.isfinite(latitude)
        or not -90 <= latitude <= 90
        or not isinstance(longitude, (int, float))
        or isinstance(longitude, bool)
        or not math.isfinite(longitude)
        or not -180 <= longitude <= 180
    ):
        raise ValueError("Valid latitude and longitude are required.")

    cache_key = (round(latitude, 3), round(longitude, 3))
    with _lock:
        now = time.monotonic()
        cached = _cache.get(cache_key)
        if cached is not None:
            expires_at, locality = cached
            if now < expires_at:
                _cache.move_to_end(cache_key)
                return locality
            del _cache[cache_key]

        delay = _MIN_REQUEST_INTERVAL_SECONDS - (now - _last_request_time)
        if delay > 0:
            time.sleep(delay)
        _last_request_time = time.monotonic()
        try:
            response = requests.get(
                _ENDPOINT,
                params={
                    "format": "jsonv2",
                    "lat": latitude,
                    "lon": longitude,
                    "zoom": 10,
                    "addressdetails": 1,
                },
                headers={
                    "Accept": "application/json",
                    "User-Agent": _USER_AGENT,
                },
                timeout=_REQUEST_TIMEOUT,
                allow_redirects=False,
            )
            response.raise_for_status()
            payload = response.json()
        except (requests.exceptions.RequestException, ValueError):
            logger.warning("Reverse geocoding failed; displaying the current location instead.")
            payload = None

        address = payload.get("address") if isinstance(payload, dict) else None
        locality = None
        if isinstance(address, dict):
            for key in ("city", "town", "village", "municipality", "city_district", "suburb", "hamlet"):
                value = address.get(key)
                if isinstance(value, str) and value.strip():
                    locality = " ".join(value.split())[:120]
                    break
        if payload is not None and locality is None:
            logger.warning("Reverse geocoding returned no locality; displaying the current location instead.")

        ttl = _CACHE_TTL_SECONDS if locality else _NEGATIVE_CACHE_TTL_SECONDS
        _cache[cache_key] = (time.monotonic() + ttl, locality)
        _cache.move_to_end(cache_key)
        while len(_cache) > _CACHE_CAPACITY:
            _cache.popitem(last=False)
        return locality
