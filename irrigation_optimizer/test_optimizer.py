"""Run: python -m irrigation_optimizer.test_optimizer  (from the project root)"""
from datetime import date, datetime, timedelta

from .models import FieldConfig, DailyForecast
from .optimizer import optimize_schedule
from . import water_calc as wc

D0 = date(2026, 10, 22)


def make_field(fid="F1", **kw):
    base = dict(field_id=fid, crop="wheat", growth_stage="mid", area_m2=1000,
                soil_type="loam", latitude=26.12, irrigation_method="drip",
                pump_flow_lpm=50, pump_id="P1", soil_moisture=0.20)
    base.update(kw)
    return FieldConfig(**base)


def fc(days, rain=None, prob=None, et0=4.0):
    rain = rain or {}
    prob = prob or {}
    return [DailyForecast(D0 + timedelta(days=i), 18, 30, rain.get(i, 0.0),
                          prob.get(i, 1.0), et0_mm=et0) for i in range(days)]


def test_hargreaves_sane():
    et0 = wc.hargreaves_et0(18, 30, 26.12, date(2026, 10, 21))
    assert 2.5 < et0 < 5.0, et0


def test_dry_field_irrigates_with_correct_numbers():
    # loam, wheat: TAW=160, RAW=88. moisture 0.20 -> dep=(0.30-0.20)*1000=100 >= RAW
    p = optimize_schedule([make_field()], fc(1))["F1"][0]
    assert p.action == "irrigate"
    # projected = 100 + 4*1.15 = 104.6 mm ; drip eff 0.9 -> 104.6*1000/0.9 L
    assert abs(p.etc_mm - 4.6) < 0.01
    assert p.litres > 0 and p.sessions


def test_wet_field_skips():
    p = optimize_schedule([make_field(soil_moisture=0.29)], fc(1))["F1"][0]
    assert p.action == "skip_no_need" and not p.sessions


def test_small_rain_ignored():
    f = make_field(soil_moisture=0.20)
    p = optimize_schedule([f], fc(1, rain={0: 2.0}))["F1"][0]
    assert p.effective_rain_mm == 0.0


def test_low_probability_rain_ignored():
    p = optimize_schedule([make_field()], fc(1, rain={0: 10}, prob={0: 0.2}))["F1"][0]
    assert p.effective_rain_mm == 0.0


def test_big_rain_tomorrow_defers():
    # depletion just above RAW and 40 mm of rain tomorrow -> defer today
    f = make_field(soil_moisture=0.2115)   # dep ~ 88.5 mm, RAW 88
    plans = optimize_schedule([f], fc(2, rain={1: 40}))["F1"]
    assert plans[0].action == "deferred_rain", plans[0].action


def test_big_rain_today_skips():
    f = make_field(soil_moisture=0.2115)
    p = optimize_schedule([f], fc(1, rain={0: 40}))["F1"][0]
    assert p.action == "skip_rain"


def test_two_fields_same_pump_no_overlap():
    a, b = make_field("A"), make_field("B", area_m2=800)
    plans = optimize_schedule([a, b], fc(1))
    iv = []
    for fid in plans:
        for s in plans[fid][0].sessions:
            iv.append((s.start, s.end))
    iv.sort()
    for (s1, e1), (s2, e2) in zip(iv, iv[1:]):
        assert e1 <= s2, (iv)


def test_overflow_carries_to_next_day():
    # very large field with a small pump -> cannot be scheduled in one day
    f = make_field(area_m2=20000, pump_flow_lpm=30)
    plans = optimize_schedule([f], fc(2))["F1"]
    assert any("carried" in n for n in plans[0].notes)
    assert plans[0].depletion_end_mm > 0


def test_per_event_cap_and_recalculated_carry():
    # depletion = 100 mm, RAW = 88. Cap 60 mm -> 60 mm today, ~44.6 mm left (100 + 4.6 - 60)
    p = optimize_schedule([make_field(pump_flow_lpm=2000)], fc(2))["F1"]
    d1, d2 = p[0], p[1]
    assert d1.action == "irrigate" and abs(d1.net_mm - 60) < 0.01, d1.net_mm
    assert abs(d1.depletion_end_mm - 44.6) < 0.1, d1.depletion_end_mm
    assert any("cap" in n.lower() for n in d1.notes)
    # next day 44.6 + 4.6 = 49.2 < RAW 88 -> re-decided from scratch, so no irrigation
    assert d2.action == "skip_no_need" and d2.depletion_start_mm == d1.depletion_end_mm


def test_rain_reduces_carried_deficit():
    p = optimize_schedule([make_field(pump_flow_lpm=2000)], fc(2, rain={1: 30}))["F1"]
    assert p[1].effective_rain_mm == 24.0
    assert p[1].depletion_end_mm < p[0].depletion_end_mm


def test_per_field_cap_override():
    p = optimize_schedule([make_field(pump_flow_lpm=2000, max_event_mm=30)], fc(1))["F1"][0]
    assert abs(p.net_mm - 30) < 0.01


def test_development_stage_kc_is_between_initial_and_mid():
    from . import config
    f = make_field(growth_stage="development")
    c = config.CROPS["wheat"]["kc"]
    assert c["initial"] < wc.get_kc(f) < c["mid"]


def test_slots_that_already_passed_today_are_not_used():
    now = datetime(D0.year, D0.month, D0.day, 10, 0)        # 10:00 -> morning window is over
    p = optimize_schedule([make_field(pump_flow_lpm=2000)], fc(1), now=now)["F1"][0]
    assert p.action == "irrigate" and p.sessions
    assert all(s.start >= "17:00" for s in p.sessions), [s.start for s in p.sessions]
    # without `now` the morning window is still used
    q = optimize_schedule([make_field(pump_flow_lpm=2000)], fc(1))["F1"][0]
    assert q.sessions[0].start == "05:00"


def test_now_only_affects_today():
    now = datetime(D0.year, D0.month, D0.day, 10, 0)
    plans = optimize_schedule([make_field(soil_moisture=0.10, pump_flow_lpm=2000, max_event_mm=30)],
                              fc(3, et0=9.0), now=now)["F1"]
    later = [p for p in plans[1:] if p.sessions]
    assert later and later[0].sessions[0].start == "05:00"      # tomorrow can use the morning window


if __name__ == "__main__":
    ok = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn(); ok += 1; print("PASS", name)
    print(f"\n{ok} tests passed")