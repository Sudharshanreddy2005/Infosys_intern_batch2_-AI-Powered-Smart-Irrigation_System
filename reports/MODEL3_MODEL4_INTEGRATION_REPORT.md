# Model 3 and Model 4 Integration Report

Validation date: 2026-10-31

## Status summary

| Model | Backend | Frontend | Status |
|---|---|---|---|
| Model 3 future soil moisture | Authenticated endpoint and direct compatibility route | Field Predictions page with explicit inputs | COMPLETE |
| Model 4 crop stress risk | Authenticated endpoint and direct compatibility route | Field Predictions page with explicit inputs | PARTIAL |

Model 4 is **PARTIAL** because the artifact's numeric class meanings are not verified by the available training evidence. The UI therefore shows the numeric class and model-estimated probability, but never guesses or displays Low/Moderate/High Stress. See [MODEL4_COMPLETE_INTEGRATION_REPORT.md](./MODEL4_COMPLETE_INTEGRATION_REPORT.md) for the final artifact and training audit.

## Files inspected

- [main.py](../main.py)
- [model3/model3_config.json](../model3/model3_config.json)
- `model3/zone4_ridge.joblib`
- [model4/evaluation_metrics.json](../model4/evaluation_metrics.json)
- [model4/inference.py](../model4/inference.py)
- `model4/model4_crop_stress.joblib`
- [static/sections.html](../static/sections.html)
- [static/sections.js](../static/sections.js)
- [static/app.js](../static/app.js)
- [templates/index.html](../templates/index.html)
- Existing model tests and [END_TO_END_MODEL_INTEGRATION_REPORT.md](./END_TO_END_MODEL_INTEGRATION_REPORT.md)

## Files created or modified

- Modified [main.py](../main.py):
  - Added authenticated `/api/ml/soil-moisture-prediction`.
  - Added authenticated `/api/ml/crop-stress-prediction`.
  - Added field ownership checks.
  - Added Model 3 prediction horizon and bounded derived future moisture.
  - Added Model 4 confidence and explicit unverified-label status.
  - Preserved existing `/api/models/model3/predict` and `/api/models/model4/predict` routes.
- Modified [static/sections.html](../static/sections.html) and [static/sections.js](../static/sections.js):
  - Added the Field Predictions navigation item and page.
  - Added explicit Model 3 and Model 4 input forms.
- Created [static/model-predictions.js](../static/model-predictions.js):
  - Loads account fields.
  - Sends real form values through the existing authenticated API helper.
  - Renders actual responses, loading/error behavior, and unverified Model 4 semantics.
- Created [tests/test_model34_api.py](../tests/test_model34_api.py).
- Created this report.

No model artifact or `.env` file was modified.

## Model 3

### Artifact and strategy

- Artifact: `model3/zone4_ridge.joblib`
- Configuration: `model3/model3_config.json`
- Zone 4 uses the fitted Ridge change model with 13 features.
- Zones 1, 2, 3, and 5 retain persistence behavior.
- Horizon: 24 hours.
- Output is bounded to the configured `[1, 100]` percent range.

### Endpoint

`POST /api/ml/soil-moisture-prediction`

Requires the existing authenticated session and CSRF protection. The request includes `field_id`, `zone`, `current_moisture_percent`, and the 13 zone-4 features when `zone` is 4. Missing zone-4 features return HTTP 422. Missing or unauthorized fields are rejected.

Response includes:

- `field_id`
- `zone`
- `current_moisture_percent`
- `predicted_moisture_24h_percent`
- `prediction_horizon_hours`
- `strategy`
- `prediction_status`
- `prediction_timestamp`

The existing direct route `/api/models/model3/predict` remains available for compatibility.

### Frontend

The new **Field Predictions** page requires explicit observed values. It does not substitute weather, soil, or sensor defaults. Zone 1/2/3/5 use persistence; Zone 4 requires all model inputs. Results display the current moisture, predicted 24-hour moisture, strategy, and any caution warning.

## Model 4

### Artifact and schema

- Artifact: `model4/model4_crop_stress.joblib`
- Size: approximately 559 MB
- Actual fitted feature count: 20
- Preprocessing: fitted numeric/categorical preprocessing pipeline in the artifact
- Probability support: available through `predict_proba`

### Endpoint

`POST /api/ml/crop-stress-prediction`

Requires the existing authenticated session and CSRF protection. The request includes `field_id`, `crop_type`, `zone`, and all 20 model features. The field is checked against the authenticated account.

Response includes:

- `field_id`
- `crop_type`
- `zone`
- `predicted_class`
- `confidence`, when supported
- `class_probabilities`, when supported
- `class_label_status: "unverified"`
- `prediction_status`
- `prediction_timestamp`

The numeric class is returned without a guessed label. The available evaluation metadata explicitly states `target_label_meanings_verified: false`. Missing artifact errors remain HTTP 503. The cached loader prevents loading the 559 MB artifact on every request. Verified artifact SHA256: `72dc2b6369ead784a959c75275f048a7dae28096fdfe0ee2b08648763ef8a177`.

The existing direct route `/api/models/model4/predict` remains available, but now also avoids exposing a guessed stress label.

### Frontend

The Field Predictions page collects the actual 20 feature values and displays the returned numeric class and confidence. It explicitly explains why no Low/Moderate/High label is shown.

## Tests and verification

Executed:

- `python -m py_compile main.py`
- `node --check static/model-predictions.js`
- `node --check static/sections.js`
- Focused Python tests: **34 passed, 1 warning**
- Full Python suite: **132 passed, 1 warning**
- JavaScript suite: **passed**
- Health smoke test: `/health` returned HTTP 200
- Unauthenticated new endpoints: returned HTTP 401

The new direct API tests verify:

- Model 3 returns a finite, bounded 24-hour moisture value.
- Model 3 rejects missing Zone 4 features.
- Model 4 returns a valid numeric class, confidence, and unverified-label status.
- New authenticated routes reject unauthenticated requests.

## Remaining limitations

1. The repository has no live sensor ingestion path for these prediction inputs. The page correctly requires explicit values rather than inventing telemetry.
2. Model 3 has no repository evaluation report containing MAE, RMSE, R², or a persistence comparison.
3. Model 4 class semantics remain unverified; numeric classes must not be presented as Low, Moderate, or High Stress.
4. Live weather values are not automatically assembled into all 13 Model 3 inputs.
5. Docker image/container startup was not rerun for this frontend/backend-only change.

## Deployment and test commands

```powershell
cd C:\Users\sudha\OneDrive\Desktop\irrigation-feature
python -m pytest -q
node --test tests_js/*.test.cjs
uvicorn main:app --reload
```

Open `/static/sections.html?view=predictions` after signing in. Use only observed, contract-valid inputs. Do not expose or commit `.env` or the Model 4 artifact.
