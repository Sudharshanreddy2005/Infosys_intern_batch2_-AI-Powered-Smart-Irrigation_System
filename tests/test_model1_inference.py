from pathlib import Path

import pytest

from backend.models.model1.inference import load_artifact_bundle, predict_records


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "backend" / "models" / "model1" / "artifacts"


def test_reduced_weather_artifact_predicts_with_expected_contract():
    bundle = load_artifact_bundle(ARTIFACTS / "reduced_weather_proxy_v1.joblib")

    result = predict_records(
        bundle,
        [{"temperature_c": 25.0, "humidity_percent": 60.0}],
    )[0]

    assert result["prediction"] in (0, 1)
    assert 0 <= result["proxy_positive_probability"] <= 1
    assert result["target"] == "irrigation_needed_proxy"


def test_full_model_rejects_missing_features():
    bundle = load_artifact_bundle(
        ARTIFACTS
        / "random_forest_without_soil_moisture_tuned_candidate_v3.joblib"
    )

    with pytest.raises(ValueError, match="schema mismatch"):
        predict_records(bundle, [{"temperature_c": 25.0}])


def test_missing_artifact_is_reported():
    with pytest.raises(FileNotFoundError, match="Model 1 artifact not found"):
        load_artifact_bundle(ARTIFACTS / "missing.joblib")
