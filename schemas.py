from datetime import date, datetime, time
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


class DailyFarmTaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    field_name: str | None = Field(default=None, max_length=100)

    @field_validator("title", "field_name", mode="before")
    @classmethod
    def normalize_text(cls, value):
        if value is None or not isinstance(value, str):
            return value
        normalized = " ".join(value.split())
        return normalized or None

    @model_validator(mode="after")
    def validate_title(self):
        if self.title is None or not self.title.strip():
            raise ValueError("Task title is required.")
        return self


class DailyFarmTaskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    field_name: str | None = Field(default=None, max_length=100)
    completed: bool | None = None

    @field_validator("title", "field_name", mode="before")
    @classmethod
    def normalize_text(cls, value):
        if value is None or not isinstance(value, str):
            return value
        normalized = " ".join(value.split())
        return normalized or None

    @model_validator(mode="after")
    def validate_changes(self):
        if self.title is not None and not self.title.strip():
            raise ValueError("Task title cannot be empty.")
        return self


class DailyFarmTaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    farmer_id: int
    title: str
    field_name: str | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @property
    def completed(self) -> bool:
        return self.completed_at is not None


class DailyFarmReminderSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    interval_hours: int = Field(default=2, ge=1, le=24)
    custom_interval_hours: int | None = Field(default=None, ge=1, le=24)
    next_reminder_at: datetime | None = None


class DailyFarmReminderSettingsResponse(DailyFarmReminderSettings):
    model_config = ConfigDict(from_attributes=True)

    id: int | None = None
    farmer_id: int | None = None
    last_notification_at: datetime | None = None


class NotificationSubscriptionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: str = Field(min_length=1, max_length=500)
    p256dh: str | None = Field(default=None, max_length=255)
    auth: str | None = Field(default=None, max_length=255)
    expires_at: datetime | None = None

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, value):
        if value.startswith("http://") or value.startswith("https://"):
            return value
        raise ValueError("A valid web push endpoint URL is required.")


class NotificationSubscriptionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    endpoint: str
    p256dh: str | None
    auth: str | None
    expires_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    updated_at: datetime

class FarmerSensorReadingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    soil_moisture_percent: float = Field(
        ge=0, le=100, allow_inf_nan=False
    )
    soil_temperature_c: float | None = Field(
        default=None, allow_inf_nan=False
    )
    humidity_percent: float | None = Field(
        default=None, ge=0, le=100, allow_inf_nan=False
    )
    ph: float | None = Field(
        default=None, ge=0, le=14, allow_inf_nan=False
    )
    electrical_conductivity_us_cm: float | None = Field(
        default=None, ge=0, allow_inf_nan=False
    )
    recorded_at: datetime


class FarmerSensorReadingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    field_id: int
    soil_moisture_percent: float
    soil_temperature_c: float | None
    humidity_percent: float | None
    ph: float | None
    electrical_conductivity_us_cm: float | None
    recorded_at: datetime
    received_at: datetime


class FarmerSensorDeviceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)


class FarmerSensorDeviceRegistrationResponse(BaseModel):
    id: int
    field_id: int
    device_id: str
    name: str
    token: str
    created_at: datetime


class FarmerSensorDeviceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    field_id: int
    device_id: str
    name: str
    is_active: bool
    created_at: datetime
    last_seen_at: datetime | None


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

    irrigation_needed: bool
    decision: Literal["irrigate", "hold"]
    reason: str = Field(min_length=1)

    soil_moisture_percent: float = Field(
        ge=0, le=100, allow_inf_nan=False
    )
    rainfall_mm: float = Field(
        ge=0, allow_inf_nan=False
    )
    rain_probability_percent: float = Field(
        ge=0, le=100, allow_inf_nan=False
    )
    et0_mm: float = Field(
        ge=0, allow_inf_nan=False
    )

    forecast_date: date
    observation_time: datetime
    weather_source: Literal["tomorrow_io", "open_meteo"]


class ReducedWeatherFeatureInputs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    temperature_c: float = Field(allow_inf_nan=False)
    humidity_percent: float = Field(
        ge=0,
        le=100,
        allow_inf_nan=False,
    )


class ReducedWeatherExperimentalResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prediction: Literal[0, 1]
    proxy_positive_probability: float = Field(
        ge=0,
        le=1,
        allow_inf_nan=False,
    )
    target: Literal["irrigation_needed_proxy"]
    proxy_rule: Literal["soil_moisture <= 20.0"]
    warning: str = Field(min_length=1)
    model_status: Literal["Experimental"]
    dataset_provenance: Literal["synthetic_or_synthetic_augmented"]
    selected_model: Literal["logistic_regression", "random_forest"]
    feature_inputs: ReducedWeatherFeatureInputs
    feature_sources: dict[
        Literal["temperature_c", "humidity_percent"],
        Literal["selected_field_current_weather_api"],
    ]
    observation_time: datetime

AssistantLanguageCode = Literal["en-IN", "te-IN", "hi-IN", "kn-IN", "ta-IN", "ml-IN"]


class FarmerAssistantRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=1500)
    language_code: AssistantLanguageCode = "en-IN"

    @field_validator("question", mode="before")
    @classmethod
    def normalize_question(cls, value):
        if not isinstance(value, str):
            return value
        question = value.strip()
        if not question:
            raise ValueError("Enter a question.")
        return question


class FarmerAssistantHistoryEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: StrictStr = Field(min_length=1, max_length=1500)

    @field_validator("content", mode="before")
    @classmethod
    def normalize_content(cls, value):
        if isinstance(value, str):
            return value.strip()
        return value


class ChartAssistantRequest(FarmerAssistantRequest):
    assistant_mode: Literal["chart"]
    field_id: int | None = Field(default=None, gt=0)
    crop_id: int | None = Field(default=None, gt=0)
    conversation_id: int | None = Field(default=None, gt=0)
    persist_conversation: bool = False
    regenerate: bool = False
    history: list[FarmerAssistantHistoryEntry] = Field(default_factory=list, max_length=6)
    chart_period: Literal["24h", "7d", "30d", "custom"] = "7d"
    start_date: date | None = None
    end_date: date | None = None

    @model_validator(mode="after")
    def validate_chart_request(self):
        expected_role = "user"
        for message in self.history:
            if message.role != expected_role:
                raise ValueError("Conversation history must alternate user and assistant messages.")
            expected_role = "assistant" if expected_role == "user" else "user"
        if self.history and self.history[-1].role != "assistant":
            raise ValueError("Conversation history must end with an assistant response.")
        if sum(len(message.content) for message in self.history) > 6000:
            raise ValueError("Conversation history exceeds the allowed size.")
        if self.regenerate and (self.conversation_id is None or not self.persist_conversation):
            raise ValueError("Regenerating a response requires a saved conversation.")

        if self.chart_period == "custom":
            if self.field_id is None or self.start_date is None or self.end_date is None:
                raise ValueError("Custom chart ranges require a selected field and both dates.")
            if self.end_date < self.start_date:
                raise ValueError("Chart range end_date must not precede start_date.")
            if (self.end_date - self.start_date).days >= 31:
                raise ValueError("Custom chart ranges cannot exceed 31 days.")
        elif self.start_date is not None or self.end_date is not None:
            raise ValueError("Use start_date and end_date only with a custom chart range.")
        return self


class AssistantConversationRenameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: StrictStr = Field(min_length=1, max_length=120)

    @field_validator("title", mode="before")
    @classmethod
    def normalize_title(cls, value):
        if isinstance(value, str):
            title = value.strip()
            if not title:
                raise ValueError("Enter a conversation title.")
            return title
        return value


class Model2ExplanationRequest(FarmerAssistantRequest):
    field_id: int = Field(gt=0)
    crop_id: int = Field(gt=0)


class WaterRequirementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_id: int = Field(gt=0)
    crop_id: int = Field(gt=0)
    prediction_period_hours: Literal[24]
class ManualIrrigationScheduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field_id: int = Field(gt=0)
    reservoir_id: int = Field(gt=0)
    scheduled_date: date
    start_time: time
    duration_minutes: int = Field(ge=1, le=1440)
    water_liters: float = Field(gt=0, allow_inf_nan=False)
    irrigation_method: Literal["drip", "sprinkler", "surface"]