"""
Irrigation Schedule Optimizer

Flow (for every day, for every field):
  1. ET0 -> ETc = ET0 * Kc
  2. Work out effective rainfall
  3. projected depletion = depletion + ETc - effective_rain
  4. projected >= RAW  -> irrigation is needed
       - if tomorrow's rain will remove the need (and the crop is not stressed yet) -> defer
  5. If needed: litres -> pump minutes -> time slots (pump calendar, no overlaps)
  6. Per-event cap (config.MAX_IRRIGATION_MM_PER_EVENT) is applied: target = min(depletion, cap).
  7. Depletion is updated with the water that was actually scheduled. The leftover deficit
     is not blindly added to the next day: the next day re-decides from
     depletion + ETc - rain against RAW.
     (Run it daily with a fresh sensor reading so the carried deficit is reset to reality.)

Complexity: D days, F fields -> O(D * F log F) (urgency sort) + slot allocation
(a small loop over windows/busy intervals for each field).
"""
from dataclasses import asdict
from datetime import date, datetime
from typing import Dict, List, Optional, Union

from . import config, water_calc as wc
from .models import DailyForecast, DayPlan, FieldConfig, Session
from .scheduler import PumpCalendar, allocate_sessions, fmt


def _et0_for(day_fc: DailyForecast, f: FieldConfig) -> float:
    if day_fc.et0_mm is not None:
        return day_fc.et0_mm
    return wc.hargreaves_et0(day_fc.temp_min, day_fc.temp_max, f.latitude, day_fc.date)


def optimize_schedule(
    fields: List[FieldConfig],
    forecast: Union[List[DailyForecast], Dict[str, List[DailyForecast]]],
    now: Optional[datetime] = None,
) -> Dict[str, List[DayPlan]]:
    """
    now: current local time (same timezone as the forecast dates, i.e. IST). When given, irrigation
    slots earlier than `now` on today's date are not used. None = ignore the clock (tests, demos).
    """
    # a single list is used for every field; a dict gives a per-field forecast
    fc_by_field = {
        f.field_id: (forecast[f.field_id] if isinstance(forecast, dict) else forecast)
        for f in fields
    }
    fc_lookup = {fid: {d.date: d for d in lst} for fid, lst in fc_by_field.items()}
    all_days = sorted({d.date for lst in fc_by_field.values() for d in lst})

    state = {}
    plans: Dict[str, List[DayPlan]] = {f.field_id: [] for f in fields}
    start_warn = {}
    for f in fields:
        taw, raw = wc.soil_water_limits(f)
        dep, warn = wc.initial_depletion(f, taw)
        state[f.field_id] = {"dep": dep, "taw": taw, "raw": raw}
        start_warn[f.field_id] = warn

    calendar = PumpCalendar()
    by_id = {f.field_id: f for f in fields}

    for idx, day in enumerate(all_days):
        todays = []   # (urgency, field, plan, projected)
        for f in fields:
            fc = fc_lookup[f.field_id].get(day)
            if fc is None:
                continue
            st = state[f.field_id]
            kc = wc.get_kc(f)
            et0 = _et0_for(fc, f)
            etc = wc.crop_etc(et0, kc)
            rain_eff = wc.effective_rainfall(fc.rain_mm, fc.rain_prob)
            dep0 = st["dep"]
            projected = max(0.0, dep0 + etc - rain_eff)

            plan = DayPlan(
                field_id=f.field_id, date=day, action="skip_no_need",
                et0_mm=round(et0, 2), kc=kc, etc_mm=round(etc, 2),
                rain_mm=fc.rain_mm, effective_rain_mm=round(rain_eff, 2),
                depletion_start_mm=round(dep0, 2), depletion_end_mm=round(projected, 2),
                raw_mm=round(st["raw"], 2), taw_mm=round(st["taw"], 2),
            )
            if not plans[f.field_id]:
                if start_warn[f.field_id]:
                    plan.notes.append(start_warn[f.field_id])
                crop_note = wc.crop_params(f.crop).get("note")
                if crop_note:
                    plan.notes.append(crop_note)

            if projected < st["raw"]:
                if rain_eff > 0 and dep0 + etc >= st["raw"]:
                    plan.action = "skip_rain"
                    plan.notes.append("Rainfall covered the water requirement")
                st["dep"] = projected
                plans[f.field_id].append(plan)
                continue

            # Irrigation was triggered. Will tomorrow's rain cover it?
            nxt = all_days[idx + 1] if idx + 1 < len(all_days) else None
            nfc = fc_lookup[f.field_id].get(nxt) if nxt else None
            if nfc is not None and projected < st["taw"]:
                n_etc = wc.crop_etc(_et0_for(nfc, f), kc)
                n_rain = wc.effective_rainfall(nfc.rain_mm, nfc.rain_prob)
                if projected + n_etc - n_rain < st["raw"]:
                    plan.action = "deferred_rain"
                    plan.notes.append(
                        f"{nfc.rain_mm} mm of rain expected tomorrow and the crop is not stressed yet - skipping today")
                    st["dep"] = projected
                    plans[f.field_id].append(plan)
                    continue

            plan.action = "irrigate"
            todays.append((projected / st["taw"], f, plan, projected))

        # the most urgent field gets the first (best) slots
        todays.sort(key=lambda t: -t[0])
        for _, f, plan, projected in todays:
            st = state[f.field_id]
            cap = f.max_event_mm if f.max_event_mm is not None else config.MAX_IRRIGATION_MM_PER_EVENT
            target_mm = min(projected, cap)          # the smaller of root-zone refill and the per-event cap
            litres_needed = wc.gross_litres(target_mm, f)
            minutes_needed = litres_needed / f.pump_flow_lpm
            not_before = (now.hour * 60 + now.minute) if (now is not None and day == now.date()) else 0
            sess, remaining = allocate_sessions(calendar, f.pump_id, day, minutes_needed, not_before)

            total_min = sum(e - s for s, e in sess)
            litres_done = total_min * f.pump_flow_lpm
            net_done = wc.net_mm_from_litres(litres_done, f)
            plan.sessions = [Session(fmt(s), fmt(e), e - s, round((e - s) * f.pump_flow_lpm, 1))
                             for s, e in sess]
            plan.litres = round(litres_done, 1)
            plan.net_mm = round(min(net_done, target_mm), 2)
            applied = min(net_done, target_mm)       # so that minute round-up cannot exceed the cap
            st["dep"] = max(0.0, projected - applied)
            if projected > cap:
                plan.notes.append(
                    f"Per-event cap of {cap:g} mm applied. The remaining deficit of {projected - applied:.1f} mm "
                    f"will be recalculated tomorrow from the latest soil moisture, rain and weather")
            plan.depletion_end_mm = round(st["dep"], 2)

            if not sess:
                plan.action = "skip_no_need"
                plan.notes.append("WARNING: no free time slot found - the deficit is carried to the next day")
            elif remaining > 0:
                plan.notes.append(
                    f"WARNING: {remaining} min of irrigation could not be scheduled today - carried to the next day")
            plans[f.field_id].append(plan)

    for fid in plans:
        plans[fid].sort(key=lambda p: p.date)
    return plans


def plans_to_dicts(plans: Dict[str, List[DayPlan]]) -> Dict[str, list]:
    """Convert plans to plain dicts for the FastAPI / JSON response."""
    out = {}
    for fid, lst in plans.items():
        rows = []
        for p in lst:
            d = asdict(p)
            d["date"] = p.date.isoformat()
            rows.append(d)
        out[fid] = rows
    return out