# Model 4 Class Reassignment Report

Validation date: 2026-10-31  
Overall status: **PARTIAL**  
Original semantic mapping: **BLOCKED**  
Agronomic interpretation of the numeric order: **SUPPORTED AS A PROPOSAL, NOT VERIFIED**

## Final mapping table

| Numeric class | Verified meaning | Evidence | Status |
|---:|---|---|---|
| 0 | Unknown from original training evidence | Dataset and notebook contain only numeric `stress_level = 0`; class 0 has the healthiest observed feature profile | **BLOCKED** |
| 1 | Unknown from original training evidence | Dataset and notebook contain only numeric `stress_level = 1`; class 1 has intermediate observed feature profile | **BLOCKED** |
| 2 | Unknown from original training evidence | Dataset and notebook contain only numeric `stress_level = 2`; class 2 has the strongest observed stress indicators | **BLOCKED** |

**Data-supported proposal only:** `0 = Low Stress`, `1 = Moderate Stress`, `2 = High Stress`. This proposal has not been installed as an application label because the original target-generation semantics are unavailable.

## 1. Original mapping investigation

Searched:

- [model4/model4.ipynb](../model4/model4.ipynb)
- Model 4 metadata and evaluation files
- Active and sibling backup project directories
- Dataset preprocessing and training scripts
- Git history and previous Model 4 files
- Terms: `stress_level`, `stress_category`, `crop_stress`, `stress_threshold`, `LabelEncoder`, class mappings, and Low/Moderate/High Stress labels

The notebook loads the target directly:

```python
y = df_clean["stress_level"].astype(int)
```

It reports numeric classes `[0, 1, 2]`. No `LabelEncoder`, manual dictionary, string target labels, stress thresholds, or authoritative data dictionary was found. The dataset-generation script was also not recovered.

Therefore, the original meaning of each number is not verified.

## 2. Dataset identity and availability

Recovered dataset:

`C:\Users\sudha\OneDrive\Desktop\all projects\irrigation-feature\datasets\model4\dataset\agro_environmental_dataset.csv`

SHA256:

`000f273d7e909b16459d5c36f9d01ad640da1461a51b7b981c3ebe614eb9df48`

Profile:

- 543,210 rows
- 25 columns
- 175,267 class 0 rows
- 239,013 class 1 rows
- 128,930 class 2 rows
- No missing values
- No duplicate rows

The dataset is not copied into the active repository or deployment image.

## 3. Class-wise agronomic analysis

The following charts and reproducible summary were generated from the recovered dataset:

- [numeric_features_by_class.png](./model4_class_analysis/numeric_features_by_class.png)
- [moisture_regime_by_class.png](./model4_class_analysis/moisture_regime_by_class.png)
- [stress_indicators_by_class.png](./model4_class_analysis/stress_indicators_by_class.png)
- [class_numeric_summary.csv](./model4_class_analysis/class_numeric_summary.csv)

### Numeric feature patterns

| Feature | Class 0 mean | Class 1 mean | Class 2 mean | Pattern |
|---|---:|---:|---:|---|
| Soil moisture (%) | 32.3547 | 34.7825 | 38.9034 | Class 2 is higher, not a standalone stress measure |
| Soil temperature (C) | 24.4438 | 24.9622 | 25.8416 | Increasing stress-associated heat |
| Air temperature (C) | 27.4502 | 27.9634 | 28.8451 | Increasing stress-associated heat |
| Soil pH | 6.5620 | 6.5094 | 6.3947 | Class 2 is more shifted from the central range |
| Salinity EC | 0.5343 | 0.6351 | 0.9354 | Strong increase toward class 2 |
| Organic matter (%) | 4.3324 | 4.1113 | 3.3431 | Lower in class 2 |
| Suitability score | 0.8826 | 0.5954 | 0.2805 | Strong monotonic decrease |
| Failure flag rate | 0.07% | 2.30% | 63.96% | Strong monotonic increase |
| pH stress flag rate | 2.24% | 18.95% | 48.80% | Strong monotonic increase |

The soil-moisture mean rises with class number, so it must not be interpreted alone as “more stress.” The combined regime, temperature, salinity, suitability, failure, and pH indicators consistently place class 0 in the healthiest profile and class 2 in the most adverse profile.

### Categorical environmental patterns

| Indicator | Class 0 | Class 1 | Class 2 |
|---|---:|---:|---:|
| Optimal moisture regime | 93.10% | 54.91% | 19.18% |
| Waterlogged moisture regime | 4.07% | 32.95% | 66.36% |
| Dry moisture regime | 2.83% | 12.14% | 14.45% |
| Optimal thermal regime | 91.83% | 77.07% | 52.69% |
| Heat-stress thermal regime | 4.46% | 15.17% | 32.87% |
| Deficient nutrient balance | 51.62% | 80.87% | 94.71% |

These distributions support the ordinal proposal but cannot prove what the original author intended the integers to mean.

## 4. Assignment-by-assignment assessment

### Class 0 = Low Stress

- **Original verification:** BLOCKED.
- **Agronomic support:** Strong. Class 0 has the highest optimal-moisture and optimal-thermal shares, lowest salinity, lowest failure rate, lowest pH-stress rate, and highest suitability.
- **Confidence in proposal:** High, subject to the target having been designed as an ordinal stress scale.
- **Limitation:** Correlation with stress-related features is not a target definition.

### Class 1 = Moderate Stress

- **Original verification:** BLOCKED.
- **Agronomic support:** Strong. Class 1 is intermediate on most environmental indicators and has intermediate failure, pH-stress, thermal, and moisture-regime rates.
- **Confidence in proposal:** High, subject to the target having been designed as an ordinal stress scale.
- **Limitation:** No source states that class 1 is the middle semantic category.

### Class 2 = High Stress

- **Original verification:** BLOCKED.
- **Agronomic support:** Strong. Class 2 has the highest salinity, heat-stress, waterlogging, nutrient-deficiency, pH-stress, and failure rates, with the lowest suitability.
- **Confidence in proposal:** High, subject to the target having been designed as an ordinal stress scale.
- **Limitation:** The target-generation code is missing; the observed relationships could reflect a differently named numeric outcome.

## 5. Reassignment decision

No application reassignment was made. The existing API and frontend continue to return numeric classes and explicitly state that semantic labels are unverified.

Installing the proposed labels now would convert a data-pattern inference into an unsupported application claim. To verify the mapping, obtain the original dataset-generation script, data dictionary, or training specification that defines `stress_level`.

## 6. Validation and tests

The unchanged Model 4 artifact independently reproduced the notebook’s held-out metrics exactly:

- Accuracy: `0.8234108356`
- Balanced accuracy: `0.8317921347`
- Macro F1: `0.8289380023`
- Weighted F1: `0.8229799495`

Existing Model 4 and API tests remain passing. No trained artifact, `.env`, Model 1, Model 2, or Model 3 implementation was modified.

## 7. Required next evidence

The mapping can be marked **VERIFIED** only when one of the following is found:

1. The script that generated `stress_level`.
2. A data dictionary defining numeric class semantics.
3. Original training documentation naming the classes.
4. An original label encoder with its fitted class mapping.

Until then, the correct production-safe status is:

```text
Numeric output available; semantic class label blocked.
```
