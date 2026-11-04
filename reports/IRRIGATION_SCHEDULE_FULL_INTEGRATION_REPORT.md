# JalSaathi Irrigation Schedule Integration Report

**Validation date:** 2026-10-31  
**Overall status:** PARTIAL  
**Readiness:** Ready for a controlled software demonstration with an authenticated test farmer, saved field inputs, a configured water source, and available forecast data. Not ready for controlled field testing or production. Browser verification with an authenticated user and live weather-provider behavior were not completed.

This report supersedes the earlier account-integration status in [IRRIGATION_OPTIMIZER_EVALUATION_REPORT.md](./IRRIGATION_OPTIMIZER_EVALUATION_REPORT.md). That report remains useful for the optimizer's earlier standalone evaluation.

## Status summary

| Area | Status | Evidence |
|---|---|---|
| Docker backend and PostgreSQL startup | PASS | Rebuilt backend; backend and database report healthy. `/health`, `/ready`, `/docs`, and `/openapi.json` returned HTTP 200. |
| Authenticated reservoir and schedule workflow | PASS | Full Python suite: 166 passed. Focused workflow tests cover create, plan, confirm, cancel, complete, and balances. |
| Owner access and mutation protection | PASS | Unauthenticated requests returned 401; tests cover CSRF rejection and cross-farmer 404 responses. |
| Water budget enforcement | PASS | Tests cover capacity validation, insufficient water, stale recommendations, and concurrent confirmations; only one competing confirmation succeeds. |
| Planner API registration | PASS | OpenAPI includes reservoir, plan, schedule, confirm, cancel, and complete operations. |
| Frontend contract and JavaScript syntax | PASS | 65 JavaScript tests passed; `node --check static\sections.js` passed. |
| Authenticated browser interaction | NOT TESTED | No authenticated browser session was available. |
| Live weather-provider behavior | NOT TESTED | Forecasts were mocked in workflow tests; no live provider call was made. |
| HTTP/database/forecast performance | NOT TESTED | No end-to-end latency benchmark was run for this integration. |
| Agronomic accuracy | NOT TESTED | No field ground truth or local agronomist validation is available. |

## 1. Architecture and data flow

The existing Optimizer calculates a plan; the new account workflow connects that calculation to saved JalSaathi data and tracks water reservations:

1. The Irrigation Schedule UI loads the signed-in farmer's fields, crops, reservoirs, and schedules.
2. The farmer selects a field and reservoir, enters a current soil-moisture measurement and actual soil/equipment details, and requests a plan.
3. The server verifies session and CSRF, confirms the field and reservoir belong to the farmer, resolves crop/area/coordinates from the saved field, and resolves a saved growth stage or requires the farmer to select one.
4. The weather adapter obtains a forecast for the saved coordinates. The optimizer calculates daily crop demand, effective rainfall, soil depletion, irrigation need, water quantity, and pump sessions.
5. If the event fits the unreserved reservoir balance, a `recommended` schedule is saved. Water is not reserved until the farmer confirms it.
6. Confirmation atomically claims the recommendation and reserves water. Cancellation releases a reservation. Completion consumes the reserved amount from both the balance and the available physical quantity.

Reservoir and schedule records are persisted using SQLAlchemy models. The application creates tables during startup with `Base.metadata.create_all`; a separate schema migration framework was not identified.

## 2. API endpoints

All account-facing operations require an authenticated session. Mutations also require the application's CSRF token.

| Method and path | Purpose |
|---|---|
| `GET /api/irrigation/reservoirs` | List the signed-in farmer's water sources; optionally filter by owned field. |
| `POST /api/irrigation/reservoirs` | Create a farmer-owned, optionally field-linked reservoir. |
| `GET /api/irrigation/reservoirs/{reservoir_id}` | Get an owned reservoir and its water balance. |
| `PATCH /api/irrigation/reservoirs/{reservoir_id}` | Update available water without dropping below outstanding reservations. |
| `POST /api/irrigation/plan` | Validate owned field and reservoir, fetch forecast, calculate and persist a recommendation when one is scheduled. |
| `GET /api/irrigation/schedules` | List the farmer's schedules and water summary. |
| `GET /api/irrigation/schedules/{schedule_id}` | Get an owned schedule. |
| `POST /api/irrigation/schedules/{schedule_id}/confirm` | Confirm a recommendation and reserve water. |
| `POST /api/irrigation/schedules/{schedule_id}/cancel` | Cancel an eligible schedule and release reserved water if confirmed. |
| `POST /api/irrigation/schedules/{schedule_id}/complete` | Mark a confirmed schedule completed and consume water. |

