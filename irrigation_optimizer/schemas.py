from datetime import date, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ReservoirCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_id: int | None = Field(default=None, ge=1)
    name: str = Field(min_length=1, max_length=100)
    capacity_liters: float = Field(gt=0, allow_inf_nan=False)
    available_liters: float = Field(ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def available_water_within_capacity(self):
        if self.available_liters > self.capacity_liters:
            raise ValueError("Available water cannot exceed reservoir capacity.")
        return self


class ReservoirWaterUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    available_liters: float = Field(ge=0, allow_inf_nan=False)


class IrrigationPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_id: int = Field(gt=0)
    reservoir_id: int | None = Field(default=None, gt=0)
    soil_moisture_pct: float = Field(ge=0, le=100, allow_inf_nan=False)
    growth_stage_code: int | None = Field(default=None, ge=1, le=3)
    soil_type_code: int = Field(ge=1, le=3)
    irrigation_method: Literal["drip", "sprinkler", "surface"]
    pump_flow_lpm: float = Field(gt=0, allow_inf_nan=False)
    days: int = Field(default=2, ge=1, le=5)


class ManualIrrigationScheduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_id: int = Field(gt=0)
    reservoir_id: int = Field(gt=0)
    scheduled_date: date
    start_time: time
    duration_minutes: int = Field(ge=1, le=1440)
    water_liters: float = Field(gt=0, allow_inf_nan=False)
    irrigation_method: Literal["drip", "sprinkler", "surface"]