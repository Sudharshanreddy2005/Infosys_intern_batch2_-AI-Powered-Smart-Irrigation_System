import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / "model2" / "model2_water_requirement.joblib"
CONFIG = ROOT / "model2" / "model2_config.json"
SAMPLE = {
    "crop_type": "wheat",
    "growth_stage": 2,
    "soil_type": 2,
    "soil_moisture_percent": 25.0,
    "temperature_c": 28.0,
    "humidity_percent": 55.0,
    "rainfall_mm": 1.0,
    "forecast_rainfall_mm": 2.0,
    "field_area_acres": 2.0,
    "irrigation_method": "drip",
    "wind_speed": 2.5,
    "et0_mm_day": 4.0,
    "crop_coefficient_kc": 1.0,
    "previous_irrigation_mm": 0.0,
}


def test_model2_config_and_artifact_contract():
    config = json.loads(CONFIG.read_text())
    model = joblib.load(ARTIFACT)
    assert config["input_features"] == list(model.feature_names_in_)
    assert config["target"] == "required_water_liters"
    assert config["non_negative_predictions"] is True


def test_model2_predicts_nonnegative_liters():
    model = joblib.load(ARTIFACT)
    prediction = float(model.predict(pd.DataFrame([SAMPLE]))[0])
    assert np.isfinite(prediction)
    assert prediction >= 0


def test_model2_rejects_missing_features():
    model = joblib.load(ARTIFACT)
    missing = dict(SAMPLE)
    del missing["rainfall_mm"]
    with pytest.raises((KeyError, ValueError)):
        model.predict(pd.DataFrame([missing]))
