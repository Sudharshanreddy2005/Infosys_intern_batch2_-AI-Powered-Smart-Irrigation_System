# JalSaathi Irrigation Optimizer Evaluation

> **Historical baseline report:** This report describes the optimizer before the account-backed reservoir and Irrigation Schedule workflow was integrated. Its statements that ownership, water availability, and the farmer-facing planner are missing are no longer current. See [IRRIGATION_SCHEDULE_FULL_INTEGRATION_REPORT.md](./IRRIGATION_SCHEDULE_FULL_INTEGRATION_REPORT.md) for the current implementation and validation results. The historical findings below are retained as a record of the earlier evaluation.

**Evaluation date:** 2026-10-31  
**Overall status:** PARTIAL  
**Readiness:** Not ready for a farmer-facing demonstration in the JalSaathi account UI, controlled field testing, or production. The calculation module is suitable for a developer-led software demonstration with test inputs; the live protected endpoint needs a server-side `IRRIGATION_API_KEY`, and the account UI is not connected.

## Status summary

| Area | Status | Evidence |
|---|---|---|
| Application and database startup | PASS | Docker backend and PostgreSQL reported healthy; `/health`, `/ready`, `/docs`, and landing page returned HTTP 200. |
| Optimizer calculations and scheduler | PASS | Deterministic unit/API scenarios passed; independent water-volume calculations matched actual scheduled delivery. |
| API input validation | PASS | Missing required data, invalid fields, unsupported methods, and unrecognized capacity fields were exercised. |
| Service authentication | PARTIAL | Wrong key returns 401 and an unconfigured key returns 503; a test-key request with mocked forecast returned 200. The running environment has no irrigation key. |
| Weather-provider operation | PARTIAL | Adapter behavior and malformed forecast handling were tested. A live provider request was not made because the API route is blocked by the missing irrigation service key. |
| Water availability constraint | FAIL | No reservoir/available-water budget exists. `available_water_liters` is rejected with 422 rather than silently ignored. |
| Farmer ownership and database integration | FAIL | The optimizer route accepts caller-supplied field data and does not resolve `field_id` to a logged-in farmer's database field. |
| Farmer-facing planner | PARTIAL | The page now accurately says the optimizer is service-only, but has no field selector, request flow, loading/error handling, or result display. |
| Performance | PARTIAL | Pure in-process scheduling was benchmarked; HTTP, database, and live-weather latency were not. |
| Agronomic accuracy | NOT TESTED | No ground-truth irrigation records or locally validated crop/soil parameters were available for accuracy evaluation. |

## 1. Architecture and data flow

The optimizer is a separate calculation service; it is not currently driven by the farmer's stored field records:

1. `POST /api/irrigation/plan` is mounted by `main.py` behind `irrigation_guard`.
2. The guard checks the `X-Irrigation-Key` header against the server-side `IRRIGATION_API_KEY`.
3. Pydantic request models validate fields and reject undeclared inputs.
4. `data_adapter.make_field` maps crop-stage and soil codes and converts moisture percent to a fraction.
5. `weather_adapter.fetch_daily_forecast` obtains hourly weather and groups complete days in IST.
6. `optimizer.optimize_schedule` estimates crop demand, effective rainfall, depletion, event volumes, and pump sessions.
7. `plans_to_dicts` returns JSON grouped by field ID.

The optimizer does not query the database, farmer/field repositories, sensor history, or irrigation history. `field_id` is an input label, not an ownership check.

## 2. Endpoint and request/response contract

### Optimizer

- `POST /api/irrigation/plan`
- Request top level: `fields` (1–50 entries), optional `days` (1–5, default 4), optional `location`.
- Each field requires: `field_id`, configured crop name, `growth_stage_code` (1–3), `soil_type_code` (1–3), measured `soil_moisture_pct`, positive `area_m2`, positive `pump_flow_lpm`, supported `irrigation_method`, and `latitude`.
- `pump_id` is optional and defaults to `pump-1`.
- Supported methods: `drip`, `sprinkler`, `surface` (surface models the configured surface/flood efficiency). The literal `flood` is not accepted.
- Unknown request fields are rejected. This makes unsupported reservoir-capacity fields explicit instead of silently ignoring them.
- Response shape: `warnings` plus `plans`, a mapping from field ID to daily plan rows. Rows include action/date, ET0, Kc, ETc, rainfall/effective rainfall, depletion/RAW/TAW, delivered net mm, litres, sessions, and notes.

Observed status behavior:

- Invalid or missing required request data: 422.
- Invalid service key: 401.
- No configured service key or no complete forecast: 503.
- Test-key request with a deterministic forecast fixture: 200.

### Application checks

- `/health`: HTTP 200.
- `/ready`: HTTP 200, including database readiness.
- `/docs`: HTTP 200.
- `/api/irrigation/plan`: registered in OpenAPI. A real request without the configured service key returned HTTP 503 before weather retrieval.

## 3. Inputs and missing data

