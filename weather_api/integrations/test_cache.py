import pytest
import requests

from weather_api.integrations import config, weather_api


@pytest.fixture(autouse=True)
def clear_weather_cache():
    weather_api._cache.clear()
    yield
    weather_api._cache.clear()


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
