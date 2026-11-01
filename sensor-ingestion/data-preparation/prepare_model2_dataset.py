
from pathlib import Path
import hashlib

import numpy as np
import pandas as pd


# =========================================================
# 1. CONFIGURATION
# =========================================================

SCRIPT_DIR = Path(__file__).resolve().parent
SENSOR_DIR = SCRIPT_DIR.parent

SOURCE = (
    SENSOR_DIR
    / "data"
    / "raw"
    / "Smart_Irrigation_Final_8500_Rows.csv"
)

OUTPUT_DIR = SCRIPT_DIR / "output" / "model2"
REPORT_DIR = SCRIPT_DIR / "reports"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
REPORT_DIR.mkdir(parents=True, exist_ok=True)

RANDOM_SEED = 42
TRAIN_RATIO = 0.80
# Target: simulated irrigation water requirement in litres
# over a 24-hour period, based on each row's input conditions.
# This is synthetic demonstration data, not measured ground truth.
TARGET = "required_water_liters"

FEATURES = [
    "crop_type",
    "growth_stage",
    "soil_type",
    "soil_moisture_percent",
    "temperature_c",
    "humidity_percent",
    "rainfall_mm",
    "forecast_rainfall_mm",
    "field_area_acres",
    "irrigation_method",
    "wind_speed",
    "et0_mm_day",
    "crop_coefficient_kc",
    "previous_irrigation_mm",
]

TRACE_COLUMNS = ["timestamp", "field_id"]

METADATA_COLUMNS = [
    "synthetic_inputs",
    "target_origin",
    "dataset_note",
]


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


# =========================================================
# 2. LOAD SOURCE WITHOUT MODIFYING IT
# =========================================================

if not SOURCE.exists():
    raise FileNotFoundError(f"Source file not found: {SOURCE}")

source_hash_before = sha256_file(SOURCE)
raw = pd.read_csv(SOURCE)

print("ORIGINAL DATASET")
print("Shape:", raw.shape)
print("Exact duplicate rows:", int(raw.duplicated().sum()))
print("Missing cells:", int(raw.isna().sum().sum()))

required_columns = [
    "label",
    "growth_stage",
    "soil_type",
    "soil_moisture",
    "temperature_c",
    "humidity_percent",
    "rainfall_mm_per_hr",
    "wind_speed",
    "timestamp",
    "field_id",
]

missing_columns = [
    col for col in required_columns if col not in raw.columns
]

if missing_columns:
    raise ValueError(f"Required source columns missing: {missing_columns}")

if len(raw) < 2:
    raise ValueError("At least two source rows are required.")


# =========================================================
# 3. PREPARE SOURCE-BASED FIELDS
# =========================================================

data = pd.DataFrame({
    "crop_type": raw["label"],
    "growth_stage": raw["growth_stage"],
    "soil_type": raw["soil_type"],
    "soil_moisture_percent": raw["soil_moisture"],
    "temperature_c": raw["temperature_c"],
    "humidity_percent": raw["humidity_percent"],
    "wind_speed": raw["wind_speed"],
    "timestamp": pd.to_datetime(
        raw["timestamp"], errors="coerce", utc=True
    ),
    "field_id": raw["field_id"],
})

for col in ["crop_type", "growth_stage", "soil_type", "field_id"]:
    data[col] = data[col].astype("string").str.strip()

for col in ["timestamp", "crop_type", "growth_stage", "soil_type", "field_id"]:
    if data[col].isna().any():
        raise ValueError(f"Missing required values in {col}.")

    if col != "timestamp" and data[col].eq("").any():
        raise ValueError(f"Blank required values in {col}.")

if data["timestamp"].isna().any():
    raise ValueError("Invalid timestamps found in the source.")

numeric_columns = [
    "soil_moisture_percent",
    "temperature_c",
    "humidity_percent",
    "wind_speed",
]

imputed_columns = []

for col in numeric_columns:
    data[col] = pd.to_numeric(
        data[col], errors="coerce"
    ).replace([np.inf, -np.inf], np.nan)

    if data[col].isna().any():
        if data[col].notna().sum() == 0:
            raise ValueError(f"No valid values available for {col}.")

        data[col] = data[col].fillna(data[col].median())
        imputed_columns.append(col)

