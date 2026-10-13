import copy
import time
import requests
from config import (
    get_api_key,
    REALTIME_ENDPOINT,
    FORECAST_ENDPOINT,
    LOCATION,
    UNITS,
    REQUEST_TIMEOUT,
    MAX_RETRIES,
    RETRY_DELAY,
    CACHE_MINUTES,
    MAX_STALE_MINUTES,
)


class WeatherAuthError(RuntimeError):
    """Raised on 401 (bad/missing API key). Stale data must NOT hide this."""


# In-memory cache: {key: {"data": ..., "time": timestamp}}
_cache = {}


def _get_cached(key, allow_stale=False):
    entry = _cache.get(key)
    if not entry:
        return None, None
    age = time.time() - entry["time"]
    if age < CACHE_MINUTES * 60:
        return copy.deepcopy(entry["data"]), age
    if allow_stale and age < MAX_STALE_MINUTES * 60:
        return copy.deepcopy(entry["data"]), age
    return None, None


def _save_cache(key, data):
    """Save a copy of data in the cache with the current timestamp."""
    _cache[key] = {"data": copy.deepcopy(data), "time": time.time()}


def _with_status(data, is_stale, age_seconds):
    info = {
        "is_stale": is_stale,
        "data_age_minutes": round(age_seconds / 60, 1),
    }
    if isinstance(data, list):
        return [{**item, **info} for item in data]
    return {**data, **info}


def _make_request(endpoint, params):
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.get(endpoint, params=params, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()      # raises an error on 4xx/5xx responses
            try:
                return response.json()       # success: loop ends here
            except ValueError:
                raise RuntimeError("API did not return valid JSON.")

        except requests.exceptions.Timeout:
            error_msg = "The API did not respond in time (timeout)."
        except requests.exceptions.ConnectionError:
            error_msg = "Connection failed. Please check your internet."
        except requests.exceptions.HTTPError as e:
            code = response.status_code
            if code == 401:
                raise WeatherAuthError("401: The API key is invalid or missing.")
            if code == 429:
                error_msg = "429: API rate limit exceeded."
            elif code >= 500:
                error_msg = f"{code}: Server error."
            else:
                # other 4xx: the request itself is wrong, retrying is pointless
                raise RuntimeError(f"HTTP error: {e}")
        except requests.exceptions.RequestException as e:
            # Catch-all for any other network error (must stay LAST)
            error_msg = f"Request failed: {e}"

        # Reached only when the error above is retryable
        if attempt == MAX_RETRIES:
            raise RuntimeError(f"{error_msg} (failed after {MAX_RETRIES} attempts)")

        print(f"Attempt {attempt} failed: {error_msg} Retrying in {RETRY_DELAY}s...")
        time.sleep(RETRY_DELAY)


def get_current_weather(location=LOCATION):
    key = ("realtime", location)
    cached, age = _get_cached(key)
    if cached is not None:
        print("Using cached data")
        return _with_status(cached, False, age)

    params = {
        "location": location,
        "units": UNITS,
        "apikey": get_api_key(),   # raises ValueError if the key is missing
    }

    try:
        data = _make_request(REALTIME_ENDPOINT, params)
    except WeatherAuthError:
        raise                      # bad API key: never hide it behind old data
    except RuntimeError as e:
        stale, age = _get_cached(key, allow_stale=True)   # fall back to old data
        if stale is not None:
            print(f"Warning: {e} Using OLD cached data ({age / 60:.1f} min old).")
            return _with_status(stale, True, age)
        raise                      # no cache, or cache older than MAX_STALE_MINUTES

    try:
        values = data["data"]["values"]
    except KeyError:
        raise RuntimeError("Unexpected API response format.")

    result = {
        "temperature_c": values.get("temperature"),
        "humidity_percent": values.get("humidity"),
        "rainfall_mm_per_hr": values.get("rainIntensity"),
    }
    _save_cache(key, result)
    return _with_status(result, False, 0)


def get_forecast(location=LOCATION, hours=24):
    """Return a list of hourly forecasts (default: next 24 hours).

    Every item also has: is_stale (bool) and data_age_minutes (float).
    """
    key = ("forecast", location)          # no `hours` in the key
    cached, age = _get_cached(key)
    if cached is not None:
        print("Using cached data")
        return _with_status(cached[:hours], False, age)   # slice AFTER reading cache

    params = {
        "location": location,
        "units": UNITS,
        "timesteps": "1h",
        "apikey": get_api_key(),
    }

    try:
        data = _make_request(FORECAST_ENDPOINT, params)
    except WeatherAuthError:
        raise
    except RuntimeError as e:
        stale, age = _get_cached(key, allow_stale=True)
        if stale is not None:
            print(f"Warning: {e} Using OLD cached data ({age / 60:.1f} min old).")
            return _with_status(stale[:hours], True, age)
        raise

    try:
        hourly = data["timelines"]["hourly"]
    except KeyError:
        raise RuntimeError("Unexpected forecast response format.")

    forecast = []
    for entry in hourly:                  # cache the FULL list
        values = entry.get("values", {})
        forecast.append({
            "time": entry.get("time"),
            "temperature_c": values.get("temperature"),
            "humidity_percent": values.get("humidity"),
            "rainfall_mm_per_hr": values.get("rainIntensity"),
            "rain_probability_percent": values.get("precipitationProbability"),
        })

    _save_cache(key, forecast)
    return _with_status(forecast[:hours], False, 0)


if __name__ == "__main__":
    try:
        print("CURRENT:", get_current_weather())
        print("CURRENT (2nd call):", get_current_weather())   # should hit the cache
        print()
        forecast = get_forecast()
        print(f"FORECAST ({len(forecast)} hours):")
        for item in forecast[:5]:            # print only first 5 to keep output short
            print(item)
    except Exception as e:
        print("Error:", e)

        