import copy
import logging
import time

import requests

from . import config

logger = logging.getLogger(__name__)
_cache = {}


class WeatherAuthError(RuntimeError):
    """The provider rejected the configured API key."""


class WeatherUnavailableError(RuntimeError):
    """The provider could not return a usable weather response."""


def _get_cached(key, allow_stale=False):
    entry = _cache.get(key)
    if entry is None:
        return None, None
    age = time.time() - entry["time"]
    if age < config.CACHE_MINUTES * 60:
        return copy.deepcopy(entry["data"]), age
    if allow_stale and age < config.MAX_STALE_MINUTES * 60:
        return copy.deepcopy(entry["data"]), age
    return None, None


def _save_cache(key, data):
    _cache[key] = {"data": copy.deepcopy(data), "time": time.time()}


def _with_status(data, is_stale, age_seconds):
    status = {
        "is_stale": is_stale,
        "data_age_minutes": round(age_seconds / 60, 1),
    }
    if isinstance(data, list):
        return [{**item, **status} for item in data]
    return {**data, **status}


def _make_request(endpoint, params):
    for attempt in range(1, config.MAX_RETRIES + 1):
        cause = None
        try:
            response = requests.get(
                endpoint,
                params=params,
                timeout=config.REQUEST_TIMEOUT,
                allow_redirects=False,
            )
            response.raise_for_status()
            try:
                return response.json()
            except ValueError as error:
                raise WeatherUnavailableError(
                    "Weather provider returned invalid JSON."
                ) from error
        except requests.exceptions.HTTPError as error:
            cause = error
            status_code = (
                error.response.status_code
                if error.response is not None
                else None
            )
            if status_code in (401, 403):
                raise WeatherAuthError(
                    "Weather provider rejected the configured API key."
                ) from error
            if status_code != 429 and (status_code is None or status_code < 500):
                raise WeatherUnavailableError(
                    f"Weather provider rejected the request (HTTP {status_code})."
                ) from error
            message = f"Weather provider returned HTTP {status_code}."
        except requests.exceptions.Timeout as error:
            cause = error
            message = "Weather provider request timed out."
        except requests.exceptions.ConnectionError as error:
            cause = error
            message = "Could not connect to the weather provider."
        except requests.exceptions.RequestException as error:
            cause = error
            message = "Weather provider request failed."

        if attempt == config.MAX_RETRIES:
            raise WeatherUnavailableError(
                f"{message} Retries exhausted."
            ) from cause
        logger.warning("Weather provider request failed; retry %s/%s.", attempt, config.MAX_RETRIES)
        time.sleep(config.RETRY_DELAY)

    raise WeatherUnavailableError("Weather provider request failed.")


def _cached_or_raise(key, request):
    try:
        return request()
    except WeatherAuthError:
        raise
    except WeatherUnavailableError:
        stale, age = _get_cached(key, allow_stale=True)
        if stale is None:
            raise
        logger.warning("Using stale weather cache (%s minutes old).", round(age / 60, 1))
        return stale, age


def get_current_weather(location=None):
    resolved_location = config.get_location(location)
    key = ("realtime", resolved_location)
    cached, age = _get_cached(key)
    if cached is not None:
        return _with_status(cached, False, age)

    def request():
        response = _make_request(
            config.REALTIME_ENDPOINT,
            {
                "location": resolved_location,
                "units": config.UNITS,
                "apikey": config.get_api_key(),
            },
        )
        try:
            values = response["data"]["values"]
            if not isinstance(values, dict):
                raise TypeError
        except (KeyError, TypeError, AttributeError) as error:
            raise WeatherUnavailableError(
                "Weather provider returned an unexpected current-weather response."
            ) from error

        result = {
            "temperature_c": values.get("temperature"),
            "humidity_percent": values.get("humidity"),
            "rainfall_mm_per_hr": values.get("rainIntensity"),
            "wind_speed_mps": values.get("windSpeed"),
            "observation_time": response["data"].get("time"),
        }
        _save_cache(key, result)
        return result, 0

    result, age = _cached_or_raise(key, request)
    return _with_status(result, age > 0, age)


def get_forecast(location=None, hours=24):
    if not 1 <= hours <= 120:
        raise ValueError("Forecast hours must be between 1 and 120.")

    resolved_location = config.get_location(location)
    key = ("forecast", resolved_location)
    cached, age = _get_cached(key)
    if cached is not None:
        return _with_status(cached[:hours], False, age)

    def request():
        response = _make_request(
            config.FORECAST_ENDPOINT,
            {
                "location": resolved_location,
                "units": config.UNITS,
                "timesteps": "1h",
                "apikey": config.get_api_key(),
            },
        )
        try:
            hourly = response["timelines"]["hourly"]
            if not isinstance(hourly, list):
                raise TypeError
        except (KeyError, TypeError, AttributeError) as error:
            raise WeatherUnavailableError(
                "Weather provider returned an unexpected forecast response."
            ) from error

        forecast = []
        for entry in hourly:
            if not isinstance(entry, dict):
                continue
            values = entry.get("values", {})
            if not isinstance(values, dict):
                continue
            forecast.append(
                {
                    "time": entry.get("time"),
                    "temperature_c": values.get("temperature"),
                    "humidity_percent": values.get("humidity"),
                    "rainfall_mm_per_hr": values.get("rainIntensity"),
                    "rain_probability_percent": values.get("precipitationProbability"),
                }
            )
        _save_cache(key, forecast)
        return forecast, 0

    result, age = _cached_or_raise(key, request)
    return _with_status(result[:hours], age > 0, age)
