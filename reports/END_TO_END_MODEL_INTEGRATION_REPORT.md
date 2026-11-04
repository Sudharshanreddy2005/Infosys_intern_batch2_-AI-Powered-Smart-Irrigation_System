# End-to-End Model Integration Audit

Validation date: 2026-10-31  
Test inputs were synthetic but satisfied each artifact's actual feature contract. No API keys, credentials, or `.env` values were printed or changed.

## 1. Project architecture

- FastAPI application: [main.py](../main.py)
- ORM/database models: [models.py](../models.py)
- Request schemas: [schemas.py](../schemas.py)
- Weather integration: `weather_api/integrations/`
- Frontend: `templates/` and `static/`
- Model 1 inference: [model1/inference.py](../model1/inference.py)
- Model 2 artifact/config: `model2/`
- Model 3 artifact/config: `model3/`
- Model 4 artifact/evaluation: `model4/`
- Optimizer: `irrigation_optimizer/`

The attached architecture flow is accurate for the direct FastAPI model endpoints. The deployed JalSaathi UI currently exposes only the Model 1 experimental dashboard flow and fail-closed Model 2 UI; it does not expose Model 3 or Model 4 controls.

## 2. Model artifact verification

| Component | Artifact | Size | Loaded |
|---|---|---:|---|
| Model 1 full | `model1/artifacts/random_forest_without_soil_moisture_tuned_candidate_v3.joblib` | 9,753,128 bytes | Yes |
| Model 1 reduced | `model1/artifacts/reduced_weather_proxy_v1.joblib` | 40,806,175 bytes | Yes |
| Model 2 | `model2/model2_water_requirement.joblib` | 483,778 bytes | Yes |
| Model 3 | `model3/zone4_ridge.joblib` | 2,265 bytes | Yes |
| Model 4 | `model4/model4_crop_stress.joblib` | 559,367,811 bytes | Yes |

Model 4 uses a fitted `ColumnTransformer`, numeric median imputation, categorical most-frequent imputation, one-hot encoding, and a random forest classifier. Its actual fitted feature list contains 20 fields and classes `[0, 1, 2]`.

## 3. Model 1 integration

**Status: PARTIAL**

The full Model 1 artifact expects 15 features. The reduced artifact expects `temperature_c` and `humidity_percent`. The embedded pipelines perform the preprocessing.

Executed direct predictions:

- Full sample: prediction `0`, positive probability `0.3057142857`.
- Reduced weather sample: prediction `1`, positive probability `0.5670238095`.

Backend flows:

- Dashboard field recommendation: `POST /api/ml/reduced-weather-prediction`.
- Experimental lab: `POST /api/ml/experimental-prediction`.
- Direct routes: `/api/models/model1/full/predict` and `/api/models/model1/weather/predict`.

Frontend flow:

`static/model1-recommendation.js` calls the reduced-weather endpoint and renders the actual returned class and probability. `static/experimental-model.js` calls the experimental endpoint and renders the actual response.

The model is explicitly a synthetic `irrigation_needed_proxy`, not a validated agronomic recommendation. The UI correctly labels it experimental.

## 4. Model 2 integration

**Status: PARTIAL**

The artifact feature order matches `model2/model2_config.json` exactly:

`crop_type`, `growth_stage`, `soil_type`, `soil_moisture_percent`, `temperature_c`, `humidity_percent`, `rainfall_mm`, `forecast_rainfall_mm`, `field_area_acres`, `irrigation_method`, `wind_speed`, `et0_mm_day`, `crop_coefficient_kc`, `previous_irrigation_mm`.

Executed direct prediction:

```text
43351.6587659212 liters
```

Metrics recorded in the configuration are MAE `5994.12` liters, RMSE `8588.09` liters, and R² `0.9492`, all on synthetic data.

Backend:

- Direct route `/api/models/model2/predict` returns the actual artifact output with `unit: "liters"`.
- `/api/ml/water-requirement` intentionally fails closed because the validated production bundle and trusted field-level inputs are unavailable.

Frontend:

`static/water-requirement.js` calls `/api/ml/water-requirement`, not the direct Model 2 route. It therefore displays “Unavailable” under the current fail-closed contract and does not display the direct synthetic estimate as a validated field estimate.

## 5. Model 3 integration

**Status: PARTIAL**

The zone 4 artifact expects 13 features and the order matches `model3/model3_config.json`. The configuration identifies a 24-hour target. Zones 1, 2, 3, and 5 use persistence; zone 3 carries a caution warning.

Executed zone 4 prediction:

```text
raw predicted change: -1.6211469522775046 percentage points
current moisture sample: 30%
derived sample future moisture: 28.3788530477%
```

