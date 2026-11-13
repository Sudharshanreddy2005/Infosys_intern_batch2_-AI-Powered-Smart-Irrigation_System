from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


MODEL3_ZONE4 = {
    "zone": 4,
    "current_moisture_percent": 30,
    "weather_temp": 28,
    "weather_humidity": 55,
    "weather_rain": 1,
    "weather_pressure": 1012,
    "weather_wind_speed": 2.5,
    "weather_radiation": 18,
    "soil_temperature_0_7cm": 25,
    "soil_temperature_7_18cm": 24,
    "month": 6,
    "day": 15,
    "hour": 12,
    "day_period": 2,
    "quarter": 2,
}


MODEL4 = {
    "soil_type": "Loamy",
    "bulk_density": 1.3,
    "organic_matter_pct": 2.5,
    "cation_exchange_capacity": 18,
    "salinity_ec": 0.8,
    "buffering_capacity": 7,
    "soil_moisture_pct": 35,
    "moisture_limit_dry": 20,
    "moisture_limit_wet": 60,
    "moisture_regime": "optimal",
    "thermal_regime": "optimal",
    "nutrient_balance": "optimal",
    "plant_category": "cereal",
    "soil_temp_c": 24,
    "air_temp_c": 28,
    "light_intensity_par": 500,
    "soil_ph": 6.8,
    "nitrogen_ppm": 45,
    "phosphorus_ppm": 25,
    "potassium_ppm": 40,
}


def test_model3_api_returns_persistence_prediction_for_zone4():
    response = client.post(
        "/api/models/model3/predict",
        json={"zone": 4, "current_moisture_percent": 30},
    )

    assert response.status_code == 200

    body = response.json()

    assert body["strategy"] == "persistence"
    assert body["prediction_horizon_hours"] == 24
    assert body["current_moisture_percent"] == 30
    assert body["predicted_moisture_24h_percent"] == 30


def test_model3_api_uses_persistence_for_all_zones():
    for zone in (1, 2, 3, 4, 5):
        response = client.post(
            "/api/models/model3/predict",
            json={"zone": zone, "current_moisture_percent": 42},
        )

        assert response.status_code == 200

        body = response.json()

        assert body["strategy"] == "persistence"
        assert body["predicted_moisture_24h_percent"] == 42


def test_model4_api_returns_numeric_class_without_unverified_label():
    response = client.post("/api/models/model4/predict", json=MODEL4)
    assert response.status_code == 200
    body = response.json()
    assert body["predicted_class"] in (0, 1, 2)
    assert body["class_label_status"] == "unverified"
    assert body["stress_level"] is None
    assert 0 <= body["confidence"] <= 1
    assert body["probability_interpretation"] == "model_estimated_probability"


def test_new_authenticated_routes_require_a_session():
    assert client.post(
        "/api/ml/soil-moisture-prediction",
        json={"field_id": 1, "zone": 1, "current_moisture_percent": 30},
    ).status_code == 401
    assert client.post(
        "/api/ml/crop-stress-prediction",
        json={},
    ).status_code == 401
