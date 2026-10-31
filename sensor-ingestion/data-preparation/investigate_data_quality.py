
from pathlib import Path
import pandas as pd

# Paths
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]

INPUT_FILE = (
    SCRIPT_DIR
    / "output"
    / "cleaned_dataset_m2.csv"
)

REPORT_DIR = SCRIPT_DIR / "reports"
REPORT_DIR.mkdir(parents=True, exist_ok=True)

REPORT_FILE = REPORT_DIR / "data_quality_decision_log.txt"


def main():
    if not INPUT_FILE.exists():
        raise FileNotFoundError(
            f"Prepared dataset not found: {INPUT_FILE}"
        )

    df = pd.read_csv(INPUT_FILE)
    report = []

    def add(text=""):
        report.append(str(text))

    add("SMART IRRIGATION - DATA QUALITY INVESTIGATION")
    add("=" * 60)
    add(f"Dataset shape: {df.shape}")
    add()

    # 1. Compare similar columns
    add("1. SIMILAR COLUMN COMPARISONS")
    add("-" * 45)

    pairs = [
        ("temperature_c", "temperature"),
        ("humidity_percent", "humidity"),
        ("rainfall_mm_per_hr", "rainfall"),
    ]

    for col1, col2 in pairs:
        if col1 in df.columns and col2 in df.columns:
            a = pd.to_numeric(df[col1], errors="coerce")
            b = pd.to_numeric(df[col2], errors="coerce")
            valid = a.notna() & b.notna()

            add(f"{col1} vs {col2}")
            add(f"  Comparable rows: {int(valid.sum())}")

            if valid.any():
                diff = (a[valid] - b[valid]).abs()
                add(f"  Exact matches: {int((diff == 0).sum())}")
                add(f"  Mean absolute difference: {diff.mean():.6f}")
                add(f"  Maximum absolute difference: {diff.max():.6f}")
                add(f"  Correlation: {a[valid].corr(b[valid]):.6f}")

                add(f"  {col1} range: {a[valid].min():.4f} to {a[valid].max():.4f}")
                add(f"  {col2} range: {b[valid].min():.4f} to {b[valid].max():.4f}")

            add()

    # 2. Categorical values
    add("2. CATEGORICAL AND CODED VALUES")
    add("-" * 45)

    categorical_columns = [
        "label",
        "growth_stage",
        "soil_type",
        "irrigation_status",
        "irrigation_frequency",
        "water_source_type",
        "sensor_status",
        "data_origin",
    ]

    for col in categorical_columns:
        if col in df.columns:
            add(f"{col}:")
            counts = df[col].value_counts(dropna=False)
            for value, count in counts.items():
                add(f"  {value}: {count}")
            add()

    # 3. Repeated sensor/timestamp combinations
    add("3. SENSOR AND TIMESTAMP CHECKS")
    add("-" * 45)

    df["timestamp_parsed"] = pd.to_datetime(
        df["timestamp"],
        errors="coerce",
        utc=True,
    )

    repeated_pairs = df.duplicated(
        subset=["sensor_id", "timestamp"],
        keep=False,
    )

    add(
        "Rows involved in repeated sensor/timestamp pairs: "
        f"{int(repeated_pairs.sum())}"
    )

    repeated_fields = df.duplicated(
        subset=["field_id", "timestamp"],
        keep=False,
    )

    add(
        "Rows involved in repeated field/timestamp pairs: "
        f"{int(repeated_fields.sum())}"
    )

    per_sensor_order = df.sort_values(
        ["sensor_id", "timestamp_parsed"]
    )

    time_gaps = (
        per_sensor_order
        .groupby("sensor_id")["timestamp_parsed"]
        .diff()
        .dropna()
        .dt.total_seconds()
        .div(60)
    )

    if not time_gaps.empty:
        add(
            "Time gaps between consecutive readings per sensor "
            "(minutes):"
        )
        add(f"  Minimum: {time_gaps.min():.2f}")
        add(f"  Median: {time_gaps.median():.2f}")
        add(f"  Maximum: {time_gaps.max():.2f}")
        add(f"  Non-positive gaps: {int((time_gaps <= 0).sum())}")

    add()

    # 4. Synthetic record metadata
    add("4. SYNTHETIC DATA REVIEW")
    add("-" * 45)

    if "data_origin" in df.columns:
        add("data_origin counts:")
        add(df["data_origin"].value_counts(dropna=False).to_string())

    if "synthetic_record_number" in df.columns:
        ids = df["synthetic_record_number"]
        add(f"Unique synthetic record numbers: {ids.nunique(dropna=True)}")
        add(f"Missing synthetic record numbers: {int(ids.isna().sum())}")

    add(
        "Note: This report cannot establish how synthetic records "
        "were generated. Confirm their provenance with the dataset "
        "creator or project documentation."
    )
    add()

    # 5. Numerical summaries with readable formatting
    add("5. NUMERIC VALUE RANGES")
    add("-" * 45)

    numeric = df.select_dtypes(include="number").drop(
        columns=["timestamp_parsed"],
        errors="ignore",
    )

    summary = numeric.describe().T[
        ["min", "50%", "max", "std"]
    ].rename(columns={"50%": "median"})

    add(summary.round(4).to_string())
    add()

    add("6. INITIAL DECISIONS")
    add("-" * 45)
    add("No columns were deleted.")
    add("No records were deleted.")
    add("No values were imputed.")
    add("Column meanings and units still require verification.")
    add("Feature selection must wait until the prediction target is agreed.")

    REPORT_FILE.write_text(
        "\n".join(report) + "\n",
        encoding="utf-8",
    )

    print("DATA QUALITY INVESTIGATION COMPLETED")
    print("=" * 45)
    print(f"Dataset shape: {df.shape[0]} rows x {df.shape[1] - 1} original columns")
    print(f"Report saved to: {REPORT_FILE}")


if __name__ == "__main__":
    main()
