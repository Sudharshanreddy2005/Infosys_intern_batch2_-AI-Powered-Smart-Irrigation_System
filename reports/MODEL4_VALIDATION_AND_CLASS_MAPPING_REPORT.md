# Model 4 Validation and Class Mapping Report

Validation date: 2026-10-31  
Overall status: **PARTIAL**

The original dataset was recovered and the held-out evaluation was independently reproduced exactly. The numeric class mapping remains **BLOCKED** because no original semantic-label definition was found.

## 1. Training evidence discovered

- Notebook: [model4/model4.ipynb](../model4/model4.ipynb)
- Metrics: [model4/evaluation_metrics.json](../model4/evaluation_metrics.json)
- Model comparison: [model4/model_comparison.csv](../model4/model_comparison.csv)
- Artifact: `model4/model4_crop_stress.joblib`
- Target: numeric `stress_level`
- Training code uses `y = df_clean["stress_level"].astype(int)`.
- No `LabelEncoder`, manual class dictionary, or string-label mapping was found.

## 2. Original class mapping

| Class | Meaning | Status |
|---:|---|---|
| 0 | Not established from original evidence | BLOCKED |
| 1 | Not established from original evidence | BLOCKED |
| 2 | Not established from original evidence | BLOCKED |

See [MODEL4_CLASS_MAPPING_VERIFICATION.md](./MODEL4_CLASS_MAPPING_VERIFICATION.md).

## 3. Dataset availability and checksum

The original dataset was found outside the active repository at:

`C:\Users\sudha\OneDrive\Desktop\all projects\irrigation-feature\datasets\model4\dataset\agro_environmental_dataset.csv`

SHA256:

`000f273d7e909b16459d5c36f9d01ad640da1461a51b7b981c3ebe614eb9df48`

Verified profile:

- Shape: `543210 x 25`
- Target counts: class 0 = `175267`, class 1 = `239013`, class 2 = `128930`
- Missing values: `0`
- Duplicate rows: `0`
- Target missing values: `0`
- Twenty model features match the artifact feature order exactly.

The dataset is not copied into or committed to the application repository.

## 4. Training and testing split

The notebook uses:

```python
train_test_split(X, y, test_size=0.20, random_state=42, stratify=y)
train_test_split(X_dev, y_dev, test_size=0.25, random_state=42, stratify=y_dev)
```

This produced:

- Training: `325926`
- Validation: `108642`
- Held-out test: `108642`

The independent reproduction found zero index overlap between training/test and validation/test partitions.

## 5. Data leakage checks

- Artifact feature order matches the 20 selected features.
- Notebook excludes `location_id`, `ph_stress_flag`, `suitability_score`, and `failure_flag` from model inputs.
- No duplicate rows remain in the recovered dataset.
- Target and excluded columns are absent from the evaluation feature frame.
- The saved pipeline contains fitted preprocessing and the estimator; preprocessing is not refit during evaluation.
- No timestamp column exists, so temporal leakage cannot be meaningfully assessed.
- An independent leakage audit of the generator is limited because the script that created the CSV was not found.

## 6. Independently reproduced metrics

The unchanged artifact was evaluated against the recovered dataset using the exact notebook split. Results match the previously reported values exactly:

| Metric | Independent result | Previously reported |
|---|---:|---:|
| Accuracy | 0.8234108356 | 0.8234108356 |
| Balanced accuracy | 0.8317921347 | 0.8317921347 |
| Macro precision | 0.8266855096 | Not reported |
| Weighted precision | 0.8232152779 | Not reported |
| Macro recall | 0.8317921347 | Not reported |
| Weighted recall | 0.8234108356 | Not reported |
| Macro F1 | 0.8289380023 | 0.8289380023 |
| Weighted F1 | 0.8229799495 | 0.8229799495 |

## 7. Confusion matrix and per-class evaluation

Rows are actual classes and columns are predicted classes in order `[0, 1, 2]`:

```text
[[30178,  4875,     0],
 [ 6645, 37199,  3959],
 [    1,  3705, 22080]]
```

| Class | Precision | Recall | F1 | Support |
|---:|---:|---:|---:|---:|
| 0 | 0.8195199 | 0.8609249 | 0.8397123 | 35053 |
| 1 | 0.8125778 | 0.7781729 | 0.7950033 | 47803 |
| 2 | 0.8479588 | 0.8562786 | 0.8520984 | 25786 |

The weakest recall is numeric class 1 at `0.7782`. Semantic interpretation is intentionally not attached to that class.

## 8. Probability reliability

The artifact supports `predict_proba()`. On the same held-out test set:

- Multiclass log loss: `0.3364596431`
- Mean one-vs-rest Brier score: `0.0708613263`
- Mean maximum predicted probability: `0.8159389440`
- Expected calibration error, 10 equal-width bins: `0.0392034993`

These are descriptive calibration checks, not proof of calibrated confidence. The UI calls the value a **model-estimated probability**, not scientific confidence.

## 9. Subgroup check

The dataset contains `plant_category` but no zone field. Held-out results by plant category:

| Plant category | Support | Accuracy | Macro F1 |
|---|---:|---:|---:|
| cereal | 43349 | 0.7818173 | 0.7845022 |
| legume | 32807 | 0.8249154 | 0.8236311 |
| vegetable | 32486 | 0.8773933 | 0.8791269 |

These subgroup differences should be considered before production use.

## 10. Application status

The application remains numeric-class-only. Model 4 inference, API, and frontend behavior are safe with the available evidence:

- Numeric class returned.
- Probabilities returned when supported.
- No guessed class label.
- Cached artifact loading.
- Artifact checksum/version included in the response.
- Missing artifact handled as HTTP 503.

## 11. Remaining limitations

1. Semantic class mapping is BLOCKED pending the original target-definition source.
2. Dataset-generation code was not found, so generator-level leakage cannot be independently reviewed.
3. The recovered dataset is outside the active repository and is not included in deployment.
4. Probability calibration has descriptive metrics only; no calibration curve or recalibration was introduced.
5. No zone column exists for zone-level performance analysis.

## 12. Verification commands

```powershell
cd C:\Users\sudha\OneDrive\Desktop\irrigation-feature
python -m pytest -q
node --test tests_js/*.test.cjs
uvicorn main:app --reload
```

No artifact, `.env`, or unrelated application behavior was modified.
