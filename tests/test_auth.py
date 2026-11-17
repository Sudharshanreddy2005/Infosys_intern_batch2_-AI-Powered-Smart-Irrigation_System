import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin

os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.pool import StaticPool

import main
from models import (
    Alert,
    AuthSession,
    FarmerField,
    FarmerSensorDevice,
    FarmerSensorReading,
    IrrigationReservoir,
    IrrigationSchedule,
    Farmer,
    NotificationDelivery,
)


@pytest.fixture
def client_pair(monkeypatch):
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    monkeypatch.setattr(main, "engine", test_engine)
    monkeypatch.setattr(main, "auth_attempts", main.OrderedDict())
    monkeypatch.setattr(main, "assistant_attempts", main.OrderedDict())
    with TestClient(main.app) as first, TestClient(main.app) as second:
        yield first, second
    test_engine.dispose()


def register(client, email="farmer@example.com", password="CorrectHorse9!"):
    return client.post(
        "/api/auth/register",
        json={
            "name": "  Asha   Rao ",
            "email": email,
            "password": password,
            "phone": "+91 98765 43210",
            "state": "Karnataka",
            "district": "Mysuru",
            "village": "Hunsur",
        },
    )


def csrf_headers(client):
    return {"X-CSRF-Token": client.cookies.get(main.CSRF_COOKIE)}


def experimental_features():
    return {
        "temperature_c": 25.0,
        "humidity_percent": 60.0,
        "rain_probability_percent": 30.0,
        "N": 20.0,
        "P": 30.0,
        "K": 40.0,
        "ph": 6.5,
        "organic_matter": 3.0,
        "crop_density": 10.0,
        "sunlight_exposure": 8.0,
        "wind_speed": 4.0,
        "frost_risk": 10.0,
        "crop_name": "maize",
        "soil_type": 1,
        "growth_stage": 2,
    }