The calculation requires current measured soil moisture; it no longer assumes a default moisture value or latitude. Crop and soil codes are mapped by the adapter. Crop parameters are selected from `irrigation_optimizer/config.py`.

The optimizer uses:

- Crop, mapped growth stage, field area in m², configured soil type, measured soil moisture, latitude, irrigation method, pump flow, pump ID, and weather forecast.
- Forecast daily minimum/maximum temperature and rainfall/probability. The project adapter aggregates hourly values and rejects malformed timestamps, temperatures, rainfall, and rainfall probabilities.
- A provider-supplied ET0 value if present in a `DailyForecast`; the current weather adapter does not produce ET0, so its normal path computes ET0 with Hargreaves–Samani.

The optimizer does **not** currently use humidity, soil temperature, irrigation history, a farmer/account ID, or available reservoir water. Humidity is present in the upstream hourly weather format but is not consumed by the daily calculation. The UI's stored field data do not provide the optimizer's complete sensor/pump input set.

## 4. Calculation formulas and independent validation

Implemented formulas:

- `ETc = ET0 × Kc`.
- `ET0` uses the provider value when supplied; otherwise Hargreaves–Samani uses daily Tmin, Tmax, latitude, and date.
- `TAW = (field_capacity − wilting_point) × root_depth_m × 1000` mm.
- `RAW = MAD × TAW`.
- Initial depletion is `(field_capacity − measured_soil_moisture_fraction) × root_depth_m × 1000`, clamped to `[0, TAW]`.
- Projected depletion is `max(0, depletion + ETc − effective_rainfall)`.
- Rain is effective only when probability is at least 0.50 and amount is at least 3 mm; effective rain is 80% of forecast rain.
- Gross water is `net_mm × area_m2 ÷ method_efficiency` litres, using `1 mm × 1 m² = 1 litre`.
- Pump minutes are gross litres divided by pump flow in L/min.
- The event target is capped at 60 mm net by default (or a field override); scheduled pump sessions are also limited by the pump calendar and configured session/rest rules.

Independent check for the test wheat/loam field (1,000 m², 20% moisture, mid-stage, ET0 4 mm/day, drip at 1,000 L/min):

- `TAW = (0.30 − 0.14) × 1.0 × 1000 = 160 mm`; `RAW = 0.55 × 160 = 88 mm`.
- `ETc = 4 × 1.15 = 4.6 mm`.
- The requested 60 mm event would require `60 × 1000 ÷ 0.90 = 66,666.67 L`.
- The whole-minute scheduler delivers 66 minutes / 66,000 L, which corresponds to `66,000 × 0.90 ÷ 1000 = 59.4 mm`.
- Reported net depth matches the volume actually scheduled and remains below the 60 mm event cap.

These are software/formula checks against configured assumptions, not proof that the configured agronomic values are suitable for a particular farm.

## 5. Scenario results

All scenarios below used deterministic fixtures, not live field measurements.

| Scenario | Expected | Actual |
|---|---|---|
| Low soil moisture, no significant rain, water available | Irrigate, calculate volume and duration, respect cap | `irrigate`; 66,000 L / 66 minutes / 59.4 mm net for the independent sample above. |
| Adequate soil moisture | Avoid unnecessary irrigation | `skip_no_need`; 0 L and no sessions. |
| Low moisture with heavy rain tomorrow | Defer if forecast rain removes the near-term need | `deferred_rain`; explanation is included in notes. |
| 40 mm rain today at 90% probability | Account for effective rain | 32 mm effective rain (`40 × 0.80`); `skip_rain` in the fixture. |
| Hotter/drier demand proxy | Higher temperature should increase Hargreaves ET0/ETc | Test confirmed ET0 and ETc increase from the 30°C to 38°C Tmax fixture. Humidity itself is not used. |
| Limited pump window | Do not exceed available pump-calendar time; report unscheduled work | Sessions remain within the configured windows and the plan notes unscheduled minutes. |
| Different methods | Apply method-specific efficiency | Verified efficiencies: drip 0.90, sprinkler 0.75, surface 0.60; gross-volume formulas differ accordingly. |
| Different crops/stages | Use configured crop/stage coefficients | Wheat, maize, and potato at initial/development/mid stages matched configured Kc values in tests. |
| Missing moisture/latitude/field ID, negative area, unsupported method | Reject rather than invent a plan | 422; invalid field input was rejected before weather-provider invocation. |
| Unknown crop / malformed forecast / no complete daily forecast | Return an explicit error or unavailable status | Unknown crop: 422 before provider call; invalid forecast values rejected; no complete daily forecast: 503. |
| Invalid/missing service API key | Reject request | Wrong key: 401; missing configured key: 503. |
| Caller requests an available-water cap | Enforce cap or clearly reject unsupported input | `available_water_liters` is rejected with 422. No reservoir budget or water-shortage output exists. |

## 6. Defects corrected

