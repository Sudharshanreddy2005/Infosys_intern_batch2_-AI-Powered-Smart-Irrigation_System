from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class FarmerRegister(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    phone: str | None = Field(default=None, max_length=32)
    state: str | None = Field(default=None, max_length=80)
    district: str | None = Field(default=None, max_length=100)
    village: str | None = Field(default=None, max_length=120)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value):
        if not isinstance(value, str):
            return value
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("Name is required.")
        return normalized

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return value.strip().casefold()

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, value):
        if value is None or not isinstance(value, str):
            return value
        value = " ".join(value.split())
        return value or None

    @field_validator("state", "district", "village", mode="before")
    @classmethod
    def normalize_location_text(cls, value):
        if value is None or not isinstance(value, str):
            return value
        normalized = " ".join(value.split())
        return normalized or None


class FarmerLogin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return value.strip().casefold()


class FarmerPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    phone: str | None = Field(default=None, max_length=32)
    state: str | None = Field(default=None, max_length=80)
    district: str | None = Field(default=None, max_length=100)
    village: str | None = Field(default=None, max_length=120)

    @field_validator("name", "phone", "state", "district", "village", mode="before")
    @classmethod
    def normalize_optional_text(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value

    @model_validator(mode="after")
    def require_nonempty_name(self):
        if self.name == "":
            raise ValueError("Name cannot be empty.")
        return self


class FarmerProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: EmailStr
    phone: str | None
    state: str | None
    district: str | None
    village: str | None


class FieldCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    crop: str | None = Field(default=None, max_length=80)
    area: float = Field(gt=0, le=10_000_000, allow_inf_nan=False)
    area_unit: Literal["acres", "hectares"]
    location: str | None = Field(default=None, max_length=200)
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("crop", "location", mode="before")
    @classmethod
    def normalize_optional_text(cls, value):
        if value is None or not isinstance(value, str):
            return value
        return " ".join(value.split()) or None

    @model_validator(mode="after")
    def require_coordinate_pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together.")
        return self


class FieldPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    crop: str | None = Field(default=None, max_length=80)
    area: float | None = Field(default=None, gt=0, le=10_000_000, allow_inf_nan=False)
    area_unit: Literal["acres", "hectares"] | None = None
    location: str | None = Field(default=None, max_length=200)
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)

    @field_validator("name", "crop", "location", mode="before")
    @classmethod
    def normalize_text(cls, value):
        return (" ".join(value.split()) or None) if isinstance(value, str) else value

    @model_validator(mode="after")
    def require_coordinate_pair(self):
        if (
            "latitude" in self.model_fields_set
            and "longitude" in self.model_fields_set
            and (self.latitude is None) != (self.longitude is None)
        ):
            raise ValueError("Latitude and longitude must be provided together.")
        return self


class CropCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    variety: str | None = Field(default=None, max_length=100)
    planting_date: date | None = None
    expected_harvest_date: date | None = None
    growth_stage: str | None = Field(default=None, max_length=80)
    field_id: int | None = Field(default=None, gt=0)

    @field_validator("name", "variety", "growth_stage", mode="before")
    @classmethod
    def normalize_text(cls, value):
        return (" ".join(value.split()) or None) if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_crop(self):
        if not self.name.strip():
            raise ValueError("Crop name is required.")
        if (
            self.planting_date is not None
            and self.expected_harvest_date is not None
            and self.expected_harvest_date < self.planting_date
        ):
            raise ValueError("Expected harvest date cannot be before planting date.")
        return self


class CropPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    variety: str | None = Field(default=None, max_length=100)
    planting_date: date | None = None
    expected_harvest_date: date | None = None
    growth_stage: str | None = Field(default=None, max_length=80)
    field_id: int | None = Field(default=None, gt=0)

    @field_validator("name", "variety", "growth_stage", mode="before")
    @classmethod
    def normalize_text(cls, value):
        return (" ".join(value.split()) or None) if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_crop(self):
        if self.name is not None and not self.name.strip():
            raise ValueError("Crop name is required.")
        if (
            self.planting_date is not None
            and self.expected_harvest_date is not None
            and self.expected_harvest_date < self.planting_date
        ):
            raise ValueError("Expected harvest date cannot be before planting date.")
        return self


class FieldResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    crop: str | None
    area: float
    area_unit: str
    location: str | None
    latitude: float | None
    longitude: float | None
    created_at: datetime
    updated_at: datetime


class CropResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    field_id: int | None
    name: str
    variety: str | None
    planting_date: date | None
    expected_harvest_date: date | None
    growth_stage: str | None
    created_at: datetime
    updated_at: datetime


class WeatherCoordinates(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
