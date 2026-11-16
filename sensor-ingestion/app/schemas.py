from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class SensorData(BaseModel):
    sensor_id: str = Field(min_length=1, max_length=40)
    field_id: int = Field(gt=0)
    soil_moisture: float = Field(ge=0, le=100)
    timestamp: datetime

    @field_validator("sensor_id", "field_id")
    @classmethod
    def validate_ids(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("soil_moisture")
    @classmethod
    def validate_finite_moisture(cls, value: float) -> float:
        if not float("-inf") < value < float("inf"):
            raise ValueError("Soil moisture must be a finite number.")
        return value