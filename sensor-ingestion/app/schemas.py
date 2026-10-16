from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class SensorData(BaseModel):
    sensor_id: str
    field_id: str
    soil_moisture: float = Field(ge=0, le=100)
    timestamp: datetime

    @field_validator("sensor_id", "field_id")
    @classmethod
    def validate_ids(cls, value):
        value = value.strip()

        if not value:
            raise ValueError("ID cannot be empty")

        return value
#What this code does:Requires all four sensor fields.Checks that the moisture reading is between 0 and 100.
#Removes leading and trailing spaces from sensor and field IDs.Rejects empty IDs.
#Checks that the timestamp is a valid date and time.
#For example, "  SM_001  " becomes "SM_001". A moisture value of 150 or a missing timestamp will be rejected.