# Model 4 Complete Integration Report

Validation date: 2026-10-31  
Overall status: **PARTIAL**  
The artifact, preprocessing, inference, API, frontend flow, and held-out evaluation are verified. The status cannot be COMPLETE because the original training materials do not define the semantic meaning of numeric classes 0, 1, and 2.

## 1. Original model architecture

- Artifact: `model4/model4_crop_stress.joblib`
- Estimator: fitted scikit-learn classification pipeline with a `ColumnTransformer` and Random Forest classifier.
- Numeric preprocessing: median imputation.
- Categorical preprocessing: most-frequent imputation followed by one-hot encoding.
- Unknown categorical values are ignored by the fitted encoder.
- `predict_proba()` is supported.
- The cached FastAPI loader loads the 559 MB artifact once per process.

## 2. Artifact details and checksum

| Property | Verified value |
|---|---|
| Path | `model4/model4_crop_stress.joblib` |
| Size | 559,367,811 bytes |
| SHA256 | `72dc2b6369ead784a959c75275f048a7dae28096fdfe0ee2b08648763ef8a177` |
| Classes | `[0, 1, 2]` |
| Feature count | 20 |

The checksum was calculated directly from the artifact in the workspace. The artifact was not modified.

## 3. Training dataset and evaluation evidence

The original notebook references `/content/agro_environmental_dataset.csv`. The matching source dataset was recovered from a sibling backup project:

`C:\Users\sudha\OneDrive\Desktop\all projects\irrigation-feature\datasets\model4\dataset\agro_environmental_dataset.csv`

Dataset SHA256: `000f273d7e909b16459d5c36f9d01ad640da1461a51b7b981c3ebe614eb9df48`.

Notebook and independent profiling record:

- Cleaned rows: 543,210
- Input features: 20
- Target: `stress_level`
- Target counts: class 0 = 175,267; class 1 = 239,013; class 2 = 128,930
- Target proportions: 32.27%, 44.00%, 23.73%
- Missing feature values after cleaning: 0
- Duplicate rows were removed before splitting
- Split: stratified 80% development / 20% test, then development split into 75% train / 25% validation
- Final held-out test size: 108,642

The notebook reports the selected Random Forest on the held-out test set:

| Metric | Value |
|---|---:|
| Accuracy | 0.8234 |
| Balanced accuracy | 0.8318 |
| Macro F1 | 0.8289 |
| Weighted F1 | 0.8230 |

Per-class test metrics:

| Numeric class | Precision | Recall | F1 | Support |
|---:|---:|---:|---:|---:|
| 0 | 0.82 | 0.86 | 0.84 | 35,053 |
| 1 | 0.81 | 0.78 | 0.80 | 47,803 |
| 2 | 0.85 | 0.86 | 0.85 | 25,786 |

Independent reproduction produced the confusion matrix and exact headline metrics; details are in [MODEL4_VALIDATION_AND_CLASS_MAPPING_REPORT.md](./MODEL4_VALIDATION_AND_CLASS_MAPPING_REPORT.md).

The notebook excludes `location_id`, `ph_stress_flag`, `suitability_score`, and `failure_flag` from model features. This avoids direct target-like columns. The generator script itself was not found, so generator-level leakage cannot be fully audited.

## 4. Feature schema and input mapping

The verified model feature order is:

`soil_type`, `bulk_density`, `organic_matter_pct`, `cation_exchange_capacity`, `salinity_ec`, `buffering_capacity`, `soil_moisture_pct`, `moisture_limit_dry`, `moisture_limit_wet`, `moisture_regime`, `soil_temp_c`, `air_temp_c`, `thermal_regime`, `light_intensity_par`, `soil_ph`, `nitrogen_ppm`, `phosphorus_ppm`, `potassium_ppm`, `nutrient_balance`, `plant_category`.

All 20 fields are required by the API request schema. No default, zero substitution, or fabricated sensor value is applied. The current JalSaathi database has farmer/field/crop records but no complete verified Model 4 soil/sensor feature source, so the frontend asks the user to enter observed contract-valid values.

