from datetime import date, datetime
import math
from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StrictStr, field_validator, model_validator


def _validate_coordinate_number(value):
    if isinstance(value, bool):
        raise ValueError("Coordinates must be finite numeric values.")
    return value


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


SarvamLanguageCode = Literal[
    "en-IN", "bn-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN", "mr-IN",
    "od-IN", "pa-IN", "ta-IN", "te-IN", "as-IN", "brx-IN", "doi-IN",
    "kok-IN", "ks-IN", "mai-IN", "mni-IN", "ne-IN", "sa-IN", "sat-IN",
    "sd-IN", "ur-IN",
]
SARVAM_LANGUAGE_CODES = get_args(SarvamLanguageCode)


class TranslationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    texts: list[StrictStr] = Field(min_length=1, max_length=16)
    source_language_code: SarvamLanguageCode
    target_language_code: SarvamLanguageCode

    @field_validator("texts")
    @classmethod
    def validate_translation_texts(cls, texts):
        normalized = []
        for text in texts:
            if not isinstance(text, str):
                raise ValueError("Translation text must be a string.")
            value = text.strip()
            if not value or len(value) > 2000 or "\n" in value or "\r" in value:
                raise ValueError("Translation text must contain 1 to 2000 characters on one line.")
            normalized.append(value)
        if len(set(normalized)) != len(normalized):
            raise ValueError("Translation text entries must be unique.")
        return normalized

    @model_validator(mode="after")
    def enforce_sarvam_input_limit(self):
        marker_overhead = len(self.texts) * 32
        if sum(map(len, self.texts)) + marker_overhead > 2000:
            raise ValueError("Combined translation text exceeds Sarvam's 2000-character limit.")
        return self


class TranslationResponse(BaseModel):
    translations: list[str]


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

    @field_validator("latitude", "longitude", mode="before")
    @classmethod
    def validate_coordinate_number(cls, value):
        return _validate_coordinate_number(value)

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

    @field_validator("latitude", "longitude", mode="before")
    @classmethod
    def validate_coordinate_number(cls, value):
        return _validate_coordinate_number(value)

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


EXPERIMENTAL_CROP_NAMES = (
    "apple",
    "banana",
    "blackgram",
    "chickpea",
    "coconut",
    "coffee",
    "cotton",
    "grapes",
    "jute",
    "kidneybeans",
    "lentil",
    "maize",
    "mango",
    "mothbeans",
    "mungbean",
    "muskmelon",
    "orange",
    "papaya",
    "pigeonpeas",
    "pomegranate",
    "rice",
    "watermelon",
)
ExperimentalCropName = Literal[
    "apple",
    "banana",
    "blackgram",
    "chickpea",
    "coconut",
    "coffee",
    "cotton",
    "grapes",
    "jute",
    "kidneybeans",
    "lentil",
    "maize",
    "mango",
    "mothbeans",
    "mungbean",
    "muskmelon",
    "orange",
    "papaya",
    "pigeonpeas",
    "pomegranate",
    "rice",
    "watermelon",
]


class ExperimentalPredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    temperature_c: float = Field(allow_inf_nan=False)
    humidity_percent: float = Field(allow_inf_nan=False)
    rain_probability_percent: float = Field(allow_inf_nan=False)
    N: float = Field(allow_inf_nan=False)
    P: float = Field(allow_inf_nan=False)
    K: float = Field(allow_inf_nan=False)
    ph: float = Field(allow_inf_nan=False)
    organic_matter: float = Field(allow_inf_nan=False)
    crop_density: float = Field(allow_inf_nan=False)
    sunlight_exposure: float = Field(allow_inf_nan=False)
    wind_speed: float = Field(allow_inf_nan=False)
    frost_risk: float = Field(allow_inf_nan=False)
    crop_name: ExperimentalCropName
    soil_type: Literal[1, 2, 3]
    growth_stage: Literal[1, 2, 3]

    @field_validator(
        "temperature_c",
        "humidity_percent",
        "rain_probability_percent",
        "N",
        "P",
        "K",
        "ph",
        "organic_matter",
        "crop_density",
        "sunlight_exposure",
        "wind_speed",
        "frost_risk",
        mode="before",
    )
    @classmethod
    def validate_finite_numeric_input(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("A finite JSON number is required.")
        if not math.isfinite(value):
            raise ValueError("A finite JSON number is required.")
        return float(value)

    @field_validator("soil_type", "growth_stage", mode="before")
    @classmethod
    def validate_integer_category(cls, value):
        if type(value) is not int:
            raise ValueError("An integer category code is required.")
        return value


class ExperimentalPredictionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prediction: Literal[0, 1]
    proxy_positive_probability: float = Field(ge=0, le=1, allow_inf_nan=False)
    target: Literal["irrigation_needed_proxy"]
    warning: str
    model_status: Literal["Experimental"]
    dataset_provenance: Literal["synthetic_or_synthetic_augmented"]


class ReducedWeatherPredictionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_id: int = Field(gt=0)


class ReducedWeatherPredictionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prediction: Literal[0, 1]
    proxy_positive_probability: float = Field(ge=0, le=1, allow_inf_nan=False)
    target: Literal["irrigation_needed_proxy"]
    proxy_rule: Literal["soil_moisture <= 20.0"]
    warning: str = Field(min_length=1)
    model_status: Literal["Experimental"]
    dataset_provenance: Literal["synthetic_or_synthetic_augmented"]
    selected_model: Literal["logistic_regression", "random_forest"]
    feature_sources: dict[
        Literal["temperature_c", "humidity_percent"],
        Literal["selected_field_current_weather_api"],
    ]
    observation_time: datetime


class FarmerAssistantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=1500)

    @field_validator("question", mode="before")
    @classmethod
    def normalize_question(cls, value):
        if not isinstance(value, str):
            return value
        question = value.strip()
        if not question:
            raise ValueError("Enter a question.")
        return question


class Model2ExplanationRequest(FarmerAssistantRequest):
    field_id: int = Field(gt=0)
    crop_id: int = Field(gt=0)


class WaterRequirementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_id: int = Field(gt=0)
    crop_id: int = Field(gt=0)
    prediction_period_hours: Literal[24]
