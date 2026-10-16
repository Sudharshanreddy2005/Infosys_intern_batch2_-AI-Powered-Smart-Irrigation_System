
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)

VALID_DATA = {
    "sensor_id": "SM_001",
    "field_id": "FIELD_001",
    "soil_moisture": 42.56789,
    "timestamp": "2026-10-09T10:30:00",
}


def test_valid_sensor_data():
    response = client.post("/sensor-data", json=VALID_DATA)

    assert response.status_code == 200
    assert response.json()["data"]["soil_moisture"] == 42.57


def test_invalid_soil_moisture():
    data = {**VALID_DATA, "soil_moisture": 150}

    response = client.post("/sensor-data", json=data)

    assert response.status_code == 422


def test_missing_soil_moisture():
    data = {
        key: value
        for key, value in VALID_DATA.items()
        if key != "soil_moisture"
    }

    response = client.post("/sensor-data", json=data)

    assert response.status_code == 422


def test_blank_sensor_id():
    data = {**VALID_DATA, "sensor_id": "   "}

    response = client.post("/sensor-data", json=data)

    assert response.status_code == 422


def test_sensor_id_whitespace_is_removed():
    data = {**VALID_DATA, "sensor_id": "  SM_001  "}

    response = client.post("/sensor-data", json=data)

    assert response.status_code == 200
    assert response.json()["data"]["sensor_id"] == "SM_001"