"""Safe, project-local inference helpers for the Model 1 proxy classifiers.

The artifacts contain fitted scikit-learn preprocessing and estimators. They
must only be loaded from trusted project-managed paths.
"""

from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline

ARTIFACT_TYPES = {
    "irrigation-proxy-classification-demo",
    "irrigation-proxy-generalization-candidate",
}
FEATURE_COLUMNS = [
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
    "crop_name",
    "soil_type",
    "growth_stage",
]
NUMERIC_FEATURES = set(FEATURE_COLUMNS[:13])
CATEGORICAL_FEATURES = set(FEATURE_COLUMNS[13:])


def load_artifact_bundle(path: str | Path) -> dict[str, Any]:
    artifact_path = Path(path)
    if not artifact_path.is_file():
        raise FileNotFoundError(f"Model 1 artifact not found: {artifact_path}")
    bundle = joblib.load(artifact_path)
    if not isinstance(bundle, dict) or bundle.get("artifact_type") not in ARTIFACT_TYPES:
        raise ValueError("Artifact is not a supported Model 1 proxy model bundle.")
    pipeline = bundle.get("pipeline")
    if not isinstance(pipeline, Pipeline):
        raise ValueError("Model 1 artifact does not contain a fitted Pipeline.")
    metadata = bundle.get("metadata")
    if not isinstance(metadata, dict):
        raise ValueError("Model 1 artifact metadata is missing or malformed.")
    names = metadata.get("feature_names")
    if not isinstance(names, list) or not names:
        raise ValueError("Model 1 feature schema is missing or malformed.")
    if any(name not in FEATURE_COLUMNS for name in names):
        raise ValueError("Model 1 feature schema contains unknown names.")
    fitted_names = getattr(pipeline, "feature_names_in_", None)
    if fitted_names is None or list(fitted_names) != names:
        raise ValueError("Model 1 metadata does not match the fitted pipeline.")
    return bundle


def validate_prediction_records(
    records: list[dict[str, Any]], metadata: dict[str, Any]
) -> pd.DataFrame:
    if not isinstance(records, list) or not records:
        raise ValueError("Prediction input must be a non-empty JSON array of records.")
    feature_names = metadata.get("feature_names")
    allowed_categories = metadata.get("categorical_values")
    if not isinstance(feature_names, list) or not isinstance(allowed_categories, dict):
        raise ValueError("Model 1 artifact feature metadata is malformed.")

    rows = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise ValueError(f"Record {index} must be a JSON object.")
        missing = [name for name in feature_names if name not in record]
        unexpected = [name for name in record if name not in feature_names]
        if missing or unexpected:
            raise ValueError(
                f"Record {index} feature schema mismatch; "
                f"missing={missing}, unexpected={unexpected}."
            )
        row = {name: record[name] for name in feature_names}
        for name in NUMERIC_FEATURES.intersection(feature_names):
            value = row[name]
            if value is None:
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"Record {index} feature {name!r} must be numeric or null.")
            if not np.isfinite(value):
                raise ValueError(f"Record {index} feature {name!r} must be finite.")
        for name in CATEGORICAL_FEATURES.intersection(feature_names):
            value = row[name]
            if value is None:
                continue
            if name == "crop_name":
                if not isinstance(value, str) or not value.strip():
                    raise ValueError(
                        f"Record {index} feature 'crop_name' must be non-empty text or null."
                    )
            elif isinstance(value, bool) or not isinstance(value, int):
                raise ValueError(
                    f"Record {index} feature {name!r} must be an integer code or null."
                )
            if value not in allowed_categories.get(name, []):
                raise ValueError(
                    f"Record {index} feature {name!r} has an unrecognized category."
                )
        rows.append(row)
    frame = pd.DataFrame(rows, columns=feature_names)
    for name in NUMERIC_FEATURES.intersection(feature_names):
        frame[name] = pd.to_numeric(frame[name], errors="raise")
    return frame


def predict_records(
    bundle: dict[str, Any], records: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    metadata = bundle["metadata"]
    features = validate_prediction_records(records, metadata)
    pipeline = bundle["pipeline"]
    classes = list(pipeline.classes_)
    positive_index = classes.index(1)
    probabilities = pipeline.predict_proba(features)[:, positive_index]
    predictions = pipeline.predict(features)
    return [
        {
            "prediction": int(prediction),
            "proxy_positive_probability": float(probability),
            "target": metadata["target_name"],
            "warning": (
                "Synthetic proxy demonstration only; not a real irrigation-need "
                "prediction or recommendation."
            ),
        }
        for prediction, probability in zip(predictions, probabilities, strict=True)
    ]
