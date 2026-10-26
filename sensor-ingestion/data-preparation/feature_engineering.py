
from pathlib import Path

import pandas as pd

# ==================================================
# 1. PATHS
# ==================================================

BASE_DIR = Path(__file__).resolve().parent
INPUT_FILE = BASE_DIR / "output" / "cleaned_dataset_m2.csv"
OUTPUT_DIR = BASE_DIR / "output" / "model_ready"
REPORT_DIR = BASE_DIR / "reports"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
REPORT_DIR.mkdir(parents=True, exist_ok=True)

REPORT_FILE = REPORT_DIR / "feature_engineering_report.txt"
DICTIONARY_FILE = REPORT_DIR / "feature_dictionary.csv"

# ==================================================
# 2. LOAD DATA
# ==================================================

if not INPUT_FILE.exists():
    raise FileNotFoundError(
        f"Input dataset not found: {INPUT_FILE}"
    )

df = pd.read_csv(INPUT_FILE)

if df.empty:
    raise ValueError("The input dataset is empty.")

original_rows = len(df)
original_columns = len(df.columns)

# ==================================================
# 3. REQUIRED COLUMNS
# ==================================================

required_columns = [
    "timestamp",
    "soil_moisture",
    "temperature_c",
    "humidity_percent",
    "rain_probability_percent",
    "label",
    "soil_type",
    "growth_stage",
    "N",
    "P",
    "K",
    "ph",
    "organic_matter",
    "crop_density",
    "sunlight_exposure",
    "wind_speed",
    "frost_risk",
]

missing_columns = [
    col for col in required_columns
    if col not in df.columns
]

if missing_columns:
    raise ValueError(
        "Required columns are missing: "
        + ", ".join(missing_columns)
    )

# ==================================================
# 4. VALIDATE TIMESTAMPS
# ==================================================

df["timestamp"] = pd.to_datetime(
    df["timestamp"],
    errors="coerce",
    utc=True,
)

if df["timestamp"].isna().any():
    raise ValueError(
        "Invalid timestamps found. Resolve them before splitting."
    )

# ==================================================
# 5. VALIDATE NUMERIC INPUTS
# ==================================================

numeric_features = [
    "soil_moisture",
    "temperature_c",
    "humidity_percent",
    "rain_probability_percent",
    "N",
    "P",
    "K",
    "ph",
    "organic_matter",
    "crop_density",
    "sunlight_exposure",
    "wind_speed",
    "frost_risk",
]

for col in numeric_features:
    df[col] = pd.to_numeric(df[col], errors="coerce")

bad_numeric = [
    col for col in numeric_features
    if df[col].isna().any()
]

if bad_numeric:
    raise ValueError(
        "Missing or non-numeric values found in: "
        + ", ".join(bad_numeric)
        + ". Investigate these values before proceeding."
    )

# Check physically meaningful bounds where units are clear.
if not df["soil_moisture"].between(0, 100).all():
    raise ValueError(
        "soil_moisture contains values outside 0-100."
    )

if not df["humidity_percent"].between(0, 100).all():
    raise ValueError(
        "humidity_percent contains values outside 0-100."
    )

if not df["rain_probability_percent"].between(0, 100).all():
    raise ValueError(
        "rain_probability_percent contains values outside 0-100."
    )

# ==================================================
# 6. PREPARE CATEGORICAL INPUTS
# ==================================================

# 'label' contains crop names in the current dataset.
# Rename it for clearer meaning in the model-ready data.

df["crop_name"] = df["label"].astype("string").str.strip()

categorical_features = [
    "crop_name",
    "soil_type",
    "growth_stage",
]

for col in ["soil_type", "growth_stage"]:
    df[col] = df[col].astype("string").str.strip()

for col in categorical_features:
    if df[col].isna().any() or (df[col] == "").any():
        raise ValueError(
            f"Missing or blank category found in {col}."
        )

# ==================================================
# 7. SELECT INITIAL FEATURES
# ==================================================

# These are candidate features, not scientifically
# validated predictors. Categories remain unencoded here.
# Member 2 should fit encoders using training data only.

selected_features = (
    numeric_features
    + categorical_features
)

