import os
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.pool import StaticPool

import main
from models import AuthSession


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
def add_prediction_context(field_id):
    from datetime import datetime, timezone

    with main.Session(main.engine) as db:
        field = db.get(main.FarmerField, field_id)
        assert field is not None

        db.execute(
            main.text("""
                INSERT INTO farmer_sensor_readings (
                    farmer_id,
                    field_id,
                    soil_moisture_percent,
                    recorded_at
                )
                VALUES (
                    :farmer_id,
                    :field_id,
                    :moisture,
                    :recorded_at
                )
            """),
            {
                "farmer_id": field.farmer_id,
                "field_id": field_id,
                "moisture": 35.0,
                "recorded_at": datetime.now(timezone.utc).isoformat(),
            },
        )

        db.add(
            main.FarmerCrop(
                farmer_id=field.farmer_id,
                field_id=field_id,
                name=field.crop or "Rice",
                growth_stage="vegetative",
            )
        )
        db.commit()


def create_prediction_field(
    client,
    coordinates=True,
    include_prediction_context=False,
):
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

    field_id = response.json()["id"]

    if include_prediction_context:
        add_prediction_context(field_id)

    return field_id



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


def test_field_api_coordinates_reach_reduced_weather_prediction(
    client_pair,
    monkeypatch,
):
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
    add_prediction_context(field_id)

    assert {
        key: created.json()[key] for key in coordinates
    } == coordinates

    listed = client.get("/api/fields")
    assert listed.status_code == 200

    listed_field = next(
        field for field in listed.json()
        if field["id"] == field_id
    )

    assert {
        key: listed_field[key] for key in coordinates
    } == coordinates

    with main.Session(main.engine) as db:
        stored_field = db.get(main.FarmerField, field_id)
        assert stored_field is not None
        assert {
            key: getattr(stored_field, key)
            for key in coordinates
        } == coordinates

    requested_locations = []

    def mock_forecast(location, days):
        requested_locations.append(location)
        return fresh_daily_forecasts(), []

    monkeypatch.setattr(
        main.irrigation_weather_adapter,
        "fetch_daily_forecast",
        mock_forecast,
    )

    prediction = client.post(
        "/api/ml/reduced-weather-prediction",
        json={"field_id": field_id},
        headers=csrf_headers(client),
    )

    assert prediction.status_code == 200, prediction.json()
    assert requested_locations == ["12.500000,77.600000"]
    assert prediction.json()["decision"] in ("irrigate", "hold")

def test_each_field_prediction_uses_its_own_saved_coordinates(
    client_pair,
    monkeypatch,
):
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

        field_record = created.json()
        add_prediction_context(field_record["id"])
        fields.append(field_record)

    listed_fields = client.get("/api/fields").json()

    assert {
        field["id"]: (field["latitude"], field["longitude"])
        for field in listed_fields
        if field["id"] in {
            record["id"] for record in fields
        }
    } == {
        record["id"]: (
            record["latitude"],
            record["longitude"],
        )
        for record in fields
    }

    weather_locations = []

    def mock_forecast(location, days):
        weather_locations.append(location)
        return fresh_daily_forecasts(), []

    monkeypatch.setattr(
        main.irrigation_weather_adapter,
        "fetch_daily_forecast",
        mock_forecast,
    )

    for field in fields:
        response = client.post(
            "/api/ml/reduced-weather-prediction",
            json={"field_id": field["id"]},
            headers=csrf_headers(client),
        )

        assert response.status_code == 200, response.json()
        assert response.json()["decision"] in ("irrigate", "hold")

    assert weather_locations == [
        "12.500000,77.600000",
        "13.100000,78.200000",
    ]


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
def fresh_daily_forecasts():
    from datetime import date, timedelta
    from irrigation_optimizer.models import DailyForecast

    today = date.today()

    return [
        DailyForecast(
            date=today,
            temp_min=20.0,
            temp_max=30.0,
            rain_mm=0.0,
            rain_prob=0.0,
            et0_mm=5.0,
        ),
        DailyForecast(
            date=today + timedelta(days=1),
            temp_min=20.0,
            temp_max=30.0,
            rain_mm=0.0,
            rain_prob=0.0,
            et0_mm=5.0,
        ),
    ]

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

    field_id = create_prediction_field(
        client,
        include_prediction_context=True,
    )

    seen_locations = []

    def mock_forecast(location, days):
        seen_locations.append(location)
        return fresh_daily_forecasts(), []

    monkeypatch.setattr(
        main.irrigation_weather_adapter,
        "fetch_daily_forecast",
        mock_forecast,
    )

    response = client.post(
        "/api/ml/reduced-weather-prediction",
        json={"field_id": field_id},
        headers=csrf_headers(client),
    )

    assert response.status_code == 200, response.json()
    assert response.headers["cache-control"] == "no-store"

    body = response.json()

    assert body["decision"] in ("irrigate", "hold")
    assert body["irrigation_needed"] == (
        body["decision"] == "irrigate"
    )
    assert body["soil_moisture_percent"] == 35.0
    assert body["rainfall_mm"] == 0.0
    assert body["rain_probability_percent"] == 0.0
    assert body["et0_mm"] >= 0.0
    assert body["forecast_date"] is not None
    assert body["observation_time"] is not None
    assert seen_locations == ["12.500000,77.600000"]
    assert seen_locations == ["12.500000,77.600000"]

