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


def test_root_and_management_serve_the_frontend():
    with TestClient(main.app) as client:
        assert client.get("/").status_code == 200
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
