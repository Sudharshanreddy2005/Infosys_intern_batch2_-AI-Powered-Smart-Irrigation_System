# All Models Test Report

Validation date: 2026-10-31  
Test inputs: synthetic, contract-valid samples only; they are not field measurements.

## Summary

| Model | Artifact | Direct prediction | FastAPI integration | Evaluation evidence | Status |
|---|---|---:|---:|---|---|
| Model 1 | `model1/artifacts/random_forest_without_soil_moisture_tuned_candidate_v3.joblib` (9,753,128 bytes) | PASS | PASS | Experimental synthetic proxy; no validated agronomic metrics in artifact | PARTIAL |
| Model 2 | `model2/model2_water_requirement.joblib` (483,778 bytes) | PASS | PASS | MAE 5,994.12 L, RMSE 8,588.09 L, R² 0.9492; synthetic data | PARTIAL |
| Model 3 | `model3/zone4_ridge.joblib` (2,265 bytes) | PASS (raw change) | PASS (raw change) | No MAE/RMSE/R² or baseline report found | PARTIAL |
| Model 4 | `model4/model4_crop_stress.joblib` (559,367,811 bytes) | PASS | PASS | Accuracy 0.8234, balanced accuracy 0.8318, macro F1 0.8289; label meanings not verified | PARTIAL |

`PARTIAL` is intentional: the artifacts execute, but the available evidence does not establish production agronomic validity. Model 4 also has an unverified target-label meaning flag.

## Model 1 - Irrigation recommendation proxy

### Artifact and contract

- Full artifact: `model1/artifacts/random_forest_without_soil_moisture_tuned_candidate_v3.joblib`, 9,753,128 bytes.
- Reduced artifact: `model1/artifacts/reduced_weather_proxy_v1.joblib`, 40,806,175 bytes.
- Full feature order: `temperature_c`, `humidity_percent`, `rain_probability_percent`, `N`, `P`, `K`, `ph`, `organic_matter`, `crop_density`, `sunlight_exposure`, `wind_speed`, `frost_risk`, `crop_name`, `soil_type`, `growth_stage`.
- Reduced feature order: `temperature_c`, `humidity_percent`.
- Preprocessing is embedded in fitted scikit-learn pipelines with numeric imputation and categorical imputation/one-hot encoding.

### Executed predictions

- Full synthetic input (`crop_name=maize`, soil type 2, growth stage 2): class `0`, positive probability `0.3057142857`.
- Reduced weather synthetic input (`25 C`, `60%` humidity): class `1`, positive probability `0.5670238095`.
- Full artifact load took about 1.88 seconds; prediction took about 0.031 seconds in the validation process.

Missing full features and unrecognized categorical values were rejected by the inference validator. The full API route returned HTTP 200 for the valid sample and HTTP 422 for a missing request body field.

### Interpretation

The output is explicitly an `irrigation_needed_proxy` based on a synthetic proxy rule. It is not a meaningful agronomic irrigation recommendation and must not control equipment.

### Status

**PARTIAL** - loading, preprocessing, prediction, validation, and API integration pass; production recommendation validity is not established.

## Model 2 - Water requirement prediction

### Artifact and contract

- Artifact: `model2/model2_water_requirement.joblib`, 483,778 bytes.
- Config: `model2/model2_config.json`.
- The config feature order exactly matched the fitted pipeline's `feature_names_in_` (14 features).
- Model type in config: `HistGradientBoostingRegressor`.
- Target: `required_water_liters`.

### Executed prediction

Contract-valid synthetic input produced:

```text
43351.6587659212 liters
```

The result was finite and nonnegative. Loading took about 0.029 seconds; prediction took about 2.412 seconds in the direct validation process. The API returned HTTP 200 with `predicted_water_liters`, `unit=liters`, and the synthetic-data note. Missing request fields returned HTTP 422.

### Evaluation

The config reports MAE `5994.12` liters, RMSE `8588.09` liters, and R² `0.9492`. These metrics are explicitly for synthetic data, so they do not prove field accuracy.

### Status

**PARTIAL** - artifact, schema, preprocessing, prediction, output, metrics, and API validation pass; production validity is limited by synthetic training/evaluation data.

## Model 3 - Future soil moisture prediction

### Artifact and contract

- Artifact: `model3/zone4_ridge.joblib`, 2,265 bytes.
- Config: `model3/model3_config.json`.
- Zone 4 feature order exactly matched the fitted pipeline's 13 feature names.
- Configured horizon: 24 hours (`target_moisture_24h`).
- Zones 1, 2, 3, and 5 use persistence; zone 3 carries a caution warning.

### Executed prediction