The rebuilt container's OpenAPI document listed all these operations. Live unauthenticated GETs to the reservoir and schedule lists returned 401.

## 3. Inputs and outputs

### Planning request

| Input | Requirement and source |
|---|---|
| `field_id` | Required; must identify a field owned by the signed-in farmer. |
| `reservoir_id` | Optional only when exactly one eligible source exists; must be owned by the farmer and either shared or linked to this field. |
| `soil_moisture_pct` | Required measured current soil moisture, 0-100%; not inferred from historical sensor records. |
| `growth_stage_code` | Optional if a supported stage is saved for the field's linked crop; codes 1-3 map to initial, development, and mid-season. |
| `soil_type_code` | Required; 1 sandy, 2 loam, 3 clay. |
| `irrigation_method` | Required literal: `drip`, `sprinkler`, or `surface`. `surface` uses the optimizer's surface/flood efficiency; literal `flood` is not accepted. |
| `pump_flow_lpm` | Required positive pump flow. No saved pump specification is assumed. |
| `days` | Optional, 1-5; default 2. |
| Crop and area | Loaded from the owned saved field or its linked crop; not accepted as caller-supplied plan overrides. |
| Coordinates | Required on the saved field for forecast lookup. |
| Zone and current telemetry | Not persisted/available; UI labels these as not recorded and requests a measured moisture value. |

Unknown request fields are rejected. Unsupported crops/stages, absent crop/stage/coordinates, invalid measurements, and inaccessible field/source data do not produce fabricated recommendations.

### Response

The plan response includes:

- `field`: saved field ID/name, crop, area and units, converted square metres, saved stage, and zone (`null` because not recorded).
- `warnings`: provider/forecast warnings.
- `weather`: selected forecast date, minimum/maximum temperature, forecast rain, and rain probability; null if no selected forecast is available.
- `plan`: action, date, ET0/Kc/ETc, rainfall and effective rainfall, depletion/RAW/TAW, delivered net depth, litres, sessions, explanation notes, required litres, shortage litres, free water, and reservoir ID.
- `schedule`: saved schedule details and lifecycle status, or null when no irrigation event was scheduled.
- `reservoir`: capacity, physical available quantity, reserved quantity, and remaining unreserved quantity.
- `status`: recommendation action or `insufficient_water`.

Schedule lifecycle statuses are `recommended`, `insufficient_water`, `confirmed`, `cancelled`, and `completed`. Insufficient-water schedules cannot be confirmed.

## 4. Calculation and reservation rules

The integration uses the existing optimizer configuration and water calculation functions; it does not change trained models or optimizer parameters.

- Crop evapotranspiration: `ETc_mm = ET0_mm * Kc`; a supplied forecast ET0 is used, otherwise the existing Hargreaves-Samani calculation uses temperature range and latitude.
- Effective rainfall is zero when rain probability is below 0.50 or forecast amount is below 3 mm; otherwise it is `rain_mm * 0.80`.
- Total available root-zone water: `TAW_mm = (field_capacity - wilting_point) * root_depth_m * 1000`.
- Readings initialize depletion from `(field_capacity - measured_moisture_fraction) * root_depth_m * 1000`, clamped to 0..TAW. Irrigation is triggered when projected depletion reaches the crop's configured readily available water (RAW).
- Projected depletion: `max(0, starting_depletion + ETc - effective_rainfall)`. If tomorrow's forecast brings projected depletion below RAW and the crop is not already beyond TAW, the optimizer may defer irrigation.
- Gross water for a target net depth: `net_mm * area_m2 / efficiency`. One millimetre over one square metre equals one litre.
- Existing method efficiencies: drip 0.90, sprinkler 0.75, surface 0.60. The event target is capped by the configured maximum net depth (60 mm unless field configuration overrides it).
- Pump time is allocated in the existing allowed windows without overlapping sessions. Whole-minute scheduling rounds down rather than exceeding the target; delivered litres equal scheduled minutes times pump flow.
- Available unreserved water: `max(0, available_liters - reserved_liters)`. A plan that exceeds this balance becomes `insufficient_water`; no irrigation sessions are returned and no water is reserved.
- Confirmation conditionally updates both schedule and reservoir in one transaction. Competing confirmations cannot reserve the same water twice. Cancellation releases only the reservation. Completion subtracts the used volume from reserved and physical available quantities.

Crop coefficients, root depths, soil values, efficiencies, and schedule windows are approximate configuration values. These calculations are software behavior, not evidence of agronomic accuracy.

## 5. Executed scenarios and actual results

The test fixtures used deterministic forecasts, so these results verify application behavior under those inputs, not the live weather provider.

