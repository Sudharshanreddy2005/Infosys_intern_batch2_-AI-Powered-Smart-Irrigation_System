"""
Connects the team weather module (weather_api/integrations/weather_api.py) to the optimizer.

get_forecast() returns an HOURLY list:
  {"time": "2026-10-21T10:00:00Z", "temperature_c", "humidity_percent",
   "rainfall_mm_per_hr", "rain_probability_percent", "is_stale", "data_age_minutes"}
The optimizer needs DAILY values -> here we group the hourly entries by day.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
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
        t = h.get("time")
        if not t or h.get("temperature_c") is None:
            continue
        local = datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone(tz)
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


MAX_FORECAST_HOURS = 120   # provider limit enforced by weather_api.get_forecast (1-120 hours)


def fetch_daily_forecast(location: Optional[str] = None, days: int = 4) -> Tuple[List[DailyForecast], List[str]]:
    """
    Daily forecast built from the team weather module (live Tomorrow.io data).
    Returns (daily, warnings).

    Needs the project root on sys.path (true when the app runs from the repo root), because
    the weather module is imported as the package weather_api.integrations.weather_api.
    location=None uses WEATHER_LOCATION from the environment (handled by the weather module).
    """
    from weather_api.integrations.weather_api import get_forecast

    # +1 day makes up for the partial first day, but the provider allows at most 120 hours
    hours = min((days + 1) * 24, MAX_FORECAST_HOURS)
    hourly = get_forecast(location, hours=hours)
    daily, warns = hourly_to_daily(hourly)
    if len(daily) < days:
        warns.append(
            f"Only {len(daily)} complete day(s) available from the provider "
            f"(forecast limit is {MAX_FORECAST_HOURS} hours); {days} were requested")
    return daily[:days], warns