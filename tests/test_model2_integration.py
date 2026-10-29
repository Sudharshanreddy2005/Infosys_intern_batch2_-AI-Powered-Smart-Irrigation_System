
from pathlib import Path

import pytest

import model2_integration


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LEGACY_ARTIFACT = (
    PROJECT_ROOT
    / "backend"
    / "models"
    / "model2"
    / "model2_water_requirement.joblib"
)


def test_legacy_model2_artifact_is_not_assumed_to_be_compatible():
    """The legacy artifact must not be assumed loadable or production-ready."""
    assert LEGACY_ARTIFACT.is_file()

    with pytest.raises((ValueError, AttributeError)):
        import joblib

        joblib.load(LEGACY_ARTIFACT)


def test_legacy_artifact_is_not_accepted_as_a_production_bundle(monkeypatch):
    monkeypatch.setattr(
        model2_integration,
        "MODEL2_ARTIFACT_PATH",
        LEGACY_ARTIFACT,
    )
    model2_integration.load_production_model2_bundle.cache_clear()

    try:
        with pytest.raises(
            ValueError,
            match="could not be loaded|invalid structure|feature schema",
        ):
            model2_integration.load_production_model2_bundle()
    finally:
        model2_integration.load_production_model2_bundle.cache_clear()
