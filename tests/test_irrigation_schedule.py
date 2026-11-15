from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from sqlalchemy.pool import StaticPool

import main
from irrigation_optimizer.models import DailyForecast


@pytest.fixture
def irrigation_clients(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "auth_attempts", main.OrderedDict())

    def forecast(_location, days):
        return [
            DailyForecast(
                date.today() + timedelta(days=index),
                18,
                30,
                rain_mm=0,
                rain_prob=0,
                et0_mm=4,
            )
            for index in range(days)
        ], []

    monkeypatch.setattr(main.irrigation_weather_adapter, "fetch_daily_forecast", forecast)
    with TestClient(main.app) as first, TestClient(main.app) as second:
        yield first, second
    engine.dispose()


def register(client, email):
    response = client.post(
        "/api/auth/register",
        json={"name": "Test Farmer", "email": email, "password": "CorrectHorse9!"},
    )
    assert response.status_code == 201
    return response


def csrf(client):
    return {"X-CSRF-Token": client.cookies.get(main.CSRF_COOKIE)}


def add_field(client, *, crop="Wheat", growth_stage=None):
    response = client.post(
        "/api/fields",
        json={
            "name": "North Field",
            "crop": crop,
            "area": 1,
            "area_unit": "acres",
            "latitude": 12.5,
            "longitude": 77.6,
        },
        headers=csrf(client),
    )
    assert response.status_code == 201
    field_id = response.json()["id"]
    if growth_stage:
        crop_response = client.post(
            "/api/crops",
            json={
                "name": crop,
                "field_id": field_id,
                "growth_stage": growth_stage,
            },
            headers=csrf(client),
        )
        assert crop_response.status_code == 201
    return response.json()


def add_reservoir(client, field_id, *, available=100_000, capacity=200_000):
    response = client.post(
        "/api/irrigation/reservoirs",
        json={
            "field_id": field_id,
            "name": "Farm tank",
            "capacity_liters": capacity,
            "available_liters": available,
        },
        headers=csrf(client),
    )
    assert response.status_code == 201, response.json()
    return response.json()


def plan_request(field_id, reservoir_id=None, **overrides):
    body = {
        "field_id": field_id,
        "reservoir_id": reservoir_id,
        "soil_moisture_pct": 5,
        "growth_stage_code": 2,
        "soil_type_code": 2,
        "irrigation_method": "drip",
        "pump_flow_lpm": 1000,
        "days": 2,
    }
    body.update(overrides)
    return body


def freeze_planning_clock(monkeypatch):
    class FrozenDateTime:
        @staticmethod
        def now(tz=None):
            local = datetime.combine(date.today(), time(4))
            return local.replace(tzinfo=tz) if tz else local

    monkeypatch.setattr(main, "datetime", FrozenDateTime)


def test_reservoir_requires_auth_csrf_and_enforces_capacity_and_water_bounds(irrigation_clients):
    farmer, _ = irrigation_clients
    assert farmer.get("/api/irrigation/reservoirs").status_code == 401
    register(farmer, "reservoir-owner@example.com")
    field = add_field(farmer)

    no_csrf = farmer.post(
        "/api/irrigation/reservoirs",
        json={
            "field_id": field["id"],
            "name": "Tank",
            "capacity_liters": 10_000,
            "available_liters": 5_000,
        },
    )
    assert no_csrf.status_code == 403
    assert farmer.post(
        "/api/irrigation/reservoirs",
        json={
            "field_id": field["id"],
            "name": "Tank",
            "capacity_liters": 10_000,
            "available_liters": -1,
        },
        headers=csrf(farmer),
    ).status_code == 422
    assert farmer.post(
        "/api/irrigation/reservoirs",
        json={
            "field_id": field["id"],
            "name": "Tank",
            "capacity_liters": 10_000,
            "available_liters": 10_001,
        },
        headers=csrf(farmer),
    ).status_code == 422

    reservoir = add_reservoir(farmer, field["id"], available=5_000, capacity=10_000)
    assert reservoir["remaining_liters"] == 5_000
    assert farmer.patch(
        f"/api/irrigation/reservoirs/{reservoir['id']}",
        json={"available_liters": -1},
        headers=csrf(farmer),
    ).status_code == 422
    assert farmer.patch(
        f"/api/irrigation/reservoirs/{reservoir['id']}",
        json={"available_liters": 10_001},
        headers=csrf(farmer),
    ).status_code == 422
    updated = farmer.patch(
        f"/api/irrigation/reservoirs/{reservoir['id']}",
        json={"available_liters": 8_000},
        headers=csrf(farmer),
    )
    assert updated.status_code == 200
    assert updated.json()["available_liters"] == 8_000
    shared = farmer.post(
        "/api/irrigation/reservoirs",
        json={
            "field_id": None,
            "name": "Shared well",
            "capacity_liters": 25_000,
            "available_liters": 20_000,
        },
        headers=csrf(farmer),
    )
    assert shared.status_code == 201
    assert len(farmer.get(
        f"/api/irrigation/reservoirs?field_id={field['id']}"
    ).json()) == 2


