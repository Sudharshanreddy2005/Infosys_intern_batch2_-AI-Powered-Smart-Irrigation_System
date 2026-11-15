
from pathlib import Path

import json
import joblib
import pandas as pd
import pytest

import model2_integration


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LEGACY_ARTIFACT = (
    PROJECT_ROOT
    / "model2"
    / "model2_water_requirement.joblib"
)
MODEL2_CONFIG = PROJECT_ROOT / "model2" / "model2_config.json"


def test_legacy_model2_artifact_loads_and_predicts_with_declared_schema():
    """The active Model 2 pipeline must remain directly usable by its API."""
    assert LEGACY_ARTIFACT.is_file()
    model = joblib.load(LEGACY_ARTIFACT)
    config = json.loads(MODEL2_CONFIG.read_text())
    assert list(model.feature_names_in_) == config["input_features"]

    record = {
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
    prediction = float(model.predict(pd.DataFrame([record]))[0])
    assert prediction >= 0


def test_validated_production_bundle_remains_fail_closed_when_unavailable():
    model2_integration.load_production_model2_bundle.cache_clear()

    try:
        with pytest.raises(
            FileNotFoundError,
            match="validated Model 2 (integration package|production artifact) is unavailable",
        ):
            model2_integration.load_production_model2_bundle()
    finally:
        model2_integration.load_production_model2_bundle.cache_clear()