def test_reduced_weather_endpoint_returns_current_assessment(
    client_pair,
    monkeypatch,
):
    client, _ = client_pair
    assert register(client).status_code == 201

    field_id = create_prediction_field(
        client,
        include_prediction_context=True,
    )

    monkeypatch.setattr(
        main.irrigation_weather_adapter,
        "fetch_daily_forecast",
        lambda location, days: (fresh_daily_forecasts(), []),
    )

    response = client.post(
        "/api/ml/reduced-weather-prediction",
        json={"field_id": field_id},
        headers=csrf_headers(client),
    )

    assert response.status_code == 200, response.json()

    body = response.json()

    assert body["decision"] in ("irrigate", "hold")
    assert body["irrigation_needed"] == (
        body["decision"] == "irrigate"
    )
    assert body["soil_moisture_percent"] == 35.0
    assert body["rainfall_mm"] == 0.0
    assert body["rain_probability_percent"] == 0.0
    assert body["et0_mm"] >= 0.0
    assert body["forecast_date"] is not None
    assert body["observation_time"] is not None
    assert body["weather_source"] in ("tomorrow_io", "open_meteo")

def test_reduced_weather_prediction_enforces_field_ownership_and_coordinates(
    client_pair,
    monkeypatch,
):
    first, second = client_pair
    assert register(first).status_code == 201

    owned_field_id = create_prediction_field(first)

    assert register(second, email="another@example.com").status_code == 201

    weather_called = []

    def mock_forecast(location, days):
        weather_called.append(location)
        return fresh_daily_forecasts(), []

    monkeypatch.setattr(
        main.irrigation_weather_adapter,
        "fetch_daily_forecast",
        mock_forecast,
    )

    foreign_response = second.post(
        "/api/ml/reduced-weather-prediction",
        json={"field_id": owned_field_id},
        headers=csrf_headers(second),
    )

    assert foreign_response.status_code == 404
    assert weather_called == []

    field_without_coordinates = create_prediction_field(
        first,
        coordinates=False,
    )

    response = first.post(
        "/api/ml/reduced-weather-prediction",
        json={"field_id": field_without_coordinates},
        headers=csrf_headers(first),
    )

    assert response.status_code == 422
    assert weather_called == []


def test_reduced_weather_prediction_rejects_stale_and_future_sensor_readings(
    client_pair,
    monkeypatch,
):
    from datetime import datetime, timedelta, timezone

    client, _ = client_pair
    assert register(client).status_code == 201

    field_id = create_prediction_field(
        client,
        include_prediction_context=True,
    )

    monkeypatch.setattr(
        main.irrigation_weather_adapter,
        "fetch_daily_forecast",
        lambda location, days: pytest.fail(
            "Invalid sensor readings must be rejected before fetching weather."
        ),
    )

    with main.Session(main.engine) as db:
        stale_time = datetime.now(timezone.utc) - timedelta(hours=25)

        db.execute(
            main.text("""
                UPDATE farmer_sensor_readings
                SET recorded_at = :recorded_at
                WHERE field_id = :field_id
            """),
            {
                "recorded_at": stale_time.isoformat(),
                "field_id": field_id,
            },
        )
        db.commit()

    stale_response = client.post(
        "/api/ml/reduced-weather-prediction",
        json={"field_id": field_id},
        headers=csrf_headers(client),
    )

    assert stale_response.status_code == 422

    with main.Session(main.engine) as db:
        future_time = datetime.now(timezone.utc) + timedelta(minutes=2)

        db.execute(
            main.text("""
                UPDATE farmer_sensor_readings
                SET recorded_at = :recorded_at
                WHERE field_id = :field_id
            """),
            {
                "recorded_at": future_time.isoformat(),
                "field_id": field_id,
            },
        )
        db.commit()

    future_response = client.post(
        "/api/ml/reduced-weather-prediction",
        json={"field_id": field_id},
        headers=csrf_headers(client),
    )

    assert future_response.status_code == 422

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
    async def mocked_answer(question):
        assert question == "How does rainfall affect irrigation?"
        return "Rainfall may reduce crop water demand."

    monkeypatch.setattr(main, "answer_farmer_question", mocked_answer)
    path = "/api/assistant/chat"
    payload = {"question": "  How does rainfall affect irrigation?  "}
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
        json={"question": "Hello", "api_key": "do-not-accept"},
        headers=headers,
    ).status_code == 422


def test_farmer_assistant_rate_limit_is_per_farmer(client_pair, monkeypatch):
    client, other = client_pair
    assert register(client).status_code == 201
    assert register(other, email="other-farmer@example.com").status_code == 201
    monkeypatch.setattr(main, "ASSISTANT_MAX_ATTEMPTS", 1)

    async def mocked_answer(_question):
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

    async def mocked_explanation(question, trusted_prediction):
        assert "Explain" in question
        assert trusted_prediction is prediction
        return "This is a test-only explanation."

    monkeypatch.setattr(main, "explain_model2_prediction", mocked_explanation)
    response = client.post(
        "/api/assistant/model2-explanation",
        json={"field_id": 1, "crop_id": 1, "question": "Explain this."},
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
    assert 'href="/static/sections.html?view=experimental-model"' in template
    assert 'data-view-link="experimental-model"' in sections
    assert "/static/experimental-model.js" in sections
    assert "/static/experimental-model.html" in sections_script
    assert "/static/weather.js?v=20261028-field-weather1" in sections
    assert "/static/app.js?v=20261027-i18n2" in template
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


def test_expired_session_is_rejected(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201
    with main.Session(main.engine) as db:
        auth_session = db.scalar(select(AuthSession))
        assert auth_session is not None
        auth_session.expires_at = main.datetime.now(main.timezone.utc) - main.timedelta(seconds=1)
        db.commit()

    assert client.get("/api/auth/me").status_code == 401


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