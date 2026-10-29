from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
MODEL2_ARTIFACT_PATH = (
    PROJECT_ROOT / "model-building" / "models" / "water_requirement_regressor.joblib"
)
MODEL2_PACKAGE_PATH = PROJECT_ROOT / "model-building"


@lru_cache(maxsize=1)
def load_production_model2_bundle() -> dict:
    if not MODEL2_PACKAGE_PATH.is_dir():
        raise FileNotFoundError("The validated Model 2 integration package is unavailable.")
    if not MODEL2_ARTIFACT_PATH.is_file():
        raise FileNotFoundError(
            "The validated Model 2 production artifact is unavailable."
        )
    package_path = str(MODEL2_PACKAGE_PATH.resolve())
    if package_path not in sys.path:
        sys.path.insert(0, package_path)
    from regression.predict_water_requirement import load_model_bundle

    return load_model_bundle(
        MODEL2_ARTIFACT_PATH,
        allow_synthetic_development=False,
    )


def predict_production_model2(bundle: dict, record: dict) -> dict:
    from regression.predict_water_requirement import predict_water_requirement

    return predict_water_requirement(bundle, record)
