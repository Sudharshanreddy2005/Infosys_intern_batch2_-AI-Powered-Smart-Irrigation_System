# Model 4 Class Mapping Verification

Validation date: 2026-10-31  
Status: **BLOCKED**

## Evidence inspected

- [model4/model4.ipynb](../model4/model4.ipynb)
- [model4/evaluation_metrics.json](../model4/evaluation_metrics.json)
- [model4/model_comparison.csv](../model4/model_comparison.csv)
- [model4/model4_crop_stress.joblib](../model4/model4_crop_stress.joblib)
- Recovered dataset: `C:\Users\sudha\OneDrive\Desktop\all projects\irrigation-feature\datasets\model4\dataset\agro_environmental_dataset.csv`
- Git history for Model 4 files and target-encoding changes

## Numeric classes

| Numeric class | Original target value | Original label | Application label | Verification |
|---:|---|---|---|---|
| 0 | `stress_level = 0` | No separate categorical label found | Numeric class only | **BLOCKED** |
| 1 | `stress_level = 1` | No separate categorical label found | Numeric class only | **BLOCKED** |
| 2 | `stress_level = 2` | No separate categorical label found | Numeric class only | **BLOCKED** |

## Findings

The notebook loads the target directly from the numeric `stress_level` column:

```python
y = df_clean["stress_level"].astype(int)
```

It reports target classes `[0, 1, 2]`, and the serialized estimator exposes `classes_ == [0, 1, 2]`. No `LabelEncoder`, manual mapping dictionary, string target labels, or authoritative documentation assigning Low/Moderate/High Stress was found in the repository, sibling backup project, or Git history searched.

The dataset includes correlations such as suitability score and failure flag by numeric class, but those relationships do not establish the intended semantic names. The model therefore continues to return numeric classes without guessed labels.

## Required evidence to unblock

One of the following original sources is required:

1. The dataset-generation script that defines the `stress_level` values.
2. The original data dictionary or project specification for `stress_level`.
3. Training documentation explicitly stating the class mapping.
4. An original fitted label encoder with its `classes_` mapping, if encoding was used before the saved dataset.

Until that evidence is supplied, displaying `Low Stress`, `Moderate Stress`, or `High Stress` would be unsupported.
