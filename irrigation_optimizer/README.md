# Irrigation Schedule Optimizer (Milestone 2)

Turns a weather forecast and a field's soil moisture into a **day-by-day irrigation plan**:
whether to irrigate, how much water to apply, and at which pump time slots.

It follows a hybrid approach:

- **Daily crop water use** is estimated from the weather and the crop's growth stage (ET0 x Kc).
- A **soil-moisture threshold** decides *when* irrigation should start.
- Before water is applied, the optimizer accounts for **rainfall**, the **remaining soil-moisture
  deficit**, the **root-zone capacity** and a **maximum irrigation limit per event**.

This avoids both unnecessary irrigation and excessive water application.

## How it works

For every day, for every field:

1. **ET0** (reference evapotranspiration) is calculated from the forecast temperatures and the
   field's latitude using the Hargreaves method. If the forecast already contains ET0, that value
   is used instead.
2. **ETc = ET0 x Kc** is the crop's water use for the day. Kc depends on the crop and growth stage.
3. **Effective rainfall** is worked out from the forecast (see [Rainfall rules](#rainfall-rules)).
4. **Projected depletion** = `depletion + ETc - effective rain` (never below 0).
5. **Trigger:** irrigate when the projected depletion reaches **RAW** (the amount of water the crop can
   lose without stress).
   - *Deferral:* if the crop is not stressed yet and tomorrow's rain will bring the depletion back
     below RAW, irrigation is skipped today.
6. **Per-event cap:** the water to apply is `min(projected depletion, cap)`. The default cap is 60 mm.
7. **Volume and time:** `litres = mm x area / system efficiency` (1 mm over 1 m2 = 1 litre), then
   `minutes = litres / pump flow`.
8. **Time slots** are allocated on the pump calendar (see [Scheduling rules](#scheduling-rules)).
9. **Carry-forward:** the leftover deficit is not blindly added to the next day. Tomorrow's decision is
   recalculated from `depletion + ETc - rain` against RAW. Calling the API every day with the latest
   sensor reading resets the carried deficit to reality.

Key formulas:

```
ET0 = 0.0023 x (Tmean + 17.8) x sqrt(Tmax - Tmin) x Ra       (Hargreaves)
ETc = ET0 x Kc
TAW = (field capacity - wilting point) x root depth           (mm)
RAW = MAD x TAW                                               (mm)
depletion = (field capacity - soil moisture) x root depth     (mm)
```

### Example

Wheat, vegetative stage, loam soil, 1000 m2, sprinkler, 600 L/min pump, soil moisture 20.5 %:

| Value | Result |
|---|---|
| Starting depletion | (0.30 - 0.205) x 1000 = 95 mm |
| TAW / RAW | 160 mm / 88 mm |
| ET0 / Kc / ETc | 3.39 mm / 0.775 / 2.63 mm |
| Projected depletion | 95 + 2.63 = 97.6 mm, above RAW, so **irrigate** |
| Applied (cap) | 60 mm = 80,400 L (sprinkler efficiency 0.75) |
| Pump time | 134 min: 05:00-06:30 and 07:00-07:44 |
| Depletion afterwards | ~37.6 mm, below RAW, so no irrigation the next day |

## Rainfall rules

- Rain with a probability below **50 %** is ignored.
- Rain lighter than **3 mm** is ignored (it does not reach the root zone).
- Otherwise, **80 %** of the forecast rain counts as effective rainfall.
- Rain beyond what the soil can hold is treated as lost (depletion never goes below 0).

## Scheduling rules

- Irrigation windows: **05:00-08:00** and **17:00-19:30**.
- A session lasts at most **90 min**, with a **30 min** rest between sessions of the same field.
  Fragments shorter than 10 min are not scheduled.
- Fields that share a pump (`pump_id`) never overlap. The most urgent field (highest
  depletion / TAW) gets the first slots.
- Slots that have already passed today are skipped (the API uses the current IST time).
- If the water cannot be scheduled in one day, the remainder stays in the depletion and is handled the
  next day, and a warning is added to the plan.

## API

`POST /api/irrigation/plan`

Requires a signed-in farmer and is rate-limited like the other weather endpoints.

Request:

```json
{
  "fields": [
    {
      "field_id": "FIELD_001",
      "crop": "wheat",
      "growth_stage_code": 2,
      "soil_type_code": 2,
      "soil_moisture_pct": 20.5,
      "area_m2": 1000,
      "pump_flow_lpm": 600,
      "irrigation_method": "sprinkler"
    }
  ],
  "days": 4
}
```

| Field | Meaning |
|---|---|
| `crop` | One of the [supported crops](#supported-crops) |
| `growth_stage_code` | 1 = Seedling, 2 = Vegetative, 3 = Flowering/Fruiting |
| `soil_type_code` | 1 = Sandy, 2 = Loamy, 3 = Clay |
| `soil_moisture_pct` | Latest sensor reading, 0-100 %. If missing, the soil is assumed to be at field capacity and a note is added |
| `area_m2`, `pump_flow_lpm` | Field area and the measured pump flow |
| `irrigation_method` | `drip` (efficiency 0.90), `sprinkler` (0.75, default) or `surface` (0.60) |
| `pump_id` | Optional. Fields with the same id share one pump calendar |
| `days` | 1-5, default 4 (see [Weather integration](#weather-integration)) |
| `location` | Optional `"lat,lon"`. Default comes from the weather configuration |

Response (one day of one field, shortened):

```json
{
  "warnings": [],
  "plans": {
    "FIELD_001": [
      {
        "date": "2026-10-30",
        "action": "irrigate",
        "et0_mm": 3.39,
        "kc": 0.775,
        "etc_mm": 2.63,
        "effective_rain_mm": 0.0,
        "depletion_start_mm": 95.0,
        "depletion_end_mm": 37.63,
        "raw_mm": 88.0,
        "taw_mm": 160.0,
        "net_mm": 60.0,
        "litres": 80400,
        "sessions": [
          {"start": "05:00", "end": "06:30", "minutes": 90, "litres": 54000},
          {"start": "07:00", "end": "07:44", "minutes": 44, "litres": 26400}
        ],
        "notes": ["Per-event cap of 60 mm applied. The remaining deficit of 37.6 mm will be recalculated tomorrow ..."]
      }
    ]
  }
}
```

`action` is one of:

| Action | Meaning |
|---|---|
| `irrigate` | Water is applied, see `sessions` |
| `skip_no_need` | Depletion is below RAW |
| `skip_rain` | Rain covered the requirement |
| `deferred_rain` | Needed, but tomorrow's rain is expected to cover it |

Status codes: `401` not signed in, `422` invalid input (unknown crop, soil or method, values out of
range), `429` rate limit reached, `503` weather data unavailable.

## Weather integration

The team weather module returns an **hourly** forecast. `weather_adapter.py` converts it to daily values:

- Days are counted in **IST**, not UTC.
- `temp_min` / `temp_max` come from the hourly temperatures, `rain_mm` is the sum of the hourly rainfall,
  and `rain_prob` is the highest probability among the rainy hours.
- A day with fewer than 12 hours of data (the partial first day) is skipped, with a warning.
- The provider allows at most 120 hours, so about 4 complete days are available.
- A warning is added if the weather data is stale.

## Supported crops

16 crops are configured in `config.py` (crop coefficient per stage, root depth and allowed depletion):

- **From the team dataset (13):** banana, blackgram, chickpea, cotton, kidneybeans, lentil, maize,
  mothbeans, mungbean, muskmelon, pigeonpeas, rice, watermelon
- **Additional (3):** wheat, potato, sugarcane

Dataset crops that are **not** configured yet: jute, mango, grapes, apple, orange, papaya, pomegranate,
coconut and coffee. The API returns a clear `422` error for them.

The *Vegetative* stage uses the midpoint of the initial and mid Kc values. A "late" (ripening) stage
exists in the config but is not part of the dataset codes.

## Project layout

| File | Purpose |
|---|---|
| `config.py` | All tunable values: crops, soils, efficiencies, rain rules, time windows, the 60 mm cap |
| `models.py` | Data structures: `FieldConfig`, `DailyForecast`, `DayPlan`, `Session` |
| `water_calc.py` | ET0, ETc, effective rainfall, soil water limits, litres and minutes |
| `scheduler.py` | Pump calendar and time-slot allocation |
| `optimizer.py` | The day-by-day loop, `optimize_schedule()` |
| `weather_adapter.py` | Hourly forecast to daily forecast, fetch from the weather module |
| `data_adapter.py` | Dataset and sensor codes/units to `FieldConfig` |
| `api.py` | FastAPI router |
| `demo.py` | Example run with two fields sharing one pump |
| `test_optimizer.py`, `test_adapters.py` | 15 + 10 tests |

## Running it

From the project root:

```
python -m irrigation_optimizer.demo
python -m irrigation_optimizer.test_optimizer
python -m irrigation_optimizer.test_adapters
```

Using it from Python:

```python
from irrigation_optimizer import optimize_schedule
from irrigation_optimizer.data_adapter import make_field
from irrigation_optimizer.weather_adapter import fetch_daily_forecast

field = make_field("FIELD_001", "wheat", 2, 2, 20.5, 1000, 600, "sprinkler")
forecast, warnings = fetch_daily_forecast(days=4)
plans = optimize_schedule([field], forecast)
```

The router is registered in `main.py` and protected with the same login and rate limiting as the weather
endpoints. The package is also copied in the `Dockerfile`.

## Assumptions and limitations

- **The crop and soil values and the 60 mm per-event cap are approximate** (FAO-56 and textbook values)
  and still need validation per crop and soil type.
- The dataset is synthetic, so the plans have not been validated on a real farm.
- The optimizer is rule-based. The Model 2 water-amount prediction is not used as an input yet, and the
  optimizer keeps its own soil-water balance because the model does not predict the field's actual water level.
- The latest soil moisture is passed in the request. It is not yet read automatically from the sensor database.
- Plans are not stored, and one weather location is used per request.
- Rice is treated like a non-flooded crop. Ponded paddy irrigation is not modelled.
- Pump flow must be measured on the real pump, otherwise the pump minutes will be wrong.