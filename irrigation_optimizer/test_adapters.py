"""Run: python -m irrigation_optimizer.test_adapters"""
from datetime import datetime, timedelta, timezone

from . import weather_adapter as wa
from .data_adapter import make_field, moisture_pct_to_fraction
from .optimizer import optimize_schedule


def fake_hourly(start_utc, hours, rain_at=None, prob=80, stale=False):
    rain_at = rain_at or {}
    out = []
    for i in range(hours):
        t = start_utc + timedelta(hours=i)
        hr = (t.hour + 5.5) % 24
        out.append({
            "time": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "temperature_c": 20 + 8 * (1 if 10 <= hr <= 16 else 0) - (3 if hr < 6 else 0),
            "humidity_percent": 60,
            "rainfall_mm_per_hr": rain_at.get(i, 0.0),
            "rain_probability_percent": prob,
            "is_stale": stale, "data_age_minutes": 5.0,
        })
    return out


def test_hourly_to_daily_groups_by_ist_and_drops_partial_days():
    # 2026-10-21 10:00 UTC = 15:30 IST -> the first day has only ~8.5 hours -> skipped
    hourly = fake_hourly(datetime(2026, 10, 21, 10, tzinfo=timezone.utc), 24 * 3)
    daily, warns = wa.hourly_to_daily(hourly)
    assert daily[0].date.isoformat() == "2026-10-22", daily[0].date
    assert any("skip" in w for w in warns)
    assert daily[0].temp_max > daily[0].temp_min


def test_rain_sum_and_probability():
    start = datetime(2026, 10, 21, 18, 30, tzinfo=timezone.utc)   # = 2026-10-22 00:00 IST
    hourly = fake_hourly(start, 24, rain_at={3: 4.0, 4: 6.0}, prob=70)
    daily, _ = wa.hourly_to_daily(hourly)
    assert len(daily) == 1 and daily[0].date.isoformat() == "2026-10-22"
    assert daily[0].rain_mm == 10.0 and abs(daily[0].rain_prob - 0.7) < 1e-9


def test_stale_warning_and_none_values_safe():
    start = datetime(2026, 10, 21, 18, 30, tzinfo=timezone.utc)
    hourly = fake_hourly(start, 24, stale=True)
    hourly[5]["rainfall_mm_per_hr"] = None
    hourly[6]["temperature_c"] = None
    daily, warns = wa.hourly_to_daily(hourly)
    assert daily and any("stale" in w for w in warns)


def test_make_field_converts_percent():
    f = make_field("F1", "Rice ", 2, 2, 20.0, 1000, 600, "sprinkler")
    assert f.crop == "rice" and f.growth_stage == "development" and f.soil_type == "loam" and abs(f.soil_moisture - 0.20) < 1e-9
    assert moisture_pct_to_fraction(100) == 1.0


def test_leader_code_mapping():
    a = make_field("A", "wheat", 1, 1, 20, 1000, 600, "sprinkler")
    b = make_field("B", "wheat", 3, 3, 20, 1000, 600, "sprinkler")
    assert (a.growth_stage, a.soil_type) == ("initial", "sandy")
    assert (b.growth_stage, b.soil_type) == ("mid", "clay")


def test_unknown_crop_gives_clear_error():
    f = make_field("F1", "mango", 2, 2, 20.0, 1000, 600, "sprinkler")
    start = datetime(2026, 10, 21, 18, 30, tzinfo=timezone.utc)
    daily, _ = wa.hourly_to_daily(fake_hourly(start, 48))
    try:
        optimize_schedule([f], daily)
        assert False, "an error was expected"
    except ValueError as e:
        assert "mango" in str(e)


