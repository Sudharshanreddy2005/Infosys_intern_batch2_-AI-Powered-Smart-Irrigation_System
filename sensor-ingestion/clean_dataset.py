
from pathlib import Path
import pandas as pd

# File locations relative to this script
BASE_DIR = Path(__file__).resolve().parent

INPUT_FILE = (
    BASE_DIR / "data" / "raw"
    / "Smart_Irrigation_Final_8500_Rows.csv"
)

OUTPUT_DIR = BASE_DIR / "data" / "processed"
OUTPUT_FILE = OUTPUT_DIR / "cleaned_dataset.csv"
REPORT_FILE = OUTPUT_DIR / "cleaning_report.txt"


def main():
    print("=" * 55)
    print("SMART IRRIGATION DATA CLEANING")
    print("=" * 55)

    # 1. Check that the input file exists
    if not INPUT_FILE.exists():
        raise FileNotFoundError(
            f"Input CSV not found: {INPUT_FILE}"
        )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 2. Load the original dataset
    df = pd.read_csv(INPUT_FILE)

    initial_rows = len(df)
    initial_columns = len(df.columns)
    initial_nulls = int(df.isna().sum().sum())
    initial_duplicates = int(df.duplicated().sum())

    print(f"\nInput file: {INPUT_FILE.name}")
    print(f"Original shape: {df.shape}")
    print(f"Missing cells before: {initial_nulls}")
    print(f"Duplicate rows before: {initial_duplicates}")

    # 3. Standardize column names
    df.columns = (
        df.columns.astype(str)
        .str.strip()
        .str.lower()
        .str.replace(r"[^a-z0-9]+", "_", regex=True)
        .str.strip("_")
    )

    # Stop if column names become duplicated
    if df.columns.duplicated().any():
        duplicates = df.columns[df.columns.duplicated()].tolist()
        raise ValueError(
            f"Duplicate column names after standardization: {duplicates}"
        )

    # 4. Clean text values and convert blank text to missing values
    for column in df.select_dtypes(include=["object", "string"]).columns:
        df[column] = df[column].map(
            lambda value: value.strip()
            if isinstance(value, str) else value
        )
        df[column] = df[column].replace(r"^\s*$", pd.NA, regex=True)

    nulls_after_text_cleaning = int(df.isna().sum().sum())

    # 5. Remove exact duplicate rows
    duplicates_removed = int(df.duplicated().sum())
    df = df.drop_duplicates().copy()

    # 6. Check timestamp columns if present
    timestamp_columns = [
        col for col in df.columns
        if "timestamp" in col or col in ["datetime", "date_time"]
    ]

    timestamp_results = {}
    for column in timestamp_columns:
        parsed = pd.to_datetime(df[column], errors="coerce")
        invalid_count = int(
            (df[column].notna() & parsed.isna()).sum()
        )
        timestamp_results[column] = invalid_count

    # 7. Check common ID columns if present
    id_columns = [
        col for col in df.columns
        if col in [
            "id", "record_id", "record_number",
            "synthetic_record_number", "sensor_id"
        ]
    ]

    id_results = {}
    for column in id_columns:
        id_results[column] = int(
            df[column].dropna().duplicated().sum()
        )

    # 8. Check soil moisture range only if that column exists
    range_results = {}
    moisture_columns = [
        col for col in df.columns
        if col in ["soil_moisture", "soil_moisture_percent"]
    ]

    for column in moisture_columns:
        values = pd.to_numeric(df[column], errors="coerce")
        invalid = values.notna() & ~values.between(0, 100)
        range_results[column] = int(invalid.sum())

    # 9. Save cleaned data separately
    df.to_csv(OUTPUT_FILE, index=False)

    # 10. Prepare final validation results
    final_nulls = int(df.isna().sum().sum())
    final_duplicates = int(df.duplicated().sum())
    final_rows = len(df)

    # 11. Create a text report
    with REPORT_FILE.open("w", encoding="utf-8") as report:
        report.write("SMART IRRIGATION DATA CLEANING REPORT\n")
        report.write("=" * 45 + "\n\n")
        report.write(f"Input file: {INPUT_FILE.name}\n")
        report.write(f"Output file: {OUTPUT_FILE.name}\n")
        report.write(f"Rows before cleaning: {initial_rows}\n")
        report.write(f"Rows after cleaning: {final_rows}\n")
        report.write(f"Columns before cleaning: {initial_columns}\n")
        report.write(f"Columns after cleaning: {len(df.columns)}\n")
        report.write(f"Missing cells before: {initial_nulls}\n")
        report.write(
            "Missing cells after text cleanup: "
            f"{nulls_after_text_cleaning}\n"
        )
        report.write(f"Missing cells after cleaning: {final_nulls}\n")
        report.write(
            f"Exact duplicate rows before: {initial_duplicates}\n"
        )
        report.write(f"Duplicate rows removed: {duplicates_removed}\n")
        report.write(f"Exact duplicate rows after: {final_duplicates}\n")

        report.write("\nTIMESTAMP CHECKS\n")
        report.write("-" * 45 + "\n")
        if timestamp_results:
            for col, count in timestamp_results.items():
                report.write(f"{col}: {count} invalid timestamps\n")
        else:
            report.write("No recognized timestamp column found.\n")

        report.write("\nID DUPLICATE CHECKS\n")
        report.write("-" * 45 + "\n")
        if id_results:
            for col, count in id_results.items():
                report.write(f"{col}: {count} duplicate IDs\n")
        else:
            report.write("No recognized ID column found.\n")

        report.write("\nRANGE CHECKS\n")
        report.write("-" * 45 + "\n")
        if range_results:
            for col, count in range_results.items():
                report.write(f"{col}: {count} out-of-range values\n")
        else:
            report.write("No recognized soil moisture column found.\n")

        report.write("\nMISSING VALUES BY COLUMN\n")
        report.write("-" * 45 + "\n")
        for col, count in df.isna().sum().items():
            report.write(f"{col}: {int(count)} missing values\n")

        report.write("\nDATA NOTE\n")
        report.write("-" * 45 + "\n")
        report.write(
            "Cleaning checks do not prove that every value is "
            "accurate or realistic. Confirm column meanings, units, "
            "and data origin before using the dataset for analysis.\n"
        )

    # 12. Display results in the terminal
    print("\nCLEANING FINISHED")
    print("=" * 55)
    print(f"Output file: {OUTPUT_FILE}")
    print(f"Report file: {REPORT_FILE}")
    print(f"Rows after cleaning: {final_rows}")
    print(f"Columns after cleaning: {len(df.columns)}")
    print(f"Missing cells after cleaning: {final_nulls}")
    print(f"Duplicate rows after cleaning: {final_duplicates}")
    print("\nPlease review the report before sharing.")


if __name__ == "__main__":
    main()