For a contract-valid zone 4 synthetic input, the fitted artifact returned a raw change of:

```text
-1.6211469522775046 percentage points
```

The API returned HTTP 200 with the same `ridge_change` value. Missing zone 4 features returned HTTP 422. The raw change is finite, but the API does not convert it to a final moisture value or enforce the configured `[1, 100]` final moisture range. Adding it to the tested current moisture of 30% gives approximately `28.378853%`, which is in range for this sample.

### Evaluation and baseline

No Model 3 MAE, RMSE, R², or persistence-baseline comparison report was found in the repository. Therefore comparative performance and production readiness cannot be established. The model must not be claimed superior to persistence.

### Status

**PARTIAL** - artifact, feature contract, raw prediction, and API validation pass; evaluation evidence is unavailable and the endpoint exposes a raw change rather than a bounded final moisture prediction.

## Model 4 - Crop stress risk prediction

### Artifact and contract

- Original artifact exists at `model4/model4_crop_stress.joblib`.
- Size: 559,367,811 bytes.
- The fitted pipeline has 20 input features, a `ColumnTransformer`, numeric median imputation, categorical most-frequent imputation, one-hot encoding, and a random forest classifier.
- Actual classes are `[0, 1, 2]`.
- Actual categorical values include soil types `Alluvial`, `Chalky`, `Clayey`, `Laterite`, `Loamy`, `Peaty`, `Saline`, `Sandy`, `Silty`; regimes and plant categories are encoded by the fitted transformer.

### Executed prediction

For a contract-valid synthetic sample:

- Predicted class: `0`
- API numeric class: `0`; stress label intentionally withheld because the artifact's class semantics are unverified.
- Probabilities: class 0 `0.9678593578`, class 1 `0.0321406422`, class 2 `0.0`
- Confidence: `0.9678593578`
- Load time: about 5.48 seconds; prediction time: about 0.067 seconds.

The direct test verified `predict()` and `predict_proba()`, probability sum, class range, and missing-feature failure. The API returned HTTP 200 for the valid sample and HTTP 422 for an empty request.

The fitted one-hot encoder uses `handle_unknown=ignore`; an API request with
`soil_type="UNKNOWN"` therefore also returned HTTP 200 rather than rejecting
the category. This is recorded as observed model behavior, not treated as
evidence that the category is valid.

### Evaluation

`model4/evaluation_metrics.json` reports accuracy `0.8234108356`, balanced accuracy `0.8317921347`, macro F1 `0.8289380023`, and weighted F1 `0.8229799495`. It also states `target_label_meanings_verified: false`; therefore the requested Low/Moderate/High semantic mapping is not independently verified by the report.

### Status

**PARTIAL** - original artifact loads and predicts through the API, but label semantics remain unverified and the artifact is very large.

## FastAPI validation

Executed with FastAPI `TestClient` and `DATABASE_URL=sqlite://` for isolated validation:

- `/api/models/model1/full/predict`: HTTP 200 with valid synthetic input; HTTP 422 for missing fields.
- `/api/models/model1/weather/predict`: HTTP 200 when a test irrigation key was supplied in process; output contains prediction and probability.
- `/api/models/model2/predict`: HTTP 200 with `43351.6587659212` liters; HTTP 422 for missing fields.
- `/api/models/model3/predict`: HTTP 200 with raw change `-1.6211469522775046`; HTTP 422 with a named missing-feature list.
- `/api/models/model4/predict`: HTTP 200 with class 0 and confidence `0.9678593578`; HTTP 422 for an empty request.
- Invalid bounded numeric inputs for Models 2 and 3 returned HTTP 422. Model 4 unknown categorical text was accepted by the fitted encoder's `handle_unknown=ignore` behavior.

The Model 4 loader was corrected to use the actual original path `model4/model4_crop_stress.joblib`, and the Dockerfile now includes the `model4/` directory. No artifact was changed.

## Automated tests

Dedicated tests:

```text
python -m pytest -q tests\test_model1.py tests\test_model2.py tests\test_model3.py tests\test_model4.py
12 passed
```

Existing repository tests were not replaced. One pre-existing Model 2 integration assertion expects the artifact to be unloadable, which conflicts with the observed successful load and prediction; it should be updated separately if the full suite is required to be entirely green.

## Remaining issues

1. Model 1 is a synthetic proxy, not a validated irrigation recommendation model.
2. Model 2 metrics are synthetic-data metrics only.
3. Model 3 has no available evaluation metrics or persistence comparison; its API exposes a raw change.
4. Model 4 label meanings are marked unverified by its own evaluation report.
5. The 559 MB Model 4 artifact makes container distribution and startup comparatively expensive.