rainfall_rate = pd.to_numeric(
    raw["rainfall_mm_per_hr"], errors="coerce"
)

if rainfall_rate.isna().any() or not np.isfinite(rainfall_rate).all():
    raise ValueError("Rainfall rate contains missing or invalid values.")

if (rainfall_rate < 0).any():
    raise ValueError("Negative rainfall rate found.")

if not data["soil_moisture_percent"].between(0, 100).all():
    raise ValueError("Soil moisture must be between 0 and 100 percent.")

if (data["humidity_percent"] < 0).any():
    raise ValueError("Negative humidity found.")

# Assumption: source rainfall is mm/hour. This represents
# the amount over one hour. Confirm source semantics with the team.
data["rainfall_mm"] = rainfall_rate.to_numpy() * 1.0


# =========================================================
# 4. GENERATE SYNTHETIC INPUT FIELDS
# =========================================================

rng = np.random.default_rng(RANDOM_SEED)

field_ids = data["field_id"].drop_duplicates().tolist()

# Keep area and irrigation method consistent for each field.
field_area_map = {
    fid: round(float(rng.uniform(0.5, 5.0)), 3)
    for fid in field_ids
}

method_map = {
    fid: str(rng.choice(
        ["drip", "sprinkler", "flood"],
        p=[0.45, 0.35, 0.20],
    ))
    for fid in field_ids
}

data["field_area_acres"] = (
    data["field_id"].map(field_area_map).astype(float)
)

data["irrigation_method"] = (
    data["field_id"].map(method_map).astype("string")
)

# Synthetic forecast values; not observed weather forecasts.
data["forecast_rainfall_mm"] = np.round(
    rng.gamma(shape=1.8, scale=2.0, size=len(data)), 2
).clip(0, 20)

# Synthetic ET0 estimate, not a validated ET0 calculation.
temperature_effect = (
    (data["temperature_c"].to_numpy() - 25) * 0.045
)
wind_effect = data["wind_speed"].to_numpy() * 0.025
humidity_effect = (
    (60 - data["humidity_percent"].to_numpy()) * 0.008
)

et0_values = (
    4.5
    + temperature_effect
    + wind_effect
    + humidity_effect
    + rng.normal(0, 0.35, len(data))
)

data["et0_mm_day"] = np.round(
    np.clip(et0_values, 2.0, 8.0), 3
)

stage_ranges = {
    "initial": (0.50, 0.80),
    "development": (0.70, 1.00),
    "mid-season": (1.00, 1.20),
    "mid season": (1.00, 1.20),
    "late-season": (0.70, 0.90),
    "late season": (0.70, 0.90),
}

kc_values = []

for stage in data["growth_stage"].astype(str):
    low, high = stage_ranges.get(
        stage.strip().lower(), (0.70, 1.20)
    )
    kc_values.append(rng.uniform(low, high))

data["crop_coefficient_kc"] = np.round(kc_values, 3)

data["previous_irrigation_mm"] = np.round(
    rng.gamma(shape=1.5, scale=2.0, size=len(data)), 2
).clip(0, 12)


# =========================================================
# 5. STOCHASTIC SIMULATION OF WATER MEASUREMENTS
# =========================================================

# These are simulated values, not actual measured water use.
# Relationships make the demonstration data learnable, while
# controlled noise prevents the target being an exact formula.

crop_demand = (
    data["et0_mm_day"].to_numpy()
    * data["crop_coefficient_kc"].to_numpy()
)

soil_moisture = data["soil_moisture_percent"].to_numpy()

soil_deficit_factor = np.clip(
    1.0 + (55.0 - soil_moisture) / 65.0,
    0.35,
    1.65,
)

recent_rain = np.minimum(data["rainfall_mm"].to_numpy(), 8.0)
forecast_rain = data["forecast_rainfall_mm"].to_numpy()
previous_irrigation = data["previous_irrigation_mm"].to_numpy()

rain_credit = 0.35 * recent_rain + 0.65 * forecast_rain
prior_irrigation_credit = 0.45 * previous_irrigation

net_demand = np.maximum(
    0.0,
    crop_demand * soil_deficit_factor
    - rain_credit
    - prior_irrigation_credit,
)

