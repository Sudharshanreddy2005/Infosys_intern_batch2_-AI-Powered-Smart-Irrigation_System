from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd


ARTIFACT_FILENAME = "model4_crop_stress.joblib"
ARTIFACT_SHA256 = "72dc2b6369ead784a959c75275f048a7dae28096fdfe0ee2b08648763ef8a177"
FEATURE_NAMES = (
    "soil_type",
    "bulk_density",
    "organic_matter_pct",
    "cation_exchange_capacity",
    "salinity_ec",
    "buffering_capacity",
    "soil_moisture_pct",
    "moisture_limit_dry",
    "moisture_limit_wet",
    "moisture_regime",
    "soil_temp_c",
    "air_temp_c",
    "thermal_regime",
    "light_intensity_par",
    "soil_ph",
    "nitrogen_ppm",
    "phosphorus_ppm",
    "potassium_ppm",
    "nutrient_balance",
    "plant_category",
)


def build_input_frame(values: dict[str, Any]) -> pd.DataFrame:
    missing = [name for name in FEATURE_NAMES if name not in values]
    if missing:
        raise ValueError(f"Missing Model 4 features: {', '.join(missing)}")
    return pd.DataFrame(
        [{name: values[name] for name in FEATURE_NAMES}],
        columns=FEATURE_NAMES,
    )


def predict(model: Any, values: dict[str, Any]) -> dict[str, Any]:
    frame = build_input_frame(values)
    prediction = int(model.predict(frame)[0])
    probabilities = (
        model.predict_proba(frame)[0]
        if hasattr(model, "predict_proba")
        else None
    )
    classes = list(model.classes_) if probabilities is not None else []
    return {
        "predicted_class": prediction,
        "class_label_status": "unverified",
        "class_probabilities": (
            {
                str(int(class_label)): float(probability)
                for class_label, probability in zip(classes, probabilities)
            }
            if probabilities is not None
            else None
        ),
        "confidence": (
            float(probabilities[classes.index(prediction)])
            if probabilities is not None and prediction in classes
            else None
        ),
        "probability_interpretation": (
            "model_estimated_probability" if probabilities is not None else None
        ),
    }


def artifact_path(base_dir: Path) -> Path:
    return base_dir / "model4" / ARTIFACT_FILENAME
