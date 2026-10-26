
from pathlib import Path

import pandas as pd

# --------------------------------------------------
# Paths
# --------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent

DATA_FILE = BASE_DIR / "output" / "cleaned_dataset_m2.csv"
REPORT_DIR = BASE_DIR / "reports"
REPORT_FILE = REPORT_DIR / "target_assessment_report.txt"

# --------------------------------------------------
# Load data without changing the source file
# --------------------------------------------------
if not DATA_FILE.exists():
    raise FileNotFoundError(
        f"Dataset not found: {DATA_FILE}\n"
        "Run the existing preparation script first."
    )

df = pd.read_csv(DATA_FILE)
REPORT_DIR.mkdir(parents=True, exist_ok=True)

report = []

def add(text=""):
    report.append(str(text))

add("MILESTONE 2 - TARGET FEASIBILITY ASSESSMENT")
add("=" * 55)
add(f"Input file: {DATA_FILE.name}")
add(f"Rows: {len(df)}")
add(f"Columns: {len(df.columns)}")
add()
add("IMPORTANT:")
add(
    "This report investigates existing columns. "
    "It does not prove that any target is scientifically valid."
)
add()

# --------------------------------------------------
# 1. Check whether expected columns exist
# --------------------------------------------------
candidate_columns = [
    "timestamp",
    "soil_moisture",
    "temperature_c",
    "temperature",
    "humidity_percent",
    "humidity",
    "rainfall_mm_per_hr",
    "rainfall",
    "rain_probability_percent",
    "irrigation_status",
    "irrigation_duration_minutes",
    "water_used_liters",
    "water_usage_efficiency",
    "label",
    "soil_type",
    "growth_stage",
    "sensor_status",
    "data_origin",
]

add("1. COLUMN AVAILABILITY")
add("-" * 55)

for col in candidate_columns:
    add(f"{col}: {'PRESENT' if col in df.columns else 'NOT FOUND'}")

add()

# --------------------------------------------------
# 2. Inspect irrigation status
# --------------------------------------------------
add("2. IRRIGATION STATUS")
add("-" * 55)

if "irrigation_status" in df.columns:
    status_counts = (
        df["irrigation_status"]
        .fillna("<MISSING>")
        .astype(str)
        .value_counts(dropna=False)
    )

    for status, count in status_counts.items():
        add(f"{status}: {count} rows ({count / len(df):.1%})")

    add()
    add(
        "Interpretation: these counts describe recorded statuses. "
        "They do not establish whether irrigation was genuinely needed."
    )
else:
    add("Cannot assess: irrigation_status is missing.")

add()

# --------------------------------------------------
# 3. Compare existing measurements by recorded status
# --------------------------------------------------
add("3. MEASUREMENTS BY RECORDED IRRIGATION STATUS")
add("-" * 55)

numeric_columns = [
    "soil_moisture",
    "temperature_c",
    "temperature",
    "humidity_percent",
    "humidity",
    "rainfall_mm_per_hr",
    "rainfall",
    "rain_probability_percent",
    "irrigation_duration_minutes",
    "water_used_liters",
    "water_usage_efficiency",
]

available_numeric = [
    col for col in numeric_columns if col in df.columns
]

if "irrigation_status" in df.columns and available_numeric:
    summary = df.groupby(
        "irrigation_status", dropna=False
    )[available_numeric].agg(["count", "median", "mean"])

    add(summary.round(3).to_string())
else:
    add("Not enough required columns to compare measurements.")

add()
add(
    "Note: differences between statuses are descriptive associations, "
    "not proof of causation or valid irrigation-need labels."
)
add()

# --------------------------------------------------
# 4. Examine water usage and duration
# --------------------------------------------------
add("4. WATER USAGE AND IRRIGATION DURATION")
add("-" * 55)

for col in [
    "water_used_liters",
    "irrigation_duration_minutes",
    "water_usage_efficiency",
]:
    if col in df.columns:
        values = pd.to_numeric(df[col], errors="coerce")
        add(f"{col}:")
        add(f"  Missing after numeric conversion: {values.isna().sum()}")
        add(f"  Minimum: {values.min()}")
        add(f"  Median: {values.median()}")
        add(f"  Maximum: {values.max()}")
        add(f"  Zero values: {(values == 0).sum()}")

add()
add(
    "Decision: water_used_liters will not be renamed to "
    "required_water_liters without evidence that both mean the same thing."
)
add()

# --------------------------------------------------
# 5. Check weather-column relationships
# --------------------------------------------------
add("5. WEATHER COLUMN COMPARISONS")
add("-" * 55)

pairs = [
    ("temperature_c", "temperature"),
    ("humidity_percent", "humidity"),
    ("rainfall_mm_per_hr", "rainfall"),
]

for first, second in pairs:
    if first not in df.columns or second not in df.columns:
        add(f"{first} vs {second}: one or both columns missing.")
        continue

    a = pd.to_numeric(df[first], errors="coerce")
    b = pd.to_numeric(df[second], errors="coerce")
    valid = a.notna() & b.notna()

    add(f"{first} vs {second}:")
    add(f"  Valid paired rows: {valid.sum()}")
    add(f"  Exact matches: {(a[valid] == b[valid]).sum()}")

    if valid.sum() > 1:
        add(f"  Mean absolute difference: {(a[valid] - b[valid]).abs().mean():.6f}")
        add(f"  Correlation: {a[valid].corr(b[valid]):.6f}")

    add()

add(
    "Decision: columns with different scales or unclear meanings "
    "must not be treated as interchangeable."
)
add()

# --------------------------------------------------
# 6. Check the provenance and timestamps
# --------------------------------------------------
add("6. DATA PROVENANCE AND TIMESTAMPS")
add("-" * 55)

if "data_origin" in df.columns:
    add("Data-origin counts:")
    add(df["data_origin"].value_counts(dropna=False).to_string())
else:
    add("data_origin column not found.")

if "timestamp" in df.columns:
    timestamps = pd.to_datetime(
        df["timestamp"], errors="coerce", utc=True
    )
    add(f"Invalid timestamps: {timestamps.isna().sum()}")

    if timestamps.notna().any():
        add(f"Earliest timestamp: {timestamps.min()}")
        add(f"Latest timestamp: {timestamps.max()}")

add()
add(
    "The current dataset is reported as synthetic or synthetic-augmented. "
    "Model results must not be presented as proof of real-world performance."
)
add()

# --------------------------------------------------
# 7. Final decisions
# --------------------------------------------------
add("7. CURRENT TARGET DECISIONS")
add("-" * 55)
add(
    "Classification target: irrigation_needed. "
    "Status: NOT YET AVAILABLE AS A VERIFIED LABEL."
)
add(
    "Regression target: required_water_liters. "
    "Status: NOT YET VERIFIED."
)
add(
    "irrigation_status: retain for investigation; do not automatically "
    "use as the irrigation-needed target."
)
add(
    "water_used_liters: retain for investigation; do not automatically "
    "use as the required-water target."
)
add(
    "Do not create target labels from arbitrary thresholds. "
    "Any rule-generated target must be explicitly documented as a proxy."
)
add(
    "Next: finalize the feature list and decide whether a defensible "
    "rule-based prototype is possible."
)

REPORT_FILE.write_text("\n".join(report), encoding="utf-8")

print("Target assessment completed.")
print(f"Input rows: {len(df)}")
print(f"Input columns: {len(df.columns)}")
print(f"Report saved to: {REPORT_FILE}")
print("The input dataset was not modified.")
