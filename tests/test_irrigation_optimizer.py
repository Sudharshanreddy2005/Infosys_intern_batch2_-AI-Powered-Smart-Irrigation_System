from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from irrigation_optimizer import config, water_calc, weather_adapter
from irrigation_optimizer.api import router
from irrigation_optimizer.models import DailyForecast, FieldConfig
from irrigation_optimizer.optimizer import optimize_schedule


DAY = date(2026, 10, 31)


def field(
    *,
    field_id="F1",
    crop="wheat",
    stage="mid",
    moisture=0.20,
    method="drip",
    area=1000.0,
    flow=1000.0,
    soil="loam",
    latitude=26.12,
):
    return FieldConfig(
        field_id, crop, stage, area, soil, latitude, method, flow, "P1", moisture
    )


def forecasts(days=2, *, rain=None, rain_prob=None, et0=4.0, temperatures=(18, 30)):
    rain = rain or {}
    rain_prob = rain_prob or {}
    return [
        DailyForecast(
            DAY + timedelta(days=index),
            temperatures[0],
            temperatures[1],
            rain.get(index, 0.0),
            rain_prob.get(index, 1.0),
            et0_mm=et0,
        )
        for index in range(days)
    ]


def request_body(**overrides):
    field_payload = {
        "field_id": "F1",
        "crop": "wheat",
        "growth_stage_code": 2,
        "soil_type_code": 2,
        "soil_moisture_pct": 20,
        "area_m2": 1000,
        "pump_flow_lpm": 1000,
        "irrigation_method": "drip",
        "latitude": 26.12,
    }
    field_payload.update(overrides)
    return {"fields": [field_payload], "days": 1}


def test_low_moisture_independent_water_calculation_and_event_cap():
    f = field(flow=1000)
    plan = optimize_schedule([f], forecasts(days=1))["F1"][0]

    taw, raw = water_calc.soil_water_limits(f)
    initial_depletion = (0.30 - 0.20) * 1000
    etc = 4.0 * 1.15
    projected_depletion = initial_depletion + etc
    expected_gross_for_cap = 60 * f.area_m2 / config.METHOD_EFFICIENCY["drip"]
    actual_net_from_scheduled_liters = (
        plan.litres * config.METHOD_EFFICIENCY["drip"] / f.area_m2
    )

    assert taw == pytest.approx(160)
    assert raw == pytest.approx(88)
    assert plan.action == "irrigate"
    assert plan.etc_mm == pytest.approx(etc)
    assert plan.litres <= expected_gross_for_cap
    assert plan.net_mm == pytest.approx(actual_net_from_scheduled_liters)
    assert plan.net_mm <= config.MAX_IRRIGATION_MM_PER_EVENT
    assert plan.depletion_end_mm == pytest.approx(projected_depletion - plan.net_mm, abs=0.02)
    assert plan.sessions and sum(session.minutes for session in plan.sessions) > 0


def test_adequate_moisture_skips_irrigation_with_no_water_scheduled():
    plan = optimize_schedule([field(moisture=0.29)], forecasts(days=1))["F1"][0]
    assert plan.action == "skip_no_need"
    assert plan.litres == 0
    assert not plan.sessions


def test_heavy_next_day_rain_defers_irrigation_and_records_reason():
    plan = optimize_schedule(
        [field(moisture=0.2115)],
        forecasts(days=2, rain={1: 40}, rain_prob={1: 0.9}),
    )["F1"][0]
    assert plan.action == "deferred_rain"
    assert "rain expected tomorrow" in plan.notes[0]
    assert plan.litres == 0


def test_rain_today_reduces_effective_rain_and_can_prevent_irrigation():
    plan = optimize_schedule(
        [field(moisture=0.2115)],
        forecasts(days=1, rain={0: 40}, rain_prob={0: 0.9}),
    )["F1"][0]
    assert plan.effective_rain_mm == pytest.approx(32)
    assert plan.action == "skip_rain"
    assert plan.litres == 0


def test_high_temperature_increases_hargreaves_demand():
    f = field()
    cool = DailyForecast(DAY, 18, 30)
    hot = DailyForecast(DAY, 18, 38)
    cool_plan = optimize_schedule([f], [cool])["F1"][0]
    hot_plan = optimize_schedule([f], [hot])["F1"][0]
    assert hot_plan.et0_mm > cool_plan.et0_mm
    assert hot_plan.etc_mm > cool_plan.etc_mm


@pytest.mark.parametrize(
    ("method", "efficiency"),
    [("drip", 0.90), ("sprinkler", 0.75), ("surface", 0.60)],
)
def test_method_efficiency_controls_gross_volume(method, efficiency):
    f = field(method=method)
    assert water_calc.gross_litres(10, f) == pytest.approx(10_000 / efficiency)
    assert water_calc.net_mm_from_litres(1000, f) == pytest.approx(efficiency)


@pytest.mark.parametrize(
    ("crop", "stage", "expected_kc"),
    [
        ("wheat", "initial", 0.40),
        ("wheat", "development", 0.775),
        ("wheat", "mid", 1.15),
        ("maize", "initial", 0.40),
        ("maize", "development", 0.80),
        ("maize", "mid", 1.20),
        ("potato", "initial", 0.50),
        ("potato", "development", 0.825),
        ("potato", "mid", 1.15),
    ],
)
def test_crop_and_growth_stage_select_configured_coefficient(crop, stage, expected_kc):
    plan = optimize_schedule(
        [field(crop=crop, stage=stage)],
        forecasts(days=1),
    )["F1"][0]
    assert plan.kc == pytest.approx(expected_kc)
    assert plan.etc_mm == pytest.approx(4 * expected_kc)


