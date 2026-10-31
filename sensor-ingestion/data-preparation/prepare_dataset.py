
from pathlib import Path
import pandas as pd

# --------------------------------------------------
# 1. File paths
# --------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]

RAW_FILE = (
    PROJECT_ROOT
    / "sensor-ingestion"
    / "data"
    / "raw"
    / "Smart_Irrigation_Final_8500_Rows.csv"
)

OUTPUT_DIR = SCRIPT_DIR / "output"
REPORT_DIR = SCRIPT_DIR / "reports"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
REPORT_DIR.mkdir(parents=True, exist_ok=True)

CLEANED_FILE = OUTPUT_DIR / "cleaned_dataset_m2.csv"
REPORT_FILE = REPORT_DIR / "preparation_report.txt"
MISSING_FILE = REPORT_DIR / "missing_values_m2.csv"
FLAGS_FILE = REPORT_DIR / "data_quality_flags.csv"


# --------------------------------------------------
# 2. Define known column types
# --------------------------------------------------
NUMERIC_COLUMNS = [
    "synthetic_record_number",
    "growth_stage",
    "crop_density",
    "soil_type",
    "soil_moisture",
    "N", "P", "K",
    "ph",
    "organic_matter",
    "temperature_c",
    "temperature",
    "humidity_percent",
    "humidity",
    "rainfall_mm_per_hr",
    "rainfall",
    "rain_probability_percent",
    "sunlight_exposure",
    "wind_speed",
    "co2_concentration",
    "frost_risk",
    "urban_area_proximity",
    "pest_pressure",
    "fertilizer_usage",
    "irrigation_frequency",
    "irrigation_duration_minutes",
    "water_used_liters",
    "water_usage_efficiency",
    "water_source_type",
]

MISSING_MARKERS = {
    "",
    "na",
    "n/a",
    "null",
    "none",
    "nan",
}

EXPECTED_COLUMNS = set(NUMERIC_COLUMNS) | {
    "timestamp",
    "field_id",
    "sensor_id",
    "label",
    "irrigation_status",
    "sensor_status",
    "data_origin",
}