# Excluded from inputs:
# - synthetic_record_number, field_id, sensor_id
# - timestamp as a direct input
# - irrigation_status
# - irrigation_duration_minutes
# - water_used_liters
# - water_usage_efficiency
# - rainfall_mm_per_hr and rainfall
# - temperature and humidity duplicate-like columns
# - sensor_status and data_origin
#
# Some excluded fields are retained in the source dataset
# for traceability or investigation.

X = df[selected_features].copy()

# ==================================================
# 8. CREATE A DEMONSTRATION-ONLY PROXY TARGET
# ==================================================

# TEMPORARY HEURISTIC:
# soil_moisture <= 20 is marked as a possible irrigation
# trigger for demonstrating the data pipeline.
#
# This threshold is NOT an agronomically validated rule.
# The resulting labels are NOT ground truth.
# Do not claim that model scores on this target prove
# the system can predict real irrigation needs.

proxy_threshold = 20.0

y_proxy = pd.Series(
    (df["soil_moisture"] <= proxy_threshold).astype("int8"),
    name="irrigation_needed_proxy",
)

# IMPORTANT:
# Because this proxy is defined directly from soil_moisture,
# a model trained with soil_moisture as an input would merely
# learn to reproduce this rule. Its evaluation would not be
# valid evidence of real-world irrigation prediction ability.

# ==================================================
# 9. CHRONOLOGICAL TRAIN / TEST SPLIT
# ==================================================

# Sort by timestamp. Earlier records are used for training;
# later records are held out for a chronological test.
#
# This tests future records in the same dataset period.
# It does NOT guarantee evaluation on unseen fields or
# real-world data.

ordered_indices = df.sort_values(
    "timestamp",
    kind="stable",
).index

X = X.loc[ordered_indices].reset_index(drop=True)
y_proxy = y_proxy.loc[ordered_indices].reset_index(drop=True)

timestamps = df.loc[
    ordered_indices, "timestamp"
].reset_index(drop=True)

split_index = int(len(X) * 0.80)

if split_index <= 0 or split_index >= len(X):
    raise ValueError("Unable to create an 80/20 split.")

X_train = X.iloc[:split_index].copy()
X_test = X.iloc[split_index:].copy()

y_train = y_proxy.iloc[:split_index].copy()
y_test = y_proxy.iloc[split_index:].copy()

# ==================================================
# 10. SAVE MODEL-READY FEATURES AND DEMO TARGETS
# ==================================================

X.to_csv(
    OUTPUT_DIR / "features_all.csv",
    index=False,
)

y_proxy.to_frame().to_csv(
    OUTPUT_DIR / "proxy_target_all.csv",
    index=False,
)

X_train.to_csv(
    OUTPUT_DIR / "X_train_demo.csv",
    index=False,
)

X_test.to_csv(
    OUTPUT_DIR / "X_test_demo.csv",
    index=False,
)

y_train.to_frame().to_csv(
    OUTPUT_DIR / "y_train_proxy_demo.csv",
    index=False,
)

y_test.to_frame().to_csv(
    OUTPUT_DIR / "y_test_proxy_demo.csv",
    index=False,
)

# ==================================================
# 11. CREATE A FEATURE DICTIONARY
# ==================================================

feature_notes = {
    "soil_moisture": (
        "Numeric candidate; reported on a 0-100 scale. "
        "Confirm sensor definition and units."
    ),
    "temperature_c": (
        "Numeric candidate; selected instead of temperature. "
        "Paired columns are nearly identical."
    ),
    "humidity_percent": (
        "Numeric candidate; selected instead of humidity. "
        "Paired columns are nearly identical."
    ),
    "rain_probability_percent": (
        "Numeric candidate; meaning and synthetic generation "
        "should be documented."
    ),
    "N": "Numeric candidate; confirm units.",
    "P": "Numeric candidate; confirm units.",
    "K": "Numeric candidate; confirm units.",
    "ph": "Numeric candidate; check agronomic plausibility.",
    "organic_matter": "Numeric candidate; confirm units.",
    "crop_density": "Numeric candidate; confirm units.",
    "sunlight_exposure": "Numeric candidate; confirm units.",
    "wind_speed": "Numeric candidate; confirm units.",
    "frost_risk": "Numeric candidate; confirm scale and meaning.",
    "crop_name": "Categorical crop name derived from label.",
    "soil_type": "Categorical code; category meanings unverified.",
    "growth_stage": "Categorical code; stage meanings unverified.",
}

