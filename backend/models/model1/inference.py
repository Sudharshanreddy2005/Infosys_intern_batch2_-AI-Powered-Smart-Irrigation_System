"""Backward-compatible imports for the root-level Model 1 implementation."""

from pathlib import Path

from model1.inference import (
    ARTIFACT_TYPES,
    CATEGORICAL_FEATURES,
    FEATURE_COLUMNS,
    NUMERIC_FEATURES,
    load_artifact_bundle as _load_artifact_bundle,
    predict_records,
    validate_prediction_records,
)


def load_artifact_bundle(path: str | Path):
    artifact_path = Path(path)
    if not artifact_path.is_file():
        compatibility_root = Path(__file__).resolve().parents[3] / "model1" / "artifacts"
        candidate = compatibility_root / artifact_path.name
        if candidate.is_file():
            artifact_path = candidate
    return _load_artifact_bundle(artifact_path)
