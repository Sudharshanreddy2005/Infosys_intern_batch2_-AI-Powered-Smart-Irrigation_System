
from pathlib import Path
import pandas as pd

# This script is inside sensor-ingestion/data-preparation/
# parents[1] points to the sensor-ingestion folder.
BASE_DIR = Path(__file__).resolve().parents[1]

INPUT_FILE = (
    BASE_DIR
    / "data"
    / "raw"
    / "Smart_Irrigation_Final_8500_Rows.csv"
)

REPORT_DIR = BASE_DIR / "data-preparation" / "reports"


def main():
    if not INPUT_FILE.exists():
        raise FileNotFoundError(
            f"Dataset not found:\n{INPUT_FILE}"
        )

    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    # Read the original data without modifying it.
    df = pd.read_csv(INPUT_FILE)

    # 1. Build a column-by-column profile.
    profile = pd.DataFrame({
        "column_name": df.columns,
        "data_type": [
            str(df[col].dtype) for col in df.columns
        ],
        "missing_values": [
            int(df[col].isna().sum()) for col in df.columns
        ],
        "missing_percent": [
            round(df[col].isna().mean() * 100, 2)
            for col in df.columns
        ],
        "unique_values": [
            int(df[col].nunique(dropna=True))
            for col in df.columns
        ],
    })

    profile.to_csv(
        REPORT_DIR / "column_profile.csv",
        index=False
    )

    # 2. Save missing-value counts.
    missing = profile[
        ["column_name", "missing_values", "missing_percent"]
    ].copy()

    missing.to_csv(
        REPORT_DIR / "missing_values.csv",
        index=False
    )

    # 3. Collect general checks.
    lines = [
        "SMART IRRIGATION - DATA INSPECTION REPORT",
        "=" * 55,
        "",
        f"Input file: {INPUT_FILE.name}",
        f"Rows: {len(df)}",
        f"Columns: {len(df.columns)}",
        f"Exact duplicate rows: {int(df.duplicated().sum())}",
        f"Total missing cells: {int(df.isna().sum().sum())}",
        "",
        "COLUMN PROFILE",
        "-" * 55,
    ]

    for _, row in profile.iterrows():
        lines.append(
            f"{row['column_name']}: "
            f"type={row['data_type']}, "
            f"missing={row['missing_values']} "
            f"({row['missing_percent']}%), "
            f"unique={row['unique_values']}"
        )

    # 4. Check repeated IDs without deleting them.
    lines.extend([
        "",
        "IDENTIFIER CHECKS",
        "-" * 55,
    ])

    for col in ["synthetic_record_number", "sensor_id", "field_id"]:
        if col in df.columns:
            repeated_rows = int(
                df[col].notna().sum() - df[col].nunique()
            )
            lines.append(
                f"{col}: unique={df[col].nunique()}, "
                f"repeated non-missing values beyond first "
                f"occurrence={repeated_rows}"
            )

    # 5. Inspect the data origin categories.
    lines.extend([
        "",
        "DATA ORIGIN COUNTS",
        "-" * 55,
    ])

    if "data_origin" in df.columns:
        origin_counts = df["data_origin"].value_counts(
            dropna=False
        )
        for value, count in origin_counts.items():
            lines.append(f"{value}: {count}")

    # 6. Check timestamp parsing without changing the column.
    lines.extend([
        "",
        "TIMESTAMP CHECK",
        "-" * 55,
    ])

    if "timestamp" in df.columns:
        parsed = pd.to_datetime(
            df["timestamp"], errors="coerce", utc=True
        )
        invalid_count = int(
            (df["timestamp"].notna() & parsed.isna()).sum()
        )
        lines.append(f"Unparseable timestamps: {invalid_count}")

        if parsed.notna().any():
            lines.append(
                f"Earliest parsed timestamp: {parsed.min()}"
            )
            lines.append(
                f"Latest parsed timestamp: {parsed.max()}"
            )

    # 7. Investigate similar columns.
    # This compares values; it does not remove any column.
    lines.extend([
        "",
        "SIMILAR COLUMN CHECKS",
        "-" * 55,
    ])

    column_pairs = [
        ("temperature_c", "temperature"),
        ("humidity_percent", "humidity"),
        ("rainfall_mm_per_hr", "rainfall"),
    ]

    for col1, col2 in column_pairs:
        if col1 in df.columns and col2 in df.columns:
            a = pd.to_numeric(df[col1], errors="coerce")
            b = pd.to_numeric(df[col2], errors="coerce")
            valid = a.notna() & b.notna()

            if valid.any():
                difference = (a[valid] - b[valid]).abs()
                lines.append(
                    f"{col1} vs {col2}: "
                    f"comparable rows={int(valid.sum())}, "
                    f"identical values={(difference == 0).sum()}, "
                    f"mean absolute difference="
                    f"{difference.mean():.6f}, "
                    f"maximum absolute difference="
                    f"{difference.max():.6f}"
                )

    # 8. Numeric summaries for further review.
    lines.extend([
        "",
        "NUMERIC SUMMARY",
        "-" * 55,
    ])

    numeric_df = df.select_dtypes(include="number")

    if not numeric_df.empty:
        lines.append(
            numeric_df.describe().round(3).to_string()
        )
    else:
        lines.append("No numeric columns detected.")

    # 9. Save the report.
    report_file = REPORT_DIR / "inspection_report.txt"
    report_file.write_text(
        "\n".join(lines), encoding="utf-8"
    )

    print("DATASET INSPECTION COMPLETED")
    print("=" * 45)
    print(f"Dataset shape: {df.shape}")
    print(f"Missing cells: {int(df.isna().sum().sum())}")
    print(f"Exact duplicate rows: {int(df.duplicated().sum())}")
    print(f"\nReports saved in:\n{REPORT_DIR}")
    print("- inspection_report.txt")
    print("- column_profile.csv")
    print("- missing_values.csv")
    print("\nThe original dataset was not modified.")


if __name__ == "__main__":
    main()
