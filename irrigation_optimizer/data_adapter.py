"""
Team dataset / sensor format -> optimizer FieldConfig.

Dataset (data/cleaned_dataset.csv):
  label        -> crop name ("rice", "maize", ...)
  growth_stage -> int 1/2/3
  soil_type    -> int 1/2/3
  soil_moisture-> PERCENT 0-100 (sensor schema: ge=0, le=100)

Codes confirmed by the team leader:
  growth_stage: 1 Seedling, 2 Vegetative, 3 Flowering/Fruiting
  soil_type   : 1 Sandy,   2 Loamy,      3 Clay
For Kc: Seedling -> initial, Vegetative -> development (between initial and mid),
Flowering/Fruiting -> mid (peak water demand). A "late" (ripening) stage is not in the dataset.
"""
from typing import Optional

from .models import FieldConfig

GROWTH_STAGE_MAP = {1: "initial", 2: "development", 3: "mid"}
SOIL_TYPE_MAP = {1: "sandy", 2: "loam", 3: "clay"}


def moisture_pct_to_fraction(pct: float) -> float:
    """The sensor reports 0-100 %, the optimizer expects a 0-1 fraction."""
    if not 0 <= pct <= 100:
        raise ValueError(f"soil moisture {pct} is outside 0-100")
    return pct / 100.0


def make_field(field_id: str, crop_label: str, growth_stage_code: int, soil_type_code: int,
               soil_moisture_pct: Optional[float], area_m2: float, pump_flow_lpm: float,
               irrigation_method: str, latitude: float = 26.12, pump_id: str = "pump-1") -> FieldConfig:
    return FieldConfig(
        field_id=field_id,
        crop=crop_label.strip().lower(),
        growth_stage=GROWTH_STAGE_MAP[growth_stage_code],
        area_m2=area_m2,
        soil_type=SOIL_TYPE_MAP[soil_type_code],
        latitude=latitude,
        irrigation_method=irrigation_method,
        pump_flow_lpm=pump_flow_lpm,
        pump_id=pump_id,
        soil_moisture=None if soil_moisture_pct is None else moisture_pct_to_fraction(soil_moisture_pct),
    )