- **Per-event overdosing from minute rounding:** The prior ceiling conversion could schedule 67,000 L for a 60 mm net cap, physically delivering 60.3 mm at the configured drip efficiency. Scheduling now floors to whole pump minutes and reports the volume actually delivered. Remainder is explicitly noted rather than rounded up.
- **Silent environmental defaults:** Soil moisture and latitude are now required; unsupported irrigation methods and unknown input fields are rejected. The adapter no longer substitutes a default latitude or accepts absent moisture.
- **Unusable forecasts treated as a successful empty plan:** Invalid forecast entries are validated, and an empty set of complete daily forecasts now returns 503 instead of an empty success response.
- **Provider call before detecting an invalid crop/configuration:** Crop and soil configuration are checked before weather retrieval.
- **Misleading UI availability copy:** The landing and schedule pages now distinguish a protected service API from an unconnected farmer-facing planner.
- **Configuration discoverability:** `.env.example` now documents the optional `IRRIGATION_API_KEY` variable. The existing `.env` was not opened or modified, and no secret values were displayed.

No trained model artifact, dataset, `.env`, or unrelated application feature was modified.

## 7. Security and ownership

- The optimizer router is protected by a server-side service key; wrong-key behavior was tested as 401. The key must not be embedded in browser JavaScript.
- The current deployment has no configured `IRRIGATION_API_KEY`; consequently the real optimizer endpoint returns 503 and does not fetch weather.
- The route does not authenticate a farmer session or check whether a submitted field belongs to that farmer. It accepts caller-supplied field attributes and does not load `FarmerField`. Do not expose this service directly to an untrusted browser or treat its `field_id` as authorization.
- Invalid input is rejected rather than converted to fabricated output. No credentials were printed or added to source.

## 8. Frontend verification

- The public landing page returned HTTP 200 and was inspected in the browser. It now says the optimizer is available only through a protected service API and that the account planner/live sensor stream are not connected.
- The existing schedule page has no field selector, planner form, optimizer request, loading/error state, recommendation quantity/duration, or result explanation. It explicitly avoids displaying fabricated watering times.
- The schedule route redirected to sign-in in the browser because no authenticated user session was available. Authenticated farmer field selection and operations therefore remain **NOT TESTED**. Browser requests to session-only endpoints returned 401, as expected while logged out.
- A JavaScript contract test checks that the current pages accurately describe the service-only state and do not claim to show a recommendation. This is not a functional end-to-end optimizer UI test.

## 9. Performance

Measured 500 calls to `optimize_schedule` in-process with one field and one deterministic forecast:

- Median: 0.0148 ms.
- P95: 0.0183 ms.
- Maximum observed: 0.1060 ms.

This excludes HTTP serialization, database work, and the weather provider. No live endpoint or provider latency/throughput benchmark was performed.

## 10. Tests and runtime evidence

- `python -m pytest -q`: **158 passed**, one Starlette/httpx deprecation warning.
- Optimizer-focused tests: **50 passed** before the final authentication test was added; the final full-suite run includes all optimizer tests.
- All discovered JavaScript contract tests: **65 passed**.
- `python -m py_compile` on changed optimizer modules/tests: passed.
- `node --check static\\sections.js`: passed.
- Task-scoped `git diff --check` with `cr-at-eol` (to respect the existing CRLF landing template): passed.
- `docker compose config -q`: passed.
- `docker compose up -d --build backend`: completed successfully; backend and PostgreSQL were healthy afterward.
- Runtime checks after rebuild: `/health` 200, `/ready` 200, `/docs` 200, landing page 200, optimizer route present in OpenAPI. With no configured service key, a real optimizer request returned 503.
- The account planner could not be visually tested after login because no authenticated browser session was available.

The unscoped `git diff --check` also reports whitespace in pre-existing unrelated staged changes (`.gitignore` and `tests/test_model2_integration.py`); those files were not edited for this evaluation.

## 11. Remaining limitations and actions before field use

1. Configure a strong `IRRIGATION_API_KEY` on the server before expecting the protected endpoint to respond; keep it out of browser code.
2. Design a farmer-authenticated server flow that loads fields from the database, verifies ownership, and supplies verified sensor/pump data without trusting arbitrary client field attributes.
3. Decide and implement the semantics for available water (for example per field per day or per planning horizon) before claiming reservoir-capacity support. The current API explicitly rejects that input.
4. Connect the account planner to a safe server-side integration and implement field selection, loading/errors, units, and explanation display.
5. Add real sensor readings and irrigation-event records if those are required for planning or comparison. No ground-truth irrigation history was available.
6. Validate crop Kc/root-depth/MAD, soil FC/WP, rainfall thresholds, and irrigation efficiencies with a local agronomist. Rice ponding, local soil variation, humidity/soil-temperature effects, and crop-specific local calibration are not modeled.
7. Repeat forecast-provider, signed-in browser, and end-to-end tests with the required configuration and authorized account.

## Final readiness assessment

**PARTIAL — software demonstration only, at developer/API level with a configured server key and controlled inputs.** As currently configured, a real optimizer API request is unavailable (503) and the account UI is disconnected. **Not ready for controlled field testing or production** until ownership, water-supply limits, verified field inputs, live integration, and local agronomic validation are addressed.