def test_schedule_water_is_limited_by_available_pump_window():
    plan = optimize_schedule(
        [field(flow=30, area=20_000)],
        forecasts(days=1),
    )["F1"][0]
    assert sum(session.minutes for session in plan.sessions) <= 330
    assert any("could not be scheduled" in note for note in plan.notes)
    assert plan.litres <= 30 * 330


def test_low_demand_is_not_rounded_up_to_exceed_requested_volume():
    f = field(moisture=0.2115, flow=1000)
    plan = optimize_schedule([f], forecasts(days=1))["F1"][0]
    actual_net = plan.litres * config.METHOD_EFFICIENCY[f.irrigation_method] / f.area_m2
    assert actual_net == pytest.approx(plan.net_mm)
    assert actual_net <= plan.depletion_start_mm + plan.etc_mm - plan.effective_rain_mm


def test_forecast_validation_rejects_invalid_temperature_and_rain():
    start = datetime(2026, 10, 31, tzinfo=timezone.utc)
    hourly = [
        {
            "time": (start + timedelta(hours=index)).isoformat(),
            "temperature_c": 24.0,
            "rainfall_mm_per_hr": 0.0,
            "rain_probability_percent": 20.0,
            "is_stale": False,
            "data_age_minutes": 0,
        }
        for index in range(24)
    ]
    hourly[5]["temperature_c"] = float("nan")
    with pytest.raises(ValueError, match="invalid temperature"):
        weather_adapter.hourly_to_daily(hourly)
    hourly[5]["temperature_c"] = 24.0
    hourly[5]["rainfall_mm_per_hr"] = -1.0
    with pytest.raises(ValueError, match="invalid rainfall"):
        weather_adapter.hourly_to_daily(hourly)


def test_api_requires_measured_moisture_real_latitude_and_supported_method(monkeypatch):
    calls = []
    monkeypatch.setattr(
        weather_adapter,
        "fetch_daily_forecast",
        lambda location, days: (calls.append((location, days)) or forecasts(days=1), []),
    )
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    missing_moisture = request_body()
    del missing_moisture["fields"][0]["soil_moisture_pct"]
    assert client.post("/api/irrigation/plan", json=missing_moisture).status_code == 422
    missing_latitude = request_body()
    del missing_latitude["fields"][0]["latitude"]
    assert client.post("/api/irrigation/plan", json=missing_latitude).status_code == 422
    missing_field_id = request_body()
    del missing_field_id["fields"][0]["field_id"]
    assert client.post("/api/irrigation/plan", json=missing_field_id).status_code == 422
    negative_area = request_body(area_m2=-1)
    assert client.post("/api/irrigation/plan", json=negative_area).status_code == 422
    invalid_method = request_body(irrigation_method="flood")
    assert client.post("/api/irrigation/plan", json=invalid_method).status_code == 422
    assert calls == []


def test_api_rejects_extra_unmodeled_water_capacity_instead_of_ignoring_it():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    body = request_body(available_water_liters=1000)
    response = client.post("/api/irrigation/plan", json=body)
    assert response.status_code == 422


def test_api_returns_unavailable_when_no_complete_forecast_exists(monkeypatch):
    monkeypatch.setattr(weather_adapter, "fetch_daily_forecast", lambda location, days: ([], ["no complete day"]))
    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post("/api/irrigation/plan", json=request_body())
    assert response.status_code == 503
    assert "no complete daily weather forecast" in response.json()["detail"].lower()


def test_api_validates_crop_before_calling_weather_provider(monkeypatch):
    calls = []
    monkeypatch.setattr(weather_adapter, "fetch_daily_forecast", lambda *args: calls.append(args))
    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post(
        "/api/irrigation/plan",
        json=request_body(crop="unknown-crop"),
    )
    assert response.status_code == 422
    assert calls == []


def test_main_irrigation_route_rejects_missing_service_api_key(monkeypatch):
    import main

    monkeypatch.setattr(main, "IRRIGATION_API_KEY", "")

    app = FastAPI()
    from fastapi import Depends

    from main import irrigation_guard

    app.include_router(router, dependencies=[Depends(irrigation_guard)])
    client = TestClient(app)
    assert client.post("/api/irrigation/plan", json=request_body()).status_code == 503


def test_main_irrigation_route_authenticates_and_returns_plan(monkeypatch):
    import main

    class FrozenDateTime:
        @staticmethod
        def now(tz):
            return datetime(2026, 10, 31, 4, 0, tzinfo=tz)

    monkeypatch.setattr(main, "IRRIGATION_API_KEY", "test-irrigation-key")
    monkeypatch.setattr("irrigation_optimizer.api.datetime", FrozenDateTime)
    monkeypatch.setattr(
        weather_adapter,
        "fetch_daily_forecast",
        lambda location, days: (forecasts(days=1), []),
    )
    app = FastAPI()
    from fastapi import Depends

    app.include_router(router, dependencies=[Depends(main.irrigation_guard)])
    client = TestClient(app)
    body = request_body(soil_moisture_pct=5)
    assert client.post("/api/irrigation/plan", json=body).status_code == 401
    response = client.post(
        "/api/irrigation/plan",
        json=body,
        headers={"X-Irrigation-Key": "test-irrigation-key"},
    )
    assert response.status_code == 200
    plan = response.json()["plans"]["F1"][0]
    assert plan["action"] == "irrigate"
    assert plan["net_mm"] <= config.MAX_IRRIGATION_MM_PER_EVENT
