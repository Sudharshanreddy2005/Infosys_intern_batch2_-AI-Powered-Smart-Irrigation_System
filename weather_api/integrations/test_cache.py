import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests

from weather_api.integrations import config, weather_api


@pytest.fixture(autouse=True)
def clear_weather_cache():
    weather_api._cache.clear()
    with weather_api._provider_cooldown_lock:
        weather_api._provider_cooldown_until = 0
    yield
    weather_api._cache.clear()
    with weather_api._provider_cooldown_lock:
        weather_api._provider_cooldown_until = 0


def test_forecast_cache_serves_different_requested_lengths(monkeypatch):
    monkeypatch.setattr(config, "get_location", lambda location=None: location or "10,20")
    monkeypatch.setattr(config, "get_api_key", lambda: "test-key")
    response = {
        "timelines": {
            "hourly": [
                {"time": f"2026-01-01T{hour:02d}:00:00Z", "values": {"temperature": hour}}
                for hour in range(24)
            ]
        }
    }
    calls = []

    def fake_request(endpoint, params):
        calls.append((endpoint, params))
        return response

    monkeypatch.setattr(weather_api, "_make_request", fake_request)

    full = weather_api.get_forecast(hours=24)
    short = weather_api.get_forecast(hours=12)

    assert len(full) == 24
    assert len(short) == 12
    assert len(calls) == 1
    assert all(item["is_stale"] is False for item in short)


def test_daily_forecast_uses_provider_daily_values(monkeypatch):
    monkeypatch.setattr(config, "get_location", lambda location=None: location or "10,20")
    monkeypatch.setattr(config, "get_api_key", lambda: "test-key")
    calls = []
    monkeypatch.setattr(
        weather_api,
        "_make_request",
        lambda endpoint, params: calls.append(params) or {
            "timelines": {
                "daily": [{
                    "time": "2026-01-01T00:00:00Z",
                    "values": {
                        "temperatureMax": 28,
                        "temperatureMin": 19,
                        "weatherCodeMax": 1001,
                        "precipitationProbabilityAvg": 40,
                    },
                }]
            }
        },
    )

    forecast = weather_api.get_forecast(hours=5, timestep="1d")

    assert calls[0]["timesteps"] == "1d"
    assert forecast[0]["temperature_high_c"] == 28
    assert forecast[0]["temperature_low_c"] == 19
    assert forecast[0]["weather_code"] == 1001
    assert forecast[0]["rain_probability_percent"] == 40


def test_weather_requests_are_package_safe_and_cache_by_location(monkeypatch):
    monkeypatch.setattr(config, "get_location", lambda location=None: location or "10,20")
    monkeypatch.setattr(config, "get_api_key", lambda: "test-key")
    calls = []

    def fake_request(endpoint, params):
        calls.append(params["location"])
        return {"data": {"time": "2026-01-01T00:00:00Z", "values": {"temperature": 20}}}

    monkeypatch.setattr(weather_api, "_make_request", fake_request)

    first = weather_api.get_current_weather()
    cached = weather_api.get_current_weather()
    other_location = weather_api.get_current_weather("30,40")

    assert first["temperature_c"] == 20
    assert cached["is_stale"] is False
    assert other_location["temperature_c"] == 20
    assert calls == ["10,20", "30,40"]


def test_current_weather_exposes_metric_probability_and_wind_fields(monkeypatch):
    monkeypatch.setattr(config, "get_location", lambda location=None: location or "10,20")
    monkeypatch.setattr(config, "get_api_key", lambda: "test-key")
    calls = []

    def fake_request(endpoint, params):
        calls.append((endpoint, params))
        return {
            "data": {
                "time": "2026-10-26T10:00:00Z",
                "values": {
                    "temperature": 21.5,
                    "humidity": 70,
                    "precipitationProbability": 35,
                    "rainIntensity": 2.4,
                    "windSpeed": 4.2,
                },
            }
        }

    monkeypatch.setattr(weather_api, "_make_request", fake_request)
    current = weather_api.get_current_weather()

    assert calls[0][1]["units"] == "metric"
    assert current["temperature_c"] == 21.5
    assert current["humidity_percent"] == 70
    assert current["precipitation_probability_percent"] == 35
    assert current["rainfall_mm_per_hr"] == 2.4
    assert current["wind_speed_mps"] == 4.2
    assert current["observation_time"] == "2026-10-26T10:00:00Z"
    assert current["is_stale"] is False
    assert current["data_age_minutes"] == 0