dictionary_rows = []

for col in selected_features:
    dictionary_rows.append({
        "feature": col,
        "data_type": (
            "categorical"
            if col in categorical_features
            else "numeric"
        ),
        "source_column": (
            "label" if col == "crop_name" else col
        ),
        "description_and_caveat": feature_notes[col],
    })

pd.DataFrame(dictionary_rows).to_csv(
    DICTIONARY_FILE,
    index=False,
)

# ==================================================
# 12. GENERATE THE REPORT
# ==================================================

report = [
    "MILESTONE 2 - FEATURE ENGINEERING REPORT",
    "=" * 55,
    f"Input file: {INPUT_FILE.name}",
    f"Original rows: {original_rows}",
    f"Original columns: {original_columns}",
    f"Rows retained: {len(X)}",
    f"Selected feature count: {len(selected_features)}",
    f"Training rows: {len(X_train)}",
    f"Testing rows: {len(X_test)}",
    "",
    "SELECTED FEATURES",
    "-" * 55,
    *selected_features,
    "",
    "EXCLUDED OR RESERVED FIELDS",
    "-" * 55,
    "Identifiers: synthetic_record_number, field_id, sensor_id",
    "Timestamp: retained for ordering, not a direct feature",
    "Weather pairs: temperature, humidity, rainfall, rainfall_mm_per_hr",
    "Action/outcome fields: irrigation_status, irrigation_duration_minutes,",
    "water_used_liters, water_usage_efficiency",
    "Other reserved fields: sensor_status, data_origin",
    "",
    "PROXY TARGET WARNING",
    "-" * 55,
    "Target name: irrigation_needed_proxy",
    f"Temporary rule: soil_moisture <= {proxy_threshold}",
    "This is an illustrative heuristic, not validated ground truth.",
    "Do not present ML scores against this target as real irrigation accuracy.",
    "Since the target is derived directly from soil_moisture, a model using",
    "soil_moisture would merely reproduce the chosen rule.",
    "",
    "REGRESSION TARGET",
    "-" * 55,
    "No required_water_liters target created.",
    "water_used_liters has not been established as required water.",
    "",
    "SPLIT STRATEGY",
    "-" * 55,
    "Chronological 80/20 split.",
    f"Last training timestamp: {timestamps.iloc[split_index - 1]}",
    f"First test timestamp: {timestamps.iloc[split_index]}",
    "This does not validate performance on real-world data.",
    "",
    "PREPROCESSING HANDOFF",
    "-" * 55,
    "Categorical features are saved as categories, not one-hot encoded.",
    "Member 2 must fit encoders and imputers on training data only.",
    "Use a scikit-learn Pipeline/ColumnTransformer to avoid leakage.",
    "",
    "DATA LIMITATIONS",
    "-" * 55,
    "All records are marked synthetic_or_synthetic_augmented.",
    "Units and meanings of several features remain unverified.",
    "Results are suitable for a documented prototype only.",
]

REPORT_FILE.write_text(
    "\n".join(report),
    encoding="utf-8",
)

# ==================================================
# 13. PRINT SUMMARY
# ==================================================

print("Feature engineering completed successfully.")
print(f"Input rows: {original_rows}")
print(f"Input columns: {original_columns}")
print(f"Selected features: {len(selected_features)}")
print(f"Training rows: {len(X_train)}")
print(f"Testing rows: {len(X_test)}")
print()
print("Proxy target counts:")
print(y_proxy.value_counts().sort_index().to_string())
print()
print(f"Output folder: {OUTPUT_DIR}")
print(f"Feature dictionary: {DICTIONARY_FILE}")
print(f"Report: {REPORT_FILE}")
print()
print("Reminder: proxy labels are not verified ground truth.")
print("The original cleaned dataset was not modified.")
