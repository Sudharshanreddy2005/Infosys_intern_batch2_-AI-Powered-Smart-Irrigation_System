import os

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

import main


def build_sensor_engine():
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with test_engine.begin() as connection:
        connection.execute(
            text(
                """
                CREATE TABLE sensor_readings (
                    timestamp TEXT NOT NULL,
                    synthetic_record_number INTEGER NOT NULL,
                    data_origin TEXT NOT NULL,
                    field_id TEXT NOT NULL,
                    soil_moisture REAL
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO sensor_readings VALUES
                    ('2026-02-02T00:00:00Z', 2, 'synthetic_or_synthetic_augmented', 'field-1', 24),
                    ('2026-02-01T00:00:00Z', 1, 'synthetic_or_synthetic_augmented', 'field-1', 26)
                """
            )
        )
    return test_engine


def test_root_is_public_landing_and_dashboard_requires_authentication():
    with TestClient(main.app) as client:
        landing = client.get("/")
        dashboard = client.get("/dashboard", follow_redirects=False)

        assert landing.status_code == 200
        assert "Smart Water." in landing.text
        assert dashboard.status_code == 303
        assert dashboard.headers["location"] == "/static/auth.html?view=login"
        assert client.get("/management").status_code == 200


def test_readiness_check_requires_a_database_connection():
    with TestClient(main.app) as client:
        response = client.get("/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_sensor_readings_are_recent_bounded_and_marked_historical(monkeypatch):
    test_engine = build_sensor_engine()
    monkeypatch.setattr(main, "engine", test_engine)

    with TestClient(main.app) as client:
        response = client.get("/sensor-readings?limit=1")

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["data"][0]["synthetic_record_number"] == 2
    assert payload["data_classification"] == "historical_dataset"
    assert payload["data_origin"] == "synthetic_or_synthetic_augmented"
    assert payload["is_live"] is False


def test_sensor_reading_limit_is_validated():
    with TestClient(main.app) as client:
        assert client.get("/sensor-readings?limit=101").status_code == 422


def test_weather_endpoint_reports_missing_configuration(monkeypatch):
    def no_location(_location=None):
        raise ValueError("Weather location is not configured.")

    monkeypatch.setattr(main, "get_location", no_location)

    with TestClient(main.app) as client:
        response = client.get("/weather/current")

    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"].lower()


def test_current_weather_returns_provider_data_without_live_network(monkeypatch):
    monkeypatch.setattr(main, "get_location", lambda location=None: location or "10,20")
    monkeypatch.setattr(
        main,
        "get_current_weather",
        lambda location: {
            "temperature_c": 21,
            "observation_time": "2026-03-30T12:45:00Z",
            "is_stale": False,
            "data_age_minutes": 0,
        },
    )

    with TestClient(main.app) as client:
        response = client.get("/weather/current")

    assert response.status_code == 200
    assert response.json()["location"] == "10,20"
    assert response.json()["temperature_c"] == 21


def test_provider_rate_limit_retry_after_is_forwarded(monkeypatch):
    monkeypatch.setattr(main, "get_location", lambda location=None: location or "10,20")

    def rate_limited(_location):
        raise main.WeatherUnavailableError(
            "Weather provider rate limit reached.",
            retry_after_seconds=17,
        )

    monkeypatch.setattr(main, "get_current_weather", rate_limited)

    with TestClient(main.app) as client:
        response = client.get("/weather/current")

    assert response.status_code == 503
    assert response.headers["retry-after"] == "17"


def test_weather_coordinates_are_validated_and_used_without_persistence(monkeypatch, request):
    test_engine = build_sensor_engine()
    request.addfinalizer(test_engine.dispose)
    monkeypatch.setattr(main, "engine", test_engine)
    locations = []
    monkeypatch.setattr(
        main,
        "get_current_weather",
        lambda location, use_cache=True: locations.append((location, use_cache)) or {},
    )
    forecasts = []
    monkeypatch.setattr(
        main,
        "get_forecast",
        lambda location, hours, use_cache=True, timestep="1h": forecasts.append(
            (location, hours, use_cache, timestep)
        ) or [],
    )
    monkeypatch.setattr(main, "get_locality", lambda latitude, longitude: "Mysuru")

    with TestClient(main.app) as client:
        unauthorized = client.post(
            "/weather/current",
            json={"latitude": 12.5, "longitude": 77.6},
        )
        assert unauthorized.status_code == 401
        registered = client.post(
            "/api/auth/register",
            json={
                "name": "Weather Farmer",
                "email": "weather@example.com",
                "password": "WeatherPass123",
            },
        )
        assert registered.status_code == 201
        response = client.post(
            "/weather/current",
            json={"latitude": 12.5, "longitude": 77.6},
        )
        forecast = client.post(
            "/weather/forecast?hours=3",
            json={"latitude": 12.5, "longitude": 77.6},
        )
        invalid_post = client.post(
            "/weather/current",
            json={"latitude": 91, "longitude": 77.6},
        )
        incomplete = client.get("/weather/current?latitude=12.5")
        invalid = client.get("/weather/current?latitude=91&longitude=77.6")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["locality"] == "Mysuru"
    assert locations == [("12.500000,77.600000", True)]
    assert forecast.status_code == 200
    assert forecast.headers["cache-control"] == "no-store"
    assert forecasts == [("12.500000,77.600000", 3, True, "1h")]
    assert incomplete.status_code == 422
    assert invalid.status_code == 422
    assert invalid_post.status_code == 422


def test_weather_forecast_supports_daily_data_and_validates_timestep(monkeypatch):
    monkeypatch.setattr(main, "get_location", lambda location=None: location or "10,20")
    calls = []
    monkeypatch.setattr(
        main,
        "get_forecast",
        lambda location, hours, use_cache=True, timestep="1h": calls.append(
            (location, hours, use_cache, timestep)
        ) or [{
            "time": "2026-04-01T00:00:00Z",
            "temperature_high_c": 28,
            "is_stale": False,
            "data_age_minutes": 0,
        }],
    )

    with TestClient(main.app) as client:
        hourly = client.get("/weather/forecast?hours=3")
        daily = client.get("/weather/forecast?hours=5&timestep=1d")
        invalid = client.get("/weather/forecast?timestep=15m")

    assert hourly.status_code == 200
    assert hourly.json()["timestep"] == "1h"
    assert daily.status_code == 200
    assert daily.json()["timestep"] == "1d"
    assert daily.json()["data"][0]["temperature_high_c"] == 28
    assert invalid.status_code == 422
    assert calls == [("10,20", 3, True, "1h"), ("10,20", 5, True, "1d")]