efficiency_map = {
    "drip": 0.90,
    "sprinkler": 0.75,
    "flood": 0.60,
}

efficiency = data["irrigation_method"].map(
    efficiency_map
).to_numpy(dtype=float)

area_m2 = data["field_area_acres"].to_numpy() * 4046.8564224

# Approximate latent volume in litres for simulation only.
latent_litres = (net_demand / efficiency) * area_m2

# Multiplicative and additive controlled variability.
relative_noise = np.clip(
    rng.normal(0.0, 0.12, len(data)), -0.30, 0.30
)

additive_noise = rng.normal(
    0.0, 0.015 * area_m2, len(data)
)

simulated_litres = (
    latent_litres * (1.0 + relative_noise)
    + additive_noise
)

data[TARGET] = np.round(
    np.maximum(simulated_litres, 0.0), 2
)

data["synthetic_inputs"] = True
data["target_origin"] = "synthetic_stochastic_simulation"
data["dataset_note"] = "demonstration_only_not_measured_field_data"


# =========================================================
# 6. VALIDATE AND SAVE COMPLETE DATASET FIRST
# =========================================================

data = data.sort_values(
    "timestamp", kind="stable"
).reset_index(drop=True)

FINAL_COLUMNS = (
    TRACE_COLUMNS + FEATURES + [TARGET] + METADATA_COLUMNS
)

prepared = data[FINAL_COLUMNS].copy()

if prepared.isna().any().any():
    raise ValueError("Prepared dataset contains missing values.")

for col in [
    "soil_moisture_percent",
    "temperature_c",
    "humidity_percent",
    "rainfall_mm",
    "forecast_rainfall_mm",
    "field_area_acres",
    "wind_speed",
    "et0_mm_day",
    "crop_coefficient_kc",
    "previous_irrigation_mm",
    TARGET,
]:
    values = pd.to_numeric(
        prepared[col], errors="coerce"
    ).to_numpy(dtype=float)

    if not np.isfinite(values).all():
        raise ValueError(f"Invalid numeric values in {col}.")

if (prepared[TARGET] < 0).any():
    raise ValueError("Negative water target found.")

if not prepared["field_area_acres"].gt(0).all():
    raise ValueError("Field area must be positive.")

if not prepared["synthetic_inputs"].all():
    raise ValueError("Synthetic provenance check failed.")

if not (
    prepared["target_origin"] == "synthetic_stochastic_simulation"
).all():
    raise ValueError("Target provenance check failed.")

full_path = OUTPUT_DIR / "model2_dataset.csv"
prepared.to_csv(full_path, index=False)

print("\nCOMPLETE DATASET SAVED")
print("File:", full_path)
print("Shape:", prepared.shape)


# =========================================================
# 7. SEPARATE X AND Y AFTER SAVING THE COMPLETE DATASET
# =========================================================

X = prepared[FEATURES].copy()
y = prepared[[TARGET]].copy()

if TARGET in X.columns:
    raise ValueError("Target leakage: target appears in X.")

if len(X) != len(y):
    raise ValueError("X and y row counts differ.")


# =========================================================
# 8. CHRONOLOGICAL 80/20 TRAIN/TEST SPLIT
# =========================================================

split_index = int(len(prepared) * TRAIN_RATIO)

if split_index <= 0 or split_index >= len(prepared):
    raise ValueError("Invalid train/test split.")

X_train = X.iloc[:split_index].copy()
X_test = X.iloc[split_index:].copy()
y_train = y.iloc[:split_index].copy()
y_test = y.iloc[split_index:].copy()

X_train.to_csv(OUTPUT_DIR / "X_train.csv", index=False)
X_test.to_csv(OUTPUT_DIR / "X_test.csv", index=False)
y_train.to_csv(OUTPUT_DIR / "y_train.csv", index=False)
y_test.to_csv(OUTPUT_DIR / "y_test.csv", index=False)


# =========================================================
# 9. FEATURE MANIFEST
# =========================================================

source_features = {
    "crop_type",
    "growth_stage",
    "soil_type",
    "soil_moisture_percent",
    "temperature_c",
    "humidity_percent",
    "rainfall_mm",
    "wind_speed",
}