Backend route `/api/models/model3/predict` returns the raw change and current moisture. It does not return a bounded `predicted_moisture_24h_percent` for zone 4.

No Model 3 MAE, RMSE, R², or persistence-baseline evaluation report was found. Production superiority over persistence is therefore **not verified**.

No frontend Model 3 request, result renderer, or soil-moisture prediction component was found. Dashboard soil moisture is explicitly rendered as “Not connected”.

## 6. Model 4 integration

**Status: PARTIAL**

The original artifact exists at `model4/model4_crop_stress.joblib`. Its actual feature order is:

`soil_type`, `bulk_density`, `organic_matter_pct`, `cation_exchange_capacity`, `salinity_ec`, `buffering_capacity`, `soil_moisture_pct`, `moisture_limit_dry`, `moisture_limit_wet`, `moisture_regime`, `soil_temp_c`, `air_temp_c`, `thermal_regime`, `light_intensity_par`, `soil_ph`, `nitrogen_ppm`, `phosphorus_ppm`, `potassium_ppm`, `nutrient_balance`, `plant_category`.

Executed prediction:

- Class: `0`
- Probabilities: `[0.9678593578, 0.0321406422, 0.0]`
- Confidence: `0.9678593578`

The API returns the numeric class and confidence without mapping it to Low, Moderate, or High Stress. `model4/evaluation_metrics.json` explicitly says `target_label_meanings_verified: false`; the semantic mapping is not independently proven by the training evidence.

Backend route `/api/models/model4/predict` returns the actual class, probabilities, confidence, and an explicit unverified-label status. Missing artifact handling returns HTTP 503. Unknown categorical values are accepted by the fitted encoder because `handle_unknown=ignore`.

No frontend Model 4 request or renderer was found.

## 7. Weather API integration

| Weather feature | API source | Backend field | Model consumer | Frontend display |
|---|---|---|---|---|
| Temperature | Tomorrow.io normalized current/forecast response | `temperature_c` | Model 1 reduced; Model 2 direct contract; Model 3 zone 4 input contract | Yes |
| Humidity | Tomorrow.io normalized response | `humidity_percent` | Model 1 reduced; Model 2 direct contract; Model 3 zone 4 input contract | Yes |
| Rainfall | Tomorrow.io normalized response | `rainfall_mm_per_hr` / forecast precipitation fields | Model 2 direct contract; Model 3 zone 4 input contract | Yes |
| Wind speed | Tomorrow.io normalized response | `wind_speed_mps` | Model 2 direct contract; Model 3 zone 4 input contract | Yes |
| Pressure | Provider-normalized forecast/current data where available | backend weather payload | Model 3 zone 4 contract, but no verified live field mapping into the model endpoint | Not prominently displayed |
| Solar radiation | Not confirmed in the normalized frontend weather flow | no verified application field | Model 3 zone 4 contract, but no verified live mapping | No |

Weather keys are loaded through environment configuration. Missing provider configuration produces an explicit unavailable response. Existing JavaScript weather tests passed, including retry, cache, stale-data, and error behavior.

## 8. Backend API verification

Executed with FastAPI `TestClient`:

| Route | Valid request | Invalid request |
|---|---:|---:|
| Model 1 full | HTTP 200 | HTTP 422 |
| Model 1 reduced weather | HTTP 200 with test key | HTTP 422/401 as applicable |
| Model 2 direct | HTTP 200 | HTTP 422 |
| Model 3 zone 4 | HTTP 200 | HTTP 422 with missing-feature list |
| Model 4 | HTTP 200 | HTTP 422 |
| Model 4 missing artifact simulation | HTTP 503 | N/A |

The direct Model 2 result was stable across five repeated predictions. Model 3 output was finite and the derived sample future moisture remained within `[1, 100]`.

## 9. Frontend integration verification

- Model 1 reduced-weather result: connected and rendered from actual response.
- Model 1 experimental lab result: connected and rendered from actual response.
- Model 2 UI: connected to the fail-closed validated endpoint, so it displays unavailable rather than the unverified direct synthetic estimate.
- Model 3 UI: not connected; dashboard shows “Not connected”.
- Model 4 UI: not connected; no frontend route/component was found.
- Weather UI: connected to current and forecast routes and displays normalized returned values.
- Authenticated requests use the shared `JalSaathiProfile.apiRequest` helper where required.

No hardcoded prediction was found in the active Model 1 renderers. Static translated/demo strings include irrigation examples such as fixed `32%`, `18%`, and `12%` text; these are presentation/demo copy and should not be represented as live sensor or prediction results. The active dashboard labels unavailable sensor/model values explicitly.