def test_end_to_end_hourly_to_plan():
    f = make_field("F1", "wheat", 2, 2, 20.5, 1000, 600, "sprinkler")
    start = datetime(2026, 10, 21, 18, 30, tzinfo=timezone.utc)
    daily, _ = wa.hourly_to_daily(fake_hourly(start, 24 * 4, rain_at={30: 12.0}))
    plans = optimize_schedule([f], daily)["F1"]
    assert len(plans) == 4 and plans[0].action in {"irrigate", "deferred_rain", "skip_no_need", "skip_rain"}


def test_fetch_daily_forecast_respects_provider_hour_limit():
    import sys, types
    calls = {}
    start = datetime(2026, 10, 21, 18, 30, tzinfo=timezone.utc)

    def fake_get_forecast(location=None, hours=24, **kw):
        calls["location"], calls["hours"] = location, hours
        return fake_hourly(start, hours)

    pkg = types.ModuleType("weather_api")
    sub = types.ModuleType("weather_api.integrations")
    leaf = types.ModuleType("weather_api.integrations.weather_api")
    leaf.get_forecast = fake_get_forecast
    saved = {k: sys.modules.get(k) for k in
             ("weather_api", "weather_api.integrations", "weather_api.integrations.weather_api")}
    sys.modules.update({"weather_api": pkg, "weather_api.integrations": sub,
                        "weather_api.integrations.weather_api": leaf})
    try:
        daily, warns = wa.fetch_daily_forecast("26.12,85.39", days=5)   # 6*24=144 > 120
    finally:
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
    assert calls["hours"] == 120 and calls["location"] == "26.12,85.39"
    assert len(daily) == 5 and not any("complete day" in w for w in warns)


def test_fetch_warns_when_fewer_days_than_requested():
    import sys, types
    start = datetime(2026, 10, 21, 18, 30, tzinfo=timezone.utc)   # 00:00 IST
    leaf = types.ModuleType("weather_api.integrations.weather_api")
    # provider returns less data than requested (only 60 hours)
    leaf.get_forecast = lambda location=None, hours=24, **kw: fake_hourly(start, 60)
    mods = {"weather_api": types.ModuleType("weather_api"),
            "weather_api.integrations": types.ModuleType("weather_api.integrations"),
            "weather_api.integrations.weather_api": leaf}
    saved = {k: sys.modules.get(k) for k in mods}
    sys.modules.update(mods)
    try:
        daily, warns = wa.fetch_daily_forecast(days=5)
    finally:
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
    assert len(daily) < 5 and any("complete day" in w for w in warns)


def test_api_endpoint(monkeypatch=None):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from . import api
    start = datetime(2026, 10, 21, 18, 30, tzinfo=timezone.utc)
    daily, w = wa.hourly_to_daily(fake_hourly(start, 24 * 3))
    orig = wa.fetch_daily_forecast
    wa.fetch_daily_forecast = lambda loc, days: (daily[:days], w)
    try:
        app = FastAPI(); app.include_router(api.router)
        c = TestClient(app)
        body = {"fields": [{"field_id": "F1", "crop": "wheat", "growth_stage_code": 2,
                            "soil_type_code": 2, "soil_moisture_pct": 20.5,
                            "area_m2": 1000, "pump_flow_lpm": 600}], "days": 3}
        r = c.post("/api/irrigation/plan", json=body)
        assert r.status_code == 200 and len(r.json()["plans"]["F1"]) == 3, r.text
        body["fields"][0]["crop"] = "mango"
        assert c.post("/api/irrigation/plan", json=body).status_code == 422

        def weather_down(loc, days):
            raise RuntimeError("provider rejected the key sk-secret-123")
        wa.fetch_daily_forecast = weather_down
        body["fields"][0]["crop"] = "wheat"
        r = c.post("/api/irrigation/plan", json=body)
        assert r.status_code == 503 and "secret" not in r.text     # no internal details leaked
    finally:
        wa.fetch_daily_forecast = orig


if __name__ == "__main__":
    n = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn(); n += 1; print("PASS", name)
    print(f"\n{n} adapter tests passed")