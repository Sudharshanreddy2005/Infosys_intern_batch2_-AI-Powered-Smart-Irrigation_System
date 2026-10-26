import copy
import email.utils
import logging
import math
import random
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from datetime import timezone

import requests

from . import config

logger = logging.getLogger(__name__)
_cache = OrderedDict()
_cache_lock = threading.Lock()
_request_locks = {}
_request_locks_lock = threading.Lock()
_provider_cooldown_until = 0.0
_provider_cooldown_lock = threading.Lock()


class WeatherAuthError(RuntimeError):
    """The provider rejected the configured API key."""


class WeatherUnavailableError(RuntimeError):
    """The provider could not return a usable weather response."""

    def __init__(self, message, retry_after_seconds=None):
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


def _get_cached(key, allow_stale=False):
    with _cache_lock:
        entry = _cache.get(key)
        if entry is None:
            return None, None
        age = time.time() - entry["time"]
        if age < config.CACHE_MINUTES * 60:
            _cache.move_to_end(key)
            return copy.deepcopy(entry["data"]), age
        if allow_stale and age < config.MAX_STALE_MINUTES * 60:
            _cache.move_to_end(key)
            return copy.deepcopy(entry["data"]), age
    return None, None


def _save_cache(key, data):
    with _cache_lock:
        _cache[key] = {"data": copy.deepcopy(data), "time": time.time()}
        _cache.move_to_end(key)
        while len(_cache) > config.MAX_CACHE_ENTRIES:
            _cache.popitem(last=False)


@contextmanager
def _serialize_request(key):
    with _request_locks_lock:
        entry = _request_locks.get(key)
        if entry is None:
            entry = {"lock": threading.Lock(), "users": 0}
            _request_locks[key] = entry
        entry["users"] += 1
    entry["lock"].acquire()
    try:
        yield
    finally:
        entry["lock"].release()
        with _request_locks_lock:
            entry["users"] -= 1
            if entry["users"] == 0 and _request_locks.get(key) is entry:
                del _request_locks[key]


def _retry_after_seconds(response):
    value = response.headers.get("Retry-After")
    if not value:
        return None
    try:
        seconds = float(value)
        return max(0.0, seconds) if math.isfinite(seconds) else None
    except ValueError:
        try:
            retry_at = email.utils.parsedate_to_datetime(value)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            return max(0.0, retry_at.timestamp() - time.time())
        except (AttributeError, TypeError, ValueError, OverflowError):
            return None


def _retry_delay(attempt):
    maximum = max(0.0, config.MAX_RETRY_DELAY)
    exponential = min(config.RETRY_DELAY * (2 ** (attempt - 1)), maximum)
    return random.uniform(exponential * 0.75, exponential)


def _set_provider_cooldown(seconds):
    global _provider_cooldown_until
    deadline = time.monotonic() + max(0.0, seconds)
    with _provider_cooldown_lock:
        _provider_cooldown_until = max(_provider_cooldown_until, deadline)


def _provider_cooldown_remaining():
    with _provider_cooldown_lock:
        return max(0.0, _provider_cooldown_until - time.monotonic())


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
        cooldown = _provider_cooldown_remaining()
        if cooldown:
            retry_after = max(1, int(cooldown + 0.999))
            raise WeatherUnavailableError(
                "Weather provider is rate limited; retry after the indicated delay.",
                retry_after_seconds=retry_after,
            )
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
            if status_code == 429:
                retry_after = _retry_after_seconds(error.response)
                delay = retry_after if retry_after is not None else _retry_delay(attempt)
                _set_provider_cooldown(delay)
                retry_after_header = max(1, int(delay + 0.999))
                logger.warning(
                    "Weather provider rate limited the request; retry after %s seconds.",
                    retry_after_header,
                )
                raise WeatherUnavailableError(
                    "Weather provider rate limit reached.",
                    retry_after_seconds=retry_after_header,
                ) from error
            if status_code is None or status_code < 500:
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
        delay = _retry_delay(attempt)
        logger.warning(
            "Weather provider request failed; retry %s/%s after %.1f seconds.",
            attempt,
            config.MAX_RETRIES,
            delay,
        )
        time.sleep(delay)

    raise WeatherUnavailableError("Weather provider request failed.")


def _cached_or_raise(key, request):
    with _serialize_request(key):
        cached, age = _get_cached(key)
        if cached is not None:
            return cached, age
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


def get_current_weather(location=None, use_cache=True):
    resolved_location = config.get_location(location)
    key = ("realtime", resolved_location)

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
            "feels_like_c": values.get("temperatureApparent"),
            "weather_code": values.get("weatherCode"),
            "humidity_percent": values.get("humidity"),
            "rainfall_mm_per_hr": values.get("rainIntensity"),
            "precipitation_probability_percent": values.get("precipitationProbability"),
            "wind_speed_mps": values.get("windSpeed"),
            "observation_time": response["data"].get("time"),
        }
        if use_cache:
            _save_cache(key, result)
        return result, 0

    result, age = _cached_or_raise(key, request) if use_cache else request()
    return _with_status(result, age >= config.CACHE_MINUTES * 60, age)


def get_forecast(location=None, hours=24, use_cache=True, timestep="1h"):
    if not 1 <= hours <= 120:
        raise ValueError("Forecast hours must be between 1 and 120.")
    if timestep not in ("1h", "1d"):
        raise ValueError("Forecast timestep must be 1h or 1d.")

    resolved_location = config.get_location(location)
    key = ("forecast", resolved_location, timestep)

    def request():
        response = _make_request(
            config.FORECAST_ENDPOINT,
            {
                "location": resolved_location,
                "units": config.UNITS,
                "timesteps": timestep,
                "apikey": config.get_api_key(),
            },
        )
        timeline_name = "daily" if timestep == "1d" else "hourly"
        try:
            timeline = response["timelines"][timeline_name]
            if not isinstance(timeline, list):
                raise TypeError
        except (KeyError, TypeError, AttributeError) as error:
            raise WeatherUnavailableError(
                "Weather provider returned an unexpected forecast response."
            ) from error

        forecast = []
        for entry in timeline:
            if not isinstance(entry, dict):
                continue
            values = entry.get("values", {})
            if not isinstance(values, dict):
                continue
            forecast.append(
                {
                    "time": entry.get("time"),
                    "temperature_c": values.get("temperature"),
                    "feels_like_c": values.get("temperatureApparent"),
                    "temperature_high_c": values.get("temperatureMax"),
                    "temperature_low_c": values.get("temperatureMin"),
                    "weather_code": values.get("weatherCode") or values.get("weatherCodeMax"),
                    "humidity_percent": values.get("humidity"),
                    "rainfall_mm_per_hr": values.get("rainIntensity"),
                    "rain_probability_percent": values.get(
                        "precipitationProbability",
                        values.get("precipitationProbabilityAvg"),
                    ),
                }
            )
        if use_cache:
            _save_cache(key, forecast)
        return forecast, 0

    result, age = _cached_or_raise(key, request) if use_cache else request()
    return _with_status(result[:hours], age >= config.CACHE_MINUTES * 60, age)