def create_prediction_field(client, coordinates=True):
    payload = {
        "name": "North plot",
        "crop": "Rice",
        "area": 2.5,
        "area_unit": "acres",
    }
    if coordinates:
        payload.update({"latitude": 12.5, "longitude": 77.6})
    response = client.post(
        "/api/fields",
        json=payload,
        headers=csrf_headers(client),
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_registration_creates_hashed_farmer_and_server_session(client_pair):
    client, _ = client_pair
    response = register(client)

    assert response.status_code == 201
    assert response.json()["name"] == "Asha Rao"
    assert "password_hash" not in response.json()
    assert client.cookies.get(main.SESSION_COOKIE)
    assert client.cookies.get(main.CSRF_COOKIE)
    assert "httponly" in response.headers["set-cookie"].lower()
    assert client.get("/api/auth/me").json()["email"] == "farmer@example.com"

    session = main.Session(main.engine)
    try:
        auth_session = session.scalar(select(AuthSession))
        assert auth_session is not None
        assert auth_session.token_hash != client.cookies.get(main.SESSION_COOKIE)
        assert len(auth_session.token_hash) == 64
    finally:
        session.close()


def test_authenticated_dashboard_is_available_after_registration(client_pair):
    client, _ = client_pair
    assert client.get("/dashboard", follow_redirects=False).status_code == 303
    assert register(client).status_code == 201

    response = client.get("/dashboard")

    assert response.status_code == 200
    assert "JalSaathi | Smart Irrigation" in response.text
    assert "Today's Irrigation Recommendation" in response.text
    assert 'data-field-previous' in response.text
    assert 'data-field-next' in response.text
    assert 'data-recommendation-status' in response.text
    assert "model1-recommendation.js?v=20261027-i18n2" in response.text
    assert "mock_development" not in response.text


def test_main_application_pwa_assets_are_served_from_the_app_origin(client_pair):
    client, _ = client_pair

    manifest = client.get("/manifest.webmanifest")
    assert manifest.status_code == 200
    assert manifest.headers["content-type"].startswith("application/manifest+json")
    manifest_data = manifest.json()
    assert manifest_data["start_url"] == "/"
    assert manifest_data["scope"] == "/"
    assert manifest_data["display"] == "standalone"
    assert manifest_data["icons"][0]["src"] == "/pwa-icons/icon-192.png"
    related_app = manifest_data["related_applications"][0]
    assert related_app["platform"] == "webapp"
    manifest_url = str(manifest.url)
    assert related_app["url"] == manifest_url
    assert related_app["id"] == urljoin(manifest_url, manifest_data["id"])

    worker = client.get("/service-worker.js")
    assert worker.status_code == 200
    assert worker.headers["service-worker-allowed"] == "/"
    assert "jalsaathi-main-" in worker.text
    assert 'self.addEventListener("push"' in worker.text
    assert 'self.addEventListener("notificationclick"' in worker.text

    offline = client.get("/offline.html")
    assert offline.status_code == 200
    assert "Your account data is not available offline." in offline.text
    for icon_name, expected_size in (
        ("icon-192.png", 192),
        ("icon-512.png", 512),
        ("icon-maskable-192.png", 192),
        ("icon-maskable-512.png", 512),
        ("apple-touch-icon.png", 180),
    ):
        icon = client.get(f"/pwa-icons/{icon_name}")
        assert icon.status_code == 200
        assert icon.headers["content-type"].startswith("image/png")
        assert icon.content[:8] == b"\x89PNG\r\n\x1a\n"
        assert int.from_bytes(icon.content[16:20], "big") == expected_size
        assert int.from_bytes(icon.content[20:24], "big") == expected_size
    assert client.get("/pwa-icons/not-an-app-icon.png").status_code == 404


def test_login_uses_generic_errors_and_sets_session(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201
    client.post("/api/auth/logout", headers=csrf_headers(client))

    invalid = client.post(
        "/api/auth/login",
        json={"email": "farmer@example.com", "password": "incorrect"},
    )
    assert invalid.status_code == 401
    assert invalid.json()["detail"] == "Email or password is incorrect."

    valid = client.post(
        "/api/auth/login",
        json={"email": "FARMER@example.com", "password": "CorrectHorse9!"},
    )
    assert valid.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_farmer_data_is_owner_scoped_and_csrf_protected(client_pair):
    first, second = client_pair
    assert register(first).status_code == 201
    assert register(second, email="another@example.com").status_code == 201

    body = {"name": "North plot", "crop": "Paddy", "area": 2.5, "area_unit": "acres"}
    without_csrf = first.post("/api/fields", json=body)
    assert without_csrf.status_code == 403

    created = first.post("/api/fields", json=body, headers=csrf_headers(first))
    assert created.status_code == 201
    field_id = created.json()["id"]
    assert "farmer_id" not in created.json()
    assert first.get("/api/fields").json()[0]["id"] == field_id
    assert second.get("/api/fields").json() == []
    assert second.get(f"/api/fields/{field_id}").status_code == 404
    assert second.patch(
        f"/api/fields/{field_id}",
        json={"name": "Stolen"},
        headers=csrf_headers(second),
    ).status_code == 404

    crop = first.post(
        "/api/crops",
        json={"name": "Paddy", "field_id": field_id},
        headers=csrf_headers(first),
    )
    assert crop.status_code == 201
    foreign_crop = second.post(
        "/api/crops",
        json={"name": "Maize", "field_id": field_id},
        headers=csrf_headers(second),
    )
    assert foreign_crop.status_code == 404

    updated_field = first.patch(
        f"/api/fields/{field_id}",
        json={"latitude": 12.5, "longitude": 77.6, "area": 3},
        headers=csrf_headers(first),
    )
    assert updated_field.status_code == 200
    assert updated_field.json()["latitude"] == 12.5
    assert first.patch(
        f"/api/fields/{field_id}",
        json={"latitude": None},
        headers=csrf_headers(first),
    ).status_code == 422

    updated_crop = first.patch(
        f"/api/crops/{crop.json()['id']}",
        json={"growth_stage": "Vegetative", "planting_date": "2026-01-10"},
        headers=csrf_headers(first),
    )
    assert updated_crop.status_code == 200
    assert updated_crop.json()["planting_date"] == "2026-01-10"
    assert first.delete(
        f"/api/crops/{crop.json()['id']}",
        headers=csrf_headers(first),
    ).status_code == 204
    assert first.delete(
        f"/api/fields/{field_id}",
        headers=csrf_headers(first),
    ).status_code == 204


def test_field_coordinates_are_created_returned_and_updated(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201
    payload = {
        "name": "North plot",
        "location": "Farm",
        "crop": "Rice",
        "area": 2.5,
        "area_unit": "acres",
        "latitude": 12.5,
        "longitude": 77.6,
    }

    created = client.post(
        "/api/fields",
        json=payload,
        headers=csrf_headers(client),
    )
    assert created.status_code == 201
    field_id = created.json()["id"]
    assert created.json()["latitude"] == 12.5
    assert created.json()["longitude"] == 77.6

    listed = client.get("/api/fields")
    assert listed.status_code == 200
    assert listed.json()[0]["latitude"] == 12.5
    assert listed.json()[0]["longitude"] == 77.6
    assert client.get(f"/api/fields/{field_id}").json()["latitude"] == 12.5

    updated = client.patch(
        f"/api/fields/{field_id}",
        json={"latitude": 13.25, "longitude": 78.75},
        headers=csrf_headers(client),
    )
    assert updated.status_code == 200
    assert updated.json()["latitude"] == 13.25
    assert updated.json()["longitude"] == 78.75
    assert client.get("/api/fields").json()[0]["latitude"] == 13.25
    assert client.get("/api/fields").json()[0]["longitude"] == 78.75


def test_field_api_coordinates_reach_reduced_weather_prediction(client_pair, monkeypatch):
    client, _ = client_pair
    assert register(client).status_code == 201
    coordinates = {"latitude": 12.5, "longitude": 77.6}
    created = client.post(
        "/api/fields",
        json={
            "name": "North plot",
            "crop": "Rice",
            "area": 2.5,
            "area_unit": "acres",
            **coordinates,
        },
        headers=csrf_headers(client),
    )
    assert created.status_code == 201
    field_id = created.json()["id"]
    assert {key: created.json()[key] for key in coordinates} == coordinates

    listed = client.get("/api/fields")
    assert listed.status_code == 200
    listed_field = next(field for field in listed.json() if field["id"] == field_id)
    assert {key: listed_field[key] for key in coordinates} == coordinates

    with main.Session(main.engine) as db:
        stored_field = db.get(main.FarmerField, field_id)
        assert stored_field is not None
        assert {key: getattr(stored_field, key) for key in coordinates} == coordinates

    requested_locations = []
    monkeypatch.setattr(
        main,
        "get_current_weather",
        lambda location: requested_locations.append(location) or fresh_weather(),
    )
    monkeypatch.setattr(
        main,
        "_load_reduced_weather_predictor",
        lambda: (
            reduced_weather_bundle(),
            lambda bundle, records: [{
                "prediction": 0,
                "proxy_positive_probability": 0.25,
                "target": "irrigation_needed_proxy",
                "warning": "Synthetic proxy demonstration only.",
            }],
        ),
    )

    prediction = client.post(
        "/api/ml/reduced-weather-experimental",
        json={"field_id": field_id},
        headers=csrf_headers(client),
    )
    assert prediction.status_code == 200, prediction.json()
    assert requested_locations == ["12.500000,77.600000"]


def test_each_field_prediction_uses_its_own_saved_coordinates(client_pair, monkeypatch):
    client, _ = client_pair
    assert register(client).status_code == 201
    fields = []
    for name, latitude, longitude in (
        ("North", 12.5, 77.6),
        ("East", 13.1, 78.2),
    ):
        created = client.post(
            "/api/fields",
            json={
                "name": name,
                "crop": "Rice",
                "area": 1,
                "area_unit": "acres",
                "latitude": latitude,
                "longitude": longitude,
            },
            headers=csrf_headers(client),
        )
        assert created.status_code == 201
        fields.append(created.json())

    listed_fields = client.get("/api/fields").json()
    assert {
        field["id"]: (field["latitude"], field["longitude"])
        for field in listed_fields
        if field["id"] in {record["id"] for record in fields}
    } == {
        record["id"]: (record["latitude"], record["longitude"])
        for record in fields
    }

    weather_locations = []
    monkeypatch.setattr(
        main,
        "get_current_weather",
        lambda location: weather_locations.append(location) or fresh_weather(),
    )
    monkeypatch.setattr(
        main,
        "_load_reduced_weather_predictor",
        lambda: (
            reduced_weather_bundle(),
            lambda bundle, records: [{
                "prediction": 1,
                "proxy_positive_probability": 0.75,
                "target": "irrigation_needed_proxy",
                "warning": "Synthetic proxy demonstration only.",
            }],
        ),
    )

    for field in fields:
        response = client.post(
            "/api/ml/reduced-weather-experimental",
            json={"field_id": field["id"]},
            headers=csrf_headers(client),
        )
        assert response.status_code == 200, response.json()

    assert weather_locations == ["12.500000,77.600000", "13.100000,78.200000"]


def test_field_coordinate_validation_rejects_bad_ranges_nonfinite_and_pairs(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201
    headers = csrf_headers(client)
    base = {
        "name": "North plot",
        "location": "Farm",
        "crop": "Rice",
        "area": 2.5,
        "area_unit": "acres",
    }

    invalid_payloads = [
        {"latitude": 90.01, "longitude": 77.6},
        {"latitude": 12.5, "longitude": 180.01},
        {"latitude": "Infinity", "longitude": 77.6},
        {"latitude": True, "longitude": 77.6},
        {"latitude": 12.5},
    ]
    for coordinates in invalid_payloads:
        response = client.post(
            "/api/fields",
            json={**base, **coordinates},
            headers=headers,
        )
        assert response.status_code == 422, response.json()

    field_id = create_prediction_field(client)
    for coordinates in (
        {"latitude": -90.01, "longitude": 77.6},
        {"latitude": 12.5, "longitude": -180.01},
        {"latitude": None},
    ):
        response = client.patch(
            f"/api/fields/{field_id}",
            json=coordinates,
            headers=headers,
        )
        assert response.status_code == 422, response.json()


def test_experimental_prediction_requires_authentication_and_csrf(client_pair):
    client, _ = client_pair
    path = "/api/ml/experimental-prediction"
    payload = experimental_features()

    assert client.post(path, json=payload).status_code == 401
    assert register(client).status_code == 201
    assert client.post(path, json=payload).status_code == 403
    assert client.post(
        path,
        json=payload,
        headers={"X-CSRF-Token": "invalid-token"},
    ).status_code == 403


def test_experimental_prediction_returns_proxy_only_response(client_pair, monkeypatch):
    client, _ = client_pair
    assert register(client).status_code == 201
    seen_records = []

    def mock_predict(bundle, records):
        seen_records.extend(records)
        return [{
            "prediction": 1,
            "proxy_positive_probability": 0.75,
            "target": "irrigation_needed_proxy",
            "warning": "Synthetic proxy demonstration only.",
        }]

    monkeypatch.setattr(
        main,
        "_load_experimental_predictor",
        lambda: (
            {"metadata": {"dataset_provenance": "synthetic_or_synthetic_augmented"}},
            mock_predict,
        ),
    )
    response = client.post(
        "/api/ml/experimental-prediction",
        json=experimental_features(),
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "prediction": 1,
        "proxy_positive_probability": 0.75,
        "target": "irrigation_needed_proxy",
        "warning": "Synthetic proxy demonstration only.",
        "model_status": "Experimental",
        "dataset_provenance": "synthetic_or_synthetic_augmented",
    }
    assert seen_records == [experimental_features()]

def test_experimental_prediction_rejects_invalid_features(client_pair, monkeypatch):
    client, _ = client_pair
    assert register(client).status_code == 201
    monkeypatch.setattr(
        main,
        "_load_experimental_predictor",
        lambda: pytest.fail("Invalid requests must not load the model."),
    )
    path = "/api/ml/experimental-prediction"
    headers = csrf_headers(client)

    missing = experimental_features()
    missing.pop("temperature_c")
    extra = {**experimental_features(), "soil_moisture": 18.0}
    invalid_crop = {**experimental_features(), "crop_name": "unknown"}
    invalid_soil = {**experimental_features(), "soil_type": 4}
    invalid_stage = {**experimental_features(), "growth_stage": 0}
    non_finite = {**experimental_features(), "temperature_c": "Infinity"}

    for payload in (missing, extra, invalid_crop, invalid_soil, invalid_stage, non_finite):
        response = client.post(path, json=payload, headers=headers)
        assert response.status_code == 422


def test_experimental_model_failure_is_safe_and_logged(client_pair, monkeypatch, caplog):
    client, _ = client_pair
    assert register(client).status_code == 201

    def unavailable():
        raise FileNotFoundError("private model path")

    monkeypatch.setattr(main, "_load_experimental_predictor", unavailable)
    response = client.post(
        "/api/ml/experimental-prediction",
        json=experimental_features(),
        headers=csrf_headers(client),
    )

    assert response.status_code == 503
    assert response.json() == {
        "detail": "The experimental model is currently unavailable."
    }
    assert "private model path" not in response.text
    assert "Experimental model prediction is unavailable." in caplog.text


def reduced_weather_bundle():
    return {
        "metadata": {
            "model_name": "random_forest",
            "proxy_rule": "soil_moisture <= 20.0",
            "dataset_provenance": "synthetic_or_synthetic_augmented",
            "feature_training_ranges": {
                "temperature_c": {"minimum": 8.83, "maximum": 43.68},
                "humidity_percent": {"minimum": 14.26, "maximum": 99.98},
            },
        }
    }


def fresh_weather(**overrides):
    from datetime import datetime, timezone

    return {
        "temperature_c": 25.0,
        "humidity_percent": 60.0,
        "is_stale": False,
        "data_age_minutes": 2.0,
        "observation_time": datetime.now(timezone.utc).isoformat(),
        **overrides,
    }


def test_reduced_weather_prediction_requires_authentication_and_csrf(client_pair):
    client, _ = client_pair
    path = "/api/ml/reduced-weather-prediction"

    assert client.post(path, json={"field_id": 1}).status_code == 401
    assert register(client).status_code == 201
    field_id = create_prediction_field(client)
    assert client.post(path, json={"field_id": field_id}).status_code == 403
    assert client.post(
        path,
        json={"field_id": field_id},
        headers={"X-CSRF-Token": "invalid-token"},
    ).status_code == 403


def test_reduced_weather_prediction_uses_owned_field_and_fresh_weather(
    client_pair,
    monkeypatch,
):
    client, _ = client_pair
    assert register(client).status_code == 201
    field_id = create_prediction_field(client)
    seen_locations = []
    seen_records = []

    def mock_weather(location):
        seen_locations.append(location)
        return fresh_weather()

    def mock_predict(bundle, records):
        seen_records.extend(records)
        return [{
            "prediction": 1,
            "proxy_positive_probability": 0.75,
            "target": "irrigation_needed_proxy",
            "warning": "Synthetic proxy demonstration only.",
        }]

    monkeypatch.setattr(main, "get_current_weather", mock_weather)
    monkeypatch.setattr(
        main,
        "_load_reduced_weather_predictor",
        lambda: (reduced_weather_bundle(), mock_predict),
    )

    response = client.post(
        "/api/ml/reduced-weather-experimental",
        json={"field_id": field_id},
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["prediction"] == 1
    assert response.json()["proxy_rule"] == "soil_moisture <= 20.0"
    assert response.json()["dataset_provenance"] == "synthetic_or_synthetic_augmented"
    assert response.json()["feature_sources"] == {
        "temperature_c": "selected_field_current_weather_api",
        "humidity_percent": "selected_field_current_weather_api",
    }
    assert response.json()["feature_inputs"] == seen_records[0]
    assert seen_locations == ["12.500000,77.600000"]
    assert seen_records == [{"temperature_c": 25.0, "humidity_percent": 60.0}]


def test_reduced_weather_endpoint_runs_the_saved_model_with_current_field_weather(
    client_pair,
    monkeypatch,
):
    client, _ = client_pair
    assert register(client).status_code == 201
    field_id = create_prediction_field(client)
    monkeypatch.setattr(
        main,
        "get_current_weather",
        lambda location: fresh_weather(),
    )

    response = client.post(
        "/api/ml/reduced-weather-experimental",
        json={"field_id": field_id},
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["prediction"] in (0, 1)
    assert 0.0 <= body["proxy_positive_probability"] <= 1.0
    assert body["selected_model"] == "random_forest"
    assert body["proxy_rule"] == "soil_moisture <= 20.0"
    assert body["feature_sources"] == {
        "temperature_c": "selected_field_current_weather_api",
        "humidity_percent": "selected_field_current_weather_api",
    }
    assert body["feature_inputs"] == {
        "temperature_c": 25.0,
        "humidity_percent": 60.0,
    }


def test_reduced_weather_prediction_enforces_field_ownership_and_coordinates(
    client_pair,
    monkeypatch,
):
    first, second = client_pair
    assert register(first).status_code == 201
    owned_field_id = create_prediction_field(first)
    assert register(second, email="another@example.com").status_code == 201
    weather_called = []
    monkeypatch.setattr(
        main,
        "get_current_weather",
        lambda location: weather_called.append(location) or fresh_weather(),
    )
    monkeypatch.setattr(
        main,
        "_load_reduced_weather_predictor",
        lambda: pytest.fail("A foreign field must not load a prediction model."),
    )

    foreign_response = second.post(
        "/api/ml/reduced-weather-experimental",
        json={"field_id": owned_field_id},
        headers=csrf_headers(second),
    )
    assert foreign_response.status_code == 404
    assert weather_called == []

    field_without_coordinates = create_prediction_field(first, coordinates=False)
    response = first.post(
        "/api/ml/reduced-weather-experimental",
        json={"field_id": field_without_coordinates},
        headers=csrf_headers(first),
    )
    assert response.status_code == 422
    assert weather_called == []


def test_reduced_weather_prediction_rejects_stale_and_out_of_training_range(
    client_pair,
    monkeypatch,
):
    client, _ = client_pair
    assert register(client).status_code == 201
    field_id = create_prediction_field(client)
    monkeypatch.setattr(main, "_load_reduced_weather_predictor", lambda: (
        reduced_weather_bundle(),
        lambda bundle, records: pytest.fail("Rejected weather must not be predicted."),
    ))

    monkeypatch.setattr(
        main,
        "get_current_weather",
        lambda location: fresh_weather(is_stale=True),
    )
    stale = client.post(
        "/api/ml/reduced-weather-experimental",
        json={"field_id": field_id},
        headers=csrf_headers(client),
    )
    assert stale.status_code == 422
    assert "Fresh field-specific weather" in stale.json()["detail"]

    monkeypatch.setattr(
        main,
        "get_current_weather",
        lambda location: fresh_weather(temperature_c=5.0),
    )
    outside_training_range = client.post(
        "/api/ml/reduced-weather-experimental",
        json={"field_id": field_id},
        headers=csrf_headers(client),
    )
    assert outside_training_range.status_code == 422
    assert "observed training range" in outside_training_range.json()["detail"]


def test_water_requirement_endpoint_fails_closed_with_authenticated_field_and_crop(
    client_pair,
):
    client, other = client_pair
    path = "/api/ml/water-requirement"
    payload = {"field_id": 1, "crop_id": 1, "prediction_period_hours": 24}

    assert client.post(path, json=payload).status_code == 401
    assert register(client).status_code == 201
    assert client.post(path, json=payload).status_code == 403

    field = client.post(
        "/api/fields",
        json={"name": "North plot", "area": 2.5, "area_unit": "acres"},
        headers=csrf_headers(client),
    )
    assert field.status_code == 201
    crop = client.post(
        "/api/crops",
        json={"name": "Maize", "field_id": field.json()["id"]},
        headers=csrf_headers(client),
    )
    assert crop.status_code == 201
    authorized_payload = {
        "field_id": field.json()["id"],
        "crop_id": crop.json()["id"],
        "prediction_period_hours": 24,
    }
    unavailable = client.post(
        path,
        json=authorized_payload,
        headers=csrf_headers(client),
    )

    assert unavailable.status_code == 503
    assert unavailable.headers["cache-control"] == "no-store"
    assert "independently verified real-world water-requirement labels" in unavailable.json()["detail"]
    assert "no estimate was generated" in unavailable.json()["detail"]

    assert register(other, email="other-farmer@example.com").status_code == 201
    foreign = other.post(
        path,
        json=authorized_payload,
        headers=csrf_headers(other),
    )
    assert foreign.status_code == 404

    mismatched_crop = client.post(
        "/api/crops",
        json={"name": "Rice"},
        headers=csrf_headers(client),
    )
    assert mismatched_crop.status_code == 201
    mismatch = client.post(
        path,
        json={
            "field_id": field.json()["id"],
            "crop_id": mismatched_crop.json()["id"],
            "prediction_period_hours": 24,
        },
        headers=csrf_headers(client),
    )
    assert mismatch.status_code == 404


def test_water_requirement_endpoint_rejects_invalid_period_and_extra_fields(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201
    headers = csrf_headers(client)
    invalid_period = client.post(
        "/api/ml/water-requirement",
        json={"field_id": 1, "crop_id": 1, "prediction_period_hours": 12},
        headers=headers,
    )
    extra_feature = client.post(
        "/api/ml/water-requirement",
        json={
            "field_id": 1,
            "crop_id": 1,
            "prediction_period_hours": 24,
            "water_used_liters": 10,
        },
        headers=headers,
    )
    assert invalid_period.status_code == 422
    assert extra_feature.status_code == 422


def test_farmer_assistant_chat_requires_auth_csrf_and_returns_provider_answer(
    client_pair,
    monkeypatch,
):
    client, _ = client_pair
    async def mocked_answer(question, language_code):
        assert question == "How does rainfall affect irrigation?"
        assert language_code == "te-IN"
        return "Rainfall may reduce crop water demand."

    monkeypatch.setattr(main, "answer_farmer_question", mocked_answer)
    path = "/api/assistant/chat"
    payload = {"question": "  How does rainfall affect irrigation?  ", "language_code": "te-IN"}
    assert client.post(path, json=payload).status_code == 401
    assert register(client).status_code == 201
    assert client.post(path, json=payload).status_code == 403

    response = client.post(path, json=payload, headers=csrf_headers(client))

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"answer": "Rainfall may reduce crop water demand."}


def test_farmer_assistant_chat_rejects_blank_oversize_and_extra_input(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201
    path = "/api/assistant/chat"
    headers = csrf_headers(client)
    assert client.post(path, json={"question": "  "}, headers=headers).status_code == 422
    assert client.post(path, json={"question": "q" * 1501}, headers=headers).status_code == 422
    assert client.post(
        path,
        json={"question": "Hello", "language_code": "fr-FR"},
        headers=headers,
    ).status_code == 422
    assert client.post(
        path,
        json={"question": "Hello", "api_key": "do-not-accept"},
        headers=headers,
    ).status_code == 422


def test_farmer_assistant_rate_limit_is_per_farmer(client_pair, monkeypatch):
    client, other = client_pair
    assert register(client).status_code == 201
    assert register(other, email="other-farmer@example.com").status_code == 201
    monkeypatch.setattr(main, "ASSISTANT_MAX_ATTEMPTS", 1)

    async def mocked_answer(_question, _language_code):
        return "Answer."

    monkeypatch.setattr(main, "answer_farmer_question", mocked_answer)
    path = "/api/assistant/chat"
    payload = {"question": "Hello"}
    assert client.post(path, json=payload, headers=csrf_headers(client)).status_code == 200
    limited = client.post(path, json=payload, headers=csrf_headers(client))
    assert limited.status_code == 429
    assert limited.headers["retry-after"] == "60"
    assert other.post(path, json=payload, headers=csrf_headers(other)).status_code == 200


def test_model2_explanation_requires_owned_field_crop_and_fails_closed(
    client_pair,
    monkeypatch,
):
    client, other = client_pair
    path = "/api/assistant/model2-explanation"
    payload = {"field_id": 1, "crop_id": 1, "question": "Explain this estimate."}
    assert client.post(path, json=payload).status_code == 401
    assert register(client).status_code == 201
    assert client.post(path, json=payload).status_code == 403

    field = client.post(
        "/api/fields",
        json={"name": "North plot", "area": 2.5, "area_unit": "acres"},
        headers=csrf_headers(client),
    ).json()
    crop = client.post(
        "/api/crops",
        json={"name": "Maize", "field_id": field["id"]},
        headers=csrf_headers(client),
    ).json()
    owned_payload = {
        "field_id": field["id"],
        "crop_id": crop["id"],
        "question": "Explain this estimate.",
    }

    async def unexpected_explanation(*_args):
        raise AssertionError("The provider must not receive an unavailable prediction.")

    monkeypatch.setattr(main, "explain_model2_prediction", unexpected_explanation)
    unavailable = client.post(
        path,
        json=owned_payload,
        headers=csrf_headers(client),
    )
    assert unavailable.status_code == 503
    assert "no estimate was generated" in unavailable.json()["detail"]
    assert unavailable.headers["cache-control"] == "no-store"

    assert register(other, email="other-farmer@example.com").status_code == 201
    foreign = other.post(path, json=owned_payload, headers=csrf_headers(other))
    assert foreign.status_code == 404


def test_model2_explanation_keeps_server_prediction_separate_from_text(
    client_pair,
    monkeypatch,
):
    client, _ = client_pair
    assert register(client).status_code == 201
    prediction = {
        "estimated_water_liters": 123.5,
        "unit": "liters_per_field_per_24_hours",
        "prediction_period_hours": 24,
        "target_basis": "gross_irrigation_requirement",
        "target_definition_approval_id": "approval-test-only",
        "model_version": "test-version",
        "dataset_provenance": "real_observed_with_independently_verified_labels",
    }
    monkeypatch.setattr(main, "_get_model2_prediction", lambda *_args: prediction)

    async def mocked_explanation(question, trusted_prediction, language_code):
        assert "Explain" in question
        assert trusted_prediction is prediction
        assert language_code == "ml-IN"
        return "This is a test-only explanation."

    monkeypatch.setattr(main, "explain_model2_prediction", mocked_explanation)
    response = client.post(
        "/api/assistant/model2-explanation",
        json={
            "field_id": 1,
            "crop_id": 1,
            "question": "Explain this.",
            "language_code": "ml-IN",
        },
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    assert response.json() == {
        "prediction": prediction,
        "explanation": "This is a test-only explanation.",
    }


def test_experimental_dashboard_is_separate_and_does_not_change_recommendations():
    project_root = Path(main.PROJECT_ROOT)
    template = (project_root / "templates" / "index.html").read_text(encoding="utf-8")
    lab = (project_root / "static" / "experimental-model.html").read_text(encoding="utf-8")
    sections = (project_root / "static" / "sections.html").read_text(encoding="utf-8")
    sections_script = (project_root / "static" / "sections.js").read_text(encoding="utf-8")
    water_script = (project_root / "static" / "water-requirement.js").read_text(encoding="utf-8")
    assistant_script = (project_root / "static" / "farmer-assistant.js").read_text(encoding="utf-8")
    script = (
        project_root / "static" / "experimental-model.js"
    ).read_text(encoding="utf-8")
    styles = (project_root / "static" / "styles.css").read_text(encoding="utf-8")

    assert "experimental-lab-card" not in template
    assert "/static/experimental-model.js" in template
    assert "/static/model1-recommendation.js" in template
    assert 'href="/static/sections.html?view=experimental-model"' not in template
    assert 'data-view-link="experimental-model"' not in sections
    assert '"experimental-model": {' in sections_script
    assert "/static/experimental-model.js" in sections
    assert "/static/experimental-model.html" in sections_script
    assert "/static/weather.js?v=" in sections
    assert "/static/app.js?v=" in template
    assert "Experimental demonstration only. This model was trained on synthetic or synthetic-augmented data and predicts a proxy target. It is not a validated real-world irrigation recommendation. Do not use this result alone to decide whether to irrigate." in lab
    assert 'name="soil_moisture"' not in template
    assert 'name="soil_moisture"' not in lab
    assert 'type="number"' in lab
    assert "credentials" not in script
    assert "apiRequest" in script
    assert "/api/fields" in script
    assert "/api/crops" in script
    assert "loadCurrent(selection, { refresh: true })" in script
    assert "rainfall_mm_per_hr" not in script
    assert "wind_speed_mps" in script
    assert "mapSupportedCrop" in script
    assert "buildPredictionPayload" in script
    assert 'data-experimental-field' in lab
    assert 'data-experimental-crop-record' in lab
    assert 'data-experimental-weather-refresh' in lab
    assert 'name="temperature_c"' in lab and "readonly" in lab
    assert "textContent" in script
    assert "data-recommendation" not in script
    assert "data-result-class" in lab
    assert "Water Requirement Estimate" in lab
    assert "data-water-estimate>Unavailable</dd>" in lab
    assert "/api/ml/water-requirement" in water_script
    assert 'data-assistant-form' in lab
    assert "/api/assistant/chat" in assistant_script
    assert "/api/assistant/model2-explanation" in assistant_script
    assert "language_code: getLanguageCode()" in assistant_script
    assert "error.message" not in assistant_script
    assert "textContent" in assistant_script
    assert "innerHTML" not in assistant_script
    assert "JalSaathiFarmerAssistant.initialize()" in sections_script
    assert "credentials" not in water_script
    assert "initializeExperimentalModelView" in sections_script
    assert "@media (max-width: 520px)" in styles


def test_authenticated_profile_can_be_updated(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201

    updated = client.patch(
        "/api/auth/me",
        json={"name": "Asha N Rao", "village": "Hunsur Town"},
        headers=csrf_headers(client),
    )

    assert updated.status_code == 200
    assert updated.json()["name"] == "Asha N Rao"
    assert updated.json()["village"] == "Hunsur Town"


def test_notification_preferences_are_persisted_and_owner_scoped(client_pair):
    first, second = client_pair
    assert register(first, "first@example.com").status_code == 201
    assert register(second, "second@example.com").status_code == 201

    defaults = first.get("/api/notification-preferences")
    assert defaults.status_code == 200
    assert defaults.json() == {
        "in_app_notifications_enabled": True,
        "web_push_enabled": False,
        "push_subscription_available": False,
        "sms_enabled": False,
        "email_enabled": False,
        "sms_available": False,
        "sms_unavailable_reason": "SMS is unavailable until a phone number is verified.",
    }

    unavailable_push = second.patch(
        "/api/notification-preferences",
        json={"web_push_enabled": True},
        headers=csrf_headers(second),
    )
    assert unavailable_push.status_code == 422
    expired_push = second.post(
        "/api/push/subscribe",
        json={
            "endpoint": "https://push.example.test/expired",
            "expirationTime": int((datetime.now(timezone.utc).timestamp() - 60) * 1000),
            "keys": {"p256dh": "test-key", "auth": "test-auth"},
        },
        headers=csrf_headers(second),
    )
    assert expired_push.status_code == 422

    subscription = first.post(
        "/api/push/subscribe",
        json={
            "endpoint": "https://push.example.test/first",
            "keys": {"p256dh": "test-key", "auth": "test-auth"},
        },
        headers=csrf_headers(first),
    )
    assert subscription.status_code == 200

    updated = first.patch(
        "/api/notification-preferences",
        json={
            "in_app_notifications_enabled": False,
            "email_enabled": True,
            "web_push_enabled": True,
        },
        headers=csrf_headers(first),
    )
    assert updated.status_code == 200
    assert updated.json()["in_app_notifications_enabled"] is False
    assert updated.json()["email_enabled"] is True
    assert updated.json()["web_push_enabled"] is True
    assert updated.json()["push_subscription_available"] is True
    assert first.get("/api/notification-preferences").json()["email_enabled"] is True

    second_preferences = second.get("/api/notification-preferences")
    assert second_preferences.status_code == 200
    assert second_preferences.json()["in_app_notifications_enabled"] is True
    assert second_preferences.json()["email_enabled"] is False
    assert second_preferences.json()["web_push_enabled"] is False
    assert second_preferences.json()["push_subscription_available"] is False


def test_skipped_in_app_alerts_are_hidden_without_removing_legacy_history(client_pair):
    farmer, _ = client_pair
    assert register(farmer).status_code == 201
    field_id = create_prediction_field(farmer)
    farmer_id = farmer.get("/api/auth/me").json()["id"]
    with main.Session(main.engine) as db:
        legacy_alert = Alert(
            farmer_id=farmer_id,
            field_id=field_id,
            alert_type="heavy_rain",
            severity="high",
            message="Legacy alert remains visible.",
            reason="Created before in-app delivery tracking.",
        )
        hidden_alert = Alert(
            farmer_id=farmer_id,
            field_id=field_id,
            alert_type="heatwave",
            severity="high",
            message="In-app delivery is disabled.",
            reason="The user disabled in-app notifications.",
        )
        db.add_all([legacy_alert, hidden_alert])
        db.flush()
        db.add(NotificationDelivery(
            alert_id=hidden_alert.id,
            farmer_id=farmer_id,
            channel="in_app",
            status="skipped",
            reason="preference_disabled",
        ))
        db.commit()
        legacy_alert_id = legacy_alert.id

    history = farmer.get("/api/alerts")
    assert history.status_code == 200
    assert [alert["id"] for alert in history.json()] == [legacy_alert_id]
    assert farmer.get("/api/alerts/counts").json() == {
        "total": 1,
        "unread": 1,
        "read": 0,
        "matching": 1,
    }


def test_sms_preferences_require_verified_phone_and_reject_invalid_updates(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201

    unavailable = client.patch(
        "/api/notification-preferences",
        json={"sms_enabled": True},
        headers=csrf_headers(client),
    )
    assert unavailable.status_code == 422

    for payload in ({}, {"email_enabled": None}, {"unexpected": True}, {"email_enabled": "yes"}):
        response = client.patch(
            "/api/notification-preferences",
            json=payload,
            headers=csrf_headers(client),
        )
        assert response.status_code == 422

    with main.Session(main.engine) as db:
        farmer = db.scalar(select(Farmer))
        farmer.phone_verified_at = datetime.now(timezone.utc)
        db.commit()

    verified = client.patch(
        "/api/notification-preferences",
        json={"sms_enabled": True},
        headers=csrf_headers(client),
    )
    assert verified.status_code == 200
    assert verified.json()["sms_enabled"] is True
    assert verified.json()["sms_available"] is True


def test_changing_phone_clears_sms_preference_and_verification(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201
    with main.Session(main.engine) as db:
        farmer = db.scalar(select(Farmer))
        farmer.phone_verified_at = datetime.now(timezone.utc)
        farmer.sms_enabled = True
        db.commit()

    changed = client.patch(
        "/api/auth/me",
        json={"phone": "+91 98765 43211"},
        headers=csrf_headers(client),
    )
    assert changed.status_code == 200
    with main.Session(main.engine) as db:
        farmer = db.scalar(select(Farmer))
        assert farmer.phone_verified_at is None
        assert farmer.sms_enabled is False


def test_account_settings_and_sidebar_navigation_are_consistent():
    root = Path(__file__).resolve().parents[1]
    pages = {
        "dashboard": (root / "templates" / "index.html").read_text(encoding="utf-8"),
        "sections": (root / "static" / "sections.html").read_text(encoding="utf-8"),
        "todo": (root / "templates" / "todo-list.html").read_text(encoding="utf-8"),
    }
    expected = [
        "dashboard",
        "fields",
        "crops",
        "field-monitoring",
        "schedule",
        "reports",
        "alerts",
        "weather",
        "predictions",
        "ai-model-predictions",
    ]

    for page_name, markup in pages.items():
        nav_match = re.search(r"<nav\b[^>]*>(.*?)</nav>", markup, flags=re.DOTALL)
        assert nav_match is not None
        nav = nav_match.group(1)
        if page_name == "sections":
            links = re.findall(r'data-view-link="([^"]+)"', nav)
        else:
            hrefs = re.findall(r'href="([^"]+)"', nav)
            links = [
                "dashboard" if href == "/dashboard" else
                re.search(r"[?&]view=([^&]+)", href).group(1)
                for href in hrefs
            ]
        assert links == expected
        assert "experimental-model" not in nav
        assert "Model Lab" not in nav
        assert 'data-common-topbar' in markup

    topbar = (root / "static" / "topbar.html").read_text(encoding="utf-8")
    sections_script = (root / "static" / "sections.js").read_text(encoding="utf-8")
    assert 'href="/static/sections.html?view=account-settings"' in topbar
    assert '"account-settings": {' in sections_script
    assert "/api/notification-preferences" in sections_script
    assert "data-settings-sms-help" in sections_script
    assert "phone_verified" in sections_script or "phone number is verified" in sections_script


def test_origin_and_extra_owner_fields_are_rejected(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201

    cross_origin = client.post(
        "/api/fields",
        json={"name": "North plot", "area": 1, "area_unit": "acres"},
        headers={**csrf_headers(client), "Origin": "https://attacker.example"},
    )
    assert cross_origin.status_code == 403

    owner_override = client.post(
        "/api/fields",
        json={
            "name": "North plot",
            "area": 1,
            "area_unit": "acres",
            "farmer_id": 900,
        },
        headers=csrf_headers(client),
    )
    assert owner_override.status_code == 422


def test_configured_pwa_origin_is_allowed_for_reverse_proxy_requests(client_pair, monkeypatch):
    client, _ = client_pair
    monkeypatch.setenv("FARMER_PWA_ORIGINS", "http://localhost:8000")

    response = client.post(
        "/api/auth/register",
        json={
            "name": "Asha Rao",
            "email": "proxied@example.com",
            "password": "CorrectHorse9!",
        },
        headers={"Origin": "http://localhost:8000"},
    )

    assert response.status_code == 201


def test_expired_session_is_rejected(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201
    with main.Session(main.engine) as db:
        auth_session = db.scalar(select(AuthSession))
        assert auth_session is not None
        auth_session.expires_at = main.datetime.now(main.timezone.utc) - main.timedelta(seconds=1)
        db.commit()

    assert client.get("/api/auth/me").status_code == 401


def test_chart_assistant_uses_owned_schedule_weather_and_language(
    client_pair,
    monkeypatch,
):
    client, other = client_pair
    assert register(client).status_code == 201
    field_id = create_prediction_field(client)
    farmer_id = client.get("/api/auth/me").json()["id"]
    crop_response = client.post(
        "/api/crops",
        json={"name": "Rice", "field_id": field_id},
        headers=csrf_headers(client),
    )
    assert crop_response.status_code == 201
    with main.Session(main.engine) as db:
        db.add(
            IrrigationSchedule(
                farmer_id=farmer_id,
                field_id=field_id,
                reservoir_id=1,
                field_name="North plot",
                crop_name="Rice",
                scheduled_date=main.datetime.now(main.timezone.utc).date(),
                start_time="06:00",
                end_time="07:00",
                water_liters=250,
                duration_minutes=60,
                irrigation_method="drip",
                status="confirmed",
                plan_snapshot={"status": "confirmed"},
            )
        )
        db.add(
            IrrigationSchedule(
                farmer_id=farmer_id,
                field_id=field_id,
                reservoir_id=1,
                field_name="North plot",
                crop_name="Maize",
                scheduled_date=main.datetime.now(main.timezone.utc).date(),
                start_time="07:00",
                end_time="08:00",
                water_liters=400,
                duration_minutes=60,
                irrigation_method="drip",
                status="confirmed",
                plan_snapshot={"status": "confirmed"},
            )
        )
        db.commit()
    assert register(other, email="other@example.com").status_code == 201
    monkeypatch.setattr(main, "weather_attempts", main.OrderedDict())
    weather_locations = []
    monkeypatch.setattr(
        main,
        "get_current_weather",
        lambda location: (
            weather_locations.append(location)
            or {
                "observation_time": "2026-03-30T12:00:00+00:00",
                "temperature_c": 24,
                "humidity_percent": 60,
                "rainfall_mm_per_hr": 0,
                "precipitation_probability_percent": 10,
                "wind_speed_mps": 2,
                "is_stale": False,
                "data_age_minutes": 5,
            }
        ),
    )
    monkeypatch.setattr(
        main,
        "get_forecast",
        lambda *_args, **_kwargs: [
            {
                "time": "2026-03-30T13:00:00+00:00",
                "temperature_c": 25,
                "humidity_percent": 58,
                "rainfall_mm_per_hr": 0,
                "precipitation_probability_percent": 5,
                "wind_speed_mps": 2,
                "is_stale": False,
                "data_age_minutes": 5,
            }
        ],
    )
    captured = {}

    async def mocked_chart_answer(question, field_data, history, language_code):
        captured.update(
            question=question,
            field_data=field_data,
            history=history,
            language_code=language_code,
        )
        return "α░╡α░╛α░ñα░╛α░╡α░░α░ú α░╕α▒éα░Üα░¿ α░àα░éα░ªα▒üα░¼α░╛α░ƒα▒üα░▓α▒ï α░ëα░éα░ªα░┐."

    monkeypatch.setattr(main, "answer_chart_question", mocked_chart_answer)
    response = client.post(
        "/api/assistant/chat",
        json={
            "assistant_mode": "chart",
            "question": "Explain my field data.",
            "language_code": "te-IN",
            "field_id": field_id,
            "crop_id": crop_response.json()["id"],
            "chart_period": "7d",
            "history": [
                {"role": "user", "content": "What is the forecast?"},
                {"role": "assistant", "content": "The saved forecast is available."},
            ],
        },
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    assert response.json()["answer"] == "α░╡α░╛α░ñα░╛α░╡α░░α░ú α░╕α▒éα░Üα░¿ α░àα░éα░ªα▒üα░¼α░╛α░ƒα▒üα░▓α▒ï α░ëα░éα░ªα░┐."
    assert response.json()["context"]["field"]["name"] == "North plot"
    assert response.json()["context"]["current_weather"]["values"]["temperature_c"] == 24
    assert response.json()["context"]["weather_forecast"]["data"][0]["temperature_c"] == 25
    assert response.json()["context"]["weather_forecast"]["range"] == {
        "start_date": "2026-03-30T13:00:00+00:00",
        "end_date": "2026-03-30T13:00:00+00:00",
    }
    assert response.json()["context"]["planned_irrigation"]["data"][0]["water_liters"] == 250
    assert len(response.json()["context"]["planned_irrigation"]["data"]) == 1
    assert response.json()["context"]["actual_water_usage"]["status"] == "unavailable"
    assert weather_locations == ["12.500000,77.600000"]
    assert captured["language_code"] == "te-IN"
    assert captured["history"][-1]["role"] == "assistant"
    assert "farmer_profile" not in captured["field_data"]
    assert response.json()["charts"] == response.json()["context"]["charts"]
    foreign_response = other.post(
        "/api/assistant/chat",
        json={
            "assistant_mode": "chart",
            "question": "Show this field.",
            "field_id": field_id,
        },
        headers=csrf_headers(other),
    )
    assert foreign_response.status_code == 404


def test_chart_assistant_builds_comparisons_from_fresh_owned_sensor_readings(client_pair, monkeypatch):
    client, _ = client_pair
    assert register(client).status_code == 201
    field_ids = [create_prediction_field(client) for _ in range(3)]
    with main.Session(main.engine) as db:
        for field_id, name in zip(field_ids, ["North plot", "East plot", "South plot"]):
            db.get(FarmerField, field_id).name = name
        db.commit()

    farmer_id = client.get("/api/auth/me").json()["id"]
    now = datetime.now(timezone.utc)
    with main.Session(main.engine) as db:
        db.add_all([
            FarmerSensorReading(
                farmer_id=farmer_id,
                field_id=field_ids[0],
                recorded_at=now,
                soil_moisture_percent=34,
                soil_temperature_c=22,
                humidity_percent=58,
                ph=6.4,
                electrical_conductivity_us_cm=120,
                source="sensor",
            ),
            FarmerSensorReading(
                farmer_id=farmer_id,
                field_id=field_ids[1],
                recorded_at=now - main.timedelta(hours=25),
                soil_moisture_percent=60,
                soil_temperature_c=24,
                humidity_percent=62,
                ph=6.8,
                electrical_conductivity_us_cm=180,
                source="sensor",
            ),
            FarmerSensorReading(
                farmer_id=farmer_id,
                field_id=field_ids[1],
                recorded_at=now,
                soil_moisture_percent=99,
                source="test_fixture",
            ),
            FarmerSensorReading(
                farmer_id=farmer_id,
                field_id=field_ids[2],
                recorded_at=now,
                soil_moisture_percent=42,
                soil_temperature_c=25,
                humidity_percent=64,
                ph=7.1,
                electrical_conductivity_us_cm=210,
                source="farmer_entered",
            ),
        ])
        db.commit()

    captured = {}

    async def mocked_gemini(question, field_data, history, language_code):
        captured["field_data"] = field_data
        return "Here is the verified comparison."

    monkeypatch.setattr(main, "answer_chart_question", mocked_gemini)
    response = client.post(
        "/api/assistant/chat",
        json={
            "assistant_mode": "chart",
            "question": "Compare soil moisture across my fields.",
            "chart_mode": "auto",
        },
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["chart_availability"]["status"] == "available"
    assert body["charts"][0]["title_key"] == "chartAssistant.soilMoisture"
    assert body["charts"][0]["labels"] == ["North plot", "South plot"]
    assert body["charts"][0]["datasets"][0]["data"] == [34.0, 42.0]
    assert body["charts"][0]["caption_values"]["staleCount"] == 1
    assert body["context"]["latest_sensor_readings"]["outdated_field_count"] == 1
    assert body["context"]["soil_ph_history"]["status"] == "available"
    assert body["context"]["electrical_conductivity_history"]["status"] == "available"
    assert all(
        item["values"].get("soil_moisture_percent") != 99
        for item in body["context"]["latest_sensor_readings"]["fields"]
    )
    assert "farmer_profile" not in captured["field_data"]
    assert "field_id" not in repr(captured["field_data"])


def test_chart_payloads_preserve_crop_and_irrigation_provenance():
    context = {
        "range": {"period": "30d", "start_date": "2026-01-01", "end_date": "2026-01-30"},
        "fields": [
            {"name": "North plot", "saved_crop_records": [{"name": "Rice"}]},
            {"name": "East plot", "saved_crop_records": [{"name": "Maize"}]},
        ],
        "planned_irrigation": {
            "status": "available",
            "source": "farmer_irrigation_schedules",
            "data": [{
                "field_name": "North plot",
                "scheduled_date": "2026-01-15",
                "water_liters": 200,
            }],
        },
        "actual_water_usage": {
            "status": "unavailable",
            "reason": "No measured usage records exist.",
        },
        "unassigned_saved_crop_records": [{"name": "Wheat"}],
        "recent_rainfall_history": {
            "status": "available",
            "source": "selected_field_recent_weather_history_api",
            "data": [
                {"time": "2026-01-29T10:00:00Z", "rain_accumulation_mm": 1.0},
                {"time": "2026-01-29T11:00:00Z", "rain_accumulation_mm": 2.0},
            ],
        },
    }

    crops = main._assistant_chart_payloads(context, "Show crop distribution.", [], "auto")
    assert crops["chart_availability"]["status"] == "available"
    assert crops["charts"][0]["type"] == "pie"
    assert crops["charts"][0]["labels"] == ["Rice", "Maize", "Wheat"]

    usage = main._assistant_chart_payloads(context, "Chart actual water usage.", [], "auto")
    assert usage["charts"] == []
    assert usage["chart_availability"]["status"] == "unavailable"
    assert usage["chart_availability"]["missing_metrics"][0]["metric_key"] == (
        "chartAssistant.actualUsageUnavailable"
    )

    rainfall = main._assistant_chart_payloads(
        context,
        "Plot rainfall for the last 30 days.",
        [],
        "auto",
    )
    assert rainfall["charts"] == []
    assert "at most 24 hours" in rainfall["chart_availability"]["missing_metrics"][0]["reason"]

    forecast_context = {
        "range": {"period": "7d", "start_date": "2026-01-24", "end_date": "2026-01-30"},
        "weather_forecast": {
            "status": "available",
            "source": "selected_field_weather_forecast_api",
            "range": {"start_date": "2026-01-31", "end_date": "2026-02-01"},
            "data": [
                {"time": "2026-01-31T10:00:00Z", "temperature_c": 24, "rainfall_mm_per_hr": 0.1},
                {"time": "2026-02-01T10:00:00Z", "temperature_c": 25, "rainfall_mm_per_hr": 0.3},
            ],
        },
    }
    forecast = main._assistant_chart_payloads(
        forecast_context,
        "Show a weather forecast chart.",
        [],
        "auto",
    )
    assert forecast["chart_availability"]["status"] == "available"
    assert {chart["title_key"] for chart in forecast["charts"]} == {
        "chartAssistant.temperature",
        "chartAssistant.rainfall",
    }


def test_auto_chart_mode_compares_a_metric_requested_for_each_field():
    context = {
        "range": {"period": "7d", "start_date": "2026-01-24", "end_date": "2026-01-30"},
        "latest_sensor_readings": {
            "status": "available",
            "source": "farmer_sensor_readings",
            "fields": [
                {
                    "field_name": "North plot",
                    "status": "available",
                    "freshness": "current",
                    "values": {"soil_moisture_percent": 31},
                },
                {
                    "field_name": "East plot",
                    "status": "available",
                    "freshness": "current",
                    "values": {"soil_moisture_percent": 46},
                },
            ],
        },
    }

    charts = main._assistant_chart_payloads(
        context,
        "Show soil moisture for my fields.",
        [],
        "auto",
    )

    assert charts["chart_availability"]["status"] == "available"
    assert charts["charts"][0]["type"] == "bar"
    assert charts["charts"][0]["labels"] == ["North plot", "East plot"]
    assert charts["charts"][0]["datasets"][0]["data"] == [31.0, 46.0]


def test_gemini_context_is_bounded_and_discloses_truncation():
    history = [
        {
            "field_id": index % 20,
            "field_name": f"Field {index % 20}",
            "recorded_at": f"2026-01-{index % 30 + 1:02d}T12:00:00+00:00",
            "soil_moisture_percent": float(index % 100),
            "source": "sensor",
        }
        for index in range(300)
    ]
    context = main._assistant_gemini_context({
        "soil_moisture_history": {
            "status": "available",
            "source": "farmer_sensor_readings",
            "data": history,
        },
    })

    assert len(main.json.dumps(context, ensure_ascii=False)) <= (
        main._ASSISTANT_GEMINI_CONTEXT_MAX_CHARACTERS + 200
    )
    assert "soil_moisture_history" in context["context_truncated_sections"]
    assert "field_id" not in repr(context)


def test_chart_assistant_validates_custom_ranges(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201
    field_id = create_prediction_field(client)

    response = client.post(
        "/api/assistant/chat",
        json={
            "assistant_mode": "chart",
            "question": "Show this range.",
            "field_id": field_id,
            "chart_period": "custom",
            "start_date": "2026-01-01",
            "end_date": "2026-02-01",
        },
        headers=csrf_headers(client),
    )

    assert response.status_code == 422


def test_chart_assistant_conversations_are_persisted_and_farmer_owned(client_pair, monkeypatch):
    client, other = client_pair
    assert register(client).status_code == 201
    assert register(other, email="other@example.com").status_code == 201
    captured = []
    answers = iter(["First answer.", "Follow-up answer.", "Regenerated answer."])

    async def mocked_chart_answer(question, field_data, history, language_code):
        captured.append({
            "question": question,
            "history": history,
            "language_code": language_code,
        })
        return next(answers)

    monkeypatch.setattr(main, "answer_chart_question", mocked_chart_answer)
    headers = csrf_headers(client)
    first = client.post(
        "/api/assistant/chat",
        json={
            "assistant_mode": "chart",
            "question": "Summarize my farm.",
            "persist_conversation": True,
        },
        headers=headers,
    )
    assert first.status_code == 200
    conversation_id = first.json()["conversation_id"]
    assert first.json()["context"]["farmer_profile"]["name"] == "Asha Rao"

    follow_up = client.post(
        "/api/assistant/chat",
        json={
            "assistant_mode": "chart",
            "question": "Explain the irrigation plan.",
            "persist_conversation": True,
            "conversation_id": conversation_id,
        },
        headers=headers,
    )
    assert follow_up.status_code == 200
    assert captured[1]["history"] == [
        {"role": "user", "content": "Summarize my farm."},
        {"role": "assistant", "content": "First answer."},
    ]

    regenerated = client.post(
        "/api/assistant/chat",
        json={
            "assistant_mode": "chart",
            "question": "This client text is ignored.",
            "persist_conversation": True,
            "regenerate": True,
            "conversation_id": conversation_id,
        },
        headers=headers,
    )
    assert regenerated.status_code == 200
    assert captured[2]["question"] == "Explain the irrigation plan."
    assert captured[2]["history"] == [
        {"role": "user", "content": "Summarize my farm."},
        {"role": "assistant", "content": "First answer."},
    ]

    detail = client.get(f"/api/assistant/conversations/{conversation_id}")
    assert detail.status_code == 200
    assert [message["role"] for message in detail.json()["messages"]] == [
        "user", "assistant", "user", "assistant",
    ]
    assert detail.json()["messages"][-1]["content"] == "Regenerated answer."
    assert client.get("/api/assistant/conversations").json()[0]["id"] == conversation_id
    assert other.get(f"/api/assistant/conversations/{conversation_id}").status_code == 404
    assert other.patch(
        f"/api/assistant/conversations/{conversation_id}",
        json={"title": "Foreign title"},
        headers=csrf_headers(other),
    ).status_code == 404
    assert other.delete(
        f"/api/assistant/conversations/{conversation_id}",
        headers=csrf_headers(other),
    ).status_code == 404

    renamed = client.patch(
        f"/api/assistant/conversations/{conversation_id}",
        json={"title": "  Farm notes  "},
        headers=headers,
    )
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Farm notes"
    deleted = client.delete(
        f"/api/assistant/conversations/{conversation_id}",
        headers=headers,
    )
    assert deleted.status_code == 200
    assert client.get("/api/assistant/conversations").json() == []


def test_chart_assistant_returns_provider_retry_after(client_pair, monkeypatch):
    client, _ = client_pair
    assert register(client).status_code == 201

    async def rate_limited(*_args, **_kwargs):
        raise main.AssistantServiceError(
            429,
            "JalSaathi AI is temporarily rate-limited. Please try again later.",
            retry_after=17,
        )

    monkeypatch.setattr(main, "answer_chart_question", rate_limited)
    response = client.post(
        "/api/assistant/chat",
        json={
            "assistant_mode": "chart",
            "question": "Summarize my farm.",
            "persist_conversation": True,
        },
        headers=csrf_headers(client),
    )

    assert response.status_code == 429
    assert response.headers["retry-after"] == "17"
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["detail"] == (
        "JalSaathi AI is temporarily rate-limited. Please try again later."
    )


def test_image_chat_uses_owned_measurements_and_detector_result_for_followups(client_pair, monkeypatch):
    client, other = client_pair
    assert register(client).status_code == 201
    assert register(other, email="other@example.com").status_code == 201
    field_id = create_prediction_field(client)
    other_field_id = create_prediction_field(other)
    crop = client.post(
        "/api/crops",
        json={"name": "Paddy", "field_id": field_id},
        headers=csrf_headers(client),
    )
    assert crop.status_code == 201
    first_farmer_id = client.get("/api/auth/me").json()["id"]
    other_farmer_id = other.get("/api/auth/me").json()["id"]
    now = datetime.now(timezone.utc)
    with main.Session(main.engine) as db:
        db.add_all([
            FarmerSensorReading(
                farmer_id=first_farmer_id,
                field_id=field_id,
                recorded_at=now,
                soil_moisture_percent=31.5,
                source="test_fixture",
            ),
            FarmerSensorReading(
                farmer_id=other_farmer_id,
                field_id=other_field_id,
                recorded_at=now,
                soil_moisture_percent=88.9,
                source="test_fixture",
            ),
        ])
        db.commit()
        farmer_summary = main.farmer_assistant._summarize_farmer_data(
            db,
            first_farmer_id,
            "Show my soil moisture.",
        )
    assert "soil_moisture=31.5%" in farmer_summary
    assert "88.9" not in farmer_summary

    detector_calls = []
    verified_prediction = {
        "crop_name": "Rice",
        "disease_name": "Leaf blight",
        "confidence": 0.82,
        "top_three_predictions": [
            {
                "class_name": "Rice___Leaf_blight",
                "crop_name": "Rice",
                "disease_name": "Leaf blight",
                "confidence": 0.82,
            },
        ],
        "is_uncertain": False,
        "uncertainty_status": "confident",
    }

    async def mocked_detector(image_bytes, content_type):
        detector_calls.append((image_bytes, content_type))
        return verified_prediction

    captured = []

    async def mocked_gemini(question, field_data, history, language_code):
        captured.append({
            "question": question,
            "field_data": field_data,
            "history": history,
            "language_code": language_code,
        })
        return "The detector found leaf blight. Check its confidence and consult local guidance."

    monkeypatch.setattr(main, "predict_crop_disease", mocked_detector)
    monkeypatch.setattr(main, "answer_chart_question", mocked_gemini)
    monkeypatch.setattr(main, "_assistant_chart_weather", lambda *_args: {})
    headers = csrf_headers(client)
    image_response = client.post(
        "/api/assistant/image",
        data={
            "question": "What does this leaf image show?",
            "language_code": "en-IN",
            "field_id": str(field_id),
            "crop_id": str(crop.json()["id"]),
            "chart_period": "7d",
        },
        files={"image": ("private-farm.jpg", b"private-image-bytes", "image/png")},
        headers=headers,
    )

    assert image_response.status_code == 200
    body = image_response.json()
    conversation_id = body["conversation_id"]
    assert detector_calls == [(b"private-image-bytes", "image/png")]
    assert body["context"]["crop_disease"]["prediction"] == verified_prediction
    assert body["context"]["soil_moisture_history"]["status"] == "unavailable"
    assert body["context"]["soil_moisture_history"]["data"] == []
    assert all(
        reading["soil_moisture_percent"] != 88.9
        for reading in body["context"]["soil_moisture_history"]["data"]
    )
    assert captured[0]["field_data"]["crop_disease"]["source"] == "crop_disease_model"

    saved = client.get(f"/api/assistant/conversations/{conversation_id}").json()
    assert saved["messages"][0]["image_attached"] is True
    assert "private-farm.jpg" not in repr(saved)
    assert "private-image-bytes" not in repr(saved)

    follow_up = client.post(
        "/api/assistant/chat",
        json={
            "assistant_mode": "chart",
            "question": "What should I do next?",
            "persist_conversation": True,
            "conversation_id": conversation_id,
        },
        headers=headers,
    )
    assert follow_up.status_code == 200
    assert captured[-1]["field_data"]["crop_disease"]["prediction"] == verified_prediction
    assert captured[-1]["history"][-1]["content"] == body["answer"]

    foreign = other.post(
        "/api/assistant/image",
        data={
            "question": "Analyze this image",
            "field_id": str(field_id),
        },
        files={"image": ("leaf.png", b"not-sent-to-detector", "image/png")},
        headers=csrf_headers(other),
    )
    assert foreign.status_code == 404
    assert len(detector_calls) == 1
    assert other.get(f"/api/assistant/conversations/{conversation_id}").status_code == 404


def test_image_chat_rejects_unsupported_media_and_large_uploads(client_pair, monkeypatch):
    client, _ = client_pair
    assert register(client).status_code == 201

    async def detector_must_not_run(*_args):
        raise AssertionError("Invalid images must be rejected before disease detection.")

    monkeypatch.setattr(main, "predict_crop_disease", detector_must_not_run)
    headers = csrf_headers(client)
    unsupported = client.post(
        "/api/assistant/image",
        data={"question": "Check this image"},
        files={"image": ("leaf.svg", b"<svg/>", "image/svg+xml")},
        headers=headers,
    )
    assert unsupported.status_code == 415

    oversized = client.post(
        "/api/assistant/image",
        data={"question": "Check this image"},
        files={"image": ("leaf.png", b"x" * (10 * 1024 * 1024 + 1), "image/png")},
        headers=headers,
    )
    assert oversized.status_code == 413

def test_field_sensor_readings_are_created_and_returned_in_time_order(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201

    field_id = create_prediction_field(client)
    path = f"/api/fields/{field_id}/sensor-readings"

    older = {
        "soil_moisture_percent": 24.5,
        "soil_temperature_c": 26.2,
        "humidity_percent": 70.0,
        "ph": 6.5,
        "electrical_conductivity_us_cm": 850.0,
        "recorded_at": "2026-11-10T07:00:00Z",
    }
    newer = {
        "soil_moisture_percent": 31.5,
        "recorded_at": "2026-11-10T08:00:00Z",
    }

    first = client.post(path, json=older, headers=csrf_headers(client))
    second = client.post(path, json=newer, headers=csrf_headers(client))

    assert first.status_code == 201, first.json()
    assert second.status_code == 201, second.json()
    assert first.json()["ph"] == 6.5
    assert first.json()["electrical_conductivity_us_cm"] == 850.0
    assert second.json()["ph"] is None
    assert second.json()["soil_temperature_c"] is None

    history = client.get(path)
    assert history.status_code == 200, history.json()

    readings = history.json()
    assert len(readings) == 2
    assert [row["soil_moisture_percent"] for row in readings] == [31.5, 24.5]


def test_field_sensor_readings_require_auth_csrf_and_field_ownership(client_pair):
    first, second = client_pair

    assert first.get("/api/fields/1/sensor-readings").status_code == 401

    assert register(first).status_code == 201
    assert register(second, email="another@example.com").status_code == 201

    field_id = create_prediction_field(first)
    path = f"/api/fields/{field_id}/sensor-readings"
    payload = {
        "soil_moisture_percent": 35.0,
        "recorded_at": "2026-11-10T09:00:00Z",
    }

    no_csrf = first.post(path, json=payload)
    assert no_csrf.status_code == 403

    created = first.post(
        path,
        json=payload,
        headers=csrf_headers(first),
    )
    assert created.status_code == 201, created.json()

    assert second.get(path).status_code == 404
    foreign_write = second.post(
        path,
        json=payload,
        headers=csrf_headers(second),
    )
    assert foreign_write.status_code == 404


def test_field_sensor_readings_reject_invalid_values_and_timestamps(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201

    field_id = create_prediction_field(client)
    path = f"/api/fields/{field_id}/sensor-readings"
    headers = csrf_headers(client)

    invalid_moisture = client.post(
        path,
        json={
            "soil_moisture_percent": 101,
            "recorded_at": "2026-11-10T09:00:00Z",
        },
        headers=headers,
    )
    assert invalid_moisture.status_code == 422

    invalid_ph = client.post(
        path,
        json={
            "soil_moisture_percent": 35,
            "ph": 15,
            "recorded_at": "2026-11-10T09:00:00Z",
        },
        headers=headers,
    )
    assert invalid_ph.status_code == 422

    missing_timezone = client.post(
        path,
        json={
            "soil_moisture_percent": 35,
            "recorded_at": "2026-11-10T09:00:00",
        },
        headers=headers,
    )
    assert missing_timezone.status_code == 422

def test_sensor_device_registration_ingestion_and_owner_security(client_pair):
    farmer, other = client_pair

    assert register(farmer).status_code == 201
    assert register(other, email="device-other@example.com").status_code == 201

    field_id = create_prediction_field(farmer)
    device_path = f"/api/fields/{field_id}/sensor-devices"

    device_payload = {"name": "North Field Sensor"}

    # Registration requires CSRF protection.
    assert farmer.post(
        device_path,
        json=device_payload,
    ).status_code == 403

    registration = farmer.post(
        device_path,
        json=device_payload,
        headers=csrf_headers(farmer),
    )

    assert registration.status_code == 201, registration.json()

    device = registration.json()
    token = device["token"]

    assert device["field_id"] == field_id
    assert device["device_id"].startswith("JAL-")
    assert token

    # Ordinary device listing must never reveal the secret token.
    listed = farmer.get(device_path)
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert "token" not in listed.json()[0]
    assert listed.json()[0]["is_active"] is True

    # Another farmer cannot view or register devices for this field.
    assert other.get(device_path).status_code == 404

    foreign_registration = other.post(
        device_path,
        json=device_payload,
        headers=csrf_headers(other),
    )
    assert foreign_registration.status_code == 404

    # An active device cannot be registered twice for the same field.
    duplicate = farmer.post(
        device_path,
        json=device_payload,
        headers=csrf_headers(farmer),
    )
    assert duplicate.status_code == 409

    reading_payload = {
        "soil_moisture_percent": 27.5,
        "soil_temperature_c": 26.0,
        "humidity_percent": 68.0,
        "ph": 6.5,
        "electrical_conductivity_us_cm": 800.0,
        "recorded_at": "2026-11-10T10:00:00Z",
    }

    # Device ingestion requires a valid bearer token.
    assert farmer.post(
        "/api/sensor-data",
        json=reading_payload,
    ).status_code == 401

    assert farmer.post(
        "/api/sensor-data",
        json=reading_payload,
        headers={"Authorization": "Bearer invalid-token"},
    ).status_code == 401

    # Valid device token submits a reading.
    ingested = farmer.post(
        "/api/sensor-data",
        json=reading_payload,
        headers={"Authorization": f"Bearer {token}"},
    )

    assert ingested.status_code == 201, ingested.json()
    assert ingested.json()["field_id"] == field_id
    assert ingested.json()["soil_moisture_percent"] == 27.5

    # The reading is visible in the owning farmer's field history.
    history = farmer.get(
        f"/api/fields/{field_id}/sensor-readings"
    )

    assert history.status_code == 200
    assert len(history.json()) == 1
    assert history.json()[0]["soil_moisture_percent"] == 27.5

    # Device activity timestamp should now be populated.
    updated_device = farmer.get(device_path).json()[0]
    assert updated_device["last_seen_at"] is not None


def test_sensor_device_revocation_and_replacement(client_pair):
    farmer, _ = client_pair

    assert register(farmer).status_code == 201
    field_id = create_prediction_field(farmer)
    device_path = f"/api/fields/{field_id}/sensor-devices"

    first_registration = farmer.post(
        device_path,
        json={"name": "First Sensor"},
        headers=csrf_headers(farmer),
    )

    assert first_registration.status_code == 201
    first_device = first_registration.json()
    first_token = first_device["token"]

    revoke_path = (
        f"{device_path}/{first_device['id']}/revoke"
    )

    revoked = farmer.post(
        revoke_path,
        headers=csrf_headers(farmer),
    )

    assert revoked.status_code == 200
    assert revoked.json()["is_active"] is False

    reading_payload = {
        "soil_moisture_percent": 30.0,
        "recorded_at": "2026-11-10T11:00:00Z",
    }

    # Revoked credentials must no longer work.
    old_token_response = farmer.post(
        "/api/sensor-data",
        json=reading_payload,
        headers={"Authorization": f"Bearer {first_token}"},
    )
    assert old_token_response.status_code == 401

    # Registering again replaces the revoked device credentials.
    second_registration = farmer.post(
        device_path,
        json={"name": "Replacement Sensor"},
        headers=csrf_headers(farmer),
    )

    assert second_registration.status_code == 201
    second_device = second_registration.json()
    second_token = second_device["token"]

    assert second_token != first_token
    assert second_device["id"] == first_device["id"]

    # The old token remains invalid.
    old_token_again = farmer.post(
        "/api/sensor-data",
        json=reading_payload,
        headers={"Authorization": f"Bearer {first_token}"},
    )
    assert old_token_again.status_code == 401

    # The replacement token works.
    new_token_response = farmer.post(
        "/api/sensor-data",
        json=reading_payload,
        headers={"Authorization": f"Bearer {second_token}"},
    )
    assert new_token_response.status_code == 201


def test_alert_notifications_are_paginated_filtered_and_farmer_owned(client_pair):
    farmer, other = client_pair
    assert register(farmer).status_code == 201
    assert register(other, email="notification-other@example.com").status_code == 201
    field_id = create_prediction_field(farmer)
    other_field_id = create_prediction_field(other)
    farmer_id = farmer.get("/api/auth/me").json()["id"]
    other_farmer_id = other.get("/api/auth/me").json()["id"]
    now = datetime.now(timezone.utc)
    with main.Session(main.engine) as db:
        db.add_all([
            Alert(
                farmer_id=farmer_id,
                field_id=field_id,
                alert_type="heavy_rain",
                severity="high",
                message="Heavy rain is forecast.",
                reason="Rain probability exceeds the configured threshold.",
                created_at=now,
            ),
            Alert(
                farmer_id=farmer_id,
                field_id=field_id,
                alert_type="sensor_failure",
                severity="medium",
                message="A sensor is not sending readings.",
                reason="No readings have arrived recently.",
                is_read=True,
                created_at=now - timedelta(minutes=5),
            ),
            Alert(
                farmer_id=other_farmer_id,
                field_id=other_field_id,
                alert_type="heatwave",
                severity="high",
                message="A foreign farmer's alert.",
                reason="Private record.",
            ),
        ])
        db.commit()
        farmer_alert_id = db.scalar(
            select(Alert.id).where(
                Alert.farmer_id == farmer_id,
                Alert.alert_type == "heavy_rain",
            )
        )

    latest = farmer.get("/api/alerts?limit=1")
    assert latest.status_code == 200
    assert len(latest.json()) == 1
    assert latest.json()[0]["category"] == "weather"
    assert latest.json()[0]["field_name"] == "North plot"
    assert "farmer_id" not in latest.json()[0]
    assert farmer.get("/api/alerts?category=sensors&read_status=read").json()[0]["category"] == "sensors"
    assert farmer.get("/api/alerts?category=weather").json()[0]["alert_type"] == "heavy_rain"
    assert farmer.get("/api/alerts?category=invalid").status_code == 422

    counts = farmer.get("/api/alerts/counts").json()
    assert counts == {"total": 2, "unread": 1, "read": 1, "matching": 2}
    filtered_counts = farmer.get("/api/alerts/counts?category=weather&read_status=unread").json()
    assert filtered_counts["matching"] == 1
    assert filtered_counts["total"] == 2
    assert other.get("/api/alerts/counts").json()["total"] == 1

    read_response = farmer.patch(
        f"/api/alerts/{farmer_alert_id}/read",
        headers=csrf_headers(farmer),
    )
    assert read_response.status_code == 200
    assert farmer.get("/api/alerts/counts").json()["unread"] == 0
    unread_response = farmer.patch(
        f"/api/alerts/{farmer_alert_id}/unread",
        headers=csrf_headers(farmer),
    )
    assert unread_response.status_code == 200
    assert farmer.get("/api/alerts/counts").json()["unread"] == 1
    assert other.patch(
        f"/api/alerts/{farmer_alert_id}/read",
        headers=csrf_headers(other),
    ).status_code == 404

    marked_all = farmer.patch("/api/alerts/read-all", headers=csrf_headers(farmer))
    assert marked_all.status_code == 200
    assert marked_all.json()["updated_count"] == 1
    assert farmer.get("/api/alerts/counts").json()["unread"] == 0
    assert farmer.get("/api/alerts?read_status=read").json()
    assert farmer.get("/api/alerts").status_code == 200


def test_weather_alert_refresh_uses_real_forecast_rules_and_deduplicates(client_pair, monkeypatch):
    farmer, _ = client_pair
    assert register(farmer).status_code == 201
    field_id = create_prediction_field(farmer)
    monkeypatch.setattr(main, "weather_alert_attempts", main.OrderedDict())
    forecast_calls = []

    def forecast(location, hours, timestep):
        forecast_calls.append((location, hours, timestep))
        return [
            {
                "time": datetime.now(timezone.utc).isoformat(),
                "temperature_c": 41,
                "rainfall_mm_per_hr": 6,
                "rain_probability_percent": 90,
                "wind_speed_mps": 18,
                "weather_code": 8000,
                "is_stale": False,
            },
        ]

    monkeypatch.setattr(main, "get_forecast", forecast)
    refreshed = farmer.post("/api/alerts/refresh", headers=csrf_headers(farmer))
    assert refreshed.status_code == 200
    assert refreshed.json()["created"] == 4
    assert forecast_calls == [("12.500000,77.600000", 24, "1h")]

    saved = farmer.get("/api/alerts?category=weather&limit=10")
    assert saved.status_code == 200
    assert {item["alert_type"] for item in saved.json()} == {
        "heavy_rain",
        "heatwave",
        "strong_wind",
        "storm",
    }
    assert all(item["field_id"] == field_id for item in saved.json())
    with main.Session(main.engine) as db:
        assert db.scalar(select(func.count()).select_from(NotificationDelivery)) == 16
    second_refresh = farmer.post("/api/alerts/refresh", headers=csrf_headers(farmer))
    assert second_refresh.status_code == 200
    assert second_refresh.json()["created"] == 0
    assert len(forecast_calls) == 1
    main.weather_alert_attempts.clear()
    duplicate_refresh = farmer.post("/api/alerts/refresh", headers=csrf_headers(farmer))
    assert duplicate_refresh.status_code == 200
    assert duplicate_refresh.json()["created"] == 0
    assert len(forecast_calls) == 2
    with main.Session(main.engine) as db:
        assert db.scalar(select(func.count()).select_from(NotificationDelivery)) == 16


def test_weather_alert_refresh_skips_stale_or_unavailable_forecasts(client_pair, monkeypatch):
    farmer, _ = client_pair
    assert register(farmer).status_code == 201
    create_prediction_field(farmer)
    monkeypatch.setattr(main, "weather_alert_attempts", main.OrderedDict())
    monkeypatch.setattr(
        main,
        "get_forecast",
        lambda *_args, **_kwargs: [
            {
                "temperature_c": 45,
                "rainfall_mm_per_hr": 20,
                "rain_probability_percent": 100,
                "wind_speed_mps": 25,
                "weather_code": 8000,
                "is_stale": True,
            },
        ],
    )

    refreshed = farmer.post("/api/alerts/refresh", headers=csrf_headers(farmer))
    assert refreshed.status_code == 200
    assert refreshed.json()["created"] == 0
    assert farmer.get("/api/alerts").json() == []


def test_weather_alert_refresh_flags_high_temperature_and_dry_low_moisture(client_pair, monkeypatch):
    farmer, _ = client_pair
    assert register(farmer).status_code == 201
    field_id = create_prediction_field(farmer)
    farmer_id = farmer.get("/api/auth/me").json()["id"]
    with main.Session(main.engine) as db:
        db.add(FarmerSensorReading(
            farmer_id=farmer_id,
            field_id=field_id,
            recorded_at=datetime.now(timezone.utc),
            soil_moisture_percent=15,
            source="sensor",
        ))
        db.commit()
    monkeypatch.setattr(main, "weather_alert_attempts", main.OrderedDict())
    monkeypatch.setattr(
        main,
        "get_forecast",
        lambda *_args, **_kwargs: [
            {
                "temperature_c": 37,
                "rainfall_mm_per_hr": 0,
                "rain_probability_percent": 0,
                "wind_speed_mps": 2,
                "weather_code": 1000,
                "is_stale": False,
            },
        ],
    )

    refreshed = farmer.post("/api/alerts/refresh", headers=csrf_headers(farmer))
    assert refreshed.status_code == 200
    assert refreshed.json()["created"] == 2
    assert {item["alert_type"] for item in farmer.get("/api/alerts?category=weather").json()} == {
        "high_temperature",
        "drought_risk",
    }


def test_alert_refresh_notifies_for_confirmed_and_completed_irrigation_events(client_pair, monkeypatch):
    farmer, _ = client_pair
    assert register(farmer).status_code == 201
    field_id = create_prediction_field(farmer)
    farmer_id = farmer.get("/api/auth/me").json()["id"]
    monkeypatch.setattr(main, "weather_alert_attempts", main.OrderedDict())
    monkeypatch.setattr(main, "get_forecast", lambda *_args, **_kwargs: [])
    with main.Session(main.engine) as db:
        reservoir = IrrigationReservoir(
            farmer_id=farmer_id,
            field_id=field_id,
            name="North reservoir",
            capacity_liters=1000,
            available_liters=1000,
            reserved_liters=100,
        )
        db.add(reservoir)
        db.flush()
        schedule = IrrigationSchedule(
            farmer_id=farmer_id,
            field_id=field_id,
            reservoir_id=reservoir.id,
            field_name="North plot",
            crop_name="Rice",
            scheduled_date=datetime.now(timezone.utc).date(),
            start_time="07:00",
            end_time="08:00",
            water_liters=100,
            duration_minutes=60,
            irrigation_method="drip",
            status="confirmed",
            plan_snapshot={},
        )
        db.add(schedule)
        db.commit()
        schedule_id = schedule.id

    confirmed = farmer.post("/api/alerts/refresh", headers=csrf_headers(farmer))
    assert confirmed.status_code == 200
    assert confirmed.json()["created"] == 1
    with main.Session(main.engine) as db:
        db.get(IrrigationSchedule, schedule_id).status = "completed"
        db.commit()

    completed = farmer.post("/api/alerts/refresh", headers=csrf_headers(farmer))
    assert completed.status_code == 200
    assert completed.json()["created"] == 1
    irrigation_alerts = farmer.get("/api/alerts?category=irrigation").json()
    assert {item["alert_type"] for item in irrigation_alerts} == {
        f"irrigation_scheduled_{schedule_id}",
        f"irrigation_completed_{schedule_id}",
    }


def test_alert_refresh_generates_a_deduplicated_stale_sensor_warning(client_pair, monkeypatch):
    farmer, _ = client_pair
    assert register(farmer).status_code == 201
    field_id = create_prediction_field(farmer)
    registered = farmer.post(
        f"/api/fields/{field_id}/sensor-devices",
        json={"name": "North Field Sensor"},
        headers=csrf_headers(farmer),
    )
    assert registered.status_code == 201
    device_id = registered.json()["id"]
    with main.Session(main.engine) as db:
        db.get(FarmerSensorDevice, device_id).last_seen_at = datetime.now(timezone.utc) - timedelta(hours=3)
        db.commit()
    monkeypatch.setattr(main, "weather_alert_attempts", main.OrderedDict())
    monkeypatch.setattr(main, "get_forecast", lambda *_args, **_kwargs: [])

    refreshed = farmer.post("/api/alerts/refresh", headers=csrf_headers(farmer))
    assert refreshed.status_code == 200
    assert refreshed.json()["created"] == 1
    sensors = farmer.get("/api/alerts?category=sensors").json()
    assert len(sensors) == 1
    assert sensors[0]["alert_type"] == "sensor_failure"
    assert sensors[0]["category"] == "sensors"
    assert "not sending readings" in sensors[0]["message"]