def test_reservoir_is_field_and_farmer_scoped_and_unconfigured_plan_is_rejected(irrigation_clients):
    farmer_a, farmer_b = irrigation_clients
    register(farmer_a, "owner-a@example.com")
    register(farmer_b, "owner-b@example.com")
    field_a = add_field(farmer_a)
    field_b = add_field(farmer_b)
    reservoir_a = add_reservoir(
        farmer_a, field_a["id"], available=500_000, capacity=1_000_000
    )

    assert farmer_b.get(
        f"/api/irrigation/reservoirs/{reservoir_a['id']}"
    ).status_code == 404
    assert farmer_b.get(
        f"/api/irrigation/reservoirs?field_id={field_a['id']}"
    ).status_code == 404
    assert farmer_b.patch(
        f"/api/irrigation/reservoirs/{reservoir_a['id']}",
        json={"available_liters": 1},
        headers=csrf(farmer_b),
    ).status_code == 404

    no_source = farmer_b.post(
        "/api/irrigation/plan",
        json=plan_request(field_b["id"]),
        headers=csrf(farmer_b),
    )
    assert no_source.status_code == 409
    assert "configure a water source" in no_source.json()["detail"].lower()
    assert farmer_b.post(
        "/api/irrigation/plan",
        json=plan_request(field_a["id"], reservoir_a["id"]),
        headers=csrf(farmer_b),
    ).status_code == 404
    assert farmer_a.post(
        "/api/irrigation/plan",
        json=plan_request(field_a["id"], reservoir_a["id"]),
        headers={},
    ).status_code == 403


