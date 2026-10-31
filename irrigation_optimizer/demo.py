"""Run: python -m irrigation_optimizer.demo"""
from datetime import date, timedelta

from .models import FieldConfig, DailyForecast
from .optimizer import optimize_schedule

fields = [
    FieldConfig("wheat-north", "wheat", "mid", 1000, "loam", 26.12, "sprinkler", 600, "P1", 0.205),
    FieldConfig("maize-east", "maize", "mid", 500, "silt_loam", 26.12, "sprinkler", 600, "P1", 0.20),
]
d0 = date(2026, 10, 22)
rain = {2: 18.0, 3: 2.0}
forecast = [DailyForecast(d0 + timedelta(days=i), 18, 30, rain.get(i, 0.0), 0.9 if i == 2 else 1.0)
            for i in range(5)]

plans = optimize_schedule(fields, forecast)
for fid, lst in plans.items():
    print(f"\n=== {fid} ===")
    print(f"{'date':<11}{'action':<14}{'ETc':>5}{'rain_eff':>9}{'dep_start':>10}{'dep_end':>8}{'litres':>9}  sessions")
    for p in lst:
        s = ", ".join(f"{x.start}-{x.end}" for x in p.sessions) or "-"
        print(f"{p.date!s:<11}{p.action:<14}{p.etc_mm:>5}{p.effective_rain_mm:>9}"
              f"{p.depletion_start_mm:>10}{p.depletion_end_mm:>8}{p.litres:>9}  {s}")
        for n in p.notes:
            print(f"           -> {n}")
            