"""
Connects the team weather module (weather_api/integrations/weather_api.py) to the optimizer.

get_forecast() returns an HOURLY list:
  {"time": "2026-10-21T10:00:00Z", "temperature_c", "humidity_percent",
   "rainfall_mm_per_hr", "rain_probability_percent", "is_stale", "data_age_minutes"}
The optimizer needs DAILY values -> here we group the hourly entries by day.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import math
import os
import requests
from typing import List, Optional, Tuple

from .models import DailyForecast

IST = timezone(timedelta(hours=5, minutes=30))   # days must be counted in IST (local time), not UTC


def hourly_to_daily(hourly: list, tz=IST, min_hours: int = 12) -> Tuple[List[DailyForecast], List[str]]:
    """
    Returns (daily_forecasts, warnings).
      temp_min / temp_max : min / max of the hourly temperatures of the day
      rain_mm             : sum of hourly rainfall_mm_per_hr (each entry covers 1 hour)
      rain_prob           : max probability among the hours that have rain (0-1)
    A day with fewer than min_hours of data (the partial first day, the last day of the
    forecast) is skipped, otherwise the temperature range would be wrong and ET0 too low.
    """
    warnings: List[str] = []
    by_day = defaultdict(list)
    for h in hourly:
        if not isinstance(h, dict):
            raise ValueError("Weather provider returned a malformed forecast entry.")
        t = h.get("time")
        temperature = h.get("temperature_c")
        if not t or temperature is None:
            continue
        if (
            isinstance(temperature, bool)
            or not isinstance(temperature, (int, float))
            or not math.isfinite(temperature)
        ):
            raise ValueError("Weather provider returned an invalid temperature.")
        try:
            local = datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone(tz)
        except (AttributeError, TypeError, ValueError) as error:
            raise ValueError("Weather provider returned an invalid forecast timestamp.") from error
        rainfall = h.get("rainfall_mm_per_hr")
        if rainfall is None:
            rainfall = 0.0
        if (
            isinstance(rainfall, bool)
            or not isinstance(rainfall, (int, float))
            or not math.isfinite(rainfall)
            or rainfall < 0
        ):
            raise ValueError("Weather provider returned invalid rainfall.")
        probability = h.get("rain_probability_percent")
        if probability is not None and (
            isinstance(probability, bool)
            or not isinstance(probability, (int, float))
            or not math.isfinite(probability)
            or not 0 <= probability <= 100
        ):
            raise ValueError("Weather provider returned an invalid rainfall probability.")
        by_day[local.date()].append(h)

    daily: List[DailyForecast] = []
    for day in sorted(by_day):
        hrs = by_day[day]
        if len(hrs) < min_hours:
            warnings.append(f"{day}: only {len(hrs)} hours of data, day skipped")
            continue
        temps = [h["temperature_c"] for h in hrs]
        rain = [(h.get("rainfall_mm_per_hr") or 0.0) for h in hrs]
        probs = [h.get("rain_probability_percent") for h, r in zip(hrs, rain) if r > 0]
        probs = [p for p in probs if p is not None]
        if sum(rain) > 0:
            prob = (max(probs) / 100.0) if probs else 1.0   # if probability is missing, trust the rain intensity
        else:
            prob = 0.0
        daily.append(DailyForecast(day, min(temps), max(temps), round(sum(rain), 2), prob))

    if any(h.get("is_stale") for h in hourly):
        age = max(h.get("data_age_minutes") or 0 for h in hourly)
        warnings.append(f"Weather data is stale (~{age} min old). The weather API may have an issue")
    if not daily:
        warnings.append("No complete day could be built - request more hours (days + 1 days of hours)")
    return daily, warnings


OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


def _open_meteo_enabled() -> bool:
    return os.getenv(
        "OPEN_METEO_FALLBACK_ENABLED", ""
    ).strip().lower() in {"1", "true", "yes", "on"}


def _fetch_open_meteo_daily_forecast(
    location: Optional[str],
    days: int,
) -> List[DailyForecast]:
    """Fetch real daily weather for a field using its saved coordinates."""

    try:
        parts = location.split(",") if location else []
        if len(parts) != 2:
            raise ValueError("Latitude and longitude are required.")

        latitude, longitude = map(float, parts)
    except (AttributeError, TypeError, ValueError) as error:
        raise ValueError(
            "Field coordinates must use latitude,longitude format."
        ) from error

    if not (
        math.isfinite(latitude)
        and math.isfinite(longitude)
        and -90 <= latitude <= 90
        and -180 <= longitude <= 180
    ):
        raise ValueError("Invalid field coordinates.")

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": (
            "temperature_2m_min,"
            "temperature_2m_max,"
            "rain_sum,"
            "precipitation_probability_max,"
            "et0_fao_evapotranspiration"
        ),
        "forecast_days": days,
        "timezone": "Asia/Kolkata",
        "temperature_unit": "celsius",
        "precipitation_unit": "mm",
    }

    try:
        response = requests.get(
            OPEN_METEO_URL,
            params=params,
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.exceptions.RequestException as error:
        raise RuntimeError("Open-Meteo weather request failed.") from error
    except ValueError as error:
        raise RuntimeError("Open-Meteo returned invalid JSON.") from error

    if not isinstance(payload, dict) or payload.get("error"):
        raise RuntimeError("Open-Meteo returned an invalid forecast.")

    daily = payload.get("daily")
    if not isinstance(daily, dict):
        raise RuntimeError("Open-Meteo did not return daily forecast data.")

    dates = daily.get("time")
    minimums = daily.get("temperature_2m_min")
    maximums = daily.get("temperature_2m_max")
    rainfall = daily.get("rain_sum")
    probabilities = daily.get("precipitation_probability_max")
    et0_values = daily.get("et0_fao_evapotranspiration")

    required_arrays = (dates, minimums, maximums, rainfall)
    if any(
        not isinstance(values, list) or len(values) < days
        for values in required_arrays
    ):
        raise RuntimeError("Open-Meteo returned incomplete daily forecast data.")

    forecasts = []

    for index in range(days):
        try:
            forecast_date = datetime.fromisoformat(dates[index]).date()
        except (TypeError, ValueError) as error:
            raise RuntimeError("Open-Meteo returned an invalid forecast date.") from error

        low = minimums[index]
        high = maximums[index]
        rain = rainfall[index]

        for value in (low, high, rain):
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
            ):
                raise RuntimeError("Open-Meteo returned invalid weather values.")

        if high < low or rain < 0:
            raise RuntimeError("Open-Meteo returned invalid temperature or rainfall.")

        probability = (
            probabilities[index]
            if isinstance(probabilities, list) and index < len(probabilities)
            else None
        )

        if probability is None:
            rain_probability = 1.0 if rain > 0 else 0.0
        else:
            if (
                isinstance(probability, bool)
                or not isinstance(probability, (int, float))
                or not math.isfinite(probability)
                or not 0 <= probability <= 100
            ):
                raise RuntimeError("Open-Meteo returned invalid rain probability.")
            rain_probability = probability / 100.0

        et0 = (
            et0_values[index]
            if isinstance(et0_values, list) and index < len(et0_values)
            else None
        )

        if et0 is not None and (
            isinstance(et0, bool)
            or not isinstance(et0, (int, float))
            or not math.isfinite(et0)
            or et0 < 0
        ):
            raise RuntimeError("Open-Meteo returned invalid ET0.")

        forecasts.append(
            DailyForecast(
                date=forecast_date,
                temp_min=float(low),
                temp_max=float(high),
                rain_mm=float(rain),
                rain_prob=rain_probability,
                et0_mm=float(et0) if et0 is not None else None,
            )
        )

    return forecasts


MAX_FORECAST_HOURS = 120   # provider limit enforced by weather_api.get_forecast (1-120 hours)




def fetch_daily_forecast(location: Optional[str] = None, days: int = 4) -> Tuple[List[DailyForecast], List[str]]:
    """
    Try Tomorrow.io first. If it fails or returns too few complete days,
    optionally use Open-Meteo when explicitly enabled.
    """
    primary_daily: List[DailyForecast] = []
    primary_warnings: List[str] = []
    primary_error = None
    primary_succeeded = False

    try:
        from weather_api.integrations.weather_api import get_forecast

        hours = min((days + 1) * 24, MAX_FORECAST_HOURS)
        hourly = get_forecast(location, hours=hours)
        primary_daily, primary_warnings = hourly_to_daily(hourly)
        primary_succeeded = True

        if len(primary_daily) >= days:
            return primary_daily[:days], primary_warnings

        primary_error = RuntimeError(
            f"Only {len(primary_daily)} complete day(s) available from Tomorrow.io; "
            f"{days} requested."
        )

    except (ValueError, RuntimeError) as error:
        primary_error = error

    if not _open_meteo_enabled():
        if primary_succeeded:
            primary_warnings.append(str(primary_error))
            return primary_daily[:days], primary_warnings
        if primary_error is not None:
            raise primary_error
        return primary_daily[:days], primary_warnings

    try:
        fallback_daily = _fetch_open_meteo_daily_forecast(location, days)

        warnings = [
            "Weather source: Open-Meteo. "
            "Attribution: https://open-meteo.com/ "
            "(CC BY 4.0: https://creativecommons.org/licenses/by/4.0/)."
        ]

        if primary_error is not None:
            warnings.append(
                "Tomorrow.io was unavailable or returned an incomplete forecast; "
                "the Open-Meteo fallback was used."
            )

        return fallback_daily, warnings

    except (ValueError, RuntimeError) as fallback_error:
        if primary_succeeded:
            primary_warnings.append(
                "Open-Meteo fallback was unavailable. "
                f"Only {len(primary_daily)} complete Tomorrow.io day(s) are available."
            )
            return primary_daily[:days], primary_warnings

        raise RuntimeError(
            "Both the primary and fallback weather providers are unavailable."
        ) from fallback_error


def fetch_current_weather(location, timeout=10):
    """Fetch model-based current conditions from Open-Meteo for a field."""
    from datetime import datetime, timezone

    if not _open_meteo_enabled():
        raise RuntimeError("Open-Meteo fallback is disabled.")

    try:
        latitude_text, longitude_text = str(location).split(",", 1)
        latitude = float(latitude_text.strip())
        longitude = float(longitude_text.strip())
    except (TypeError, ValueError) as error:
        raise ValueError("Open-Meteo requires field coordinates as latitude,longitude.") from error

    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise ValueError("Field coordinates are outside the valid latitude/longitude range.")

    response = requests.get(
        OPEN_METEO_URL,
        params={
            "latitude": latitude,
            "longitude": longitude,
            "current": "temperature_2m,relative_humidity_2m",
            "temperature_unit": "celsius",
            "timezone": "GMT",
        },
        timeout=timeout,
    )
    response.raise_for_status()
    payload = response.json()
    current = payload.get("current") if isinstance(payload, dict) else None
    if not isinstance(current, dict):
        raise RuntimeError("Open-Meteo returned no current-weather values.")

    try:
        temperature = float(current["temperature_2m"])
        humidity = float(current["relative_humidity_2m"])
        observed_at = datetime.fromisoformat(
            str(current["time"]).replace("Z", "+00:00")
        )
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError("Open-Meteo returned incomplete current-weather values.") from error

    if not math.isfinite(temperature) or not math.isfinite(humidity):
        raise RuntimeError("Open-Meteo returned non-finite weather values.")
    if not 0 <= humidity <= 100:
        raise RuntimeError("Open-Meteo returned humidity outside the 0–100 percent range.")

    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)
    else:
        observed_at = observed_at.astimezone(timezone.utc)

    age_minutes = (datetime.now(timezone.utc) - observed_at).total_seconds() / 60
    if age_minutes < -1:
        raise RuntimeError("Open-Meteo returned a future weather timestamp.")

    return {
        "temperature_c": temperature,
        "humidity_percent": humidity,
        "observation_time": observed_at.isoformat(),
        "data_age_minutes": max(0.0, age_minutes),
        "is_stale": age_minutes >= 180,
        "weather_source": "Open-Meteo model-based current conditions",
    }