def test_generate_confirm_cancel_and_complete_reservations_are_transactional(
    irrigation_clients, monkeypatch
):
    farmer, _ = irrigation_clients
    register(farmer, "schedule-owner@example.com")
    field = add_field(farmer, growth_stage="Vegetative")
    reservoir = add_reservoir(
        farmer, field["id"], available=500_000, capacity=1_000_000
    )
    freeze_planning_clock(monkeypatch)

    generated = farmer.post(
        "/api/irrigation/plan",
        json=plan_request(field["id"], reservoir["id"]),
        headers=csrf(farmer),
    )
    assert generated.status_code == 200, generated.json()
    body = generated.json()
    assert body["plan"]["action"] == "irrigate"
    assert body["plan"]["rain_mm"] == 0
    assert body["field"]["growth_stage"] == "Vegetative"
    schedule_id = body["schedule"]["id"]
    assert body["schedule"]["status"] == "recommended"
    assert body["reservoir"]["reserved_liters"] == 0
    planned_liters = body["schedule"]["water_liters"]
    assert body["plan"]["sessions"]

    assert farmer.get(
        f"/api/irrigation/schedules/{schedule_id}"
    ).status_code == 200
    assert farmer.get("/api/irrigation/schedules").json()["summary"]["total_reserved_liters"] == 0

    confirmed = farmer.post(
        f"/api/irrigation/schedules/{schedule_id}/confirm",
        headers=csrf(farmer),
    )
    assert confirmed.status_code == 200, confirmed.json()
    assert confirmed.json()["schedule"]["status"] == "confirmed"
    assert confirmed.json()["reservoir"]["reserved_liters"] == planned_liters
    assert confirmed.json()["reservoir"]["remaining_liters"] == pytest.approx(
        reservoir["available_liters"] - planned_liters
    )
    assert farmer.post(
        f"/api/irrigation/schedules/{schedule_id}/confirm",
        headers=csrf(farmer),
    ).status_code == 409
    assert farmer.patch(
        f"/api/irrigation/reservoirs/{reservoir['id']}",
        json={"available_liters": planned_liters - 1},
        headers=csrf(farmer),
    ).status_code == 422

    cancelled = farmer.post(
        f"/api/irrigation/schedules/{schedule_id}/cancel",
        headers=csrf(farmer),
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["schedule"]["status"] == "cancelled"
    assert cancelled.json()["reservoir"]["reserved_liters"] == 0
    assert cancelled.json()["reservoir"]["available_liters"] == reservoir["available_liters"]
    assert farmer.post(
        f"/api/irrigation/schedules/{schedule_id}/complete",
        headers=csrf(farmer),
    ).status_code == 409

    second_plan = farmer.post(
        "/api/irrigation/plan",
        json=plan_request(field["id"], reservoir["id"]),
        headers=csrf(farmer),
    )
    second_id = second_plan.json()["schedule"]["id"]
    assert farmer.post(
        f"/api/irrigation/schedules/{second_id}/confirm",
        headers=csrf(farmer),
    ).status_code == 200
    completed = farmer.post(
        f"/api/irrigation/schedules/{second_id}/complete",
        headers=csrf(farmer),
    )
    assert completed.status_code == 200
    assert completed.json()["schedule"]["status"] == "completed"
    assert completed.json()["reservoir"]["reserved_liters"] == 0
    assert completed.json()["reservoir"]["available_liters"] == pytest.approx(
        reservoir["available_liters"] - planned_liters
    )


def test_insufficient_water_is_reported_without_reservation_and_is_not_confirmable(
    irrigation_clients, monkeypatch
):
    farmer, _ = irrigation_clients
    register(farmer, "low-water@example.com")
    field = add_field(farmer)
    reservoir = add_reservoir(farmer, field["id"], available=1_000)
    freeze_planning_clock(monkeypatch)

    response = farmer.post(
        "/api/irrigation/plan",
        json=plan_request(field["id"], reservoir["id"]),
        headers=csrf(farmer),
    )
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "insufficient_water"
    assert result["plan"]["action"] == "insufficient_water"
    notes = " ".join(result["plan"]["notes"]).lower()
    assert "no irrigation was scheduled" in notes
    assert "min of irrigation could not be scheduled today" not in notes
    assert "no free time slot found" not in notes
    assert result["plan"]["litres"] == 0
    assert result["plan"]["required_liters"] > reservoir["available_liters"]
    assert result["plan"]["water_shortage_liters"] > 0
    assert result["schedule"]["status"] == "insufficient_water"
    assert result["reservoir"]["reserved_liters"] == 0
    assert farmer.post(
        f"/api/irrigation/schedules/{result['schedule']['id']}/confirm",
        headers=csrf(farmer),
    ).status_code == 409


def test_adequate_moisture_and_forecast_rain_do_not_create_irrigation_reservations(
    irrigation_clients, monkeypatch
):
    farmer, _ = irrigation_clients
    register(farmer, "skip-water@example.com")
    field = add_field(farmer)
    reservoir = add_reservoir(farmer, field["id"])
    freeze_planning_clock(monkeypatch)

    adequate = farmer.post(
        "/api/irrigation/plan",
        json=plan_request(field["id"], reservoir["id"], soil_moisture_pct=29),
        headers=csrf(farmer),
    )
    assert adequate.status_code == 200
    assert adequate.json()["plan"]["action"] == "skip_no_need"
    assert adequate.json()["schedule"] is None

    def rainy_forecast(_location, days):
        return [
            DailyForecast(
                date.today() + timedelta(days=index),
                18,
                30,
                rain_mm=40 if index == 1 else 0,
                rain_prob=0.9 if index == 1 else 0,
                et0_mm=4,
            )
            for index in range(days)
        ], []

    monkeypatch.setattr(
        main.irrigation_weather_adapter, "fetch_daily_forecast", rainy_forecast
    )
    rain = farmer.post(
        "/api/irrigation/plan",
        json=plan_request(field["id"], reservoir["id"], soil_moisture_pct=21.15),
        headers=csrf(farmer),
    )
    assert rain.status_code == 200
    assert rain.json()["plan"]["action"] == "deferred_rain"
    assert rain.json()["schedule"] is None
    balances = farmer.get(
        f"/api/irrigation/reservoirs/{reservoir['id']}"
    ).json()
    assert balances["reserved_liters"] == 0


def test_schedule_access_is_owner_scoped_and_missing_inputs_are_rejected(
    irrigation_clients, monkeypatch
):
    farmer_a, farmer_b = irrigation_clients
    register(farmer_a, "schedule-a@example.com")
    register(farmer_b, "schedule-b@example.com")
    field_a = add_field(farmer_a)
    field_b = add_field(farmer_b)
    reservoir_a = add_reservoir(
        farmer_a, field_a["id"], available=500_000, capacity=1_000_000
    )

    missing_moisture = plan_request(field_a["id"], reservoir_a["id"])
    del missing_moisture["soil_moisture_pct"]
    assert farmer_a.post(
        "/api/irrigation/plan",
        json=missing_moisture,
        headers=csrf(farmer_a),
    ).status_code == 422
    assert farmer_a.post(
        "/api/irrigation/plan",
        json=plan_request(field_b["id"], reservoir_a["id"]),
        headers=csrf(farmer_a),
    ).status_code == 404
    freeze_planning_clock(monkeypatch)
    generated = farmer_a.post(
        "/api/irrigation/plan",
        json=plan_request(field_a["id"], reservoir_a["id"]),
        headers=csrf(farmer_a),
    )
    assert generated.status_code == 200
    schedule_id = generated.json()["schedule"]["id"]
    assert farmer_b.get(
        f"/api/irrigation/schedules/{schedule_id}"
    ).status_code == 404
    assert farmer_b.post(
        f"/api/irrigation/schedules/{schedule_id}/confirm",
        headers=csrf(farmer_b),
    ).status_code == 404
    assert farmer_b.post(
        f"/api/irrigation/schedules/{schedule_id}/cancel",
        headers=csrf(farmer_b),
    ).status_code == 404
    assert farmer_a.post(
        f"/api/irrigation/schedules/{schedule_id}/confirm",
        headers=csrf(farmer_a),
    ).status_code == 200
    assert farmer_a.delete(
        f"/api/fields/{field_a['id']}",
        headers=csrf(farmer_a),
    ).status_code == 409
    assert farmer_b.get("/api/irrigation/schedules?field_id=" + str(field_a["id"])).status_code == 404
    assert farmer_b.get("/api/irrigation/schedules/9999").status_code == 404


def test_stale_preview_confirmations_cannot_overreserve_the_same_reservoir(
    irrigation_clients, monkeypatch
):
    farmer, _ = irrigation_clients
    register(farmer, "concurrent-water@example.com")
    field = add_field(farmer)
    reservoir = add_reservoir(
        farmer, field["id"], available=300_000, capacity=400_000
    )
    freeze_planning_clock(monkeypatch)

    first = farmer.post(
        "/api/irrigation/plan",
        json=plan_request(field["id"], reservoir["id"]),
        headers=csrf(farmer),
    ).json()["schedule"]
    second = farmer.post(
        "/api/irrigation/plan",
        json=plan_request(field["id"], reservoir["id"]),
        headers=csrf(farmer),
    ).json()["schedule"]
    assert first["status"] == second["status"] == "recommended"

    assert farmer.post(
        f"/api/irrigation/schedules/{first['id']}/confirm",
        headers=csrf(farmer),
    ).status_code == 200
    second_confirm = farmer.post(
        f"/api/irrigation/schedules/{second['id']}/confirm",
        headers=csrf(farmer),
    )
    assert second_confirm.status_code == 409
    balances = farmer.get(
        f"/api/irrigation/reservoirs/{reservoir['id']}"
    ).json()
    assert balances["reserved_liters"] == pytest.approx(first["water_liters"])
    assert balances["remaining_liters"] >= 0


def test_concurrent_confirmations_reserve_water_only_once(tmp_path, monkeypatch):
    engine = create_engine(
        URL.create(
            "sqlite+pysqlite",
            database=str(tmp_path / "irrigation-concurrent.db"),
        ),
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    with engine.connect() as connection:
        connection.exec_driver_sql("PRAGMA journal_mode=WAL")
    monkeypatch.setattr(main, "engine", engine)
    monkeypatch.setattr(main, "auth_attempts", main.OrderedDict())

    def forecast(_location, days):
        return [
            DailyForecast(
                date.today() + timedelta(days=index),
                18,
                30,
                rain_mm=0,
                rain_prob=0,
                et0_mm=4,
            )
            for index in range(days)
        ], []

    monkeypatch.setattr(main.irrigation_weather_adapter, "fetch_daily_forecast", forecast)
    with TestClient(main.app) as first_client, TestClient(main.app) as second_client:
        register(first_client, "simultaneous-confirm@example.com")
        second_client.cookies.update(first_client.cookies)
        field = add_field(first_client)
        reservoir = add_reservoir(
            first_client, field["id"], available=300_000, capacity=400_000
        )
        freeze_planning_clock(monkeypatch)
        first_schedule = first_client.post(
            "/api/irrigation/plan",
            json=plan_request(field["id"], reservoir["id"]),
            headers=csrf(first_client),
        ).json()["schedule"]
        second_schedule = second_client.post(
            "/api/irrigation/plan",
            json=plan_request(field["id"], reservoir["id"]),
            headers=csrf(second_client),
        ).json()["schedule"]
        schedule_ids = [first_schedule["id"], second_schedule["id"]]

        def confirm(client, schedule_id):
            return client.post(
                f"/api/irrigation/schedules/{schedule_id}/confirm",
                headers=csrf(client),
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(
                lambda values: confirm(*values),
                [
                    (first_client, schedule_ids[0]),
                    (second_client, schedule_ids[1]),
                ],
            ))
        assert sorted(response.status_code for response in responses) == [200, 409]
        with main.Session(engine) as db:
            stored_reservoir = db.get(main.IrrigationReservoir, reservoir["id"])
            assert stored_reservoir is not None
            assert stored_reservoir.reserved_liters <= stored_reservoir.available_liters
            assert stored_reservoir.reserved_liters == pytest.approx(
                next(
                    schedule["water_liters"]
                    for schedule, response in zip(
                        (first_schedule, second_schedule), responses
                    )
                    if response.status_code == 200
                )
            )
    engine.dispose()
def test_manual_schedule_creation_checks_water_and_reserves_only_on_confirmation(
    irrigation_clients,
):
    farmer, _ = irrigation_clients
    register(farmer, "manual-schedule@example.com")

    field = add_field(farmer)
    reservoir = add_reservoir(
        farmer, field["id"], available=5_000, capacity=10_000
    )

    payload = {
        "field_id": field["id"],
        "reservoir_id": reservoir["id"],
        "scheduled_date": (date.today() + timedelta(days=2)).isoformat(),
        "start_time": "08:00",
        "duration_minutes": 30,
        "water_liters": 1_000,
        "irrigation_method": "drip",
    }

    # Manual schedule creation requires CSRF protection.
    no_csrf = farmer.post("/api/irrigation/schedules", json=payload)
    assert no_csrf.status_code == 403

    # Create a valid manual schedule.
    created = farmer.post(
        "/api/irrigation/schedules",
        json=payload,
        headers=csrf(farmer),
    )
    assert created.status_code == 201, created.json()

    schedule = created.json()["schedule"]
    schedule_id = schedule["id"]

    assert schedule["status"] == "recommended"
    assert schedule["water_liters"] == 1_000
    assert schedule["irrigation_method"] == "drip"

    # Creating the schedule must not reserve water.
    assert created.json()["message"]
    schedules = farmer.get("/api/irrigation/schedules").json()
    assert schedules["summary"]["total_reserved_liters"] == 0

    # Reject a manual schedule exceeding available water.
    excessive = {
        **payload,
        "water_liters": 6_000,
    }
    rejected = farmer.post(
        "/api/irrigation/schedules",
        json=excessive,
        headers=csrf(farmer),
    )
    assert rejected.status_code == 409

    # Confirming the valid schedule reserves its water.
    confirmed = farmer.post(
        f"/api/irrigation/schedules/{schedule_id}/confirm",
        headers=csrf(farmer),
    )
    assert confirmed.status_code == 200, confirmed.json()
    assert confirmed.json()["schedule"]["status"] == "confirmed"
    assert confirmed.json()["reservoir"]["reserved_liters"] == 1_000