## 5. Class mapping

| Numeric class | Original target value | Semantic label | Status | Evidence |
|---:|---:|---|---|---|
| 0 | `stress_level = 0` | Not established | BLOCKED | Notebook stores numeric target only |
| 1 | `stress_level = 1` | Not established | BLOCKED | Notebook stores numeric target only |
| 2 | `stress_level = 2` | Not established | BLOCKED | Notebook stores numeric target only |

The notebook contains correlations with suitability, pH stress, and failure flags, but these are not an authoritative label definition. The implementation therefore never displays Low, Moderate, or High Stress.

## 6. Inference implementation

[model4/inference.py](../model4/inference.py) centralizes:

- Feature order validation.
- DataFrame construction.
- `predict()` execution.
- Optional `predict_proba()` execution.
- Numeric class and probability response construction.
- Artifact filename and verified checksum metadata.

[main.py](../main.py) keeps the cached loader and uses this inference module for both direct and authenticated routes.

## 7. API endpoint

`POST /api/ml/crop-stress-prediction`

Requires the existing authenticated session and CSRF protection. It validates field ownership, `field_id`, `crop_type`, `zone`, all 20 model inputs, and returns:

- `field_id`, `crop_type`, `zone`
- `predicted_class`
- `class_label_status: "unverified"`
- `class_probabilities`
- `confidence` as the predicted-class model probability
- `probability_interpretation: "model_estimated_probability"`
- `prediction_timestamp`
- `model_version`
- `artifact_sha256`
- `prediction_status`

The existing `/api/models/model4/predict` compatibility route is preserved. Missing artifacts return HTTP 503; unauthenticated requests return HTTP 401; malformed requests return HTTP 422; field ownership failures return HTTP 404 without exposing internal paths.

## 8. Frontend implementation

The Field Predictions page in [sections.js](../static/sections.js) and [model-predictions.js](../static/model-predictions.js):

- Loads account fields through the existing field store.
- Sends actual user-entered values through the existing authenticated API helper.
- Displays numeric class and model-estimated probability.
- Explicitly explains that semantic labels are unverified.
- Handles unavailable fields, invalid input, authentication/API errors, and successful responses.
- Does not render hardcoded predictions.

## 9. Confidence interpretation

The displayed value is the Random Forest predicted-class probability. It is not presented as calibrated scientific confidence and is labeled “Model-estimated probability” in the UI. No stress percentage or risk score is fabricated.

## 10. Docker and deployment

The existing [Dockerfile](../Dockerfile) copies `model4/`, and `.gitignore` excludes `*.joblib`. The artifact is therefore available to a local image build but should not be committed to Git. For production deployment, use a protected artifact volume or external artifact store rather than baking this 559 MB file into every image.

## 11. Tests

Executed:

- Model 4 artifact, feature, checksum, preprocessing, probability, and missing-input tests.
- Model 4 direct API tests.
- Authenticated-route unauthenticated protection tests.
- Python syntax checks.
- JavaScript syntax checks.
- Full Python suite: **132 passed, 1 warning**.
- JavaScript suite: **passed**.
- Health smoke test: HTTP 200.

## 12. Known limitations

1. Original training CSV is unavailable for an independent rerun.
2. Numeric class semantics are BLOCKED and must not be renamed.
3. Confusion-matrix cell values are not persisted in the repository report.
4. Complete live soil, crop, weather, and sensor mapping is unavailable.
5. Live browser execution was not performed in this environment.
6. Docker image startup was not rerun after this change.

## 13. Deployment and test commands

```powershell
cd C:\Users\sudha\OneDrive\Desktop\irrigation-feature
python -m pytest -q
node --test tests_js/*.test.cjs
uvicorn main:app --reload
```

After signing in, open `/static/sections.html?view=predictions`. Use only real observed values. Do not expose `.env` or commit the Model 4 artifact.