descriptions = {
    "crop_type": "Source crop label",
    "growth_stage": "Source growth stage",
    "soil_type": "Source soil type",
    "soil_moisture_percent": "Source soil moisture percentage",
    "temperature_c": "Source temperature in Celsius",
    "humidity_percent": "Source humidity percentage",
    "rainfall_mm": "One-hour amount derived from source rate; assumes mm/hour",
    "forecast_rainfall_mm": "Synthetic forecast rainfall",
    "field_area_acres": "Synthetic area fixed per field ID",
    "irrigation_method": "Synthetic method fixed per field ID",
    "wind_speed": "Source wind speed; units require confirmation",
    "et0_mm_day": "Synthetic evapotranspiration estimate",
    "crop_coefficient_kc": "Synthetic growth-stage-based coefficient",
    "previous_irrigation_mm": "Synthetic previous irrigation depth",
    TARGET: "Synthetic stochastic target, not observed ground truth",
}

manifest = pd.DataFrame([
    {
        "column": col,
        "role": "target" if col == TARGET else "feature",
        "data_origin": (
            "source_or_derived_from_source"
            if col in source_features
            else (
                "synthetic_simulation"
                if col == TARGET
                else "synthetic_input"
            )
        ),
        "description": descriptions[col],
    }
    for col in FEATURES + [TARGET]
])

manifest.to_csv(OUTPUT_DIR / "feature_manifest.csv", index=False)


# =========================================================
# 10. REPORT AND ORIGINAL SOURCE INTEGRITY CHECK
# =========================================================

source_hash_after = sha256_file(SOURCE)

if source_hash_before != source_hash_after:
    raise RuntimeError("Original source file hash changed.")

report_lines = [
    "MODEL 2 DATA PREPARATION REPORT",
    "================================",
    f"Source file: {SOURCE}",
    f"Source shape: {raw.shape}",
    f"Prepared dataset shape: {prepared.shape}",
    f"Source exact duplicate rows: {int(raw.duplicated().sum())}",
    f"Source missing cells: {int(raw.isna().sum().sum())}",
    f"Prepared missing cells: {int(prepared.isna().sum().sum())}",
    f"Imputed source columns: {imputed_columns}",
    f"Feature count: {len(FEATURES)}",
    f"Target: {TARGET}",
    f"Training rows: {len(X_train)}",
    f"Testing rows: {len(X_test)}",
    "Split: chronological 80/20",
    f"Original source SHA-256 unchanged: {source_hash_before == source_hash_after}",
    "",
    "DATA PROVENANCE AND LIMITATIONS",
    "-------------------------------",
    "Target meaning: simulated required water in litres per 24 hours.",
"Each source row is a 15-minute observation, not a 15-minute water target.",
    "The original source CSV is not modified.",
    "Forecast rainfall, field area, irrigation method, ET0,",
    "crop coefficient and previous irrigation are synthetic.",
    "The target required_water_liters is a stochastic simulation,",
    "not an observed measurement or verified ground-truth label.",
    "Synthetic variability does not establish real-world validity.",
    "Model scores measure agreement with this simulation only.",
    "The rainfall feature assumes the source rate is mm/hour",
    "and represents a one-hour period; confirm with the team.",
    "Wind-speed units and source measurement definitions need confirmation.",
    "Replace synthetic fields and target with validated observations",
    "before making real-world irrigation accuracy claims.",
    "",
    "Features:",
    ", ".join(FEATURES),
    "",
    "Trace columns excluded from X:",
    ", ".join(TRACE_COLUMNS),
]

report_path = REPORT_DIR / "model2_dataset_report.txt"
report_path.write_text("\n".join(report_lines), encoding="utf-8")

print("\nMODEL 2 PREPARATION COMPLETED")
print("Source shape:", raw.shape)
print("Prepared shape:", prepared.shape)
print("Feature count:", len(FEATURES))
print("Target:", TARGET)
print("Training rows:", len(X_train))
print("Testing rows:", len(X_test))
print("Source unchanged:", source_hash_before == source_hash_after)
print("Outputs:", OUTPUT_DIR)
print("Report:", report_path)