## 10. End-to-end test results

| Flow | Result |
|---|---|
| Model 1 input → backend → artifact → JSON → dashboard renderer | PASS |
| Model 1 experimental input → backend → artifact → JSON → experimental UI | PASS |
| Model 2 direct API input → artifact → liters JSON | PASS |
| Model 2 dashboard input → validated endpoint → UI | PARTIAL; intentionally unavailable without approved production bundle |
| Model 3 API input → artifact → raw change JSON → frontend | PARTIAL; frontend missing |
| Model 4 API input → artifact → class/probabilities JSON → frontend | PARTIAL; frontend missing |
| Weather provider/configuration → backend → frontend | PASS for configured/mocked/error-tested flow; live provider not verified without credentials |

## 11. Prediction accuracy

- Model 1: no independent accuracy metrics were available for the synthetic proxy artifact; it must not be treated as an agronomic model.
- Model 2: MAE `5994.12`, RMSE `8588.09`, R² `0.9492`, synthetic data only.
- Model 3: no MAE/RMSE/R² or persistence baseline metrics found.
- Model 4: accuracy `0.8234108356`, balanced accuracy `0.8317921347`, macro F1 `0.8289380023`, weighted F1 `0.8229799495`; target label meanings unverified.

API success is not treated as evidence of predictive accuracy.

## 12. Hardcoded and mock data findings

- No trained artifact was replaced or mocked.
- Model 1 UI uses actual backend responses.
- Dashboard sensor moisture remains “Not connected”.
- Static i18n/demo copy contains example irrigation messages and percentages; these are not wired to live data.
- Weather cached display values are clearly subject to stale/cache status handling.

## 13. Missing integrations

1. No Model 3 frontend input/result flow.
2. No Model 4 frontend input/result flow.
3. Model 2 validated field-level flow remains unavailable by design.
4. No verified live solar-radiation mapping into Model 3.
5. No Model 3 evaluation report or persistence comparison.
6. Model 4 class semantic meanings are not verified by training evidence.
7. Live weather-provider execution was not performed without exposing credentials.

## 14. Errors and required fixes

- The Model 4 backend loader was corrected to use `model4/model4_crop_stress.joblib`; Docker now includes `model4/`.
- No safe frontend expansion was applied during this audit because adding Model 3/4 forms requires product decisions about trusted sensor inputs and display semantics.
- Do not enable Model 2’s validated UI with the direct synthetic artifact unless its provenance and endpoint contract are intentionally changed and documented.

## 15. Final recommendations

1. Keep Model 1 labeled experimental and proxy-only.
2. Keep Model 2’s validated UI fail-closed until independently verified labels and prediction-time field inputs exist.
3. Add a Model 3 evaluation artifact with MAE/RMSE/R² against persistence before exposing recommendations.
4. Verify Model 4 label semantics from authoritative training documentation before presenting Low/Moderate/High as facts.
5. Add explicit frontend flows for Models 3 and 4 only after their input sources and output contracts are approved.
6. Keep live weather tests separate from mocked/provider-unavailable tests and run them only with user-supplied credentials.

## Direct answers

1. **Are all four trained models correctly loaded?** Yes, all four artifacts loaded successfully.
2. **Are all four connected to FastAPI?** Yes, direct backend routes exist and were executed; Model 2 also has a separate validated fail-closed route.
3. **Are all four connected to the frontend?** No. Model 1 is connected; Model 2 is connected to the fail-closed validated flow; Models 3 and 4 are not connected.
4. **Are actual predictions displayed in the UI?** Model 1 actual predictions are displayed. Model 2 displays unavailable under the validated contract. Models 3 and 4 are not displayed.
5. **Is weather connected to the backend?** Yes, with configured/mocked/error-tested flows. A live provider call was not performed.
6. **Are weather values passed to correct models?** Model 1 reduced weather is verified. Model 2 and Model 3 contracts accept weather fields, but complete live field-source mapping is not verified.
7. **Are frontend values hardcoded?** Static example/demo copy exists, but active Model 1 prediction values are response-driven and unavailable states are labeled.
8. **Which models have acceptable accuracy?** Model 2 and Model 4 have reported test metrics, but Model 2 uses synthetic data and Model 4 label semantics are unverified. Model 1 and Model 3 are not established as production-accurate.
9. **Which integrations are incomplete?** Model 3 frontend, Model 4 frontend, validated Model 2 field prediction, Model 3 evaluation, and live solar-radiation mapping.
10. **Ready for final demonstration?** Ready for an honest integration demonstration of Model 1, direct backend Models 2–4, and weather error/configuration handling. Not ready to claim a complete four-model production UI or validated agronomic recommendations.
