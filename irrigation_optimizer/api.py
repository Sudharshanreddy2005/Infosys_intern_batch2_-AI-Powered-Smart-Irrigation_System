"""
FastAPI router for the irrigation optimizer.

Add to main.py (the endpoint calls the paid weather API, so protect it with the app's auth):

    from irrigation_optimizer.api import router as irrigation_router
    app.include_router(irrigation_router, dependencies=[Depends(irrigation_guard)])

POST /api/irrigation/plan
"""
import logging
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from . import weather_adapter
from .data_adapter import make_field
from .optimizer import optimize_schedule, plans_to_dicts
from . import config, water_calc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/irrigation", tags=["irrigation"])


class FieldIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_id: str = Field(min_length=1, max_length=80)
    crop: str = Field(min_length=1, max_length=80)
    growth_stage_code: int = Field(ge=1, le=3)    # 1 Seedling, 2 Vegetative, 3 Flowering/Fruiting
    soil_type_code: int = Field(ge=1, le=3)       # 1 Sandy, 2 Loamy, 3 Clay
    soil_moisture_pct: float = Field(ge=0, le=100)
    area_m2: float = Field(gt=0)
    pump_flow_lpm: float = Field(gt=0)
    irrigation_method: Literal["drip", "sprinkler", "surface"]
    pump_id: str = "pump-1"
    latitude: float = Field(ge=-90, le=90)


class PlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fields: List[FieldIn] = Field(min_length=1, max_length=50)
    days: int = Field(default=4, ge=1, le=5)
    location: Optional[str] = Field(default=None, min_length=1, max_length=100)  # "lat,lon"


@router.post("/plan")
def irrigation_plan(req: PlanRequest):
    try:
        fields = [make_field(f.field_id, f.crop, f.growth_stage_code, f.soil_type_code,
                             f.soil_moisture_pct, f.area_m2, f.pump_flow_lpm,
                             f.irrigation_method, f.latitude, f.pump_id) for f in req.fields]
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=422, detail=f"Invalid field input: {e}")

    try:
        for field in fields:
            water_calc.get_kc(field)
            water_calc.soil_water_limits(field)
            if field.irrigation_method not in config.METHOD_EFFICIENCY:
                raise ValueError(f"Unsupported irrigation method '{field.irrigation_method}'.")
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=422, detail=f"Invalid field input: {e}")

    try:
        forecast, warnings = weather_adapter.fetch_daily_forecast(req.location, req.days)
    except (ValueError, RuntimeError) as e:      # missing weather config, provider down / rejected key
        logger.warning("Weather data unavailable for the irrigation plan: %s", e)
        raise HTTPException(
            status_code=503,
            detail="Weather data is unavailable. Check the provider configuration and try again.")

    if not forecast:
        raise HTTPException(
            status_code=503,
            detail="No complete daily weather forecast is available; no irrigation plan was generated.",
        )

    try:
        plans = optimize_schedule(fields, forecast, now=datetime.now(weather_adapter.IST))
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=422, detail=f"Could not build a schedule: {e}")
    return {"warnings": warnings, "plans": plans_to_dicts(plans)}