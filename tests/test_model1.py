from pathlib import Path

import pytest

from model1.inference import load_artifact_bundle, predict_records


ROOT = Path(__file__).resolve().parents[1]
FULL_ARTIFACT = ROOT / "model1" / "artifacts" / "random_forest_without_soil_moisture_tuned_candidate_v3.joblib"
WEATHER_ARTIFACT = ROOT / "model1" / "artifacts" / "reduced_weather_proxy_v1.joblib"


FULL_SAMPLE = {
    "temperature_c": 25.0,
    "humidity_percent": 60.0,
    "rain_probability_percent": 10.0,
    "N": 80.0,
    "P": 40.0,
    "K": 50.0,
    "ph": 6.5,
    "organic_matter": 2.0,
    "crop_density": 1.0,
    "sunlight_exposure": 8.0,
    "wind_speed": 2.0,
    "frost_risk": 0.0,
    "crop_name": "maize",
    "soil_type": 2,
    "growth_stage": 2,
}


def test_full_model_loads_and_predicts():
    bundle = load_artifact_bundle(FULL_ARTIFACT)
    result = predict_records(bundle, [FULL_SAMPLE])[0]
    assert result["prediction"] in (0, 1)
    assert 0 <= result["proxy_positive_probability"] <= 1


def test_reduced_weather_model_loads_and_predicts():
    bundle = load_artifact_bundle(WEATHER_ARTIFACT)
    result = predict_records(
        bundle, [{"temperature_c": 25.0, "humidity_percent": 60.0}]
    )[0]
    assert result["prediction"] in (0, 1)
    assert 0 <= result["proxy_positive_probability"] <= 1


def test_model1_rejects_missing_and_invalid_features():
    bundle = load_artifact_bundle(FULL_ARTIFACT)
    missing = dict(FULL_SAMPLE)
    del missing["crop_name"]
    with pytest.raises(ValueError, match="schema mismatch"):
        predict_records(bundle, [missing])

    invalid = dict(FULL_SAMPLE)
    invalid["soil_type"] = 99
    with pytest.raises(ValueError, match="unrecognized category"):
        predict_records(bundle, [invalid])
