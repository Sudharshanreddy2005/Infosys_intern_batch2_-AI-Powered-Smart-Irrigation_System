
from pathlib import Path
import pandas as pd

BASE = Path(__file__).parent
OUTPUT = BASE / "output"
MODEL = OUTPUT / "model_ready"
REPORTS = BASE / "reports"

required_files = [
    OUTPUT / "cleaned_dataset_m2.csv",
    MODEL / "features_all.csv",
    MODEL / "proxy_target_all.csv",
    MODEL / "X_train_demo.csv",
    MODEL / "X_test_demo.csv",
    MODEL / "y_train_proxy_demo.csv",
    MODEL / "y_test_proxy_demo.csv",
    REPORTS / "feature_dictionary.csv",
    REPORTS / "feature_engineering_report.txt",
    REPORTS / "preparation_report.txt",
    REPORTS / "target_assessment_report.txt",
]

print("=" * 55)
print("MILESTONE 2 - FINAL HANDOFF VERIFICATION")
print("=" * 55)

missing_files = [str(f.relative_to(BASE)) for f in required_files if not f.exists()]
if missing_files:
    print("\nFAIL: Required files are missing:")
    for f in missing_files:
        print(" -", f)
    raise SystemExit(1)

print("\nPASS: All required dataset and report files exist.")

cleaned = pd.read_csv(OUTPUT / "cleaned_dataset_m2.csv")
X = pd.read_csv(MODEL / "features_all.csv")
y = pd.read_csv(MODEL / "proxy_target_all.csv")
X_train = pd.read_csv(MODEL / "X_train_demo.csv")
X_test = pd.read_csv(MODEL / "X_test_demo.csv")
y_train = pd.read_csv(MODEL / "y_train_proxy_demo.csv")
y_test = pd.read_csv(MODEL / "y_test_proxy_demo.csv")

print("\nDataset shapes:")
for name, df in [
    ("Cleaned dataset", cleaned),
    ("All features", X),
    ("All proxy targets", y),
    ("X_train", X_train),
    ("X_test", X_test),
    ("y_train", y_train),
    ("y_test", y_test),
]:
    print(f"{name}: {df.shape}")

errors = []

if cleaned.shape != (8500, 36):
    errors.append("Cleaned dataset is not 8500 rows x 36 columns.")

if X.shape != (8500, 16):
    errors.append("features_all.csv is not 8500 rows x 16 columns.")

if y.shape != (8500, 1):
    errors.append("proxy_target_all.csv is not 8500 rows x 1 column.")

if X_train.shape != (6800, 16) or X_test.shape != (1700, 16):
    errors.append("Training/testing feature shapes are incorrect.")

if y_train.shape != (6800, 1) or y_test.shape != (1700, 1):
    errors.append("Training/testing target shapes are incorrect.")

if X.isna().any().any() or y.isna().any().any():
    errors.append("Missing values found in model-ready features or target.")

if list(X.columns) != list(X_train.columns) or list(X.columns) != list(X_test.columns):
    errors.append("Feature columns differ between full, training, and testing files.")

if not X_train.reset_index(drop=True).equals(X.iloc[:6800].reset_index(drop=True)):
    errors.append("X_train does not match the first 6800 feature rows.")

if not X_test.reset_index(drop=True).equals(X.iloc[6800:].reset_index(drop=True)):
    errors.append("X_test does not match the last 1700 feature rows.")

if not y_train.reset_index(drop=True).equals(y.iloc[:6800].reset_index(drop=True)):
    errors.append("y_train does not match the first 6800 target rows.")

if not y_test.reset_index(drop=True).equals(y.iloc[6800:].reset_index(drop=True)):
    errors.append("y_test does not match the last 1700 target rows.")

if "soil_moisture" not in X.columns:
    errors.append("soil_moisture is missing from the feature data.")
else:
    expected_target = (X["soil_moisture"] <= 20.0).astype(int)
    actual_target = pd.to_numeric(y.iloc[:, 0], errors="coerce")
    if actual_target.isna().any() or not actual_target.reset_index(drop=True).equals(
        expected_target.reset_index(drop=True)
    ):
        errors.append("Proxy target does not match the documented soil-moisture rule.")

if "timestamp" in cleaned.columns:
    timestamps = pd.to_datetime(cleaned["timestamp"], errors="coerce", utc=True)
    print("\nTimestamp checks:")
    print("Invalid timestamps:", int(timestamps.isna().sum()))
    print("Chronologically ordered:", bool(timestamps.is_monotonic_increasing))
    if timestamps.isna().any() or not timestamps.is_monotonic_increasing:
        errors.append(
            "Cleaned dataset timestamps are invalid or not sorted. "
            "Confirm the chronological ordering used by feature_engineering.py."
        )
    else:
        print("Last training timestamp:", timestamps.iloc[6799])
        print("First test timestamp:", timestamps.iloc[6800])

print("\nFeature columns:")
print(", ".join(X.columns))

print("\nProxy target distribution:")
print(y.iloc[:, 0].value_counts(dropna=False).sort_index().to_string())

print("\nDuplicate feature rows (review only; not automatically an error):",
      int(X.duplicated().sum()))

if errors:
    print("\nVERIFICATION FAILED:")
    for error in errors:
        print(" -", error)
    raise SystemExit(1)

print("\nPASS: File shapes, split alignment, missing values, and proxy rule verified.")
print("NOTE: This does not validate real-world irrigation prediction accuracy.")
