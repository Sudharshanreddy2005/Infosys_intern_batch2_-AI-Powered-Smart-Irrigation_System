import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / "model3" / "zone4_ridge.joblib"
CONFIG = ROOT / "model3" / "model3_config.json"
SAMPLE = {
    "weather_temp": 28.0,
    "weather_humidity": 55.0,
    "weather_rain": 1.0,
    "weather_pressure": 1012.0,
    "weather_wind_speed": 2.5,
    "weather_radiation": 18.0,
    "soil_temperature_0-7cm": 25.0,
    "soil_temperature_7-18cm": 24.0,
    "month": 6,
    "day": 15,
    "hour": 12,
    "day_period": 2,
    "quarter": 2,
}


def test_model3_config_and_artifact_contract():
    config = json.loads(CONFIG.read_text())
    model = joblib.load(ARTIFACT)
    features = config["zones"]["4"]["features"]
    assert features == list(model.feature_names_in_)
    assert config["target"] == "target_moisture_24h"


def test_model3_zone4_predicts_finite_change():
    model = joblib.load(ARTIFACT)
    prediction = float(model.predict(pd.DataFrame([SAMPLE]))[0])
    assert np.isfinite(prediction)


def test_model3_rejects_missing_features():
    model = joblib.load(ARTIFACT)
    missing = dict(SAMPLE)
    del missing["quarter"]
    with pytest.raises((KeyError, ValueError)):
        model.predict(pd.DataFrame([missing]))
