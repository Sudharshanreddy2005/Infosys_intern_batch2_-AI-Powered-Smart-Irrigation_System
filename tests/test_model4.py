from pathlib import Path
import hashlib

import joblib
import numpy as np
import pandas as pd
import pytest

from model4.inference import ARTIFACT_SHA256, FEATURE_NAMES, build_input_frame, predict


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / "model4" / "model4_crop_stress.joblib"
SAMPLE = {
    "soil_type": "Loamy",
    "bulk_density": 1.3,
    "organic_matter_pct": 2.5,
    "cation_exchange_capacity": 18.0,
    "salinity_ec": 0.8,
    "buffering_capacity": 7.0,
    "soil_moisture_pct": 35.0,
    "moisture_limit_dry": 20.0,
    "moisture_limit_wet": 60.0,
    "moisture_regime": "optimal",
    "thermal_regime": "optimal",
    "nutrient_balance": "optimal",
    "plant_category": "cereal",
    "soil_temp_c": 24.0,
    "air_temp_c": 28.0,
    "light_intensity_par": 500.0,
    "soil_ph": 6.8,
    "nitrogen_ppm": 45.0,
    "phosphorus_ppm": 25.0,
    "potassium_ppm": 40.0,
}


def test_original_model4_artifact_is_available():
    assert ARTIFACT.is_file()
    model = joblib.load(ARTIFACT)
    assert hasattr(model, "predict")
    assert hasattr(model, "feature_names_in_")
    assert len(model.feature_names_in_) == 20
    assert tuple(model.feature_names_in_) == FEATURE_NAMES


def test_model4_artifact_checksum_matches_verified_source():
    digest = hashlib.sha256()
    with ARTIFACT.open("rb") as artifact:
        for chunk in iter(lambda: artifact.read(1024 * 1024), b""):
            digest.update(chunk)
    assert digest.hexdigest() == ARTIFACT_SHA256


def test_model4_predict_and_probability_contract():
    model = joblib.load(ARTIFACT)
    frame = pd.DataFrame([SAMPLE], columns=model.feature_names_in_)
    prediction = int(model.predict(frame)[0])
    probabilities = model.predict_proba(frame)[0]
    assert prediction in (0, 1, 2)
    assert len(probabilities) == 3
    assert np.isclose(probabilities.sum(), 1.0)
    assert 0 <= float(probabilities[prediction]) <= 1


def test_model4_rejects_missing_feature():
    model = joblib.load(ARTIFACT)
    missing = dict(SAMPLE)
    del missing["plant_category"]
    with pytest.raises((KeyError, ValueError)):
        model.predict(pd.DataFrame([missing]))


def test_model4_inference_returns_unverified_numeric_class_and_probability():
    model = joblib.load(ARTIFACT)
    result = predict(model, SAMPLE)
    assert result["predicted_class"] in (0, 1, 2)
    assert result["class_label_status"] == "unverified"
    assert result["confidence"] == result["class_probabilities"][str(result["predicted_class"])]


def test_model4_input_builder_rejects_missing_feature():
    missing = dict(SAMPLE)
    del missing["plant_category"]
    with pytest.raises(ValueError, match="plant_category"):
        build_input_frame(missing)