# --------------------------------------------------
# 3. Load the raw dataset
# --------------------------------------------------
def main():
    if not RAW_FILE.exists():
        raise FileNotFoundError(
            f"Raw dataset not found: {RAW_FILE}"
        )

    df = pd.read_csv(
        RAW_FILE,
        keep_default_na=False,
    )

    original_rows = len(df)
    original_columns = len(df.columns)
    original_column_names = list(df.columns)

    report = [
        "SMART IRRIGATION - MILESTONE 2 PREPARATION REPORT",
        "=" * 60,
        f"Input file: {RAW_FILE.name}",
        f"Original rows: {original_rows}",
        f"Original columns: {original_columns}",
        "",
    ]

    # --------------------------------------------------
    # 4. Check the expected schema
    # --------------------------------------------------
    missing_columns = sorted(
        EXPECTED_COLUMNS - set(df.columns)
    )
    unexpected_columns = sorted(
        set(df.columns) - EXPECTED_COLUMNS
    )

    report.append("SCHEMA CHECK")
    report.append("-" * 40)
    report.append(f"Missing expected columns: {missing_columns}")
    report.append(f"Unexpected columns: {unexpected_columns}")
    report.append("")

    if missing_columns:
        raise ValueError(
            "Expected columns are missing. "
            "Review the schema before cleaning."
        )

    # --------------------------------------------------
    # 5. Normalize text values
    # --------------------------------------------------
    text_columns = df.select_dtypes(
        include=["object", "string"]
    ).columns.tolist()

    text_cells_normalized = 0
    missing_markers_found = 0

    for col in text_columns:
        original = df[col].astype("string")
        trimmed = original.str.strip()

        text_cells_normalized += int(
            (original != trimmed).fillna(False).sum()
        )

        lowered = trimmed.str.lower()
        marker_mask = lowered.isin(MISSING_MARKERS)

        missing_markers_found += int(marker_mask.sum())

        df[col] = trimmed.mask(marker_mask, pd.NA)

    report.append("TEXT NORMALIZATION")
    report.append("-" * 40)
    report.append(
        f"Text cells with surrounding whitespace: "
        f"{text_cells_normalized}"
    )
    report.append(
        f"Common missing-value markers found: "
        f"{missing_markers_found}"
    )
    report.append("")

    # --------------------------------------------------
    # 6. Convert verified numeric columns
    # --------------------------------------------------
    conversion_report = []

    for col in NUMERIC_COLUMNS:
        before = df[col].copy()
        converted = pd.to_numeric(
            before,
            errors="coerce",
        )

        newly_invalid = int(
            (before.notna() & converted.isna()).sum()
        )

        conversion_report.append(
            f"{col}: {newly_invalid} "
            "non-missing values could not be converted"
        )

        df[col] = converted

    report.append("NUMERIC CONVERSION")
    report.append("-" * 40)
    report.extend(conversion_report)
    report.append("")

    # --------------------------------------------------
    # 7. Parse timestamps
    # --------------------------------------------------
    parsed_timestamps = pd.to_datetime(
        df["timestamp"],
        errors="coerce",
        utc=True,
    )

    invalid_timestamps = int(
        parsed_timestamps.isna().sum()
    )

    report.append("TIMESTAMP VALIDATION")
    report.append("-" * 40)
    report.append(
        f"Unparseable or missing timestamps: "
        f"{invalid_timestamps}"
    )

    valid_times = parsed_timestamps.dropna()

    if not valid_times.empty:
        report.append(
            f"Earliest timestamp: {valid_times.min()}"
        )
        report.append(
            f"Latest timestamp: {valid_times.max()}"
        )

    report.append("")

    # Keep timestamps in a consistent UTC representation.
    df["timestamp"] = parsed_timestamps.dt.strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )

    # --------------------------------------------------
    # 8. Check exact duplicates without deleting them
    # --------------------------------------------------
    exact_duplicate_rows = int(
        df.duplicated().sum()
    )

    report.append("DUPLICATE CHECK")
    report.append("-" * 40)
    report.append(
        f"Exact duplicate rows after normalization: "
        f"{exact_duplicate_rows}"
    )
    report.append(
        "No rows were automatically removed."
    )
    report.append("")

    # --------------------------------------------------
    # 9. Validate values and retain row-level flags
    # --------------------------------------------------
    flags = pd.Series(
        "",
        index=df.index,
        dtype="string",
    )

    def add_flag(mask, message):
        mask = mask.fillna(False)
        flags.loc[mask] = flags.loc[mask].map(
            lambda existing: (
                f"{existing}; {message}"
                if existing
                else message
            )
        )

    # Physically bounded or non-negative variables.
    bounded_columns = {
        "soil_moisture": (0, 100),
        "humidity_percent": (0, 100),
        "humidity": (0, 100),
        "rain_probability_percent": (0, 100),
        "ph": (0, 14),
    }

    for col, (lower, upper) in bounded_columns.items():
        add_flag(
            (df[col] < lower) | (df[col] > upper),
            f"{col} outside {lower}-{upper}",
        )

    non_negative_columns = [
        "crop_density",
        "N", "P", "K",
        "organic_matter",
        "rainfall_mm_per_hr",
        "rainfall",
        "sunlight_exposure",
        "wind_speed",
        "co2_concentration",
        "frost_risk",
        "urban_area_proximity",
        "pest_pressure",
        "fertilizer_usage",
        "irrigation_frequency",
        "irrigation_duration_minutes",
        "water_used_liters",
        "water_usage_efficiency",
    ]

    for col in non_negative_columns:
        add_flag(
            df[col] < 0,
            f"{col} is negative",
        )

    add_flag(
        df["sensor_id"].isna(),
        "Missing sensor_id",
    )
    add_flag(
        df["field_id"].isna(),
        "Missing field_id",
    )
    add_flag(
        df["timestamp"].isna(),
        "Missing or invalid timestamp",
    )

    # Report suspicious identifier and category issues.
    add_flag(
        df["synthetic_record_number"].isna(),
        "Missing synthetic_record_number",
    )

    add_flag(
        df["synthetic_record_number"].duplicated(keep=False),
        "Repeated synthetic_record_number",
    )

    report.append("VALIDATION SUMMARY")
    report.append("-" * 40)

    for col, (lower, upper) in bounded_columns.items():
        count = int(
            ((df[col] < lower) | (df[col] > upper)).sum()
        )
        report.append(
            f"{col} outside {lower}-{upper}: {count}"
        )

    for col in non_negative_columns:
        count = int((df[col] < 0).sum())
        report.append(
            f"{col} negative values: {count}"
        )

    report.append(
        f"Rows with at least one quality flag: "
        f"{int(flags.ne('').sum())}"
    )
    report.append("Flagged records were retained.")
    report.append("")

    # --------------------------------------------------
    # 10. Save missing-value report
    # --------------------------------------------------
    missing_report = pd.DataFrame({
        "column_name": df.columns,
        "data_type": [
            str(df[col].dtype) for col in df.columns
        ],
        "missing_values": [
            int(df[col].isna().sum()) for col in df.columns
        ],
        "missing_percentage": [
            round(float(df[col].isna().mean() * 100), 2)
            for col in df.columns
        ],
    })

    missing_report.to_csv(
        MISSING_FILE,
        index=False,
    )

    # --------------------------------------------------
    # 11. Save flagged rows for investigation
    # --------------------------------------------------
    flag_columns = [
        col for col in [
            "synthetic_record_number",
            "timestamp",
            "field_id",
            "sensor_id",
        ]
        if col in df.columns
    ]

    flags_output = df[flag_columns].copy()
    flags_output["validation_issues"] = flags

    flags_output = flags_output[
        flags_output["validation_issues"] != ""
    ]

    flags_output.to_csv(
        FLAGS_FILE,
        index=False,
    )

    # --------------------------------------------------
    # 12. Save separate Milestone 2 outputs
    # --------------------------------------------------
    df.to_csv(
        CLEANED_FILE,
        index=False,
    )

    report.extend([
        "OUTPUT SUMMARY",
        "-" * 40,
        f"Output rows: {len(df)}",
        f"Output columns: {len(df.columns)}",
        f"Rows removed: {original_rows - len(df)}",
        f"Cleaned dataset: {CLEANED_FILE}",
        f"Missing-value report: {MISSING_FILE}",
        f"Quality flags: {FLAGS_FILE}",
        "",
        "Original raw dataset was not modified.",
        "Milestone 1 outputs were not modified.",
        "No missing values were imputed.",
        "No outliers were automatically deleted.",
    ])

    REPORT_FILE.write_text(
        "\n".join(report) + "\n",
        encoding="utf-8",
    )

    print("MILESTONE 2 DATA PREPARATION COMPLETED")
    print("=" * 45)
    print(f"Original shape: {(original_rows, original_columns)}")
    print(f"Output shape: {df.shape}")
    print(f"Rows removed: {original_rows - len(df)}")
    print(f"Rows flagged: {int(flags.ne('').sum())}")
    print(f"Missing cells after preparation: {int(df.isna().sum().sum())}")
    print(f"\nCleaned dataset: {CLEANED_FILE}")
    print(f"Preparation report: {REPORT_FILE}")
    print(f"Missing-value report: {MISSING_FILE}")
    print(f"Quality flags: {FLAGS_FILE}")


if __name__ == "__main__":
    main()