def test_auth_errors_are_not_retried_or_hidden_by_stale_cache(monkeypatch):
    response = requests.Response()
    response.status_code = 401
    calls = []

    def unauthorized(*args, **kwargs):
        calls.append(True)
        return response

    monkeypatch.setattr(config, "MAX_RETRIES", 3)
    monkeypatch.setattr(weather_api.requests, "get", unauthorized)

    with pytest.raises(weather_api.WeatherAuthError):
        weather_api._make_request("https://example.invalid", {})
    assert len(calls) == 1


def test_weather_cache_coalesces_concurrent_requests(monkeypatch):
    monkeypatch.setattr(config, "get_location", lambda location=None: location or "10,20")
    monkeypatch.setattr(config, "get_api_key", lambda: "test-key")
    calls = []
    calls_lock = threading.Lock()

    def fake_request(endpoint, params):
        with calls_lock:
            calls.append(params["location"])
        time.sleep(0.03)
        return {"data": {"time": "2026-01-01T00:00:00Z", "values": {"temperature": 20}}}

    monkeypatch.setattr(weather_api, "_make_request", fake_request)

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda _: weather_api.get_current_weather(), range(8)))

    assert len(calls) == 1
    assert all(result["temperature_c"] == 20 for result in results)


def test_429_honors_retry_after_and_suppresses_requests_during_cooldown(monkeypatch):
    response = requests.Response()
    response.status_code = 429
    response.headers["Retry-After"] = "12"
    calls = []

    def rate_limited(*args, **kwargs):
        calls.append(True)
        return response

    monkeypatch.setattr(weather_api.requests, "get", rate_limited)

    with pytest.raises(weather_api.WeatherUnavailableError) as error:
        weather_api._make_request("https://example.invalid", {})
    assert error.value.retry_after_seconds == 12

    with pytest.raises(weather_api.WeatherUnavailableError) as cooling_down:
        weather_api._make_request("https://example.invalid", {})
    assert cooling_down.value.retry_after_seconds >= 1
    assert len(calls) == 1


def test_429_uses_stale_weather_and_recovers_after_retry_after(monkeypatch):
    monkeypatch.setattr(config, "get_location", lambda location=None: location or "10,20")
    monkeypatch.setattr(config, "get_api_key", lambda: "test-key")
    monkeypatch.setattr(config, "MAX_RETRIES", 3)
    clock = [100.0]
    monkeypatch.setattr(weather_api.time, "monotonic", lambda: clock[0])
    cached_values = {"temperature_c": 19}
    weather_api._save_cache(
        ("realtime", "10,20"),
        cached_values,
    )
    weather_api._cache[("realtime", "10,20")]["time"] -= config.CACHE_MINUTES * 60 + 1
    response = requests.Response()
    response.status_code = 429
    response.headers["Retry-After"] = "8"
    calls = []

    def rate_limit_then_recover(*args, **kwargs):
        calls.append(True)
        if len(calls) == 1:
            return response
        recovered = requests.Response()
        recovered.status_code = 200
        recovered._content = json.dumps({
            "data": {
                "time": "2026-01-01T00:00:00Z",
                "values": {"temperature": 23},
            },
        }).encode()
        return recovered

    monkeypatch.setattr(weather_api.requests, "get", rate_limit_then_recover)

    stale = weather_api.get_current_weather()
    assert stale["temperature_c"] == 19
    assert stale["is_stale"] is True

    clock[0] += 9
    fresh = weather_api.get_current_weather()
    assert fresh["temperature_c"] == 23
    assert fresh["is_stale"] is False
    assert len(calls) == 2


def test_transient_provider_errors_use_bounded_exponential_jitter(monkeypatch):
    responses = []
    sleeps = []

    def temporary_server_error(*args, **kwargs):
        response = requests.Response()
        response.status_code = 503 if len(responses) < 2 else 200
        response._content = b'{"ok": true}'
        responses.append(response)
        return response

    monkeypatch.setattr(weather_api.requests, "get", temporary_server_error)
    monkeypatch.setattr(weather_api.time, "sleep", sleeps.append)
    monkeypatch.setattr(weather_api.random, "uniform", lambda lower, upper: upper)
    monkeypatch.setattr(config, "MAX_RETRIES", 3)

    assert weather_api._make_request("https://example.invalid", {}) == {"ok": True}
    assert len(responses) == 3
    assert sleeps == [1, 2]