| Scenario | Expected | Actual |
|---|---|---|
| Low measured moisture, no forecast rain, sufficient water | Irrigation event and pump session are recommended; no water is reserved until confirmation. | PASS: plan action `irrigate`, session present, saved `recommended` schedule, reservation initially zero; confirm reserves the schedule volume. |
| Adequate soil moisture | No unnecessary watering or reservation. | PASS: `skip_no_need`, no saved schedule. |
| Low moisture with significant next-day rain | Defer if the forecast removes the need before stress. | PASS: mocked 40 mm / 90% forecast results in `deferred_rain`, no schedule or reservation. |
| Limited available water | Do not exceed free water; report shortage and prevent confirmation. | PASS: `insufficient_water`, positive shortage, zero delivered litres/reserved balance, confirmation returns 409. |
| Invalid/missing moisture | Reject rather than invent a reading. | PASS: missing moisture returns 422. |
| Unowned field, reservoir, or schedule | Do not expose or mutate another farmer's data. | PASS: cross-owner access returns 404; session and CSRF requirements are tested. |
| Stale and concurrent confirmation attempts | Never reserve more than available quantity. | PASS: stale second confirmation returns 409; file-backed SQLite/WAL concurrent test produces one 200 and one 409, with a balance no greater than available water. |
| Drip/sprinkler/surface differences and hot/dry scenario | Preserve configured efficiencies and calculate demand from the existing optimizer. | Optimizer configuration defines distinct efficiencies; the new account-workflow integration tests do not independently exercise each method or a hot/dry request end to end. |

## 6. Security and reliability

- Session-authenticated farmer identity is used for field, reservoir, and schedule queries.
- Mutations require CSRF validation.
- Resources belonging to another farmer are returned as 404, avoiding cross-tenant disclosure.
- SQL-level conditional updates protect reservoir balances and schedule state transitions.
- Validation uses strict request schemas, finite numeric fields, and bounded enums/ranges.
- Tests cover missing water sources, capacity violations, insufficient water, inaccessible resources, schedule deletion protection, stale state, and concurrent reservations.
- `/health`, `/ready`, `/docs`, and `/openapi.json` returned HTTP 200 on the rebuilt container. Backend and PostgreSQL were healthy.
- Weather failure is surfaced as 503; no recommendation is returned without a usable forecast.

## 7. Frontend verification

The existing JalSaathi `Irrigation Schedule` section now has account-backed field and reservoir selectors, saved field/crop/stage details, reservoir create/update controls, measured soil moisture and actual equipment inputs, plan submission, weather/recommendation display, schedule actions, loading/error feedback, and refreshed water summaries.

The UI labels unavailable zone/stage/coordinates instead of replacing them with fake telemetry. It displays water in litres and duration in minutes, and supports confirm/cancel/complete actions. JavaScript contract tests assert these controls and API connections; JavaScript syntax validation passed. Visual/browser interaction with an authenticated account was not tested.

## 8. Test and runtime evidence

- `python -m pytest -q`: **166 passed**, one Starlette/httpx deprecation warning.
- `node --test` over all `tests_js\*.test.cjs`: **65 passed**, 0 failed.
- `node --check static\sections.js`: passed.
- `python -m py_compile main.py models.py irrigation_optimizer\schemas.py irrigation_optimizer\workflow.py tests\test_irrigation_schedule.py`: passed.
- `docker compose up -d --build backend`: backend image rebuilt and backend recreated; PostgreSQL remained healthy.
- Live checks: `/health` 200, `/ready` 200, `/docs` 200, `/openapi.json` 200; unauthenticated reservoir and schedule list requests 401.
- Authenticated API workflows were exercised using isolated in-memory/file-backed SQLite databases and mocked deterministic forecasts, not against production farmer data.

## 9. Remaining limitations and readiness

- No authenticated browser session was available for visual/manual UI verification.
- Live weather-provider configuration and latency were not tested.
- Reservoir water quantities, pump flow, soil type, irrigation method, and current soil moisture depend on accurate farmer input.
- Historical sensor data is not live telemetry; no zone or live moisture feed is present.
- No local agronomic validation or ground-truth comparison was available. In particular, configured crop/soil coefficients and the rice ponding limitation require expert review before field use.
- Tables are created at startup; production deployment should add a reviewed migration strategy before schema evolution.
- No end-to-end HTTP/database/weather performance benchmark was performed.

**Final assessment: PARTIAL — ready for a controlled software demonstration under the stated setup conditions; not ready for controlled field testing or production.** This is a software correctness assessment, not a claim of scientific prediction accuracy or water-saving efficacy.
