"""
FastAPI router for the irrigation optimizer.

Add to main.py (the endpoint calls the paid weather API, so protect it with the app's auth):

    from irrigation_optimizer.api import router as irrigation_router
    app.include_router(irrigation_router, dependencies=[Depends(irrigation_guard)])

POST /api/irrigation/plan
"""
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import weather_adapter
from .data_adapter import make_field
from .optimizer import optimize_schedule, plans_to_dicts

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/irrigation", tags=["irrigation"])


class FieldIn(BaseModel):
    field_id: str
    crop: str
    growth_stage_code: int = Field(ge=1, le=3)    # 1 Seedling, 2 Vegetative, 3 Flowering/Fruiting
    soil_type_code: int = Field(ge=1, le=3)       # 1 Sandy, 2 Loamy, 3 Clay
    soil_moisture_pct: Optional[float] = Field(default=None, ge=0, le=100)
    area_m2: float = Field(gt=0)
    pump_flow_lpm: float = Field(gt=0)
    irrigation_method: str = "sprinkler"
    pump_id: str = "pump-1"
    latitude: float = Field(default=26.12, ge=-90, le=90)


class PlanRequest(BaseModel):
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
        forecast, warnings = weather_adapter.fetch_daily_forecast(req.location, req.days)
    except (ValueError, RuntimeError) as e:      # missing weather config, provider down / rejected key
        logger.warning("Weather data unavailable for the irrigation plan: %s", e)
        raise HTTPException(
            status_code=503,
            detail="Weather data is unavailable. Check the provider configuration and try again.")

    try:
        plans = optimize_schedule(fields, forecast, now=datetime.now(weather_adapter.IST))
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=422, detail=f"Could not build a schedule: {e}")
    return {"warnings": warnings, "plans": plans_to_dicts(plans)}