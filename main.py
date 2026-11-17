import hashlib
import hmac
import binascii
import json
import logging
import math
import os
import base64
import re
import secrets
import threading
import time
from collections import OrderedDict, deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urljoin, urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from pydantic import BaseModel, Field
import joblib
import pandas as pd
from sqlalchemy import create_engine, func, or_, select, text, update
from sqlalchemy.engine import URL
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session


from models import (
    AssistantConversation,
    AuthSession,
    Base,
    DailyFarmReminderSetting,
    DailyFarmTask,
    FarmNotificationSubscription,
    Alert,
    Farmer,
    FarmerCrop,
    FarmerField,
    FarmerSensorReading,
    FarmerSensorDevice,
    IrrigationReservoir,
    IrrigationSchedule,
    NotificationDelivery,
)
from crop_disease_client import (
    ALLOWED_IMAGE_TYPES,
    MAX_CROP_IMAGE_BYTES,
    CropDiseaseServiceError,
    predict_crop_disease,
)
from alerts.database import (
    create_alert,
    mark_alert_as_read,
    mark_alert_as_unread,
    mark_all_alerts_as_read,
    resolve_alert,
)
from alerts.delivery import dispatch_alert_notifications
from alerts.service import process_drought_risk, process_sensor_failure, process_weather_forecast
from alerts.schemas import (
    NotificationPreferencesUpdate,
    PushSubscriptionRequest,
)
from schemas import (
    AssistantConversationRenameRequest,
    AssistantLanguageCode,
    CropCreate,
    CropPatch,
    CropResponse,
    ChartAssistantRequest,
    DailyFarmReminderSettings,
    DailyFarmReminderSettingsResponse,
    DailyFarmTaskCreate,
    DailyFarmTaskResponse,
    DailyFarmTaskUpdate,
    FarmerSensorReadingCreate,
    FarmerSensorReadingResponse,
    ExperimentalPredictionRequest,
    ExperimentalPredictionResponse,
    EXPERIMENTAL_CROP_NAMES,
    FarmerAssistantRequest,
    FarmerLogin,
    FarmerPatch,
    FarmerProfile,
    FarmerRegister,
    FieldCreate,
    FieldPatch,
    FieldResponse,
    Model2ExplanationRequest,
    NotificationSubscriptionPayload,
    NotificationSubscriptionResponse,
    ReducedWeatherPredictionRequest,
    ReducedWeatherPredictionResponse,
    ReducedWeatherExperimentalResponse,
    TranslationRequest,
    TranslationResponse,
    WeatherCoordinates,
    WaterRequirementRequest,
    FarmerSensorDeviceCreate,
    FarmerSensorDeviceRegistrationResponse,
    FarmerSensorDeviceResponse,
)
from weather_api.integrations.config import get_location
from irrigation_optimizer.weather_adapter import fetch_current_weather
from weather_api.integrations.weather_api import (
    WeatherAuthError,
    WeatherUnavailableError,
    get_current_weather,
    get_forecast,
    get_recent_history,
)
from sarvam_translation import (
    TranslationConfigurationError,
    TranslationEntitlementError,
    TranslationProviderError,
    TranslationRateLimitError,
    translate_texts,
)
from weather_api.integrations.reverse_geocoding import get_locality
import farmer_assistant
from farmer_assistant import (
    AssistantServiceError,
    answer_farmer_question,
    explain_model2_prediction,
)
from chart_assistant import answer_chart_question
from model2_integration import load_production_model2_bundle
from irrigation_optimizer import config as irrigation_config
from irrigation_optimizer import water_calc as irrigation_water_calc
from irrigation_optimizer import weather_adapter as irrigation_weather_adapter
from irrigation_optimizer.data_adapter import make_field as make_optimizer_field
from irrigation_optimizer.optimizer import optimize_schedule, plans_to_dicts
from irrigation_optimizer.schemas import (
    IrrigationPlanRequest,
    ManualIrrigationScheduleRequest,
    ReservoirCreate,
    ReservoirWaterUpdate,
)
from irrigation_optimizer.workflow import (
    InsufficientWater,
    ScheduleConflict,
    cancel_schedule as cancel_irrigation_schedule,
    complete_schedule as complete_irrigation_schedule,
    confirm_schedule as confirm_irrigation_schedule,
    reservoir_response,
    schedule_response,
)
from model1.inference import load_artifact_bundle, predict_records
from model4.inference import (
    ARTIFACT_FILENAME,
    ARTIFACT_SHA256,
    artifact_path,
    predict as predict_model4,
)

logger = logging.getLogger(__name__)
password_hasher = PasswordHasher()
dummy_password_hash = password_hasher.hash(secrets.token_urlsafe(32))
auth_attempts = OrderedDict()
auth_attempts_lock = threading.Lock()
weather_attempts = OrderedDict()
weather_attempts_lock = threading.Lock()
weather_alert_attempts = OrderedDict()
weather_alert_attempts_lock = threading.Lock()
public_weather_attempts = OrderedDict()
public_weather_attempts_lock = threading.Lock()
assistant_attempts = OrderedDict()
assistant_attempts_lock = threading.Lock()
translation_attempts = OrderedDict()
translation_attempts_lock = threading.Lock()
AUTH_WINDOW_SECONDS = 900
AUTH_MAX_ATTEMPTS = 10
WEATHER_WINDOW_SECONDS = 60
WEATHER_MAX_ATTEMPTS = 30
ASSISTANT_WINDOW_SECONDS = 60
ASSISTANT_MAX_ATTEMPTS = 10
TRANSLATION_WINDOW_SECONDS = 60
TRANSLATION_MAX_ATTEMPTS = 20
SESSION_COOKIE = "jalsaathi_session"
CSRF_COOKIE = "jalsaathi_csrf"
PROJECT_ROOT = Path(__file__).resolve().parent
STATIC_DIR = PROJECT_ROOT / "static"
TEMPLATES_DIR = PROJECT_ROOT / "templates"
PWA_ICONS_DIR = STATIC_DIR / "main-pwa-icons"
PWA_ICON_FILES = {
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-192.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
}
load_dotenv(PROJECT_ROOT / ".env")

@asynccontextmanager
async def lifespan(_app):
    Base.metadata.create_all(bind=engine)
    yield
app = FastAPI(
    title="Smart Irrigation System API",
    description="Backend for predictive water management and crop optimization",
    version="1.0.0",
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# --------------------------------------------------
# DATABASE CONFIGURATION
# --------------------------------------------------
load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
else:
    db_password = os.getenv("DB_PASSWORD")
    if not db_password:
        raise RuntimeError("Set DATABASE_URL or DB_PASSWORD to configure the database.")
    engine = create_engine(
        URL.create(
            "postgresql+psycopg",
            username=os.getenv("DB_USER", "irrigation_user"),
            password=db_password,
            host=os.getenv("DB_HOST", "localhost"),
            port=int(os.getenv("DB_PORT", "5433")),
            database=os.getenv("DB_NAME", "smart_irrigation_db"),
        ),
        pool_pre_ping=True,
    )


BASE_DIR = PROJECT_ROOT


class Model2Request(BaseModel):
    crop_type: str
    growth_stage: int = Field(ge=1, le=3)
    soil_type: int = Field(ge=1, le=3)
    soil_moisture_percent: float = Field(ge=0, le=100)
    temperature_c: float
    humidity_percent: float = Field(ge=0, le=100)
    rainfall_mm: float = Field(ge=0)
    forecast_rainfall_mm: float = Field(ge=0)
    field_area_acres: float = Field(gt=0)
    irrigation_method: str
    wind_speed: float = Field(ge=0)
    et0_mm_day: float = Field(ge=0)
    crop_coefficient_kc: float = Field(gt=0)
    previous_irrigation_mm: float = Field(ge=0)

class Model2ExperimentalRequest(BaseModel):
    field_id: int = Field(gt=0)
    crop_id: int = Field(gt=0)
    zone: int = Field(ge=1, le=5)


class Model3Request(BaseModel):
    zone: int = Field(ge=1, le=5)
    current_moisture_percent: float = Field(ge=1, le=100)
    weather_temp: float | None = None
    weather_humidity: float | None = None
    weather_rain: float | None = None
    weather_pressure: float | None = None
    weather_wind_speed: float | None = None
    weather_radiation: float | None = None
    soil_temperature_0_7cm: float | None = None
    soil_temperature_7_18cm: float | None = None
    month: int | None = Field(default=None, ge=1, le=12)
    day: int | None = Field(default=None, ge=1, le=31)
    hour: int | None = Field(default=None, ge=0, le=23)
    day_period: int | None = None
    quarter: int | None = Field(default=None, ge=1, le=4)


class SoilMoisturePredictionRequest(Model3Request):
    field_id: int = Field(gt=0)


class Model1FullRequest(BaseModel):
    temperature_c: float
    humidity_percent: float = Field(ge=0, le=100)
    rain_probability_percent: float = Field(ge=0, le=100)
    N: float
    P: float
    K: float
    ph: float
    organic_matter: float
    crop_density: float
    sunlight_exposure: float
    wind_speed: float
    frost_risk: float
    crop_name: str
    soil_type: int = Field(ge=1, le=3)
    growth_stage: int = Field(ge=1, le=3)


class Model1WeatherRequest(BaseModel):
    temperature_c: float
    humidity_percent: float = Field(ge=0, le=100)


class Model4Request(BaseModel):
    soil_type: str
    bulk_density: float
    organic_matter_pct: float
    cation_exchange_capacity: float
    salinity_ec: float
    buffering_capacity: float
    soil_moisture_pct: float
    moisture_limit_dry: float
    moisture_limit_wet: float
    moisture_regime: str
    thermal_regime: str
    nutrient_balance: str
    plant_category: str
    soil_temp_c: float
    air_temp_c: float
    light_intensity_par: float
    soil_ph: float
    nitrogen_ppm: float
    phosphorus_ppm: float
    potassium_ppm: float


class CropStressPredictionRequest(Model4Request):
    field_id: int = Field(gt=0)
    crop_type: str = Field(min_length=1, max_length=80)
    zone: int = Field(ge=1, le=5)


@lru_cache(maxsize=1)
def _load_legacy_model2():
    return joblib.load(BASE_DIR / "model2" / "model2_water_requirement.joblib")


@lru_cache(maxsize=1)
def _load_model3():
    return joblib.load(BASE_DIR / "model3" / "zone4_ridge.joblib")


@lru_cache(maxsize=1)
def _load_model1_full():
    return load_artifact_bundle(
        BASE_DIR / "model1" / "artifacts"
        / "random_forest_without_soil_moisture_tuned_candidate_v3.joblib"
    )


@lru_cache(maxsize=1)
def _load_model1_weather():
    return load_artifact_bundle(
        BASE_DIR / "model1" / "artifacts" / "reduced_weather_proxy_v1.joblib"
    )


@lru_cache(maxsize=1)
def _load_model4():
    artifact = artifact_path(BASE_DIR)
    if not artifact.is_file():
        raise FileNotFoundError(f"Model 4 artifact not found: {artifact}")
    return joblib.load(artifact)


IRRIGATION_API_KEY = os.getenv("IRRIGATION_API_KEY", "").strip()


def irrigation_guard(x_irrigation_key: str = Header(default="")):
    if not IRRIGATION_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Irrigation API authentication is not configured.",
        )
    if not hmac.compare_digest(x_irrigation_key, IRRIGATION_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid irrigation API key.")


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _session_ttl_seconds() -> int:
    try:
        hours = int(os.getenv("SESSION_TTL_HOURS", "12"))
    except ValueError as error:
        raise RuntimeError("SESSION_TTL_HOURS must be a positive integer.") from error
    if not 1 <= hours <= 720:
        raise RuntimeError("SESSION_TTL_HOURS must be between 1 and 720.")
    return hours * 3600


def _secure_cookies() -> bool:
    app_env = os.getenv("APP_ENV", "development").strip().lower()
    if app_env == "production":
        return True
    configured = os.getenv("COOKIE_SECURE", "").strip().lower()
    if configured in {"1", "true", "yes"}:
        return True
    if configured in {"0", "false", "no"}:
        return False
    return False


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _limit_auth_attempts(request: Request) -> None:
    now = time.monotonic()
    key = _client_key(request)
    with auth_attempts_lock:
        attempts = auth_attempts.get(key)
        if attempts is None:
            if len(auth_attempts) >= 4096:
                auth_attempts.popitem(last=False)
            attempts = deque()
            auth_attempts[key] = attempts
        auth_attempts.move_to_end(key)
        while attempts and now - attempts[0] >= AUTH_WINDOW_SECONDS:
            attempts.popleft()
        if len(attempts) >= AUTH_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=429,
                detail="Too many authentication attempts. Please try again later.",
                headers={"Retry-After": str(AUTH_WINDOW_SECONDS)},
            )
        attempts.append(now)


def _limit_translation_requests(request: Request) -> None:
    now = time.monotonic()
    key = _client_key(request)
    with translation_attempts_lock:
        attempts = translation_attempts.get(key)
        if attempts is None:
            if len(translation_attempts) >= 4096:
                translation_attempts.popitem(last=False)
            attempts = deque()
            translation_attempts[key] = attempts
        translation_attempts.move_to_end(key)
        while attempts and now - attempts[0] >= TRANSLATION_WINDOW_SECONDS:
            attempts.popleft()
        if len(attempts) >= TRANSLATION_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=429,
                detail="Too many translation requests. Please try again later.",
                headers={"Retry-After": str(TRANSLATION_WINDOW_SECONDS)},
            )
        attempts.append(now)


def _limit_weather_requests(farmer_id: int) -> None:
    now = time.monotonic()
    with weather_attempts_lock:
        attempts = weather_attempts.get(farmer_id)
        if attempts is None:
            if len(weather_attempts) >= 4096:
                weather_attempts.popitem(last=False)
            attempts = deque()
            weather_attempts[farmer_id] = attempts
        weather_attempts.move_to_end(farmer_id)
        while attempts and now - attempts[0] >= WEATHER_WINDOW_SECONDS:
            attempts.popleft()
        if len(attempts) >= WEATHER_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=429,
                detail="Too many location-based weather requests. Please try again later.",
                headers={"Retry-After": str(WEATHER_WINDOW_SECONDS)},
            )
        attempts.append(now)


def _limit_public_weather_requests(request: Request) -> None:
    now = time.monotonic()
    key = _client_key(request)
    with public_weather_attempts_lock:
        attempts = public_weather_attempts.get(key)
        if attempts is None:
            if len(public_weather_attempts) >= 4096:
                public_weather_attempts.popitem(last=False)
            attempts = deque()
            public_weather_attempts[key] = attempts
        public_weather_attempts.move_to_end(key)
        while attempts and now - attempts[0] >= WEATHER_WINDOW_SECONDS:
            attempts.popleft()
        if len(attempts) >= WEATHER_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=429,
                detail="Too many weather requests. Please try again later.",
                headers={"Retry-After": str(WEATHER_WINDOW_SECONDS)},
            )
        attempts.append(now)


def _limit_assistant_requests(farmer_id: int) -> None:
    now = time.monotonic()
    with assistant_attempts_lock:
        attempts = assistant_attempts.get(farmer_id)
        if attempts is None:
            if len(assistant_attempts) >= 4096:
                assistant_attempts.popitem(last=False)
            attempts = deque()
            assistant_attempts[farmer_id] = attempts
        assistant_attempts.move_to_end(farmer_id)
        while attempts and now - attempts[0] >= ASSISTANT_WINDOW_SECONDS:
            attempts.popleft()
        if len(attempts) >= ASSISTANT_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=429,
                detail="Too many assistant requests. Please try again later.",
                headers={"Retry-After": str(ASSISTANT_WINDOW_SECONDS)},
            )
        attempts.append(now)


def _origin_key(value: str) -> tuple[str, str] | None:
    try:
        supplied = urlsplit(value)
        _ = supplied.port
    except ValueError:
        return None
    if (
        supplied.scheme.casefold() not in {"http", "https"}
        or not supplied.netloc
        or supplied.username is not None
        or supplied.password is not None
        or supplied.path not in {"", "/"}
        or supplied.query
        or supplied.fragment
    ):
        return None
    return supplied.scheme.casefold(), supplied.netloc.casefold()


def _validate_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin:
        expected = _origin_key(str(request.base_url))
        allowed_origins = {expected} if expected is not None else set()
        for configured_origin in os.getenv("FARMER_PWA_ORIGINS", "").split(","):
            configured_origin = configured_origin.strip()
            if not configured_origin:
                continue
            configured_key = _origin_key(configured_origin)
            if configured_key is None:
                raise RuntimeError(
                    "FARMER_PWA_ORIGINS must contain only valid HTTP(S) origins."
                )
            allowed_origins.add(configured_key)
        if _origin_key(origin) not in allowed_origins:
            raise HTTPException(status_code=403, detail="Cross-origin request rejected.")
    elif request.headers.get("sec-fetch-site", "").casefold() == "cross-site":
        raise HTTPException(status_code=403, detail="Cross-origin request rejected.")


def get_db():
    with Session(engine) as session:
        yield session


def get_auth_context(
    request: Request,
    db: Session = Depends(get_db),
) -> tuple[Farmer, AuthSession]:
    raw_token = request.cookies.get(SESSION_COOKIE)
    if not raw_token or len(raw_token) > 128:
        raise HTTPException(status_code=401, detail="Authentication required.")

    auth_session = db.scalar(
        select(AuthSession).where(AuthSession.token_hash == _digest(raw_token))
    )
    if auth_session is None:
        raise HTTPException(status_code=401, detail="Authentication required.")

    expires_at = auth_session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        db.delete(auth_session)
        db.commit()
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again.")

    farmer = db.get(Farmer, auth_session.farmer_id)
    if farmer is None:
        db.delete(auth_session)
        db.commit()
        raise HTTPException(status_code=401, detail="Authentication required.")
    return farmer, auth_session


def require_csrf(
    request: Request,
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
) -> tuple[Farmer, AuthSession]:
    _validate_origin(request)
    csrf_cookie = request.cookies.get(CSRF_COOKIE, "")
    csrf_header = request.headers.get("x-csrf-token", "")
    if (
        not csrf_cookie
        or not csrf_header
        or not hmac.compare_digest(csrf_cookie, csrf_header)
        or not hmac.compare_digest(_digest(csrf_cookie), context[1].csrf_hash)
    ):
        raise HTTPException(status_code=403, detail="CSRF validation failed.")
    return context


@lru_cache(maxsize=1)
def _load_experimental_predictor():
    artifact_path = (
        PROJECT_ROOT
        / "model1"
        / "artifacts"
        / "random_forest_without_soil_moisture_tuned_candidate_v3.joblib"
    )
    if not artifact_path.is_file():
        raise FileNotFoundError("Experimental model files are unavailable.")
    bundle = load_artifact_bundle(artifact_path)
    metadata = bundle["metadata"]
    expected_features = [
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
        "crop_name",
        "soil_type",
        "growth_stage",
    ]
    if (
        bundle.get("artifact_type") != "irrigation-proxy-generalization-candidate"
        or metadata.get("model_name") != "random_forest"
        or metadata.get("feature_set") != "without_soil_moisture"
        or metadata.get("feature_names") != expected_features
        or metadata.get("target_name") != "irrigation_needed_proxy"
        or metadata.get("proxy_rule") != "soil_moisture <= 20.0"
        or metadata.get("dataset_provenance")
        != "synthetic_or_synthetic_augmented"
        or metadata.get("categorical_values", {}).get("crop_name")
        != list(EXPERIMENTAL_CROP_NAMES)
        or metadata.get("categorical_values", {}).get("soil_type") != [1, 2, 3]
        or metadata.get("categorical_values", {}).get("growth_stage") != [1, 2, 3]
    ):
        raise ValueError("Experimental artifact metadata does not match the expected schema.")
    return bundle, predict_records


@lru_cache(maxsize=1)
def _load_reduced_weather_predictor():
    artifact_path = (
        PROJECT_ROOT
        / "model1"
        / "artifacts"
        / "reduced_weather_proxy_v1.joblib"
    )
    if not artifact_path.is_file():
        raise FileNotFoundError("Reduced-weather experimental model is unavailable.")
    bundle = load_artifact_bundle(artifact_path)
    metadata = bundle["metadata"]
    expected_features = ["temperature_c", "humidity_percent"]
    training_ranges = metadata.get("feature_training_ranges")
    if (
        bundle.get("artifact_type")
        != "irrigation-proxy-generalization-candidate"
        or metadata.get("model_name") not in {"logistic_regression", "random_forest"}
        or metadata.get("feature_set") != "without_soil_moisture"
        or metadata.get("feature_subset") != "reduced_weather_only"
        or metadata.get("feature_names") != expected_features
        or metadata.get("categorical_values") != {}
        or metadata.get("target_name") != "irrigation_needed_proxy"
        or metadata.get("proxy_rule") != "soil_moisture <= 20.0"
        or metadata.get("dataset_provenance")
        != "synthetic_or_synthetic_augmented"
        or not isinstance(training_ranges, dict)
        or any(
            not isinstance(training_ranges.get(name), dict)
            or not isinstance(training_ranges[name].get("minimum"), (int, float))
            or not isinstance(training_ranges[name].get("maximum"), (int, float))
            or training_ranges[name]["minimum"] >= training_ranges[name]["maximum"]
            for name in expected_features
        )
    ):
        raise ValueError("Reduced-weather artifact metadata does not match the expected schema.")
    return bundle, predict_records


def _set_session_cookies(response: Response, raw_token: str, csrf_token: str) -> None:
    ttl = _session_ttl_seconds()
    secure = _secure_cookies()
    response.set_cookie(
        SESSION_COOKIE,
        raw_token,
        max_age=ttl,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        max_age=ttl,
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )


def _clear_session_cookies(response: Response) -> None:
    secure = _secure_cookies()
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, secure=secure, samesite="lax")
    response.delete_cookie(CSRF_COOKIE, path="/", httponly=False, secure=secure, samesite="lax")


def _create_session(db: Session, farmer: Farmer, response: Response) -> None:
    raw_token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=_session_ttl_seconds())
    db.add(
        AuthSession(
            farmer_id=farmer.id,
            token_hash=_digest(raw_token),
            csrf_hash=_digest(csrf_token),
            expires_at=expires_at,
        )
    )
    db.commit()
    _set_session_cookies(response, raw_token, csrf_token)


def _profile(farmer: Farmer) -> FarmerProfile:
    return FarmerProfile.model_validate(farmer)


def _field_response(field: FarmerField) -> FieldResponse:
    return FieldResponse.model_validate(field)


def _crop_response(crop: FarmerCrop) -> CropResponse:
    return CropResponse.model_validate(crop)


def _task_response(task: DailyFarmTask) -> DailyFarmTaskResponse:
    return DailyFarmTaskResponse.model_validate(task)


def _owned_task(db: Session, farmer_id: int, task_id: int) -> DailyFarmTask:
    task = db.scalar(
        select(DailyFarmTask).where(
            DailyFarmTask.id == task_id,
            DailyFarmTask.farmer_id == farmer_id,
        )
    )
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found.")
    return task


def _get_or_create_reminder_settings(db: Session, farmer_id: int) -> DailyFarmReminderSetting:
    setting = db.scalar(
        select(DailyFarmReminderSetting).where(DailyFarmReminderSetting.farmer_id == farmer_id)
    )
    if setting is not None:
        return setting
    setting = DailyFarmReminderSetting(
        farmer_id=farmer_id,
        enabled=False,
        interval_hours=2,
        custom_interval_hours=None,
        next_reminder_at=None,
    )
    db.add(setting)
    db.commit()
    db.refresh(setting)
    return setting


def _owned_field(db: Session, farmer_id: int, field_id: int) -> FarmerField:
    field = db.scalar(
        select(FarmerField).where(
            FarmerField.id == field_id,
            FarmerField.farmer_id == farmer_id,
        )
    )
    if field is None:
        raise HTTPException(status_code=404, detail="Field not found.")
    return field


def _owned_crop(db: Session, farmer_id: int, crop_id: int) -> FarmerCrop:
    crop = db.scalar(
        select(FarmerCrop).where(
            FarmerCrop.id == crop_id,
            FarmerCrop.farmer_id == farmer_id,
        )
    )
    if crop is None:
        raise HTTPException(status_code=404, detail="Crop not found.")
    return crop


def _validate_crop_field(db: Session, farmer_id: int, field_id: int | None) -> None:
    if field_id is not None:
        _owned_field(db, farmer_id, field_id)


def _owned_irrigation_reservoir(
    db: Session,
    farmer_id: int,
    reservoir_id: int,
    field_id: int | None = None,
    *,
    lock: bool = False,
) -> IrrigationReservoir:
    statement = select(IrrigationReservoir).where(
        IrrigationReservoir.id == reservoir_id,
        IrrigationReservoir.farmer_id == farmer_id,
    )
    if lock:
        statement = statement.with_for_update()
    reservoir = db.scalar(statement)
    if reservoir is None or (
        field_id is not None and reservoir.field_id not in (None, field_id)
    ):
        raise HTTPException(status_code=404, detail="Reservoir not found.")
    return reservoir


def _irrigation_stage_code(stage: str | None) -> int | None:
    normalized = (stage or "").strip().casefold()
    if any(token in normalized for token in ("seed", "initial")):
        return 1
    if any(token in normalized for token in ("vegetative", "development", "growing")):
        return 2
    if any(token in normalized for token in ("flower", "fruit", "mid")):
        return 3
    return None


def _irrigation_crop_key(crop: str) -> str:
    normalized = "".join(character for character in crop.casefold() if character.isalnum())
    aliases = {"paddy": "rice", "corn": "maize", "blackgram": "blackgram"}
    return aliases.get(normalized, normalized)


def _field_area_m2(field: FarmerField) -> float:
    unit = field.area_unit.casefold()
    if unit == "acres":
        return field.area * 4046.8564224
    if unit == "hectares":
        return field.area * 10_000
    raise HTTPException(status_code=422, detail="The field uses an unsupported area unit.")


def _reservoir_list_for_field(
    db: Session,
    farmer_id: int,
    field_id: int | None,
) -> list[IrrigationReservoir]:
    statement = select(IrrigationReservoir).where(
        IrrigationReservoir.farmer_id == farmer_id
    )
    if field_id is not None:
        statement = statement.where(
            (IrrigationReservoir.field_id.is_(None))
            | (IrrigationReservoir.field_id == field_id)
        )
    return list(db.scalars(statement.order_by(IrrigationReservoir.id)).all())


@app.get("/api/irrigation/reservoirs")
def list_irrigation_reservoirs(
    field_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    farmer_id = context[0].id
    if field_id is not None:
        _owned_field(db, farmer_id, field_id)
    reservoirs = _reservoir_list_for_field(db, farmer_id, field_id)
    return [reservoir_response(reservoir) for reservoir in reservoirs]


@app.post("/api/irrigation/reservoirs", status_code=201)
def create_irrigation_reservoir(
    payload: ReservoirCreate,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    farmer_id = context[0].id
    if payload.field_id is not None:
        _owned_field(db, farmer_id, payload.field_id)
    reservoir = IrrigationReservoir(
        farmer_id=farmer_id,
        **payload.model_dump(),
    )
    db.add(reservoir)
    db.commit()
    db.refresh(reservoir)
    return reservoir_response(reservoir)


@app.get("/api/irrigation/reservoirs/{reservoir_id}")
def get_irrigation_reservoir(
    reservoir_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    reservoir = _owned_irrigation_reservoir(db, context[0].id, reservoir_id)
    return reservoir_response(reservoir)


@app.patch("/api/irrigation/reservoirs/{reservoir_id}")
def update_irrigation_reservoir_water(
    reservoir_id: int,
    payload: ReservoirWaterUpdate,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    result = db.execute(
        update(IrrigationReservoir)
        .where(
            IrrigationReservoir.id == reservoir_id,
            IrrigationReservoir.farmer_id == context[0].id,
            IrrigationReservoir.capacity_liters >= payload.available_liters,
            IrrigationReservoir.reserved_liters <= payload.available_liters,
        )
        .values(
            available_liters=payload.available_liters,
            updated_at=datetime.now(timezone.utc),
        )
    )
    if result.rowcount != 1:
        reservoir = db.scalar(
            select(IrrigationReservoir).where(
                IrrigationReservoir.id == reservoir_id,
                IrrigationReservoir.farmer_id == context[0].id,
            )
        )
        if reservoir is None:
            raise HTTPException(status_code=404, detail="Reservoir not found.")
        raise HTTPException(
            status_code=422,
            detail=(
                "Available water must not exceed capacity or be less than water reserved "
                "for confirmed schedules."
            ),
        )
    db.commit()
    reservoir = db.get(IrrigationReservoir, reservoir_id)
    if reservoir is None:
        raise HTTPException(status_code=404, detail="Reservoir not found.")
    db.refresh(reservoir)
    return reservoir_response(reservoir)


@app.post("/api/irrigation/plan")
def generate_irrigation_plan(
    payload: IrrigationPlanRequest,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    farmer_id = context[0].id
    field = _owned_field(db, farmer_id, payload.field_id)
    matching_reservoirs = _reservoir_list_for_field(db, farmer_id, field.id)
    if not matching_reservoirs:
        raise HTTPException(
            status_code=409,
            detail="Configure a water source for this account or field before generating a plan.",
        )
    if payload.reservoir_id is None:
        if len(matching_reservoirs) != 1:
            raise HTTPException(
                status_code=422,
                detail="Select which reservoir will supply this field.",
            )
        reservoir = matching_reservoirs[0]
    else:
        reservoir = _owned_irrigation_reservoir(
            db, farmer_id, payload.reservoir_id, field.id, lock=True
        )
    available_liters = max(
        0.0, reservoir.available_liters - reservoir.reserved_liters
    )
    crop_record = db.scalar(
        select(FarmerCrop)
        .where(
            FarmerCrop.farmer_id == farmer_id,
            FarmerCrop.field_id == field.id,
        )
        .order_by(FarmerCrop.updated_at.desc(), FarmerCrop.id.desc())
        .limit(1)
    )
    crop_name = (crop_record.name if crop_record else field.crop) or ""
    if not crop_name.strip():
        raise HTTPException(status_code=422, detail="Add a crop to this field before planning irrigation.")
    crop_key = _irrigation_crop_key(crop_name)
    stage_code = payload.growth_stage_code or _irrigation_stage_code(
        crop_record.growth_stage if crop_record else None
    )
    if stage_code is None:
        raise HTTPException(
            status_code=422,
            detail="Select a crop growth stage; no supported stage is saved for this field.",
        )
    if field.latitude is None or field.longitude is None:
        raise HTTPException(
            status_code=422,
            detail="Add this field's latitude and longitude before generating a weather-based plan.",
        )

    try:
        optimizer_field = make_optimizer_field(
            str(field.id),
            crop_key,
            stage_code,
            payload.soil_type_code,
            payload.soil_moisture_pct,
            _field_area_m2(field),
            payload.pump_flow_lpm,
            payload.irrigation_method,
            field.latitude,
            f"field-{field.id}",
        )
        irrigation_water_calc.get_kc(optimizer_field)
        irrigation_water_calc.soil_water_limits(optimizer_field)
    except (KeyError, ValueError) as error:
        raise HTTPException(status_code=422, detail=f"Invalid field planning data: {error}") from error

    location = f"{field.latitude:.6f},{field.longitude:.6f}"
    try:
        forecast, warnings = irrigation_weather_adapter.fetch_daily_forecast(
            location, payload.days
        )
    except (RuntimeError, ValueError) as error:
        logger.warning("Weather data unavailable for irrigation planning: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Weather data is unavailable for this field. Check the provider configuration and try again.",
        ) from error
    if not forecast:
        raise HTTPException(
            status_code=503,
            detail="No complete daily weather forecast is available; no irrigation plan was generated.",
        )

    field_id_text = str(field.id)
    daily_plans = optimize_schedule(
        [optimizer_field],
        forecast,
        now=datetime.now(irrigation_weather_adapter.IST),
    )[field_id_text]
    irrigation_plan = next(
        (item for item in daily_plans if item.action == "irrigate"),
        daily_plans[0],
    )
    selected_forecast = next(
        (item for item in forecast if item.date == irrigation_plan.date),
        None,
    )
    projected_need_mm = max(
        0.0,
        irrigation_plan.depletion_start_mm
        + irrigation_plan.etc_mm
        - irrigation_plan.effective_rain_mm,
    )
    target_mm = min(
        projected_need_mm,
        irrigation_config.MAX_IRRIGATION_MM_PER_EVENT,
    )
    required_liters = irrigation_water_calc.gross_litres(
        target_mm, optimizer_field
    ) if irrigation_plan.action == "irrigate" else 0.0
    shortage_liters = max(0.0, required_liters - available_liters)

    status = None
    if required_liters and shortage_liters > 0.01:
        irrigation_plan.action = "insufficient_water"
        irrigation_plan.litres = 0.0
        irrigation_plan.net_mm = 0.0
        irrigation_plan.sessions = []
        irrigation_plan.notes = [
            note for note in irrigation_plan.notes
            if not (
                "min of irrigation could not be scheduled today" in note
                or "no free time slot found" in note
                or note.startswith("Per-event cap of ")
            )
        ]
        irrigation_plan.depletion_end_mm = round(projected_need_mm, 2)
        irrigation_plan.notes.append(
            f"Insufficient unreserved reservoir water: {shortage_liters:.1f} L short of the "
            f"{required_liters:.1f} L event requirement. No irrigation was scheduled."
        )
        status = "insufficient_water"
    elif required_liters and irrigation_plan.litres > available_liters + 0.01:
        shortage_liters = irrigation_plan.litres - available_liters
        irrigation_plan.action = "insufficient_water"
        irrigation_plan.net_mm = 0.0
        irrigation_plan.litres = 0.0
        irrigation_plan.sessions = []
        irrigation_plan.notes = [
            note for note in irrigation_plan.notes
            if not (
                "min of irrigation could not be scheduled today" in note
                or "no free time slot found" in note
                or note.startswith("Per-event cap of ")
            )
        ]
        irrigation_plan.depletion_end_mm = round(projected_need_mm, 2)
        irrigation_plan.notes.append(
            f"Insufficient unreserved reservoir water: {shortage_liters:.1f} L short. "
            "No irrigation was scheduled."
        )
        status = "insufficient_water"
    elif (
        irrigation_plan.action == "irrigate"
        and irrigation_plan.litres > 0
        and irrigation_plan.sessions
    ):
        status = "recommended"

    serialized_plan = plans_to_dicts(
        {field_id_text: [irrigation_plan]}
    )[field_id_text][0]
    serialized_plan.update(
        {
            "required_liters": round(required_liters, 1),
            "water_shortage_liters": round(shortage_liters, 1),
            "available_water_liters": round(available_liters, 1),
            "reservoir_id": reservoir.id,
        }
    )
    schedule = None
    if status is not None:
        sessions = irrigation_plan.sessions
        schedule = IrrigationSchedule(
            farmer_id=farmer_id,
            field_id=field.id,
            reservoir_id=reservoir.id,
            field_name=field.name,
            crop_name=crop_name,
            scheduled_date=irrigation_plan.date,
            start_time=sessions[0].start if sessions else None,
            end_time=sessions[-1].end if sessions else None,
            water_liters=required_liters if status == "insufficient_water" else irrigation_plan.litres,
            duration_minutes=sum(session.minutes for session in sessions),
            irrigation_method=payload.irrigation_method,
            status=status,
            plan_snapshot=serialized_plan,
        )
        db.add(schedule)
        db.commit()
        db.refresh(schedule)

    reservoir = _owned_irrigation_reservoir(
        db, farmer_id, reservoir.id, field.id
    )
    return {
        "field": {
            "id": field.id,
            "name": field.name,
            "crop": crop_name,
            "area": field.area,
            "area_unit": field.area_unit,
            "area_m2": round(_field_area_m2(field), 2),
            "growth_stage": crop_record.growth_stage if crop_record else None,
            "zone": None,
        },
        "warnings": warnings,
        "weather": {
            "date": selected_forecast.date,
            "temperature_min_c": selected_forecast.temp_min,
            "temperature_max_c": selected_forecast.temp_max,
            "rain_mm": selected_forecast.rain_mm,
            "rain_probability": selected_forecast.rain_prob,
        } if selected_forecast else None,
        "plan": serialized_plan,
        "schedule": schedule_response(schedule) if schedule else None,
        "reservoir": reservoir_response(reservoir),
        "status": status or irrigation_plan.action,
    }
@app.post("/api/irrigation/schedules", status_code=201)
def create_manual_irrigation_schedule(
    payload: ManualIrrigationScheduleRequest,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    farmer_id = context[0].id

    field = _owned_field(db, farmer_id, payload.field_id)
    reservoir = _owned_irrigation_reservoir(
        db,
        farmer_id,
        payload.reservoir_id,
        field.id,
        lock=True,
    )

    now = datetime.now(irrigation_weather_adapter.IST)
    start_at = datetime.combine(
        payload.scheduled_date,
        payload.start_time,
        tzinfo=irrigation_weather_adapter.IST,
    )
    end_at = start_at + timedelta(minutes=payload.duration_minutes)

    if start_at <= now:
        raise HTTPException(
            status_code=422,
            detail="Choose a future date and start time.",
        )

    if end_at.date() != payload.scheduled_date:
        raise HTTPException(
            status_code=422,
            detail="The irrigation schedule must finish on the same date.",
        )

    available_liters = max(
        0.0,
        reservoir.available_liters - reservoir.reserved_liters,
    )

    if payload.water_liters > available_liters:
        shortage = payload.water_liters - available_liters
        raise HTTPException(
            status_code=409,
            detail=(
                f"Not enough unreserved water. "
                f"Available: {available_liters:.1f} L; "
                f"requested: {payload.water_liters:.1f} L; "
                f"shortage: {shortage:.1f} L."
            ),
        )

    crop_record = db.scalar(
        select(FarmerCrop)
        .where(
            FarmerCrop.farmer_id == farmer_id,
            FarmerCrop.field_id == field.id,
        )
        .order_by(FarmerCrop.updated_at.desc(), FarmerCrop.id.desc())
        .limit(1)
    )
    crop_name = (crop_record.name if crop_record else field.crop) or ""

    schedule = IrrigationSchedule(
        farmer_id=farmer_id,
        field_id=field.id,
        reservoir_id=reservoir.id,
        field_name=field.name,
        crop_name=crop_name,
        scheduled_date=payload.scheduled_date,
        start_time=payload.start_time.strftime("%H:%M"),
        end_time=end_at.strftime("%H:%M"),
        water_liters=payload.water_liters,
        duration_minutes=payload.duration_minutes,
        irrigation_method=payload.irrigation_method,
        status="recommended",
        plan_snapshot={
            "action": "manual_schedule",
            "source": "farmer_entered",
            "available_water_liters": round(available_liters, 1),
            "requested_water_liters": round(payload.water_liters, 1),
            "notes": [
                "Manually created by the farmer.",
                "Water will be reserved only after confirmation.",
            ],
        },
    )

    try:
        db.add(schedule)
        db.commit()
        db.refresh(schedule)
    except Exception:
        db.rollback()
        raise

    return {
        "schedule": schedule_response(schedule),
        "message": "Manual irrigation schedule created. Confirm it to reserve water.",
    }

@app.get("/api/irrigation/schedules")
def list_irrigation_schedules(
    field_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    farmer_id = context[0].id
    if field_id is not None:
        _owned_field(db, farmer_id, field_id)
    statement = select(IrrigationSchedule).where(
        IrrigationSchedule.farmer_id == farmer_id
    )
    if field_id is not None:
        statement = statement.where(IrrigationSchedule.field_id == field_id)
    schedules = list(
        db.scalars(
            statement.order_by(
                IrrigationSchedule.scheduled_date,
                IrrigationSchedule.start_time,
                IrrigationSchedule.id,
            )
        ).all()
    )
    for schedule in schedules:
        _owned_field(db, farmer_id, schedule.field_id)
        _owned_irrigation_reservoir(
            db, farmer_id, schedule.reservoir_id, schedule.field_id
        )
    reservoirs = _reservoir_list_for_field(db, farmer_id, field_id)
    today = datetime.now(timezone.utc).date()
    confirmed = [item for item in schedules if item.status == "confirmed"]
    return {
        "schedules": [schedule_response(item) for item in schedules],
        "summary": {
            "total_scheduled_liters": round(
                sum(item.water_liters for item in confirmed), 1
            ),
            "total_reserved_liters": round(
                sum(item.reserved_liters for item in reservoirs), 1
            ),
            "remaining_available_liters": round(
                sum(
                    max(0.0, item.available_liters - item.reserved_liters)
                    for item in reservoirs
                ),
                1,
            ),
            "upcoming_events": sum(
                item.scheduled_date >= today for item in confirmed
            ),
            "completed_events": sum(
                item.status == "completed" for item in schedules
            ),
        },
    }


@app.get("/api/irrigation/schedules/{schedule_id}")
def get_irrigation_schedule(
    schedule_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    schedule = db.scalar(
        select(IrrigationSchedule).where(
            IrrigationSchedule.id == schedule_id,
            IrrigationSchedule.farmer_id == context[0].id,
        )
    )
    if schedule is None:
        raise HTTPException(status_code=404, detail="Irrigation schedule not found.")
    _owned_field(db, context[0].id, schedule.field_id)
    _owned_irrigation_reservoir(
        db, context[0].id, schedule.reservoir_id, schedule.field_id
    )
    return schedule_response(schedule)


@app.post("/api/irrigation/schedules/{schedule_id}/confirm")
def confirm_irrigation_schedule_route(
    schedule_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    schedule = db.scalar(
        select(IrrigationSchedule).where(
            IrrigationSchedule.id == schedule_id,
            IrrigationSchedule.farmer_id == context[0].id,
        )
    )
    if schedule is None:
        raise HTTPException(status_code=404, detail="Irrigation schedule not found.")
    _owned_field(db, context[0].id, schedule.field_id)
    _owned_irrigation_reservoir(
        db, context[0].id, schedule.reservoir_id, schedule.field_id
    )
    try:
        schedule = confirm_irrigation_schedule(db, context[0].id, schedule_id)
    except InsufficientWater as error:
        raise HTTPException(
            status_code=409,
            detail=f"Available reservoir water changed; {error.shortage_liters:.1f} L is now short.",
        ) from error
    except ScheduleConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    reservoir = _owned_irrigation_reservoir(
        db, context[0].id, schedule.reservoir_id, schedule.field_id
    )
    return {
        "schedule": schedule_response(schedule),
        "reservoir": reservoir_response(reservoir),
    }


@app.post("/api/irrigation/schedules/{schedule_id}/cancel")
def cancel_irrigation_schedule_route(
    schedule_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    schedule = db.scalar(
        select(IrrigationSchedule).where(
            IrrigationSchedule.id == schedule_id,
            IrrigationSchedule.farmer_id == context[0].id,
        )
    )
    if schedule is None:
        raise HTTPException(status_code=404, detail="Irrigation schedule not found.")
    _owned_field(db, context[0].id, schedule.field_id)
    _owned_irrigation_reservoir(
        db, context[0].id, schedule.reservoir_id, schedule.field_id
    )
    try:
        schedule = cancel_irrigation_schedule(db, context[0].id, schedule_id)
    except ScheduleConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    reservoir = _owned_irrigation_reservoir(
        db, context[0].id, schedule.reservoir_id, schedule.field_id
    )
    return {
        "schedule": schedule_response(schedule),
        "reservoir": reservoir_response(reservoir),
    }


@app.post("/api/irrigation/schedules/{schedule_id}/complete")
def complete_irrigation_schedule_route(
    schedule_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    schedule = db.scalar(
        select(IrrigationSchedule).where(
            IrrigationSchedule.id == schedule_id,
            IrrigationSchedule.farmer_id == context[0].id,
        )
    )
    if schedule is None:
        raise HTTPException(status_code=404, detail="Irrigation schedule not found.")
    _owned_field(db, context[0].id, schedule.field_id)
    _owned_irrigation_reservoir(
        db, context[0].id, schedule.reservoir_id, schedule.field_id
    )
    try:
        schedule = complete_irrigation_schedule(db, context[0].id, schedule_id)
    except ScheduleConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    reservoir = _owned_irrigation_reservoir(
        db, context[0].id, schedule.reservoir_id, schedule.field_id
    )
    return {
        "schedule": schedule_response(schedule),
        "reservoir": reservoir_response(reservoir),
    }


@app.post("/api/auth/register", status_code=201, response_model=FarmerProfile)
def register_farmer(
    payload: FarmerRegister,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    _validate_origin(request)
    _limit_auth_attempts(request)
    farmer = Farmer(
        name=payload.name,
        email=str(payload.email).casefold(),
        password_hash=password_hasher.hash(payload.password),
        phone=payload.phone,
        state=payload.state,
        district=payload.district,
        village=payload.village,
    )
    db.add(farmer)
    try:
        db.commit()
        db.refresh(farmer)
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="An account with this email address already exists.",
        ) from error
    except SQLAlchemyError as error:
        db.rollback()
        logger.exception("Farmer registration failed.")
        raise HTTPException(status_code=503, detail="Account registration is unavailable.") from error
    _create_session(db, farmer, response)
    return _profile(farmer)


@app.post("/api/auth/login", response_model=FarmerProfile)
def login_farmer(
    payload: FarmerLogin,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    _validate_origin(request)
    _limit_auth_attempts(request)
    farmer = db.scalar(select(Farmer).where(Farmer.email == str(payload.email).casefold()))
    password_hash = farmer.password_hash if farmer else dummy_password_hash
    try:
        valid_password = password_hasher.verify(password_hash, payload.password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        valid_password = False
    if not farmer or not valid_password:
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    _create_session(db, farmer, response)
    return _profile(farmer)


@app.get("/api/auth/me", response_model=FarmerProfile)
def current_farmer(
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    return _profile(context[0])


@app.patch("/api/auth/me", response_model=FarmerProfile)
def update_farmer_profile(
    payload: FarmerPatch,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    farmer = context[0]
    values = payload.model_dump(exclude_unset=True)
    if values.get("name") is None and "name" in values:
        raise HTTPException(status_code=422, detail="Name cannot be empty.")
    if not values:
        raise HTTPException(status_code=422, detail="At least one profile field is required.")
    if "phone" in values and values["phone"] != farmer.phone:
        farmer.phone_verified_at = None
        farmer.sms_enabled = False
    for key, value in values.items():
        setattr(farmer, key, value)
    db.commit()
    db.refresh(farmer)
    return _profile(farmer)


@app.post("/api/auth/logout", status_code=204)
def logout_farmer(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    _validate_origin(request)
    raw_token = request.cookies.get(SESSION_COOKIE)
    if raw_token:
        auth_session = db.scalar(
            select(AuthSession).where(AuthSession.token_hash == _digest(raw_token))
        )
        if auth_session:
            csrf_cookie = request.cookies.get(CSRF_COOKIE, "")
            csrf_header = request.headers.get("x-csrf-token", "")
            if (
                not csrf_cookie
                or not csrf_header
                or not hmac.compare_digest(csrf_cookie, csrf_header)
                or not hmac.compare_digest(_digest(csrf_cookie), auth_session.csrf_hash)
            ):
                raise HTTPException(status_code=403, detail="CSRF validation failed.")
            db.delete(auth_session)
            db.commit()
    _clear_session_cookies(response)
    response.status_code = 204
    return response


@app.post(
    "/api/ml/experimental-prediction",
    response_model=ExperimentalPredictionResponse,
)
def experimental_prediction(
    payload: ExperimentalPredictionRequest,
    response: Response,
    _context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    response.headers["Cache-Control"] = "no-store"
    try:
        bundle, predict_records = _load_experimental_predictor()
        prediction = predict_records(bundle, [payload.model_dump()])[0]
    except Exception as error:
        logger.exception("Experimental model prediction is unavailable.")
        raise HTTPException(
            status_code=503,
            detail="The experimental model is currently unavailable.",
        ) from error

    return {
        **prediction,
        "model_status": "Experimental",
        "dataset_provenance": bundle["metadata"]["dataset_provenance"],
    }


@app.post(
    "/api/ml/reduced-weather-prediction",
    response_model=ReducedWeatherPredictionResponse,
)
def reduced_weather_prediction(
    payload: ReducedWeatherPredictionRequest,
    response: Response,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    response.headers["Cache-Control"] = "no-store"

    farmer_id = context[0].id

    # 1. Verify field ownership and coordinates.
    field = _owned_field(db, farmer_id, payload.field_id)

    if field.latitude is None or field.longitude is None:
        raise HTTPException(
            status_code=422,
            detail="This field has no saved coordinates for weather-based irrigation assessment.",
        )

    _limit_weather_requests(farmer_id)

    location = f"{field.latitude:.6f},{field.longitude:.6f}"

    # 2. Retrieve the latest saved sensor reading for this field.
    reading = db.scalars(
        select(FarmerSensorReading)
        .where(
            FarmerSensorReading.farmer_id == farmer_id,
            FarmerSensorReading.field_id == field.id,
        )
        .order_by(
            FarmerSensorReading.recorded_at.desc(),
            FarmerSensorReading.id.desc(),
        )
        .limit(1)
    ).first()

    if reading is None:
        raise HTTPException(
            status_code=422,
            detail="No saved soil-moisture reading is available for this field.",
        )

    if reading.recorded_at.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail="The latest sensor reading has an invalid timestamp.",
        )

    reading_time = reading.recorded_at.astimezone(timezone.utc)
    reading_age_seconds = (
        datetime.now(timezone.utc) - reading_time
    ).total_seconds()

    if reading_age_seconds < -60:
        raise HTTPException(
            status_code=422,
            detail="The latest sensor reading has a timestamp too far in the future.",
        )

    moisture = reading.soil_moisture_percent

    if (
        isinstance(moisture, bool)
        or not isinstance(moisture, (int, float))
        or not math.isfinite(moisture)
        or not 0 <= moisture <= 100
    ):
        raise HTTPException(
            status_code=422,
            detail="The saved soil-moisture reading is invalid.",
        )

    # 3. Retrieve the latest crop information for this field.
    crop_record = db.scalars(
        select(FarmerCrop)
        .where(
            FarmerCrop.farmer_id == farmer_id,
            FarmerCrop.field_id == field.id,
        )
        .order_by(FarmerCrop.updated_at.desc())
        .limit(1)
    ).first()

    crop_name = (
        crop_record.name
        if crop_record and crop_record.name
        else field.crop
    )
    if not crop_name:
        raise HTTPException(
            status_code=422,
            detail="Crop information is not available for this field.",
        )

    crop_key = _irrigation_crop_key(crop_name)

    growth_stage = (
        crop_record.growth_stage
        if crop_record
        else None
    )
    growth_stage_code = _irrigation_stage_code(growth_stage)

    if growth_stage_code is None:
        raise HTTPException(
            status_code=422,
            detail="A supported crop growth stage is required for irrigation assessment.",
        )

    # 4. Retrieve the field-specific daily weather forecast.
    try:
        forecast_days, forecast_warnings = (
            irrigation_weather_adapter.fetch_daily_forecast(
                location=location,
                days=2,
            )
        )
    except Exception as error:
        logger.exception(
            "Field-specific daily forecast is unavailable."
        )
        raise _weather_error(error) from error

    if not forecast_days:
        raise HTTPException(
            status_code=503,
            detail="No daily weather forecast is available for this field.",
        )

    today_forecast = forecast_days[0]
    tomorrow_forecast = (
        forecast_days[1]
        if len(forecast_days) > 1
        else None
    )

    # 5. Identify the weather source.
    warning_text = " ".join(
        str(item) for item in (forecast_warnings or [])
    ).lower()

    weather_source = (
        "open_meteo"
        if "open-meteo" in warning_text
        else "tomorrow_io"
    )

    # 6. Build a field configuration for the existing water-balance
    # calculations.
    #
    # Soil type code 2 is the agreed loam fallback because the current
    # field database does not store soil type.
    #
    # Drip and pump flow are configuration placeholders required by
    # make_optimizer_field. This endpoint does not operate a pump or
    # create an irrigation schedule.
    try:
        optimizer_field = make_optimizer_field(
            field_id=str(field.id),
            crop_label=crop_key,
            growth_stage_code=growth_stage_code,
            soil_type_code=2,
            soil_moisture_pct=float(moisture),
            area_m2=_field_area_m2(field),
            pump_flow_lpm=1.0,
            irrigation_method="drip",
            latitude=float(field.latitude),
        )

        kc = irrigation_water_calc.get_kc(optimizer_field)

        taw_mm, raw_mm = (
            irrigation_water_calc.soil_water_limits(
                optimizer_field
            )
        )

        depletion_mm, _ = (
            irrigation_water_calc.initial_depletion(
                optimizer_field,
                taw_mm,
            )
        )

        # 7. Calculate today's crop water use.
        et0_mm = today_forecast.et0_mm

        if et0_mm is None:
            et0_mm = irrigation_water_calc.hargreaves_et0(
                today_forecast.temp_min,
                today_forecast.temp_max,
                float(field.latitude),
                today_forecast.date,
            )

        etc_mm = irrigation_water_calc.crop_etc(
            et0_mm,
            kc,
        )

        effective_rain_mm = (
            irrigation_water_calc.effective_rainfall(
                today_forecast.rain_mm,
                today_forecast.rain_prob,
            )
        )

        projected_depletion_mm = max(
            0.0,
            depletion_mm + etc_mm - effective_rain_mm,
        )

        irrigation_needed = projected_depletion_mm >= raw_mm

        decision = "hold"
        reason = (
            "Current soil-water depletion is below the "
            "irrigation threshold."
        )

        if irrigation_needed:
            decision = "irrigate"
            reason = (
                "Projected soil-water depletion reaches the "
                "irrigation threshold after accounting for "
                "crop water use and effective rainfall."
            )

            # 8. If today's threshold is crossed, check whether
            # tomorrow's forecast rainfall is likely to reduce
            # depletion below the threshold.
            if tomorrow_forecast is not None:
                tomorrow_et0 = tomorrow_forecast.et0_mm

                if tomorrow_et0 is None:
                    tomorrow_et0 = (
                        irrigation_water_calc.hargreaves_et0(
                            tomorrow_forecast.temp_min,
                            tomorrow_forecast.temp_max,
                            float(field.latitude),
                            tomorrow_forecast.date,
                        )
                    )

                tomorrow_etc = (
                    irrigation_water_calc.crop_etc(
                        tomorrow_et0,
                        kc,
                    )
                )

                tomorrow_effective_rain = (
                    irrigation_water_calc.effective_rainfall(
                        tomorrow_forecast.rain_mm,
                        tomorrow_forecast.rain_prob,
                    )
                )

                tomorrow_projected_depletion = max(
                    0.0,
                    projected_depletion_mm
                    + tomorrow_etc
                    - tomorrow_effective_rain,
                )

                if tomorrow_projected_depletion < raw_mm:
                    decision = "hold"
                    reason = (
                        "Rainfall expected tomorrow is likely "
                        "to bring projected soil-water depletion "
                        "below the irrigation threshold. "
                        "Reassess after the forecast rainfall."
                    )

    except HTTPException:
        raise
    except Exception as error:
        logger.exception(
            "Field-specific irrigation assessment failed."
        )
        raise HTTPException(
            status_code=503,
            detail="The irrigation assessment could not be completed with the available field and weather data.",
        ) from error

    # 9. Return the field-specific irrigation assessment.
    return {
        "irrigation_needed": decision == "irrigate",
        "decision": decision,
        "reason": reason,
        "soil_moisture_percent": float(moisture),
        "rainfall_mm": float(today_forecast.rain_mm),
        "rain_probability_percent": (
            float(today_forecast.rain_prob) * 100
        ),
        "et0_mm": float(et0_mm),
        "forecast_date": today_forecast.date,
        "observation_time": reading_time,
        "weather_source": weather_source,
    }

@app.post(
    "/api/ml/reduced-weather-experimental",
    response_model=ReducedWeatherExperimentalResponse,
)
def reduced_weather_experimental_prediction(
    payload: ReducedWeatherPredictionRequest,
    response: Response,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    response.headers["Cache-Control"] = "no-store"
    field = _owned_field(db, context[0].id, payload.field_id)

    if field.latitude is None or field.longitude is None:
        raise HTTPException(
            status_code=422,
            detail="This field has no saved coordinates for current-weather inference.",
        )

    _limit_weather_requests(context[0].id)
    location = f"{field.latitude:.6f},{field.longitude:.6f}"

    try:
        weather = get_current_weather(location)
    except (ValueError, WeatherUnavailableError, WeatherAuthError) as error:
        raise _weather_error(error) from error

    if not isinstance(weather, dict):
        raise HTTPException(
            status_code=422,
            detail="Field-specific weather is invalid; no prediction was generated.",
        )

    observation_time = weather.get("observation_time")
    if not isinstance(observation_time, str):
        raise HTTPException(
            status_code=422,
            detail="Fresh field-specific weather is unavailable; no prediction was generated.",
        )

    try:
        observed_at = datetime.fromisoformat(
            observation_time.replace("Z", "+00:00")
        )
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail="The field weather observation timestamp is invalid; no prediction was generated.",
        ) from error

    data_age = weather.get("data_age_minutes")

    if (
        weather.get("is_stale") is not False
        or observed_at.tzinfo is None
        or not isinstance(data_age, (int, float))
        or isinstance(data_age, bool)
        or not math.isfinite(data_age)
        or data_age < 0
        or data_age >= 15
    ):
        raise HTTPException(
            status_code=422,
            detail="Fresh field-specific weather is unavailable; no prediction was generated.",
        )

    now = datetime.now(timezone.utc)
    observed_at = observed_at.astimezone(timezone.utc)
    observation_age_seconds = (now - observed_at).total_seconds()

    if observation_age_seconds < -60 or observation_age_seconds >= 15 * 60:
        raise HTTPException(
            status_code=422,
            detail="Fresh field-specific weather is unavailable; no prediction was generated.",
        )

    record = {}

    for name in ("temperature_c", "humidity_percent"):
        value = weather.get(name)

        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
        ):
            raise HTTPException(
                status_code=422,
                detail=f"Field weather is missing a valid {name}; no prediction was generated.",
            )

        record[name] = float(value)

    if not 0 <= record["humidity_percent"] <= 100:
        raise HTTPException(
            status_code=422,
            detail="Field humidity is outside the percent scale; no prediction was generated.",
        )

    try:
        bundle, predict_records = _load_reduced_weather_predictor()

        for name, value in record.items():
            training_range = bundle["metadata"]["feature_training_ranges"][name]

            if not (
                training_range["minimum"]
                <= value
                <= training_range["maximum"]
            ):
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Field weather {name} is outside the model's observed "
                        "training range; extrapolation is blocked."
                    ),
                )

        prediction = predict_records(bundle, [record])[0]

        if (
            type(prediction.get("prediction")) is not int
            or prediction["prediction"] not in (0, 1)
            or isinstance(prediction.get("proxy_positive_probability"), bool)
            or not isinstance(
                prediction.get("proxy_positive_probability"),
                (int, float),
            )
            or not math.isfinite(
                prediction["proxy_positive_probability"]
            )
            or not 0 <= prediction["proxy_positive_probability"] <= 1
        ):
            raise ValueError(
                "The reduced-weather model returned an invalid binary result."
            )

    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Reduced-weather proxy prediction is unavailable.")
        raise HTTPException(
            status_code=503,
            detail="The experimental reduced-weather model is currently unavailable.",
        ) from error

    return {
        **prediction,
        "proxy_rule": bundle["metadata"]["proxy_rule"],
        "model_status": "Experimental",
        "dataset_provenance": bundle["metadata"]["dataset_provenance"],
        "selected_model": bundle["metadata"]["model_name"],
        "feature_inputs": record,
        "feature_sources": {
            "temperature_c": "selected_field_current_weather_api",
            "humidity_percent": "selected_field_current_weather_api",
        },
        "observation_time": observed_at,
    }

@app.post("/api/ml/water-requirement/experimental")
def experimental_water_requirement_prediction(
    payload: Model2ExperimentalRequest,
    response: Response,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    response.headers["Cache-Control"] = "no-store"
    farmer_id = context[0].id

    field = _owned_field(db, farmer_id, payload.field_id)
    crop = _owned_crop(db, farmer_id, payload.crop_id)

    if crop.field_id != field.id:
        raise HTTPException(status_code=404, detail="Crop not found for this field.")

    if not crop.name and not field.crop:
        raise HTTPException(status_code=422, detail="Crop information is unavailable.")

    area_m2 = _field_area_m2(field)
    area_acres = area_m2 / 4046.8564224

    if not math.isfinite(area_acres) or area_acres <= 0:
        raise HTTPException(status_code=422, detail="Field area is invalid.")

    sources = {}
    illustrative_inputs = []

    # Crop information
    crop_name = (crop.name or field.crop).strip().lower()
    sources["crop_type"] = "saved crop record" if crop.name else "field crop"

    stage_code = _irrigation_stage_code(crop.growth_stage)
    if stage_code is None:
        stage_code = 1
        sources["growth_stage"] = "illustrative default: seedlings"
        illustrative_inputs.append("growth_stage")
    else:
        sources["growth_stage"] = "saved crop growth stage"

    # Latest field sensor reading
    reading = db.scalars(
        select(FarmerSensorReading)
        .where(
            FarmerSensorReading.farmer_id == farmer_id,
            FarmerSensorReading.field_id == field.id,
        )
        .order_by(
            FarmerSensorReading.recorded_at.desc(),
            FarmerSensorReading.id.desc(),
        )
        .limit(1)
    ).first()

    if reading is not None:
        moisture = float(reading.soil_moisture_percent)
        sources["soil_moisture_percent"] = "latest saved sensor reading"
    else:
        moisture = 28.3
        sources["soil_moisture_percent"] = "illustrative default"
        illustrative_inputs.append("soil_moisture_percent")

    if reading is not None and reading.humidity_percent is not None:
        humidity = float(reading.humidity_percent)
        sources["humidity_percent"] = "latest saved sensor reading"
    else:
        humidity = 55.0
        sources["humidity_percent"] = "illustrative default"
        illustrative_inputs.append("humidity_percent")

    # Weather values: use field forecast when coordinates and service are available.
    temperature = 28.0
    rainfall = 1.0
    forecast_rainfall = 2.0
    et0 = 4.0

    weather_available = False

    if field.latitude is not None and field.longitude is not None:
        try:
            forecast_days, _warnings = (
                irrigation_weather_adapter.fetch_daily_forecast(
                    location=f"{field.latitude:.6f},{field.longitude:.6f}",
                    days=2,
                )
            )

            if forecast_days:
                today = forecast_days[0]
                temperature = (float(today.temp_min) + float(today.temp_max)) / 2
                rainfall = max(0.0, float(today.rain_mm))

                if today.et0_mm is not None:
                    et0 = max(0.0, float(today.et0_mm))

                if len(forecast_days) > 1:
                    forecast_rainfall = max(
                        0.0, float(forecast_days[1].rain_mm)
                    )

                weather_available = True
        except Exception:
            logger.warning(
                "Experimental Model 2 weather data unavailable for field %s.",
                field.id,
            )

    for key in ("temperature_c", "rainfall_mm", "forecast_rainfall_mm", "et0_mm_day"):
        sources[key] = "field weather forecast" if weather_available else "illustrative default"
        if not weather_available:
            illustrative_inputs.append(key)

    # The database does not currently store field soil type.
    soil_type = 2
    sources["soil_type"] = "illustrative loam default"
    illustrative_inputs.append("soil_type")

    # Use the most recent completed irrigation schedule when available.
    previous_schedule = db.scalars(
        select(IrrigationSchedule)
        .where(
            IrrigationSchedule.farmer_id == farmer_id,
            IrrigationSchedule.field_id == field.id,
            IrrigationSchedule.status == "completed",
        )
        .order_by(
            IrrigationSchedule.scheduled_date.desc(),
            IrrigationSchedule.created_at.desc(),
        )
        .limit(1)
    ).first()

    if previous_schedule is not None:
        irrigation_method = previous_schedule.irrigation_method.lower()
        previous_irrigation = max(
            0.0, float(previous_schedule.water_liters) / area_m2
        )
        sources["irrigation_method"] = "latest completed irrigation schedule"
        sources["previous_irrigation_mm"] = "latest completed irrigation schedule"
    else:
        irrigation_method = "drip"
        previous_irrigation = 0.0
        sources["irrigation_method"] = "illustrative default"
        sources["previous_irrigation_mm"] = "illustrative default"
        illustrative_inputs.extend(["irrigation_method", "previous_irrigation_mm"])

    # These features are not currently stored in the field or sensor records.
    wind_speed = 2.5
    crop_coefficient = 1.0
    sources["wind_speed"] = "illustrative default"
    sources["crop_coefficient_kc"] = "illustrative default"
    illustrative_inputs.extend(["wind_speed", "crop_coefficient_kc"])

    features = {
        "crop_type": crop_name,
        "growth_stage": stage_code,
        "soil_type": soil_type,
        "soil_moisture_percent": moisture,
        "temperature_c": temperature,
        "humidity_percent": humidity,
        "rainfall_mm": rainfall,
        "forecast_rainfall_mm": forecast_rainfall,
        "field_area_acres": area_acres,
        "irrigation_method": irrigation_method,
        "wind_speed": wind_speed,
        "et0_mm_day": et0,
        "crop_coefficient_kc": crop_coefficient,
        "previous_irrigation_mm": previous_irrigation,
    }

    try:
        model = _load_legacy_model2()
        input_data = pd.DataFrame([features])
        prediction = float(model.predict(input_data)[0])

        if not math.isfinite(prediction):
            raise ValueError("Model returned a non-finite prediction.")

    except Exception as error:
        logger.exception("Experimental Model 2 prediction failed.")
        raise HTTPException(
            status_code=503,
            detail="The experimental Model 2 prediction could not be completed.",
        ) from error

    return {
        "prediction_status": "experimental",
        "estimated_water_liters": round(max(0.0, prediction), 2),
        "unit": "litres",
        "prediction_period_hours": 24,
        "model": "HistGradientBoostingRegressor",
        "selected_field": field.name,
        "selected_crop": crop_name,
        "selected_zone": payload.zone,
        "inputs": features,
        "input_sources": sources,
        "illustrative_inputs": sorted(set(illustrative_inputs)),
        "prediction_timestamp": datetime.now(timezone.utc).isoformat(),
        "data_note": (
            "Experimental demonstration using a model trained and evaluated "
            "on synthetic data. This is not a validated irrigation recommendation."
        ),
    }

@app.post("/api/ml/water-requirement")
def water_requirement_prediction(
    payload: WaterRequirementRequest,
    response: Response,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    response.headers["Cache-Control"] = "no-store"
    return _get_model2_prediction(
        db,
        context[0].id,
        payload.field_id,
        payload.crop_id,
    )


def _get_model2_prediction(
    db: Session,
    farmer_id: int,
    field_id: int,
    crop_id: int,
) -> dict:
    field = _owned_field(db, farmer_id, field_id)
    crop = _owned_crop(db, farmer_id, crop_id)
    if crop.field_id != field.id:
        raise HTTPException(status_code=404, detail="Crop not found for this field.")
    try:
        load_production_model2_bundle()
    except (FileNotFoundError, ImportError, OSError, ValueError) as error:
        logger.warning("Model 2 production artifact is unavailable: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Water requirement estimates are unavailable. A validated production "
                "Model 2 artifact trained and evaluated on independently verified "
                "real-world water-requirement labels is not available; no estimate "
                "was generated."
            ),
            headers={"Cache-Control": "no-store"},
        ) from error
    raise HTTPException(
        status_code=503,
        detail=(
            "Water requirement estimates are unavailable. Required prediction-time "
            "soil-moisture and measured rainfall inputs are not available from "
            "validated application sources; no estimate was generated."
        ),
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/assistant/chat")
async def farmer_assistant_chat(
    payload: FarmerAssistantRequest | ChartAssistantRequest,
    response: Response,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    response.headers["Cache-Control"] = "no-store"
    _limit_assistant_requests(context[0].id)
    if isinstance(payload, ChartAssistantRequest):
        farmer_id = context[0].id
        conversation = None
        question = payload.question
        history = [message.model_dump() for message in payload.history]
        field_id = payload.field_id
        crop_id = payload.crop_id
        if payload.conversation_id is not None:
            conversation = _owned_assistant_conversation(
                db,
                farmer_id,
                payload.conversation_id,
            )
            saved_messages = conversation.messages
            if not isinstance(saved_messages, list):
                raise HTTPException(status_code=500, detail="Saved conversation data is invalid.")
            if payload.regenerate:
                if (
                    len(saved_messages) < 2
                    or not isinstance(saved_messages[-2], dict)
                    or not isinstance(saved_messages[-1], dict)
                    or saved_messages[-2].get("role") != "user"
                    or saved_messages[-1].get("role") != "assistant"
                    or not isinstance(saved_messages[-2].get("content"), str)
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="There is no saved response to regenerate.",
                    )
                question = saved_messages[-2]["content"]
                history = _assistant_history_entries(saved_messages[:-2])
                field_id = conversation.field_id
                crop_id = conversation.crop_id
            else:
                history = _assistant_history_entries(saved_messages)

        selected_crop = None
        if crop_id is not None:
            selected_crop = _owned_crop(db, farmer_id, crop_id)
            if field_id is not None and selected_crop.field_id != field_id:
                raise HTTPException(
                    status_code=404,
                    detail="Crop not found for the selected field.",
                )
            if field_id is None:
                field_id = selected_crop.field_id

        field_data = _assistant_chart_context(
            db,
            farmer_id,
            field_id,
            payload,
            selected_crop,
        )
        field_data.update(
            _assistant_chart_payloads(
                field_data,
                question,
                history,
                payload.chart_mode,
            )
        )
        if conversation is not None:
            previous_disease = _latest_verified_crop_disease(conversation.messages)
            if previous_disease is not None:
                field_data["crop_disease"] = previous_disease
        farmer = context[0]
        field_data["farmer_profile"] = {
            "name": farmer.name,
            "state": farmer.state,
            "district": farmer.district,
            "village": farmer.village,
        }
        try:
            answer = await answer_chart_question(
                question,
                _assistant_gemini_context(field_data),
                history,
                payload.language_code,
            )
        except AssistantServiceError as error:
            logger.warning("Chart assistant request failed with status %s.", error.status_code)
            headers = {"Cache-Control": "no-store"}
            if error.retry_after is not None:
                headers["Retry-After"] = str(error.retry_after)
            raise HTTPException(
                status_code=error.status_code,
                detail=error.detail,
                headers=headers,
            ) from error
        result: dict[str, object] = {
            "answer": answer,
            "context": field_data,
            "charts": field_data["charts"],
            "chart_availability": field_data["chart_availability"],
        }
        if payload.persist_conversation or conversation is not None:
            if conversation is None:
                title = " ".join(question.split())
                if len(title) > 120:
                    title = f"{title[:117].rstrip()}..."
                conversation = AssistantConversation(
                    farmer_id=farmer_id,
                    title=title,
                    messages=[],
                )
                db.add(conversation)

            saved_messages = list(conversation.messages)
            if payload.regenerate:
                saved_messages = saved_messages[:-1]
            else:
                saved_messages.append({"role": "user", "content": question})
            saved_messages.append({
                "role": "assistant",
                "content": answer,
                "context": field_data,
            })
            conversation.messages = saved_messages[-200:]
            conversation.field_id = field_id
            conversation.crop_id = selected_crop.id if selected_crop else None
            conversation.updated_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(conversation)
            result["conversation_id"] = conversation.id
        return result

    token = farmer_assistant.assistant_request_context.set({
        "db": db,
        "farmer_id": context[0].id,
        "farmer": context[0],
    })
    try:
        answer = await answer_farmer_question(
            payload.question,
            payload.language_code,
        )
    except AssistantServiceError as error:
        logger.warning("Farmer assistant request failed with status %s.", error.status_code)
        headers = {"Cache-Control": "no-store"}
        if error.retry_after is not None:
            headers["Retry-After"] = str(error.retry_after)
        raise HTTPException(
            status_code=error.status_code,
            detail=error.detail,
            headers=headers,
        ) from error
    finally:
        farmer_assistant.assistant_request_context.reset(token)
    return {"answer": answer}


@app.post("/api/assistant/image")
async def farmer_assistant_image(
    response: Response,
    image: UploadFile = File(...),
    question: str = Form(..., min_length=1, max_length=1500),
    language_code: AssistantLanguageCode = Form("en-IN"),
    field_id: int | None = Form(None, gt=0),
    crop_id: int | None = Form(None, gt=0),
    chart_period: Literal["24h", "7d", "30d"] = Form("7d"),
    chart_mode: Literal["auto", "text", "chart"] = Form("auto"),
    conversation_id: int | None = Form(None, gt=0),
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    response.headers["Cache-Control"] = "no-store"
    _limit_assistant_requests(context[0].id)
    payload = ChartAssistantRequest(
        assistant_mode="chart",
        question=question,
        language_code=language_code,
        field_id=field_id,
        crop_id=crop_id,
        chart_period=chart_period,
        chart_mode=chart_mode,
        persist_conversation=True,
        conversation_id=conversation_id,
    )
    farmer_id = context[0].id
    conversation = (
        _owned_assistant_conversation(db, farmer_id, payload.conversation_id)
        if payload.conversation_id is not None
        else None
    )
    history = _assistant_history_entries(conversation.messages) if conversation else []

    selected_crop = None
    if payload.crop_id is not None:
        selected_crop = _owned_crop(db, farmer_id, payload.crop_id)
        if payload.field_id is not None and selected_crop.field_id != payload.field_id:
            raise HTTPException(status_code=404, detail="Crop not found for the selected field.")
        if payload.field_id is None:
            payload.field_id = selected_crop.field_id
    if payload.field_id is not None:
        _owned_field(db, farmer_id, payload.field_id)

    try:
        image_bytes = await image.read(MAX_CROP_IMAGE_BYTES + 1)
    finally:
        await image.close()
    if len(image_bytes) > MAX_CROP_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Choose an image no larger than 10 MB.")
    content_type = image.content_type or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Choose a JPEG, PNG, or WebP leaf image.",
        )

    try:
        prediction = await predict_crop_disease(image_bytes, content_type)
    except CropDiseaseServiceError as error:
        status_code = 502 if error.status_code == 503 else error.status_code
        raise HTTPException(
            status_code=status_code,
            detail=error.detail,
            headers={"Cache-Control": "no-store"},
        ) from error

    field_data = _assistant_chart_context(
        db,
        farmer_id,
        payload.field_id,
        payload,
        selected_crop,
    )
    field_data["farmer_profile"] = {
        "name": context[0].name,
        "state": context[0].state,
        "district": context[0].district,
        "village": context[0].village,
    }
    field_data["crop_disease"] = {
        "status": "available",
        "source": "crop_disease_model",
        "prediction": prediction,
    }
    field_data.update(
        _assistant_chart_payloads(
            field_data,
            payload.question,
            history,
            payload.chart_mode,
        )
    )
    try:
        answer = await answer_chart_question(
            payload.question,
            _assistant_gemini_context(field_data),
            history,
            payload.language_code,
        )
    except AssistantServiceError as error:
        logger.warning("Crop disease explanation failed with status %s.", error.status_code)
        headers = {"Cache-Control": "no-store"}
        if error.retry_after is not None:
            headers["Retry-After"] = str(error.retry_after)
        raise HTTPException(
            status_code=error.status_code,
            detail=error.detail,
            headers=headers,
        ) from error

    if conversation is None:
        title = " ".join(payload.question.split())
        if len(title) > 120:
            title = f"{title[:117].rstrip()}..."
        conversation = AssistantConversation(
            farmer_id=farmer_id,
            title=title,
            messages=[],
        )
        db.add(conversation)
    saved_messages = list(conversation.messages)
    saved_messages.append({
        "role": "user",
        "content": payload.question,
        "image_attached": True,
    })
    saved_messages.append({
        "role": "assistant",
        "content": answer,
        "context": field_data,
    })
    conversation.messages = saved_messages[-200:]
    conversation.field_id = payload.field_id
    conversation.crop_id = selected_crop.id if selected_crop else None
    conversation.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(conversation)
    return {
        "answer": answer,
        "context": field_data,
        "charts": field_data["charts"],
        "chart_availability": field_data["chart_availability"],
        "conversation_id": conversation.id,
    }


def _owned_assistant_conversation(
    db: Session,
    farmer_id: int,
    conversation_id: int,
) -> AssistantConversation:
    conversation = db.scalar(
        select(AssistantConversation).where(
            AssistantConversation.id == conversation_id,
            AssistantConversation.farmer_id == farmer_id,
        )
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return conversation


def _assistant_history_entries(messages: list[dict]) -> list[dict[str, str]]:
    entries = [
        {"role": message["role"], "content": message["content"]}
        for message in messages
        if isinstance(message, dict)
        and message.get("role") in {"user", "assistant"}
        and isinstance(message.get("content"), str)
        and message["content"].strip()
    ]
    return entries[-6:]


def _latest_verified_crop_disease(messages: list[dict]) -> dict | None:
    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        context = message.get("context")
        if not isinstance(context, dict):
            continue
        disease_context = context.get("crop_disease")
        if (
            isinstance(disease_context, dict)
            and disease_context.get("status") == "available"
            and disease_context.get("source") == "crop_disease_model"
            and isinstance(disease_context.get("prediction"), dict)
        ):
            return disease_context
    return None


@app.get("/api/assistant/conversations")
def list_assistant_conversations(
    response: Response,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    response.headers["Cache-Control"] = "no-store"
    conversations = db.scalars(
        select(AssistantConversation)
        .where(AssistantConversation.farmer_id == context[0].id)
        .order_by(AssistantConversation.updated_at.desc(), AssistantConversation.id.desc())
        .limit(100)
    ).all()
    return [
        {
            "id": conversation.id,
            "title": conversation.title,
            "field_id": conversation.field_id,
            "crop_id": conversation.crop_id,
            "updated_at": conversation.updated_at.isoformat(),
        }
        for conversation in conversations
    ]


@app.get("/api/assistant/conversations/{conversation_id}")
def get_assistant_conversation(
    conversation_id: int,
    response: Response,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    response.headers["Cache-Control"] = "no-store"
    conversation = _owned_assistant_conversation(db, context[0].id, conversation_id)
    return {
        "id": conversation.id,
        "title": conversation.title,
        "field_id": conversation.field_id,
        "crop_id": conversation.crop_id,
        "messages": conversation.messages,
        "updated_at": conversation.updated_at.isoformat(),
    }


@app.patch("/api/assistant/conversations/{conversation_id}")
def rename_assistant_conversation(
    conversation_id: int,
    payload: AssistantConversationRenameRequest,
    response: Response,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    response.headers["Cache-Control"] = "no-store"
    conversation = _owned_assistant_conversation(db, context[0].id, conversation_id)
    conversation.title = payload.title
    conversation.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": conversation.id, "title": conversation.title}


@app.delete("/api/assistant/conversations/{conversation_id}")
def delete_assistant_conversation(
    conversation_id: int,
    response: Response,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    response.headers["Cache-Control"] = "no-store"
    conversation = _owned_assistant_conversation(db, context[0].id, conversation_id)
    db.delete(conversation)
    db.commit()
    return {"deleted": True}


def _assistant_chart_number(value, *, minimum=None, maximum=None):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or (minimum is not None and value < minimum)
        or (maximum is not None and value > maximum)
    ):
        return None
    return float(value)


_ASSISTANT_SENSOR_STALE_AFTER_HOURS = 24
_ASSISTANT_GEMINI_CONTEXT_MAX_CHARACTERS = 18000


def _assistant_gemini_context(field_data: dict) -> dict:
    excluded_keys = {
        "farmer_id",
        "farmer_profile",
        "field_id",
        "crop_id",
        "device_id",
        "reservoir_id",
        "id",
        "latitude",
        "longitude",
    }

    def remove_internal_values(value):
        if isinstance(value, dict):
            return {
                key: remove_internal_values(item)
                for key, item in value.items()
                if key not in excluded_keys
            }
        if isinstance(value, list):
            return [remove_internal_values(item) for item in value]
        return value

    context = remove_internal_values(field_data)
    truncated_sections = []

    def trim_list(container: dict, key: str, limit: int, label: str, *, keep: str = "last") -> None:
        values = container.get(key)
        if not isinstance(values, list) or len(values) <= limit:
            return
        container[key] = values[-limit:] if keep == "last" else values[:limit]
        container["truncated"] = True
        truncated_sections.append(label)

    sensor_history_keys = (
        "soil_moisture_history",
        "soil_temperature_history",
        "humidity_history",
        "soil_ph_history",
        "electrical_conductivity_history",
    )
    for history_key in sensor_history_keys:
        section = context.get(history_key)
        if isinstance(section, dict):
            trim_list(section, "data", 60, history_key)
    schedule = context.get("planned_irrigation")
    if isinstance(schedule, dict):
        trim_list(schedule, "data", 60, "planned_irrigation")
    forecast = context.get("weather_forecast")
    if isinstance(forecast, dict):
        trim_list(forecast, "data", 24, "weather_forecast", keep="first")
    latest = context.get("latest_sensor_readings")

    def size() -> int:
        return len(json.dumps(context, allow_nan=False, ensure_ascii=False, sort_keys=True))

    if size() > _ASSISTANT_GEMINI_CONTEXT_MAX_CHARACTERS:
        for history_key in sensor_history_keys:
            section = context.get(history_key)
            if isinstance(section, dict):
                trim_list(section, "data", 24, history_key)
        if isinstance(schedule, dict):
            trim_list(schedule, "data", 24, "planned_irrigation")
        if isinstance(forecast, dict):
            trim_list(forecast, "data", 12, "weather_forecast", keep="first")
        if isinstance(latest, dict):
            trim_list(latest, "fields", 30, "latest_sensor_readings")
        fields = context.get("fields")
        if isinstance(fields, list) and len(fields) > 30:
            context["fields"] = fields[:30]
            context["fields_truncated"] = True
            truncated_sections.append("fields")
        elif isinstance(context.get("field"), dict):
            crop_records = context["field"].get("saved_crop_records")
            if isinstance(crop_records, list) and len(crop_records) > 30:
                context["field"]["saved_crop_records"] = crop_records[:30]
                context["field"]["crops_truncated"] = True
                truncated_sections.append("saved_crop_records")

    if size() > _ASSISTANT_GEMINI_CONTEXT_MAX_CHARACTERS:
        fields = context.get("fields")
        if isinstance(fields, list):
            for field in fields:
                trim_list(field, "saved_crop_records", 2, "saved_crop_records")
            if len(fields) > 20:
                context["fields"] = fields[:20]
                context["fields_truncated"] = True
                truncated_sections.append("fields")
        elif isinstance(context.get("field"), dict):
            trim_list(
                context["field"],
                "saved_crop_records",
                2,
                "saved_crop_records",
            )
        unassigned = context.get("unassigned_saved_crop_records")
        if isinstance(unassigned, list) and len(unassigned) > 10:
            context["unassigned_saved_crop_records"] = unassigned[:10]
            context["crops_truncated"] = True
            truncated_sections.append("unassigned_saved_crop_records")
        if isinstance(latest, dict):
            trim_list(latest, "fields", 20, "latest_sensor_readings")

    if size() > _ASSISTANT_GEMINI_CONTEXT_MAX_CHARACTERS:
        for history_key in sensor_history_keys:
            section = context.get(history_key)
            if isinstance(section, dict):
                trim_list(section, "data", 12, history_key)
        if isinstance(schedule, dict):
            trim_list(schedule, "data", 12, "planned_irrigation")
        if isinstance(forecast, dict):
            trim_list(forecast, "data", 8, "weather_forecast", keep="first")
        if isinstance(latest, dict):
            trim_list(latest, "fields", 10, "latest_sensor_readings")
        fields = context.get("fields")
        if isinstance(fields, list):
            if len(fields) > 10:
                context["fields"] = fields[:10]
                context["fields_truncated"] = True
                truncated_sections.append("fields")
            for field in context["fields"]:
                trim_list(field, "saved_crop_records", 1, "saved_crop_records")
        elif isinstance(context.get("field"), dict):
            crop_records = context["field"].get("saved_crop_records")
            if isinstance(crop_records, list) and len(crop_records) > 1:
                context["field"]["saved_crop_records"] = crop_records[:1]
                context["field"]["crops_truncated"] = True
                truncated_sections.append("saved_crop_records")

    if size() > _ASSISTANT_GEMINI_CONTEXT_MAX_CHARACTERS:
        raise AssistantServiceError(
            413,
            "The available farm data is too large to explain in one request.",
        )
    if truncated_sections:
        context["context_truncated_sections"] = sorted(set(truncated_sections))
    return context


def _assistant_chart_period(payload: ChartAssistantRequest) -> tuple[date, date]:
    if payload.chart_period == "custom":
        return payload.start_date, payload.end_date
    today = datetime.now(timezone.utc).date()
    days = {"24h": 1, "7d": 7, "30d": 30}[payload.chart_period]
    return today - timedelta(days=days - 1), today


def _assistant_chart_weather(farmer_id: int, field: FarmerField) -> dict:
    unavailable = {
        "current_weather": {
            "status": "unavailable",
            "reason": "Current field-specific weather is unavailable.",
        },
        "weather_forecast": {
            "status": "unavailable",
            "reason": "Field-specific weather forecast is unavailable.",
            "maximum_horizon_hours": 120,
            "data": [],
        },
        "recent_rainfall_history": {
            "status": "unavailable",
            "classification": "historical_observed",
            "source": "selected_field_recent_weather_history_api",
            "maximum_horizon_hours": 24,
            "total_rainfall_mm": None,
            "range": None,
            "data": [],
            "reason": "Recent observed rainfall history is unavailable.",
        },
    }
    if field.latitude is not None and field.longitude is not None:
        location = f"{field.latitude:.6f},{field.longitude:.6f}"
    elif field.location and field.location.strip():
        location = field.location.strip()
    else:
        unavailable["current_weather"]["reason"] = (
            "This field has no saved coordinates or location for field-specific weather."
        )
        unavailable["weather_forecast"]["reason"] = unavailable["current_weather"]["reason"]
        unavailable["recent_rainfall_history"]["reason"] = (
            unavailable["current_weather"]["reason"]
        )
        return unavailable

    try:
        _limit_weather_requests(farmer_id)
    except HTTPException as error:
        reason = error.detail if isinstance(error.detail, str) else "Weather data is temporarily unavailable."
        for section in unavailable.values():
            section.update(reason=reason, retryable=error.status_code == 429)
        return unavailable

    def mark_unavailable(section: str, error: Exception) -> None:
        detail = error.detail if isinstance(error, HTTPException) else str(error)
        unavailable[section]["reason"] = (
            detail if isinstance(detail, str) and detail else unavailable[section]["reason"]
        )
        if isinstance(error, HTTPException):
            unavailable[section]["retryable"] = error.status_code == 429

    try:
        current = get_current_weather(location)
    except (ValueError, WeatherUnavailableError, WeatherAuthError, HTTPException) as error:
        mark_unavailable("current_weather", error)
        current = None

    try:
        forecast = get_forecast(location, 120, timestep="1h")
    except (ValueError, WeatherUnavailableError, WeatherAuthError, HTTPException) as error:
        mark_unavailable("weather_forecast", error)
        forecast = []

    rainfall_history_failed = False
    try:
        rainfall_history = get_recent_history(location, 24)
    except (ValueError, WeatherUnavailableError, WeatherAuthError, HTTPException) as error:
        mark_unavailable("recent_rainfall_history", error)
        rainfall_history = []
        rainfall_history_failed = True

    if current is None:
        values = {key: None for key in (
            "temperature_c", "feels_like_c", "humidity_percent",
            "rainfall_mm_per_hr", "rain_probability_percent", "wind_speed_mps",
        )}
        observation_time = None
    elif not isinstance(current, dict):
        mark_unavailable(
            "current_weather",
            WeatherUnavailableError("Weather provider returned an unexpected current-weather response."),
        )
        current = None
        values = {key: None for key in (
            "temperature_c", "feels_like_c", "humidity_percent",
            "rainfall_mm_per_hr", "rain_probability_percent", "wind_speed_mps",
        )}
        observation_time = None
    else:
        values = {
            "temperature_c": _assistant_chart_number(current.get("temperature_c")),
            "feels_like_c": _assistant_chart_number(current.get("feels_like_c")),
            "humidity_percent": _assistant_chart_number(
                current.get("humidity_percent"), minimum=0, maximum=100
            ),
            "rainfall_mm_per_hr": _assistant_chart_number(
                current.get("rainfall_mm_per_hr"), minimum=0
            ),
            "rain_probability_percent": _assistant_chart_number(
                current.get("precipitation_probability_percent"), minimum=0, maximum=100
            ),
            "wind_speed_mps": _assistant_chart_number(current.get("wind_speed_mps"), minimum=0),
        }
        observation_time = current.get("observation_time")
        if isinstance(observation_time, datetime):
            observation_time = observation_time.isoformat()
        elif not isinstance(observation_time, str):
            observation_time = None

    if not isinstance(forecast, list):
        mark_unavailable(
            "weather_forecast",
            WeatherUnavailableError("Weather provider returned an unexpected forecast response."),
        )
        forecast = []
    forecast_data = []
    for item in forecast[:72]:
        if not isinstance(item, dict) or not isinstance(item.get("time"), str):
            continue
        forecast_data.append({
            "time": item["time"],
            "temperature_c": _assistant_chart_number(item.get("temperature_c")),
            "humidity_percent": _assistant_chart_number(
                item.get("humidity_percent"), minimum=0, maximum=100
            ),
            "rainfall_mm_per_hr": _assistant_chart_number(
                item.get("rainfall_mm_per_hr"), minimum=0
            ),
            "rain_probability_percent": _assistant_chart_number(
                item.get("precipitation_probability_percent", item.get("rain_probability_percent")),
                minimum=0,
                maximum=100,
            ),
            "wind_speed_mps": _assistant_chart_number(item.get("wind_speed_mps"), minimum=0),
            "is_stale": bool(item.get("is_stale", False)),
            "data_age_minutes": _assistant_chart_number(item.get("data_age_minutes"), minimum=0),
        })

    if not isinstance(rainfall_history, list):
        mark_unavailable(
            "recent_rainfall_history",
            WeatherUnavailableError("Weather provider returned an unexpected recent-history response."),
        )
        rainfall_history = []
    observed_rainfall = []
    for item in rainfall_history[-24:]:
        if not isinstance(item, dict) or not isinstance(item.get("time"), str):
            continue
        observed_rainfall.append({
            "time": item["time"],
            "rain_accumulation_mm": _assistant_chart_number(
                item.get("rain_accumulation_mm"), minimum=0
            ),
            "rain_intensity_mm_per_hr": _assistant_chart_number(
                item.get("rain_intensity_mm_per_hr"), minimum=0
            ),
            "is_stale": bool(item.get("is_stale", False)),
        })
    accumulation_values = [
        item["rain_accumulation_mm"] for item in observed_rainfall
        if item["rain_accumulation_mm"] is not None
    ]
    history_complete = (
        len(observed_rainfall) == 24
        and len(accumulation_values) == len(observed_rainfall)
    )
    if observed_rainfall and accumulation_values:
        history_status = "available" if history_complete else "partial"
        if not history_complete:
            reason = (
                "Some hourly observed rainfall values are unavailable."
                if len(accumulation_values) != len(observed_rainfall)
                else "Observed rainfall data does not cover the full 24-hour requested period."
            )
            unavailable["recent_rainfall_history"]["reason"] = reason
    else:
        history_status = "unavailable"
        if not rainfall_history_failed:
            unavailable["recent_rainfall_history"]["reason"] = (
                "No observed rainfall values are available for the recent-history period."
            )
    history_age_values = [
        _assistant_chart_number(item.get("data_age_minutes"), minimum=0)
        for item in rainfall_history if isinstance(item, dict)
    ]
    history_age_values = [value for value in history_age_values if value is not None]

    current_available = current is not None and any(value is not None for value in values.values())
    return {
        "current_weather": {
            "status": "available" if current_available else "unavailable",
            "classification": "current_observation",
            "source": "selected_field_current_weather_api",
            "values": values,
            "observation_time": observation_time,
            "is_stale": bool(current.get("is_stale", False)) if current else False,
            "data_age_minutes": _assistant_chart_number(
                current.get("data_age_minutes"), minimum=0
            ) if current else None,
            **({"reason": unavailable["current_weather"]["reason"]}
               if not current_available else {}),
        },
        "weather_forecast": {
            "status": "available" if forecast_data else "unavailable",
            "classification": "forecast",
            "source": "selected_field_weather_forecast_api",
            "maximum_horizon_hours": 120,
            "range": {
                "start_date": forecast_data[0]["time"],
                "end_date": forecast_data[-1]["time"],
            } if forecast_data else None,
            "data": forecast_data,
            **({"reason": unavailable["weather_forecast"]["reason"]}
               if not forecast_data else {}),
        },
        "recent_rainfall_history": {
            "status": history_status,
            "classification": "historical_observed",
            "source": "selected_field_recent_weather_history_api",
            "maximum_horizon_hours": 24,
            "coverage_hours": len(observed_rainfall),
            "total_rainfall_mm": sum(accumulation_values) if history_complete else None,
            "range": {
                "start_date": observed_rainfall[0]["time"],
                "end_date": observed_rainfall[-1]["time"],
            } if observed_rainfall else None,
            "data": observed_rainfall,
            "is_stale": any(
                item.get("is_stale", False) for item in rainfall_history
                if isinstance(item, dict)
            ),
            "data_age_minutes": max(history_age_values) if history_age_values else None,
            **({"reason": unavailable["recent_rainfall_history"]["reason"]}
               if history_status != "available" else {}),
        },
    }


def _assistant_chart_latest_sensors(
    db: Session,
    farmer_id: int,
    fields_by_id: dict[int, FarmerField],
) -> dict:
    if not fields_by_id:
        return {
            "latest_sensor_readings": {
                "status": "unavailable",
                "source": "farmer_sensor_readings",
                "freshness_horizon_hours": _ASSISTANT_SENSOR_STALE_AFTER_HOURS,
                "fields": [],
                "reason": "No saved farmer-owned fields are available.",
            },
        }

    ranked_readings = (
        select(
            FarmerSensorReading.id.label("reading_id"),
            func.row_number().over(
                partition_by=FarmerSensorReading.field_id,
                order_by=(
                    FarmerSensorReading.recorded_at.desc(),
                    FarmerSensorReading.id.desc(),
                ),
            ).label("reading_rank"),
        )
        .where(
            FarmerSensorReading.farmer_id == farmer_id,
            FarmerSensorReading.field_id.in_(fields_by_id),
            FarmerSensorReading.source != "test_fixture",
        )
        .subquery()
    )
    readings = db.scalars(
        select(FarmerSensorReading)
        .join(ranked_readings, FarmerSensorReading.id == ranked_readings.c.reading_id)
        .where(ranked_readings.c.reading_rank == 1)
    ).all()
    readings_by_field = {reading.field_id: reading for reading in readings}
    now = datetime.now(timezone.utc)
    field_data = []
    for field_id, field in fields_by_id.items():
        reading = readings_by_field.get(field_id)
        if reading is None:
            field_data.append({
                "field_id": field_id,
                "field_name": field.name,
                "status": "unavailable",
                "freshness": "no_reading",
                "values": {},
            })
            continue

        recorded_at = reading.recorded_at
        if recorded_at.tzinfo is None:
            recorded_at = recorded_at.replace(tzinfo=timezone.utc)
        age_seconds = (now - recorded_at).total_seconds()
        is_future = age_seconds < 0
        age_hours = max(0, age_seconds / 3600)
        freshness = (
            "future_timestamp"
            if is_future
            else "outdated"
            if age_hours > _ASSISTANT_SENSOR_STALE_AFTER_HOURS
            else "current"
        )
        values = {
            "soil_moisture_percent": _assistant_chart_number(
                reading.soil_moisture_percent, minimum=0, maximum=100
            ),
            "soil_temperature_c": _assistant_chart_number(
                reading.soil_temperature_c, minimum=-50, maximum=100
            ),
            "humidity_percent": _assistant_chart_number(
                reading.humidity_percent, minimum=0, maximum=100
            ),
            "ph": _assistant_chart_number(reading.ph, minimum=0, maximum=14),
            "electrical_conductivity_us_cm": _assistant_chart_number(
                reading.electrical_conductivity_us_cm, minimum=0
            ),
        }
        field_data.append({
            "field_id": field_id,
            "field_name": field.name,
            "status": "available" if any(value is not None for value in values.values()) else "unavailable",
            "freshness": freshness,
            "recorded_at": reading.recorded_at.isoformat(),
            "data_age_hours": age_hours if not is_future else None,
            "values": values,
            "source": reading.source,
        })

    fresh_count = sum(
        item["status"] == "available" and item["freshness"] == "current"
        for item in field_data
    )
    outdated_count = sum(
        item["status"] == "available" and item["freshness"] == "outdated"
        for item in field_data
    )
    return {
        "latest_sensor_readings": {
            "status": "available" if fresh_count or outdated_count else "unavailable",
            "source": "farmer_sensor_readings",
            "freshness_horizon_hours": _ASSISTANT_SENSOR_STALE_AFTER_HOURS,
            "current_field_count": fresh_count,
            "outdated_field_count": outdated_count,
            "fields": field_data,
            **(
                {}
                if fresh_count or outdated_count
                else {"reason": "No verified sensor readings are available for these fields."}
            ),
        },
    }


def _assistant_chart_soil_history(
    db: Session,
    farmer_id: int,
    fields_by_id: dict[int, FarmerField],
    start_date: date,
    end_date: date,
) -> dict:
    unavailable = {
        "soil_moisture_history": {
            "status": "unavailable",
            "reason": "No verified farmer-owned soil-moisture readings are available for this date range.",
            "unit": "percent",
            "data": [],
        },
        "soil_temperature_history": {
            "status": "unavailable",
            "reason": "No verified farmer-owned soil-temperature readings are available for this date range.",
            "unit": "°C",
            "data": [],
        },
        "humidity_history": {
            "status": "unavailable",
            "reason": "No verified farmer-owned humidity readings are available for this date range.",
            "unit": "%",
            "data": [],
        },
        "soil_ph_history": {
            "status": "unavailable",
            "reason": "No verified farmer-owned pH readings are available for this date range.",
            "unit": "pH",
            "data": [],
        },
        "electrical_conductivity_history": {
            "status": "unavailable",
            "reason": "No verified farmer-owned electrical-conductivity readings are available for this date range.",
            "unit": "µS/cm",
            "data": [],
        },
    }
    if not fields_by_id:
        return unavailable
    start_time = datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)
    end_time = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    readings = db.scalars(
        select(FarmerSensorReading)
        .where(
            FarmerSensorReading.farmer_id == farmer_id,
            FarmerSensorReading.field_id.in_(fields_by_id),
            FarmerSensorReading.recorded_at >= start_time,
            FarmerSensorReading.recorded_at < end_time,
            FarmerSensorReading.source != "test_fixture",
        )
        .order_by(FarmerSensorReading.recorded_at.desc(), FarmerSensorReading.id.desc())
        .limit(501)
    ).all()
    records = [
        {
            "field_id": reading.field_id,
            "field_name": fields_by_id[reading.field_id].name,
            "recorded_at": reading.recorded_at.isoformat(),
            "soil_moisture_percent": _assistant_chart_number(
                reading.soil_moisture_percent,
                minimum=0,
                maximum=100,
            ),
            "soil_temperature_c": _assistant_chart_number(
                reading.soil_temperature_c,
                minimum=-50,
                maximum=100,
            ),
            "humidity_percent": _assistant_chart_number(
                reading.humidity_percent,
                minimum=0,
                maximum=100,
            ),
            "ph": _assistant_chart_number(reading.ph, minimum=0, maximum=14),
            "electrical_conductivity_us_cm": _assistant_chart_number(
                reading.electrical_conductivity_us_cm, minimum=0
            ),
            "source": reading.source,
        }
        for reading in reversed(readings[:500])
        if reading.field_id in fields_by_id
    ]
    result = {}
    for history_key, metric_key, unit, reason in (
        (
            "soil_moisture_history",
            "soil_moisture_percent",
            "percent",
            unavailable["soil_moisture_history"]["reason"],
        ),
        (
            "soil_temperature_history",
            "soil_temperature_c",
            "°C",
            unavailable["soil_temperature_history"]["reason"],
        ),
        (
            "humidity_history",
            "humidity_percent",
            "%",
            unavailable["humidity_history"]["reason"],
        ),
        (
            "soil_ph_history",
            "ph",
            "pH",
            unavailable["soil_ph_history"]["reason"],
        ),
        (
            "electrical_conductivity_history",
            "electrical_conductivity_us_cm",
            "µS/cm",
            unavailable["electrical_conductivity_history"]["reason"],
        ),
    ):
        data = [record for record in records if record[metric_key] is not None]
        result[history_key] = (
            {
                "status": "available",
                "source": "farmer_sensor_readings",
                "unit": unit,
                "data": data,
                "truncated": len(readings) > 500,
            }
            if data
            else {
                "status": "unavailable",
                "reason": reason,
                "unit": unit,
                "data": [],
            }
        )
    return result


def _assistant_chart_context(
    db: Session,
    farmer_id: int,
    field_id: int | None,
    payload: ChartAssistantRequest,
    selected_crop: FarmerCrop | None,
) -> dict:
    start_date, end_date = _assistant_chart_period(payload)
    range_data = {
        "period": payload.chart_period,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
    }
    generated_at = datetime.now(timezone.utc).isoformat()

    if field_id is not None:
        field = _owned_field(db, farmer_id, field_id)
        crops = db.scalars(
            select(FarmerCrop)
            .where(FarmerCrop.farmer_id == farmer_id, FarmerCrop.field_id == field.id)
            .order_by(FarmerCrop.id)
            .limit(101)
        ).all()
        schedule_filters = [
            IrrigationSchedule.farmer_id == farmer_id,
            IrrigationSchedule.field_id == field.id,
            IrrigationSchedule.scheduled_date >= start_date,
            IrrigationSchedule.scheduled_date <= end_date,
            IrrigationSchedule.status != "cancelled",
        ]
        if selected_crop is not None:
            schedule_filters.append(IrrigationSchedule.crop_name == selected_crop.name)
        schedules = db.scalars(
            select(IrrigationSchedule)
            .where(*schedule_filters)
            .order_by(IrrigationSchedule.scheduled_date, IrrigationSchedule.id)
            .limit(501)
        ).all()
        schedule_data = [
            {
                "field_id": field.id,
                "field_name": field.name,
                "crop_name": schedule.crop_name,
                "scheduled_date": schedule.scheduled_date.isoformat(),
                "water_liters": water_liters,
                "duration_minutes": schedule.duration_minutes,
                "irrigation_method": schedule.irrigation_method,
                "status": schedule.status,
            }
            for schedule in schedules[:500]
            if (water_liters := _assistant_chart_number(schedule.water_liters, minimum=0)) is not None
        ]
        soil_history = _assistant_chart_soil_history(
            db,
            farmer_id,
            {field.id: field},
            start_date,
            end_date,
        )
        field_data = {
            "scope": "selected farmer-owned field",
            "range": range_data,
            "generated_at": generated_at,
            "field": {
                "id": field.id,
                "name": field.name,
                "crop_label": field.crop,
                "area": _assistant_chart_number(field.area, minimum=0),
                "area_unit": field.area_unit,
                "saved_crop_records": [
                    {
                        "name": crop.name,
                        "variety": crop.variety,
                        "planting_date": crop.planting_date.isoformat() if crop.planting_date else None,
                        "expected_harvest_date": crop.expected_harvest_date.isoformat()
                        if crop.expected_harvest_date else None,
                        "growth_stage": crop.growth_stage,
                    }
                    for crop in crops[:100]
                ],
                "crops_truncated": len(crops) > 100,
            },
            **_assistant_chart_latest_sensors(db, farmer_id, {field.id: field}),
            **soil_history,
            "actual_water_usage": {
                "status": "unavailable",
                "reason": "Saved schedules contain planned volumes, not measured water consumption.",
            },
            "planned_irrigation": {
                "status": "available",
                "source": "field_irrigation_schedules",
                "label": "Planned schedule volumes; not actual water consumption.",
                "unit": "liters",
                "data": schedule_data,
                "truncated": len(schedules) > 500,
            },
            "future_soil_moisture_prediction": {
                "status": "unavailable",
                "reason": "No verified field-specific soil-moisture prediction is saved.",
            },
            "data_limitations": [
                *(
                    ["Historical soil measurements are unavailable."]
                    if soil_history["soil_moisture_history"]["status"] == "unavailable"
                    else []
                ),
                "Actual measured water consumption is unavailable; schedules contain planned volumes only.",
                "Observed rainfall history covers at most 24 hours; longer archive data is unavailable for this request.",
                "No verified field-specific prediction is saved.",
            ],
        }
        if selected_crop is not None:
            field_data["selected_crop"] = {
                "name": selected_crop.name,
                "variety": selected_crop.variety,
                "growth_stage": selected_crop.growth_stage,
                "planting_date": selected_crop.planting_date.isoformat()
                if selected_crop.planting_date else None,
                "expected_harvest_date": selected_crop.expected_harvest_date.isoformat()
                if selected_crop.expected_harvest_date else None,
            }
        field_data.update(_assistant_chart_weather(farmer_id, field))
        return field_data

    fields = db.scalars(
        select(FarmerField)
        .where(FarmerField.farmer_id == farmer_id)
        .order_by(FarmerField.id)
        .limit(51)
    ).all()
    fields_truncated = len(fields) > 50
    fields = fields[:50]
    field_by_id = {field.id: field for field in fields}
    crops = db.scalars(
        select(FarmerCrop)
        .where(FarmerCrop.farmer_id == farmer_id)
        .order_by(FarmerCrop.id)
        .limit(101)
    ).all()
    crops_truncated = len(crops) > 100
    crops_by_field: dict[int | None, list[dict]] = {}
    for crop in crops[:100]:
        crops_by_field.setdefault(crop.field_id, []).append({
            "name": crop.name,
            "variety": crop.variety,
            "growth_stage": crop.growth_stage,
            "planting_date": crop.planting_date.isoformat() if crop.planting_date else None,
            "expected_harvest_date": crop.expected_harvest_date.isoformat()
            if crop.expected_harvest_date else None,
        })

    schedules = []
    if field_by_id:
        schedule_filters = [
            IrrigationSchedule.farmer_id == farmer_id,
            IrrigationSchedule.field_id.in_(field_by_id),
            IrrigationSchedule.scheduled_date >= start_date,
            IrrigationSchedule.scheduled_date <= end_date,
            IrrigationSchedule.status != "cancelled",
        ]
        if selected_crop is not None:
            schedule_filters.append(IrrigationSchedule.crop_name == selected_crop.name)
        schedules = db.scalars(
            select(IrrigationSchedule)
            .where(*schedule_filters)
            .order_by(IrrigationSchedule.scheduled_date, IrrigationSchedule.id)
            .limit(501)
        ).all()
    schedule_data = [
        {
            "field_id": schedule.field_id,
            "field_name": field_by_id[schedule.field_id].name,
            "crop_name": schedule.crop_name,
            "scheduled_date": schedule.scheduled_date.isoformat(),
            "water_liters": water_liters,
            "duration_minutes": schedule.duration_minutes,
            "irrigation_method": schedule.irrigation_method,
            "status": schedule.status,
        }
        for schedule in schedules[:500]
        if schedule.field_id in field_by_id
        and (water_liters := _assistant_chart_number(schedule.water_liters, minimum=0)) is not None
    ]
    soil_history = _assistant_chart_soil_history(
        db,
        farmer_id,
        field_by_id,
        start_date,
        end_date,
    )

    result = {
        "scope": "authenticated farmer overview",
        "range": range_data,
        "generated_at": generated_at,
        "fields": [
            {
                "id": field.id,
                "name": field.name,
                "crop_label": field.crop,
                "area": _assistant_chart_number(field.area, minimum=0),
                "area_unit": field.area_unit,
                "saved_crop_records": crops_by_field.get(field.id, []),
            }
            for field in fields
        ],
        "unassigned_saved_crop_records": crops_by_field.get(None, []),
        "fields_truncated": fields_truncated,
        "crops_truncated": crops_truncated,
        **_assistant_chart_latest_sensors(db, farmer_id, field_by_id),
        "current_weather": {
            "status": "unavailable",
            "classification": "current_observation",
            "reason": "Select a field for field-specific current weather.",
            "values": {},
        },
        "weather_forecast": {
            "status": "unavailable",
            "classification": "forecast",
            "reason": "Select a field for field-specific weather charts.",
            "maximum_horizon_hours": 120,
            "data": [],
        },
        "recent_rainfall_history": {
            "status": "unavailable",
            "classification": "historical_observed",
            "reason": (
                "Select a field for observed rainfall history. The available recent-history "
                "period is limited to 24 hours."
            ),
            "maximum_horizon_hours": 24,
            "coverage_hours": 0,
            "total_rainfall_mm": None,
            "range": None,
            "data": [],
        },
        **soil_history,
        "actual_water_usage": {
            "status": "unavailable",
            "reason": "The application has no verified sensor-measured water-usage records.",
        },
        "planned_irrigation": {
            "status": "available",
            "source": "farmer_irrigation_schedules",
            "label": "Planned schedule volumes; not actual water consumption.",
            "unit": "liters",
            "data": schedule_data,
            "truncated": len(schedules) > 500,
        },
        "data_limitations": [
            "Select a field for field-specific weather charts.",
            *(
                ["Historical soil measurements are unavailable."]
                if soil_history["soil_moisture_history"]["status"] == "unavailable"
                else []
            ),
            "Actual measured water consumption is unavailable; schedules contain planned volumes only.",
            "Observed rainfall history covers at most 24 hours; longer archive data is unavailable for this request.",
        ],
    }
    if selected_crop is not None:
        result["selected_crop"] = {
            "name": selected_crop.name,
            "variety": selected_crop.variety,
            "growth_stage": selected_crop.growth_stage,
            "planting_date": selected_crop.planting_date.isoformat()
            if selected_crop.planting_date else None,
            "expected_harvest_date": selected_crop.expected_harvest_date.isoformat()
            if selected_crop.expected_harvest_date else None,
        }
    return result


def _assistant_chart_question_intent(question: str, history: list[dict]) -> dict:
    normalized = question.casefold()
    previous_user_messages = [
        item["content"]
        for item in history
        if isinstance(item, dict)
        and item.get("role") == "user"
        and isinstance(item.get("content"), str)
    ]
    if previous_user_messages and re.search(
        r"\b(?:it|that|those|them|same|also|then|what about|and)\b|"
        r"(?:దాని|అదే|उन|उस|ಅದರ|அது|അത്)",
        normalized,
    ):
        normalized = f"{previous_user_messages[-1]} {normalized}"

    def matches(pattern: str) -> bool:
        return re.search(pattern, normalized, re.IGNORECASE) is not None

    categories = []
    category_patterns = {
        "fields": r"\b(?:field|fields|plot|plots|land)\b|పొలం|పొలాలు|खेत|खेती|ಜಮೀನು|ಹೊಲ|வயல்|കൃഷിയിടം",
        "crops": r"\b(?:crop|crops|variety|planting|harvest)\b|పంట|పంటలు|फसल|ಬೆಳೆ|பயிர்|വിള",
        "sensor_readings": r"\b(?:sensor|moisture|humidity|pH|EC|conductivity|soil temperature|soil temp)\b|తేమ|ఉష్ణోగ్రత|नमी|मिट्टी|ತೇವಾಂಶ|ஈரப்பதம்|ഈർപ്പം",
        "weather": r"\b(?:weather|rain|rainfall|forecast|precipitation|wind|humidity)\b|వర్షం|వర్షపాతం|వాతావరణం|बारिश|वर्षा|मौसम|ಮಳೆ|ಹವಾಮಾನ|மழை|வானிலை|മഴ|കാലാവസ്ഥ",
        "irrigation": r"\b(?:irrigation|water|schedule|watering)\b|నీటిపారుదల|सिंचाई|ನೀರಾವರಿ|பாசனம்|ജലസേചനം",
    }
    for category, pattern in category_patterns.items():
        if matches(pattern):
            categories.append(category)
    if not categories:
        categories.append("general")

    comparison = matches(
        r"\b(?:compare|comparison|across|lowest|highest|least|most|which field|"
        r"which fields|difference|rank|ranking)\b|పోల్చి|తులన|तुलना|ಹೋಲಿಸಿ|ஒப்பிடு|താരതമ്യം"
    )
    fieldwise_comparison = matches(
        r"\b(?:for|in|across|between)\s+(?:my\s+|the\s+|all\s+)?fields\b|"
        r"\b(?:each|every)\s+field\b"
    )
    historical = matches(
        r"\b(?:trend|history|historical|over time|last \d+\s*(?:hours?|days?|weeks?)|"
        r"past \d+\s*(?:hours?|days?|weeks?)|last week|past week)\b|చరిత్ర|గత వారం|इतिहास|पिछले|ಇತಿಹಾಸ|கடந்த|ചരിത്രം|കഴിഞ്ഞ"
    )
    forecast = matches(
        r"\b(?:forecast|expected|tomorrow|upcoming|next \d+\s*(?:hours?|days?))\b|రేపు|అంచనా|पूर्वानुमान|कल|ನಾಳೆ|முன்னறிவிப்பு|നാളെ"
    )
    recommendation_requested = matches(
        r"\b(?:recommend(?:ation)?s?|suggest(?:ion)?s?|advise|advice|should i|"
        r"what should|next steps?)\b|సలహా|సూచించండి|सलाह|सुझाव|ಸಲಹೆ|பரிந்துரை|ഉപദേശം"
    )
    explicit_recent_rain = matches(
        r"\b(?:last|past)\s*24\s*hours?\b|\btoday\b|గత 24 గంటలు|पिछले 24 घंटे|ಕಳೆದ 24 ಗಂಟೆ|கடந்த 24 மணிநேரம்|കഴിഞ്ഞ 24 മണിക്കൂർ"
    )
    chart_language = matches(
        r"\b(?:chart|graph|plot|visuali[sz]e|distribution|breakdown|trend)\b|"
        r"చార్ట్|గ్రాఫ్|వివరణాత్మక చార్ట్|चार्ट|ग्राफ|ವಿವರಣೆ|ಚಾರ್ಟ್|ಗ್ರಾಃ|"
        r"விளக்கப்படம்|வரைபடம்|ചാർട്ട്|ഗ്രാഫ്"
    )
    metrics = []
    if matches(r"\b(?:moisture|soil moisture)\b|నేల తేమ|మట్టి తేమ|मिट्टी की नमी|ಮಣ್ಣಿನ ತೇವಾಂಶ|மண் ஈரப்பதம்|മണ്ണിലെ ഈർപ്പം"):
        metrics.append("soil_moisture")
    if matches(r"\bsoil\s+(?:temperature|temp)\b|నేల ఉష్ణోగ్రత|मिट्टी का तापमान|ಮಣ್ಣಿನ ತಾಪಮಾನ|மண் வெப்பநிலை|മണ്ണിന്റെ താപനില"):
        metrics.append("soil_temperature")
    if matches(r"\bpH\b|ఆమ్లత్వం|पीएच|ಪಿಎಚ್|அமிலத்தன்மை"):
        metrics.append("soil_ph")
    if matches(r"\bEC\b|electrical conductivity|విద్యుత్ వాహకత|विद्युत चालकता|ವಿದ್ಯುತ್ ವಾಹಕತೆ|மின் கடத்துத்திறன்|വൈദ്യുത ചാലകത"):
        metrics.append("electrical_conductivity")
    if matches(r"\bhumidity\b|తేమ|आर्द्रता|ಆರ್ದ್ರತೆ|ஈரப்பதம்|ഈർപ്പം"):
        metrics.append("humidity")
    if matches(r"\b(?:rain|rainfall|precipitation)\b|వర్షం|వర్షపాతం|बारिश|वर्षा|ಮಳೆ|மழை|മഴ"):
        metrics.append("rainfall")
    if matches(r"\b(?:temperature|temp)\b|ఉష్ణోగ్రత|तापमान|ಉಷ್ಣಾಂಶ|வெப்பநிலை|താപനില") and (
        "soil_temperature" not in metrics
    ):
        metrics.append("weather_temperature")
    if matches(r"\b(?:irrigation|watering|water schedule|planned water)\b|నీటిపారుదల|सिंचाई|ನೀರಾವರಿ|பாசனம்|ജലസേചനം"):
        metrics.append("planned_irrigation")
    if matches(r"\b(?:crop distribution|crop breakdown|crop mix|crop share)\b|పంటల పంపిణీ|फसल वितरण|ಬೆಳೆ ಹಂಚಿಕೆ|பயிர் பகிர்வு|വിള വിതരണം"):
        metrics.append("crop_distribution")
    elif matches(r"\bcrops?\b|పంటలు?|फसलें?|ಬೆಳೆಗಳು?|பயிர்கள்?|വിളകൾ") and (
        comparison or fieldwise_comparison
    ):
        metrics.append("crop_distribution")
    if matches(r"\b(?:field area|field size|land area)\b|పొలం విస్తీర్ణం|खेत का क्षेत्रफल|ಹೊಲದ ವಿಸ್ತೀರ್ಣ|வயல் பரப்பளவு|കൃഷിയിടത്തിന്റെ വിസ്തീർണ്ണം"):
        metrics.append("field_area")
    if matches(r"\b(?:water usage|water use|water consumption|actual water used|water used|water consumed)\b"):
        metrics.append("actual_water_usage")
    if (
        forecast
        and "weather" in categories
        and chart_language
        and "weather_temperature" not in metrics
        and "rainfall" not in metrics
    ):
        metrics.extend(["weather_temperature", "rainfall"])
    actual_usage_requested = "actual_water_usage" in metrics
    return {
        "categories": categories,
        "metrics": metrics,
        "comparison": comparison,
        "historical": historical,
        "forecast": forecast,
        "recommendation_requested": recommendation_requested,
        "explicit_recent_rain": explicit_recent_rain,
        "fieldwise_comparison": fieldwise_comparison,
        "chart_requested": chart_language or comparison or historical or (
            fieldwise_comparison and bool(metrics)
        ),
        "actual_usage_requested": actual_usage_requested,
    }


def _assistant_chart_sample_points(points: list[dict], maximum: int = 24) -> list[dict]:
    if len(points) <= maximum:
        return points
    indexes = {
        round(index * (len(points) - 1) / (maximum - 1))
        for index in range(maximum)
    }
    return [point for index, point in enumerate(points) if index in indexes]


def _assistant_chart_spec(
    *,
    chart_id: str,
    chart_type: str,
    title_key: str,
    labels: list[str],
    values: list[float],
    unit: str,
    source: str,
    caption_key: str,
    range_data: dict | None,
    axis_type: str = "category",
    field_name: str | None = None,
    caption_values: dict | None = None,
) -> dict:
    dataset = {"label_key": title_key, "data": values}
    return {
        "id": chart_id,
        "type": chart_type,
        "axis_type": axis_type,
        "title_key": title_key,
        "labels": labels,
        "datasets": [dataset],
        "unit": unit,
        "source": source,
        "caption_key": caption_key,
        "caption_values": caption_values or {},
        "range": range_data,
        **({"field_name": field_name} if field_name else {}),
    }


def _assistant_chart_payloads(
    field_data: dict,
    question: str,
    history: list[dict],
    chart_mode: str,
) -> dict:
    intent = _assistant_chart_question_intent(question, history)
    should_chart = chart_mode == "chart" or (
        chart_mode == "auto" and intent["chart_requested"]
    )
    if chart_mode == "text" or not should_chart:
        return {
            "question_analysis": intent,
            "charts": [],
            "chart_availability": {"status": "not_requested", "reason": None},
        }

    charts = []
    missing_metrics = []
    range_data = field_data.get("range")

    def unavailable(metric_key: str, reason: str) -> None:
        missing_metrics.append({"metric_key": metric_key, "reason": reason})

    sensor_metrics = {
        "soil_moisture": (
            "soil_moisture_percent", "chartAssistant.soilMoisture", "%",
            "soil_moisture_history",
        ),
        "soil_temperature": (
            "soil_temperature_c", "chartAssistant.soilTemperature", "°C",
            "soil_temperature_history",
        ),
        "soil_ph": (
            "ph", "chartAssistant.soilPH", "pH", "soil_ph_history",
        ),
        "electrical_conductivity": (
            "electrical_conductivity_us_cm", "chartAssistant.electricalConductivity",
            "µS/cm", "electrical_conductivity_history",
        ),
        "humidity": (
            "humidity_percent", "chartAssistant.humidity", "%",
            "humidity_history",
        ),
    }
    for metric in intent["metrics"]:
        if metric not in sensor_metrics:
            continue
        value_key, title_key, unit, history_key = sensor_metrics[metric]
        if intent["historical"]:
            history_data = field_data.get(history_key, {})
            records = history_data.get("data", []) if history_data.get("status") == "available" else []
            grouped_records: dict[int | None, list[dict]] = {}
            chart_count_before = len(charts)
            for record in records:
                if (
                    isinstance(record.get(value_key), (int, float))
                    and isinstance(record.get("recorded_at"), str)
                ):
                    grouped_records.setdefault(record.get("field_id"), []).append(record)
            for _, field_records in list(grouped_records.items())[:5]:
                points = _assistant_chart_sample_points([
                    {"time": item["recorded_at"], "value": float(item[value_key])}
                    for item in field_records
                ])
                if len(points) < 2:
                    continue
                charts.append(_assistant_chart_spec(
                    chart_id=f"{metric}-history-{len(charts) + 1}",
                    chart_type="line",
                    title_key=title_key,
                    labels=[item["time"] for item in points],
                    values=[item["value"] for item in points],
                    unit=unit,
                    source=history_data.get("source", "farmer_sensor_readings"),
                    caption_key="aiChat.chartHistoryCaption",
                    range_data=range_data,
                    axis_type="time",
                    field_name=field_records[0].get("field_name"),
                ))
            if len(charts) == chart_count_before:
                unavailable(
                    title_key,
                    "No verified history with at least two measurements is available for this range.",
                )
            continue

        latest = field_data.get("latest_sensor_readings", {})
        readings = latest.get("fields", []) if isinstance(latest, dict) else []
        current = [
            item for item in readings
            if item.get("status") == "available"
            and item.get("freshness") == "current"
            and isinstance(item.get("values"), dict)
            and isinstance(item["values"].get(value_key), (int, float))
        ]
        if (
            intent["comparison"] or intent["fieldwise_comparison"]
        ) and len(current) < 2:
            unavailable(
                title_key,
                "At least two current verified readings are required for a field comparison.",
            )
            continue
        if not current:
            unavailable(title_key, "No current verified sensor readings are available.")
            continue
        current = current[:24]
        charts.append(_assistant_chart_spec(
            chart_id=f"{metric}-latest-by-field",
            chart_type="bar",
            title_key=title_key,
            labels=[item["field_name"] for item in current],
            values=[float(item["values"][value_key]) for item in current],
            unit=unit,
            source=latest.get("source", "farmer_sensor_readings"),
            caption_key="aiChat.chartLatestSensorCaption",
            range_data=range_data,
            caption_values={
                "staleCount": latest.get("outdated_field_count", 0),
            },
        ))

    if "crop_distribution" in intent["metrics"]:
        crop_counts: dict[str, int] = {}
        field_records = field_data.get("fields")
        if not isinstance(field_records, list):
            field_records = [field_data.get("field", {})]
        crop_records = [
            crop
            for field in field_records
            for crop in field.get("saved_crop_records", [])
        ]
        crop_records.extend(field_data.get("unassigned_saved_crop_records", []))
        for crop in crop_records:
            name = crop.get("name")
            if isinstance(name, str) and name.strip():
                crop_counts[name.strip()] = crop_counts.get(name.strip(), 0) + 1
        if len(crop_counts) >= 2:
            labels = list(crop_counts)
            charts.append(_assistant_chart_spec(
                chart_id="saved-crop-distribution",
                chart_type="pie",
                title_key="chartAssistant.cropDistribution",
                labels=labels,
                values=[float(crop_counts[label]) for label in labels],
                unit="records",
                source="farmer_crop_records",
                caption_key="aiChat.chartCropDistributionCaption",
                range_data=range_data,
            ))
        else:
            unavailable(
                "chartAssistant.cropDistribution",
                "At least two saved crop categories are required for a distribution chart.",
            )

    if "field_area" in intent["metrics"]:
        field_records = field_data.get("fields")
        if not isinstance(field_records, list):
            field_records = [field_data.get("field", {})]
        areas = [
            item for item in field_records
            if isinstance(item.get("name"), str)
            and isinstance(item.get("area"), (int, float))
            and item["area"] > 0
            and isinstance(item.get("area_unit"), str)
        ]
        units = {item["area_unit"] for item in areas}
        if len(areas) >= 2 and len(units) == 1:
            charts.append(_assistant_chart_spec(
                chart_id="field-area-comparison",
                chart_type="bar",
                title_key="chartAssistant.fieldAreaDistribution",
                labels=[item["name"] for item in areas[:24]],
                values=[float(item["area"]) for item in areas[:24]],
                unit=next(iter(units)),
                source="farmer_field_records",
                caption_key="aiChat.chartFieldAreaCaption",
                range_data=range_data,
            ))
        else:
            unavailable(
                "chartAssistant.fieldAreaDistribution",
                "At least two saved fields with matching area units are required.",
            )

    if intent["actual_usage_requested"]:
        unavailable(
            "chartAssistant.actualUsageUnavailable",
            "Measured water-usage records are not available; schedules are planned amounts.",
        )
    elif "planned_irrigation" in intent["metrics"]:
        schedule = field_data.get("planned_irrigation", {})
        schedule_data = schedule.get("data", []) if isinstance(schedule, dict) else []
        points = [
            item for item in schedule_data
            if isinstance(item.get("water_liters"), (int, float))
            and isinstance(item.get("scheduled_date"), str)
        ]
        if points:
            labels = [
                f"{item.get('field_name', '')} · {item['scheduled_date']}".strip(" ·")
                for item in points[-24:]
            ]
            charts.append(_assistant_chart_spec(
                chart_id="planned-irrigation-by-field",
                chart_type="bar",
                title_key="chartAssistant.plannedIrrigation",
                labels=labels,
                values=[float(item["water_liters"]) for item in points[-24:]],
                unit="L",
                source=schedule.get("source", "farmer_irrigation_schedules"),
                caption_key="aiChat.chartPlannedIrrigationCaption",
                range_data=range_data,
            ))
        else:
            unavailable(
                "chartAssistant.plannedIrrigation",
                "No saved planned-irrigation schedule volumes are available for this range.",
            )

    if "rainfall" in intent["metrics"]:
        if intent["forecast"]:
            forecast_data = field_data.get("weather_forecast", {})
            values = forecast_data.get("data", []) if forecast_data.get("status") == "available" else []
            points = [
                item for item in values
                if isinstance(item.get("rainfall_mm_per_hr"), (int, float))
                and isinstance(item.get("time"), str)
                and item.get("is_stale") is not True
            ]
            points = _assistant_chart_sample_points(points)
            if len(points) >= 2:
                charts.append(_assistant_chart_spec(
                    chart_id="rainfall-forecast",
                    chart_type="line",
                    title_key="chartAssistant.rainfall",
                    labels=[item["time"] for item in points],
                    values=[float(item["rainfall_mm_per_hr"]) for item in points],
                    unit="mm/h",
                    source=forecast_data.get("source", "selected_field_weather_forecast_api"),
                    caption_key="aiChat.chartForecastCaption",
                    range_data=forecast_data.get("range") or range_data,
                    axis_type="time",
                ))
            else:
                unavailable(
                    "chartAssistant.rainfall",
                    "At least two verified field-specific forecast values are required.",
                )
        else:
            rainfall = field_data.get("recent_rainfall_history", {})
            period = range_data.get("period") if isinstance(range_data, dict) else None
            if period != "24h" and not intent["explicit_recent_rain"]:
                unavailable(
                    "chartAssistant.rainfall",
                    "Observed rainfall history is available for at most 24 hours, not the selected longer period.",
                )
            elif rainfall.get("status") != "available" or rainfall.get("is_stale") is True:
                unavailable(
                    "chartAssistant.rainfall",
                    "A complete verified 24-hour observed-rainfall history is not available.",
                )
            else:
                points = [
                    item for item in rainfall.get("data", [])
                    if isinstance(item.get("rain_accumulation_mm"), (int, float))
                    and isinstance(item.get("time"), str)
                ]
                if len(points) >= 2:
                    charts.append(_assistant_chart_spec(
                        chart_id="observed-rainfall-24h",
                        chart_type="bar",
                        title_key="chartAssistant.rainfall",
                        labels=[item["time"] for item in points],
                        values=[float(item["rain_accumulation_mm"]) for item in points],
                        unit="mm",
                        source=rainfall.get("source", "selected_field_recent_weather_history_api"),
                        caption_key="aiChat.chartObservedRainCaption",
                        range_data=rainfall.get("range") or range_data,
                        axis_type="time",
                    ))
                else:
                    unavailable(
                        "chartAssistant.rainfall",
                        "At least two verified observed-rainfall values are required.",
                    )

    if "weather_temperature" in intent["metrics"] and intent["forecast"]:
        forecast_data = field_data.get("weather_forecast", {})
        values = forecast_data.get("data", []) if forecast_data.get("status") == "available" else []
        points = [
            item for item in values
            if isinstance(item.get("temperature_c"), (int, float))
            and isinstance(item.get("time"), str)
            and item.get("is_stale") is not True
        ]
        points = _assistant_chart_sample_points(points)
        if len(points) >= 2:
            charts.append(_assistant_chart_spec(
                chart_id="temperature-forecast",
                chart_type="line",
                title_key="chartAssistant.temperature",
                labels=[item["time"] for item in points],
                values=[float(item["temperature_c"]) for item in points],
                unit="°C",
                source=forecast_data.get("source", "selected_field_weather_forecast_api"),
                caption_key="aiChat.chartForecastCaption",
                range_data=forecast_data.get("range") or range_data,
                axis_type="time",
            ))
        else:
            unavailable(
                "chartAssistant.temperature",
                "At least two verified field-specific forecast values are required.",
            )

    if not intent["metrics"] and should_chart:
        unavailable(
            "chartAssistant.chartLabel",
            "Specify a measurement, crop distribution, field-area comparison, or irrigation schedule.",
        )

    if charts and missing_metrics:
        status = "partial"
    elif charts:
        status = "available"
    else:
        status = "unavailable"
    return {
        "question_analysis": intent,
        "charts": charts,
        "chart_availability": {
            "status": status,
            "missing_metrics": missing_metrics,
            "reason": None if charts else "insufficient_verified_data",
        },
    }


@app.post("/api/assistant/model2-explanation")
async def farmer_assistant_model2_explanation(
    payload: Model2ExplanationRequest,
    response: Response,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    response.headers["Cache-Control"] = "no-store"
    farmer_id = context[0].id
    _limit_assistant_requests(farmer_id)
    prediction = _get_model2_prediction(
        db,
        farmer_id,
        payload.field_id,
        payload.crop_id,
    )
    try:
        explanation = await explain_model2_prediction(
            payload.question,
            prediction,
            payload.language_code,
        )
    except AssistantServiceError as error:
        logger.warning("Model 2 explanation request failed with status %s.", error.status_code)
        headers = {"Cache-Control": "no-store"}
        if error.retry_after is not None:
            headers["Retry-After"] = str(error.retry_after)
        raise HTTPException(
            status_code=error.status_code,
            detail=error.detail,
            headers=headers,
        ) from error
    return {"prediction": prediction, "explanation": explanation}


@app.get("/api/fields", response_model=list[FieldResponse])
def list_farmer_fields(
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    records = db.scalars(
        select(FarmerField)
        .where(FarmerField.farmer_id == context[0].id)
        .order_by(FarmerField.id)
    ).all()
    return [_field_response(record) for record in records]


@app.post("/api/fields", status_code=201, response_model=FieldResponse)
def create_farmer_field(
    payload: FieldCreate,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    field = FarmerField(
        farmer_id=context[0].id,
        **payload.model_dump(),
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return _field_response(field)


@app.get("/api/fields/{field_id}", response_model=FieldResponse)
def get_farmer_field(
    field_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    return _field_response(_owned_field(db, context[0].id, field_id))


@app.patch("/api/fields/{field_id}", response_model=FieldResponse)
def update_farmer_field(
    field_id: int,
    payload: FieldPatch,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    field = _owned_field(db, context[0].id, field_id)
    values = payload.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(status_code=422, detail="At least one field value is required.")
    for required in ("name", "area", "area_unit"):
        if required in values and values[required] is None:
            raise HTTPException(status_code=422, detail=f"{required} cannot be empty.")
    latitude = values.get("latitude", field.latitude)
    longitude = values.get("longitude", field.longitude)
    if (latitude is None) != (longitude is None):
        raise HTTPException(status_code=422, detail="Latitude and longitude must be set or cleared together.")
    for key, value in values.items():
        setattr(field, key, value)
    db.commit()
    db.refresh(field)
    return _field_response(field)


@app.delete("/api/fields/{field_id}", status_code=204)
def delete_farmer_field(
    field_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    field = _owned_field(db, context[0].id, field_id)
    active_schedule_id = db.scalar(
        select(IrrigationSchedule.id)
        .where(
            IrrigationSchedule.farmer_id == context[0].id,
            IrrigationSchedule.field_id == field_id,
            IrrigationSchedule.status == "confirmed",
        )
        .limit(1)
    )
    if active_schedule_id is not None:
        raise HTTPException(
            status_code=409,
            detail="Cancel or complete confirmed irrigation schedules before deleting this field.",
        )
    db.delete(field)
    db.commit()
    return Response(status_code=204)


@app.get("/api/crops", response_model=list[CropResponse])
def list_farmer_crops(
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    records = db.scalars(
        select(FarmerCrop)
        .where(FarmerCrop.farmer_id == context[0].id)
        .order_by(FarmerCrop.id)
    ).all()
    return [_crop_response(record) for record in records]


@app.post("/api/crops", status_code=201, response_model=CropResponse)
def create_farmer_crop(
    payload: CropCreate,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    _validate_crop_field(db, context[0].id, payload.field_id)
    crop = FarmerCrop(farmer_id=context[0].id, **payload.model_dump())
    db.add(crop)
    db.commit()
    db.refresh(crop)
    return _crop_response(crop)


@app.get("/api/crops/{crop_id}", response_model=CropResponse)
def get_farmer_crop(
    crop_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    return _crop_response(_owned_crop(db, context[0].id, crop_id))


@app.patch("/api/crops/{crop_id}", response_model=CropResponse)
def update_farmer_crop(
    crop_id: int,
    payload: CropPatch,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    crop = _owned_crop(db, context[0].id, crop_id)
    values = payload.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(status_code=422, detail="At least one crop value is required.")
    if "name" in values and values["name"] is None:
        raise HTTPException(status_code=422, detail="Crop name cannot be empty.")
    for key, value in values.items():
        setattr(crop, key, value)
    if (
        crop.planting_date is not None
        and crop.expected_harvest_date is not None
        and crop.expected_harvest_date < crop.planting_date
    ):
        raise HTTPException(status_code=422, detail="Expected harvest date cannot be before planting date.")
    _validate_crop_field(db, context[0].id, crop.field_id)
    db.commit()
    db.refresh(crop)
    return _crop_response(crop)


@app.delete("/api/crops/{crop_id}", status_code=204)
def delete_farmer_crop(
    crop_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    crop = _owned_crop(db, context[0].id, crop_id)
    db.delete(crop)
    db.commit()
    return Response(status_code=204)


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(TEMPLATES_DIR / "landing.html")


@app.get("/manifest.webmanifest", include_in_schema=False)
def main_app_manifest(request: Request):
    manifest = json.loads(
        (STATIC_DIR / "main-app.webmanifest").read_text(encoding="utf-8")
    )
    manifest["related_applications"] = [{
        "platform": "webapp",
        "url": str(request.url_for("main_app_manifest")),
        "id": urljoin(str(request.base_url), manifest.get("id", "/")),
    }]
    return Response(
        content=json.dumps(manifest),
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/service-worker.js", include_in_schema=False)
def main_app_service_worker():
    return FileResponse(
        STATIC_DIR / "main-app-sw.js",
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache",
            "Service-Worker-Allowed": "/",
        },
    )


@app.get("/offline.html", include_in_schema=False)
def main_app_offline_page():
    return FileResponse(STATIC_DIR / "main-offline.html")


@app.get("/pwa-icons/{icon_name}", include_in_schema=False)
def main_app_pwa_icon(icon_name: str):
    if icon_name not in PWA_ICON_FILES:
        raise HTTPException(status_code=404, detail="PWA icon not found.")
    icon_path = PWA_ICONS_DIR / icon_name
    if not icon_path.is_file():
        raise HTTPException(status_code=404, detail="PWA icon not found.")
    return FileResponse(icon_path, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/dashboard", include_in_schema=False)
def dashboard(request: Request, db: Session = Depends(get_db)):
    try:
        get_auth_context(request, db)
    except HTTPException as error:
        if error.status_code != 401:
            raise
        return RedirectResponse("/static/auth.html?view=login", status_code=303)
    return FileResponse(TEMPLATES_DIR / "index.html")


@app.get("/management", include_in_schema=False)
def management_page():
    return RedirectResponse("/static/sections.html?view=fields", status_code=303)


@app.get("/todo", include_in_schema=False)
def daily_farm_todo_page(request: Request, db: Session = Depends(get_db)):
    try:
        get_auth_context(request, db)
    except HTTPException as error:
        if error.status_code != 401:
            raise
        return RedirectResponse("/static/auth.html?view=login", status_code=303)
    return FileResponse(TEMPLATES_DIR / "todo-list.html")


@app.get("/api/todo/tasks", response_model=list[DailyFarmTaskResponse])
def list_daily_farm_tasks(
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    farmer_id = context[0].id
    tasks = db.scalars(
        select(DailyFarmTask)
        .where(DailyFarmTask.farmer_id == farmer_id)
        .order_by(DailyFarmTask.completed_at.is_not(None), DailyFarmTask.created_at.desc())
    ).all()
    return [_task_response(task) for task in tasks]


@app.post("/api/todo/tasks", response_model=DailyFarmTaskResponse, status_code=201)
def create_daily_farm_task(
    payload: DailyFarmTaskCreate,
    request: Request,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    farmer_id = context[0].id
    task = DailyFarmTask(
        farmer_id=farmer_id,
        title=payload.title,
        field_name=payload.field_name,
        completed_at=None,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return _task_response(task)


@app.patch("/api/todo/tasks/{task_id}", response_model=DailyFarmTaskResponse)
def update_daily_farm_task(
    task_id: int,
    payload: DailyFarmTaskUpdate,
    request: Request,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    task = _owned_task(db, context[0].id, task_id)
    if payload.title is not None:
        task.title = payload.title
    if payload.field_name is not None:
        task.field_name = payload.field_name
    if payload.completed is not None:
        task.completed_at = datetime.now(timezone.utc) if payload.completed else None
    db.commit()
    db.refresh(task)
    return _task_response(task)


@app.delete("/api/todo/tasks/{task_id}", status_code=204)
def delete_daily_farm_task(
    task_id: int,
    request: Request,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    task = _owned_task(db, context[0].id, task_id)
    db.delete(task)
    db.commit()
    return Response(status_code=204)


@app.get("/api/todo/reminder-settings", response_model=DailyFarmReminderSettingsResponse)
def get_daily_farm_reminder_settings(
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    settings = _get_or_create_reminder_settings(db, context[0].id)
    return DailyFarmReminderSettingsResponse.model_validate(settings)


@app.post("/api/todo/reminder-settings", response_model=DailyFarmReminderSettingsResponse)
def update_daily_farm_reminder_settings(
    payload: DailyFarmReminderSettings,
    request: Request,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    settings = _get_or_create_reminder_settings(db, context[0].id)
    settings.enabled = payload.enabled
    settings.interval_hours = payload.interval_hours
    settings.custom_interval_hours = payload.custom_interval_hours
    settings.next_reminder_at = (
        datetime.now(timezone.utc) + timedelta(hours=payload.interval_hours)
        if payload.enabled
        else None
    )
    db.commit()
    db.refresh(settings)
    return DailyFarmReminderSettingsResponse.model_validate(settings)


@app.get("/api/todo/pending-tasks", response_model=list[DailyFarmTaskResponse])
def get_pending_daily_farm_tasks(
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    tasks = db.scalars(
        select(DailyFarmTask)
        .where(DailyFarmTask.farmer_id == context[0].id)
        .where(DailyFarmTask.completed_at.is_(None))
        .order_by(DailyFarmTask.created_at.desc())
    ).all()
    return [_task_response(task) for task in tasks]


@app.post("/api/todo/notification-subscriptions", response_model=NotificationSubscriptionResponse, status_code=201)
def register_notification_subscription(
    payload: NotificationSubscriptionPayload,
    request: Request,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    expires_at = payload.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    subscription = FarmNotificationSubscription(
        farmer_id=context[0].id,
        endpoint=payload.endpoint,
        p256dh=payload.p256dh,
        auth=payload.auth,
        expires_at=expires_at,
        revoked_at=None,
    )
    db.add(subscription)
    db.commit()
    db.refresh(subscription)
    return NotificationSubscriptionResponse.model_validate(subscription)


@app.delete("/api/todo/notification-subscriptions", status_code=204)
def revoke_notification_subscription(
    request: Request,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    endpoint = request.headers.get("x-notification-endpoint") or request.query_params.get("endpoint")
    if not endpoint:
        raise HTTPException(status_code=400, detail="Notification endpoint is required.")
    subscriptions = db.scalars(
        select(FarmNotificationSubscription).where(
            FarmNotificationSubscription.farmer_id == context[0].id,
            FarmNotificationSubscription.endpoint == endpoint,
            FarmNotificationSubscription.revoked_at.is_(None),
        )
    ).all()
    for subscription in subscriptions:
        subscription.revoked_at = datetime.now(timezone.utc)
    db.commit()
    return Response(status_code=204)


@app.post("/api/translate", response_model=TranslationResponse)
def translate_ui_text(
    payload: TranslationRequest,
    request: Request,
):
    _validate_origin(request)
    _limit_translation_requests(request)
    try:
        translations = translate_texts(
            payload.texts,
            payload.source_language_code,
            payload.target_language_code,
        )
    except TranslationConfigurationError as error:
        raise HTTPException(
            status_code=503,
            detail="Translation service is not configured. Contact the administrator.",
        ) from error
    except TranslationRateLimitError as error:
        raise HTTPException(
            status_code=429,
            detail="Translation service is busy. Please try again later.",
            headers={"Retry-After": str(error.retry_after_seconds or 60)},
        ) from error
    except TranslationEntitlementError as error:
        logger.warning(
            "Sarvam translation request blocked: category=%s upstream_status=%s",
            error.category,
            error.status_code,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Sarvam translation is unavailable because the account may not have "
                "the required plan, credits, or API entitlement. Local dictionary "
                "translations remain available."
            ),
        ) from error
    except TranslationProviderError as error:
        logger.warning(
            "Sarvam translation request failed: category=%s upstream_status=%s",
            error.category,
            error.status_code,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                "Sarvam translation is temporarily unavailable. Use locally stored "
                "translations or try again later."
            ),
        ) from error
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail="Translation text contains a reserved token or exceeds the provider's input limit.",
        ) from error
    return TranslationResponse(translations=translations)


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/ready")
def readiness_check():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        logger.warning("Database readiness check failed.", exc_info=True)
        raise HTTPException(status_code=503, detail="Database is unavailable.")
    return {"status": "ready"}

@app.get("/db-test")
def test_database():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"database": "connected successfully"}
    except SQLAlchemyError:
        logger.warning("Database connection test failed.", exc_info=True)
        raise HTTPException(status_code=503, detail="Database connection failed.")
        return {"database": "connected successfully"}
    except SQLAlchemyError as error:
        logger.warning("Database connection test failed.", exc_info=True)
        raise HTTPException(status_code=503, detail="Database connection failed.") from error


# --------------------------------------------------
# GET SENSOR READINGS
# --------------------------------------------------

@app.post(
    "/api/fields/{field_id}/sensor-readings",
    status_code=201,
    response_model=FarmerSensorReadingResponse,
)
def create_field_sensor_reading(
    field_id: int,
    payload: FarmerSensorReadingCreate,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),

):
    _owned_field(db, context[0].id, field_id)

    if (
        payload.recorded_at.tzinfo is None
        or payload.recorded_at.utcoffset() is None
    ):
        raise HTTPException(
            status_code=422,
            detail="recorded_at must include a timezone.",
        )

    reading = FarmerSensorReading(
        farmer_id=context[0].id,
        field_id=field_id,
        **payload.model_dump(),
    )
    db.add(reading)
    db.commit()
    db.refresh(reading)

    return reading


@app.get(
    "/api/fields/{field_id}/sensor-readings",
    response_model=list[FarmerSensorReadingResponse],
)
def get_field_sensor_readings(
    field_id: int,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    limit: int = Query(default=5000, ge=1, le=5000),
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    _owned_field(db, context[0].id, field_id)

    for name, value in (("start_at", start_at), ("end_at", end_at)):
        if value is not None and (
            value.tzinfo is None or value.utcoffset() is None
        ):
            raise HTTPException(
                status_code=422,
                detail=f"{name} must include a timezone.",
            )

    if start_at is not None and end_at is not None and start_at >= end_at:
        raise HTTPException(
            status_code=422,
            detail="start_at must be earlier than end_at.",
        )

    statement = select(FarmerSensorReading).where(
        FarmerSensorReading.farmer_id == context[0].id,
        FarmerSensorReading.field_id == field_id,
    )

    if start_at is not None:
        statement = statement.where(
            FarmerSensorReading.recorded_at >= start_at
        )

    if end_at is not None:
        statement = statement.where(
            FarmerSensorReading.recorded_at <= end_at
        )

    statement = statement.order_by(
        FarmerSensorReading.recorded_at.desc(),
        FarmerSensorReading.id.desc(),
    ).limit(limit)

    return db.scalars(statement).all()


@app.post(
    "/api/fields/{field_id}/sensor-devices",
    status_code=201,
    response_model=FarmerSensorDeviceRegistrationResponse,
)
def register_field_sensor_device(
    field_id: int,
    payload: FarmerSensorDeviceCreate,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    _owned_field(db, context[0].id, field_id)

    device_name = payload.name.strip()
    if not device_name:
        raise HTTPException(
            status_code=422,
            detail="Device name cannot be empty.",
        )

    device = db.scalar(
        select(FarmerSensorDevice).where(
            FarmerSensorDevice.field_id == field_id
        )
    )

    if device is not None and device.is_active:
        raise HTTPException(
            status_code=409,
            detail="An active sensor device is already registered for this field.",
        )

    token = secrets.token_urlsafe(32)
    device_id = f"JAL-{secrets.token_hex(8).upper()}"

    if device is None:
        device = FarmerSensorDevice(
            farmer_id=context[0].id,
            field_id=field_id,
            device_id=device_id,
            name=device_name,
            token_hash=_digest(token),
            is_active=True,
        )
        db.add(device)
    else:
        # A revoked device can be replaced with a new identity and token.
        device.farmer_id = context[0].id
        device.device_id = device_id
        device.name = device_name
        device.token_hash = _digest(token)
        device.is_active = True
        device.last_seen_at = None

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A sensor device is already registered for this field.",
        )

    db.refresh(device)

    # The original secret is returned only at registration time.
    return FarmerSensorDeviceRegistrationResponse(
        id=device.id,
        field_id=device.field_id,
        device_id=device.device_id,
        name=device.name,
        token=token,
        created_at=device.created_at,
    )


@app.get(
    "/api/fields/{field_id}/sensor-devices",
    response_model=list[FarmerSensorDeviceResponse],
)
def list_field_sensor_devices(
    field_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    _owned_field(db, context[0].id, field_id)

    statement = (
        select(FarmerSensorDevice)
        .where(
            FarmerSensorDevice.farmer_id == context[0].id,
            FarmerSensorDevice.field_id == field_id,
        )
        .order_by(FarmerSensorDevice.id)
    )

    return db.scalars(statement).all()


@app.post(
    "/api/fields/{field_id}/sensor-devices/{device_id}/revoke",
    response_model=FarmerSensorDeviceResponse,
)
def revoke_field_sensor_device(
    field_id: int,
    device_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    _owned_field(db, context[0].id, field_id)

    device = db.scalar(
        select(FarmerSensorDevice).where(
            FarmerSensorDevice.id == device_id,
            FarmerSensorDevice.farmer_id == context[0].id,
            FarmerSensorDevice.field_id == field_id,
        )
    )

    if device is None:
        raise HTTPException(status_code=404, detail="Sensor device not found.")

    device.is_active = False
    db.commit()
    db.refresh(device)

    return device


@app.post(
    "/api/sensor-data",
    status_code=201,
    response_model=FarmerSensorReadingResponse,
)
def ingest_device_sensor_reading(
    payload: FarmerSensorReadingCreate,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    # Devices authenticate with their registered bearer token.
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Sensor device authentication required.",
        )

    scheme, separator, raw_token = authorization.partition(" ")

    if (
        not separator
        or scheme.lower() != "bearer"
        or not raw_token
        or len(raw_token) > 128
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid sensor device credentials.",
        )

    device = db.scalar(
        select(FarmerSensorDevice).where(
            FarmerSensorDevice.token_hash == _digest(raw_token)
        )
    )

    if device is None or not device.is_active:
        raise HTTPException(
            status_code=401,
            detail="Invalid or inactive sensor device.",
        )

    if (
        payload.recorded_at.tzinfo is None
        or payload.recorded_at.utcoffset() is None
    ):
        raise HTTPException(
            status_code=422,
            detail="recorded_at must include a timezone.",
        )

    # The server obtains ownership and field ID from the device record.
    reading = FarmerSensorReading(
        farmer_id=device.farmer_id,
        field_id=device.field_id,
        **payload.model_dump(),
    )

    device.last_seen_at = datetime.now(timezone.utc)

    db.add(reading)
    db.commit()
    db.refresh(reading)

    return reading


@app.get("/sensor-readings")
def get_sensor_readings(limit: int = Query(default=10, ge=1, le=100)):
    try:
        with engine.connect() as connection:
            result = connection.execute(
                text(
                    """
                    SELECT *
                    FROM sensor_readings
                    ORDER BY timestamp DESC, synthetic_record_number DESC
                    LIMIT :limit
                    """
                ),
                {"limit": limit},
            )
            rows = [dict(row) for row in result.mappings().all()]
    except SQLAlchemyError as error:
        logger.exception("Could not retrieve historical sensor readings.")
        raise HTTPException(
            status_code=503,
            detail="Historical sensor readings are unavailable.",
        ) from error

    origins = {row.get("data_origin") for row in rows if row.get("data_origin")}
    origin = (
        next(iter(origins))
        if rows and len(origins) == 1 and all(row.get("data_origin") for row in rows)
        else "mixed_or_unavailable"
    )
    return {
        "count": len(rows),
        "data": rows,
        "data_classification": "historical_dataset",
        "data_origin": origin,
        "is_live": False,
    }


def _weather_error(error):
    if isinstance(error, WeatherAuthError):
        logger.warning("Weather provider rejected the configured credentials.")
        return HTTPException(
            status_code=502,
            detail="Weather data is unavailable because the provider rejected its credentials.",
        )
    if isinstance(error, WeatherUnavailableError) and error.retry_after_seconds is not None:
        logger.warning(
            "Weather provider rate limit reached: upstream_status=429 retry_after=%s",
            error.retry_after_seconds,
        )
        return HTTPException(
            status_code=503,
            detail="Weather provider rate limit reached. Try again after the indicated delay.",
            headers={"Retry-After": str(error.retry_after_seconds)},
        )
    logger.warning("Weather provider data is unavailable: %s", error)
    headers = {}
    if isinstance(error, WeatherUnavailableError) and error.retry_after_seconds is not None:
        headers["Retry-After"] = str(error.retry_after_seconds)
    return HTTPException(
        status_code=503,
        detail="Weather data is unavailable. Check the provider configuration and try again.",
        headers=headers,
    )


def _resolve_weather_location(
    location: str | None,
    latitude: float | None,
    longitude: float | None,
) -> str:
    if (latitude is None) != (longitude is None):
        raise HTTPException(status_code=422, detail="Latitude and longitude must be provided together.")
    if latitude is not None and location is not None:
        raise HTTPException(status_code=422, detail="Choose either a named location or coordinates.")
    if latitude is not None:
        return f"{latitude:.6f},{longitude:.6f}"
    return get_location(location)


@app.get("/weather/current")
def current_weather(
    request: Request,
    location: str | None = Query(default=None, min_length=1, max_length=100),
    latitude: float | None = Query(default=None, ge=-90, le=90, allow_inf_nan=False),
    longitude: float | None = Query(default=None, ge=-180, le=180, allow_inf_nan=False),
):
    _limit_public_weather_requests(request)
    try:
        resolved_location = _resolve_weather_location(location, latitude, longitude)
        return {"location": resolved_location, **get_current_weather(resolved_location)}
    except (ValueError, WeatherUnavailableError, WeatherAuthError) as error:
        raise _weather_error(error) from error


@app.post("/weather/current")
def current_weather_for_coordinates(
    coordinates: WeatherCoordinates,
    response: Response,
    _context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    _limit_weather_requests(_context[0].id)
    resolved_location = _resolve_weather_location(
        None,
        coordinates.latitude,
        coordinates.longitude,
    )
    try:
        response.headers["Cache-Control"] = "no-store"
        weather = get_current_weather(resolved_location)
        weather["locality"] = get_locality(coordinates.latitude, coordinates.longitude)
        return {
            "location": resolved_location,
            **weather,
        }
    except (ValueError, WeatherUnavailableError, WeatherAuthError) as error:
        raise _weather_error(error) from error


@app.get("/weather/forecast")
def weather_forecast(
    request: Request,
    hours: int = Query(default=24, ge=1, le=120),
    timestep: str = Query(default="1h", pattern="^(1h|1d)$"),
    location: str | None = Query(default=None, min_length=1, max_length=100),
    latitude: float | None = Query(default=None, ge=-90, le=90, allow_inf_nan=False),
    longitude: float | None = Query(default=None, ge=-180, le=180, allow_inf_nan=False),
):
    _limit_public_weather_requests(request)
    try:
        resolved_location = _resolve_weather_location(location, latitude, longitude)
        data = get_forecast(resolved_location, hours, timestep=timestep)
        return {
            "location": resolved_location,
            "hours": len(data) if timestep == "1h" else None,
            "timestep": timestep,
            "periods": len(data),
            "data": data,
            "is_stale": bool(data) and all(item["is_stale"] for item in data),
            "data_age_minutes": max(
                (item["data_age_minutes"] for item in data),
                default=0,
            ),
        }
    except (ValueError, WeatherUnavailableError, WeatherAuthError) as error:
        raise _weather_error(error) from error


@app.post("/weather/forecast")
def weather_forecast_for_coordinates(
    coordinates: WeatherCoordinates,
    response: Response,
    hours: int = Query(default=24, ge=1, le=120),
    timestep: str = Query(default="1h", pattern="^(1h|1d)$"),
    _context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    _limit_weather_requests(_context[0].id)
    resolved_location = _resolve_weather_location(
        None,
        coordinates.latitude,
        coordinates.longitude,
    )
    try:
        data = get_forecast(resolved_location, hours, timestep=timestep)
        response.headers["Cache-Control"] = "no-store"
        return {
            "location": resolved_location,
            "hours": len(data) if timestep == "1h" else None,
            "timestep": timestep,
            "periods": len(data),
            "data": data,
            "is_stale": bool(data) and all(item["is_stale"] for item in data),
            "data_age_minutes": max(
                (item["data_age_minutes"] for item in data),
                default=0,
            ),
        }
    except (ValueError, WeatherUnavailableError, WeatherAuthError) as error:
        raise _weather_error(error) from error

# --------------------------------------------------
# MODEL 2: WATER REQUIREMENT PREDICTION
# --------------------------------------------------

@app.post("/api/models/model2/predict")
def predict_water_requirement(request: Model2Request):

    try:
        model2 = _load_legacy_model2()
        input_data = pd.DataFrame([
            request.model_dump()
        ])

        input_data["crop_type"] = (
            input_data["crop_type"].str.lower()
        )

        input_data["irrigation_method"] = (
            input_data["irrigation_method"].str.lower()
        )

        prediction = float(
            model2.predict(input_data)[0]
        )

        return {
            "model": "Model 2 - Water Requirement Prediction",
            "predicted_water_liters": max(0, prediction),
            "unit": "liters",
            "note": "Model trained and evaluated on synthetic data."
        }

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Water requirement prediction failed"
        )


# --------------------------------------------------
# MODEL 3: 24-HOUR SOIL MOISTURE PREDICTION
# --------------------------------------------------

@app.post("/api/models/model3/predict")
def predict_soil_moisture(request: Model3Request):
    current_moisture = request.current_moisture_percent

    return {
        "model": "Model 3 - 24-Hour Soil Moisture Prediction",
        "zone": request.zone,
        "strategy": "persistence",
        "prediction_horizon_hours": 24,
        "current_moisture_percent": current_moisture,
        "predicted_moisture_24h_percent": current_moisture,
        "unit": "percent",
        "note": "Persistence estimate: current moisture is carried forward."
    }
@app.post("/api/ml/soil-moisture-prediction")
def soil_moisture_prediction(
    request: SoilMoisturePredictionRequest,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    _owned_field(db, context[0].id, request.field_id)
    result = predict_soil_moisture(request)
    return {
        "field_id": request.field_id,
        "zone": request.zone,
        "prediction_status": "available",
        "prediction_timestamp": datetime.now(timezone.utc).isoformat(),
        **result,
    }
    # --------------------------------------------------
# MODEL 1: FULL 15-FEATURE PREDICTION
# --------------------------------------------------

@app.post("/api/models/model1/full/predict")
def predict_model1_full(request: Model1FullRequest):
    try:
        model1_full = _load_model1_full()
        result = predict_records(
            model1_full,
            [request.model_dump()]
        )

        return {
            "model": "Model 1 - Full 15-feature proxy classifier",
            **result[0]
        }

    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Model 1 full prediction failed"
        )


# --------------------------------------------------
# MODEL 1: REDUCED WEATHER PREDICTION
# --------------------------------------------------

@app.post("/api/models/model1/weather/predict")
def predict_model1_weather(
    request: Model1WeatherRequest,
    _: None = Depends(irrigation_guard)
):
    try:
        model1_weather = _load_model1_weather()
        metadata = model1_weather["metadata"]
        ranges = metadata["feature_training_ranges"]

        if not (
            ranges["temperature_c"]["minimum"]
            <= request.temperature_c
            <= ranges["temperature_c"]["maximum"]
        ):
            raise HTTPException(
                status_code=422,
                detail="Temperature is outside the model's training range."
            )

        if not (
            ranges["humidity_percent"]["minimum"]
            <= request.humidity_percent
            <= ranges["humidity_percent"]["maximum"]
        ):
            raise HTTPException(
                status_code=422,
                detail="Humidity is outside the model's training range."
            )

        result = predict_records(
            model1_weather,
            [request.model_dump()]
        )

        return {
            "model": "Model 1 - Reduced Weather Proxy",
            **result[0]
        }

    except HTTPException:
        raise

    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Model 1 weather prediction failed"
        )
    # --------------------------------------------------
# MODEL 4: CROP STRESS PREDICTION
# --------------------------------------------------

@app.post("/api/models/model4/predict")
def predict_crop_stress(request: Model4Request):

    try:
        model4 = _load_model4()
        result = predict_model4(model4, request.model_dump())

        return {
            "model": "Model 4 - Crop Stress Prediction",
            **result,
            "stress_level": None,
            "model_version": ARTIFACT_FILENAME,
            "artifact_sha256": ARTIFACT_SHA256,
            "note": (
                "The artifact class-to-stress-label meanings are not verified; "
                "the numeric class is returned without a guessed label. "
                "Probabilities are model estimates, not calibration evidence."
            ),
        }

    except FileNotFoundError as error:
        logger.warning("Model 4 artifact is unavailable: %s", error)
        raise HTTPException(
            status_code=503,
            detail=(
                "Crop stress prediction is unavailable. Restore "
                "model4/model4_crop_stress.joblib from the original artifact source."
            ),
        ) from error
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Crop stress prediction failed"
        )


@app.post("/api/ml/crop-stress-prediction")
def crop_stress_prediction(
    request: CropStressPredictionRequest,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    _owned_field(db, context[0].id, request.field_id)
    result = predict_crop_stress(request)
    return {
        "field_id": request.field_id,
        "crop_type": request.crop_type,
        "zone": request.zone,
        "prediction_status": "available",
        "prediction_timestamp": datetime.now(timezone.utc).isoformat(),
        **result,
    }
# --------------------------------------------------
# ALERT MANAGEMENT APIs
# --------------------------------------------------

ALERT_REFRESH_INTERVAL_SECONDS = 15 * 60


def _alert_category(alert_type: str) -> str:
    normalized = alert_type.casefold()
    if any(term in normalized for term in ("weather", "rain", "heat", "temperature", "wind", "frost", "storm", "drought")):
        return "weather"
    if any(term in normalized for term in ("sensor", "device")):
        return "sensors"
    if any(term in normalized for term in ("crop", "disease", "pest")):
        return "crops"
    if any(term in normalized for term in ("irrigation", "watering", "water", "moisture", "overwatering")):
        return "irrigation"
    if any(term in normalized for term in ("system", "report", "prediction")):
        return "system"
    return "fields"


def _alert_category_conditions(category: str):
    patterns = {
        "weather": ("%weather%", "%rain%", "%heat%", "%temperature%", "%wind%", "%frost%", "%storm%", "%drought%"),
        "sensors": ("%sensor%", "%device%"),
        "crops": ("%crop%", "%disease%", "%pest%"),
        "irrigation": ("%irrigation%", "%watering%", "%water%", "%moisture%", "%overwatering%"),
        "system": ("%system%", "%report%", "%prediction%"),
    }
    if category == "fields":
        categorized_patterns = tuple(
            pattern
            for category_patterns in patterns.values()
            for pattern in category_patterns
        )
        return ~or_(*(func.lower(Alert.alert_type).like(pattern) for pattern in categorized_patterns))
    return or_(*(func.lower(Alert.alert_type).like(pattern) for pattern in patterns[category]))


def _utc_datetime(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _refresh_automated_alerts(db: Session, farmer_id: int) -> int:
    now = datetime.now(timezone.utc)
    created_count = 0
    created_alert_ids: list[int] = []
    fields = db.scalars(
        select(FarmerField).where(FarmerField.farmer_id == farmer_id)
    ).all()

    for field in fields:
        if field.latitude is None or field.longitude is None:
            continue
        key = (farmer_id, field.id)
        monotonic_now = time.monotonic()
        with weather_alert_attempts_lock:
            last_checked = weather_alert_attempts.get(key)
            if last_checked is not None and monotonic_now - last_checked < ALERT_REFRESH_INTERVAL_SECONDS:
                continue
            if len(weather_alert_attempts) >= 4096:
                weather_alert_attempts.popitem(last=False)
            weather_alert_attempts[key] = monotonic_now
            weather_alert_attempts.move_to_end(key)

        try:
            forecast = get_forecast(
                f"{field.latitude:.6f},{field.longitude:.6f}",
                hours=24,
                timestep="1h",
            )
        except (ValueError, WeatherUnavailableError, WeatherAuthError) as error:
            logger.warning(
                "Weather alert evaluation skipped for field %s (%s).",
                field.id,
                type(error).__name__,
            )
            continue

        weather_result = process_weather_forecast(str(field.id), forecast)
        generated = list(weather_result.get("alerts", []))
        usable_periods = [
            period for period in forecast
            if isinstance(period, dict) and not period.get("is_stale", False)
        ]
        latest_reading = db.scalar(
            select(FarmerSensorReading)
            .where(
                FarmerSensorReading.farmer_id == farmer_id,
                FarmerSensorReading.field_id == field.id,
                FarmerSensorReading.source == "sensor",
                FarmerSensorReading.soil_moisture_percent.is_not(None),
            )
            .order_by(FarmerSensorReading.recorded_at.desc())
            .limit(1)
        )
        if latest_reading is not None and usable_periods:
            recorded_at = _utc_datetime(latest_reading.recorded_at)
            rainfall = sum(
                max(0.0, float(period["rainfall_mm_per_hr"]))
                for period in usable_periods
                if isinstance(period.get("rainfall_mm_per_hr"), (int, float))
                and math.isfinite(float(period["rainfall_mm_per_hr"]))
            )
            if now - recorded_at <= timedelta(hours=24):
                drought_result = process_drought_risk(
                    str(field.id),
                    float(latest_reading.soil_moisture_percent),
                    rainfall,
                )
                if drought_result.get("alert_generated"):
                    generated.append(drought_result["alert"])

        for alert_data in generated:
            values = dict(alert_data)
            values.update(farmer_id=farmer_id, field_id=field.id, is_read=False)
            values.pop("created_at", None)
            alert, was_created = create_alert(db, values)
            if was_created:
                if alert is None:
                    raise RuntimeError("New alert was not returned by the alert store.")
                created_alert_ids.append(alert.id)
                created_count += 1

    devices = db.scalars(
        select(FarmerSensorDevice).where(
            FarmerSensorDevice.farmer_id == farmer_id,
            FarmerSensorDevice.is_active.is_(True),
        )
    ).all()
    for device in devices:
        last_seen = device.last_seen_at or device.created_at
        if last_seen is None:
            continue
        stale_hours = (now - _utc_datetime(last_seen)).total_seconds() / 3600
        failure_result = process_sensor_failure(
            str(device.field_id),
            device.device_id,
            stale_hours,
        )
        if not failure_result.get("alert_generated"):
            continue
        values = dict(failure_result["alert"])
        values.update(farmer_id=farmer_id, field_id=device.field_id, is_read=False)
        values.pop("created_at", None)
        alert, was_created = create_alert(db, values)
        if was_created:
            if alert is None:
                raise RuntimeError("New alert was not returned by the alert store.")
            created_alert_ids.append(alert.id)
            created_count += 1

    schedules = db.scalars(
        select(IrrigationSchedule).where(
            IrrigationSchedule.farmer_id == farmer_id,
            IrrigationSchedule.status.in_(("confirmed", "completed")),
        )
    ).all()
    for schedule in schedules:
        event_type = "irrigation_scheduled" if schedule.status == "confirmed" else "irrigation_completed"
        message = (
            f"Irrigation is confirmed for {schedule.field_name} on {schedule.scheduled_date}."
            if schedule.status == "confirmed"
            else f"Irrigation was completed for {schedule.field_name} on {schedule.scheduled_date}."
        )
        values = {
            "farmer_id": farmer_id,
            "field_id": schedule.field_id,
            "alert_type": f"{event_type}_{schedule.id}",
            "severity": "low",
            "message": message,
            "reason": (
                f"{schedule.water_liters:g} liters planned for "
                f"{schedule.duration_minutes} minutes via {schedule.irrigation_method}."
            ),
            "is_read": False,
        }
        alert, was_created = create_alert(db, values)
        if was_created:
            if alert is None:
                raise RuntimeError("New alert was not returned by the alert store.")
            created_alert_ids.append(alert.id)
            created_count += 1

    if created_alert_ids:
        db.commit()
        for alert_id in created_alert_ids:
            dispatch_alert_notifications(db, alert_id)
    return created_count


def _visible_in_app_alert_filter():
    return ~Alert.id.in_(
        select(NotificationDelivery.alert_id).where(
            NotificationDelivery.channel == "in_app",
            NotificationDelivery.status == "skipped",
        )
    )


@app.get("/api/alerts")
def list_farmer_alerts(
    unread_only: bool = Query(default=False),
    read_status: Literal["all", "read", "unread"] = Query(default="all"),
    category: Literal["weather", "irrigation", "sensors", "crops", "system", "fields"] | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    query = (
        select(Alert, FarmerField.name)
        .join(
            FarmerField,
            (FarmerField.id == Alert.field_id) & (FarmerField.farmer_id == Alert.farmer_id),
        )
        .where(Alert.farmer_id == context[0].id, _visible_in_app_alert_filter())
    )
    if unread_only or read_status == "unread":
        query = query.where(Alert.is_read.is_(False))
    elif read_status == "read":
        query = query.where(Alert.is_read.is_(True))
    if category is not None:
        query = query.where(_alert_category_conditions(category))
    query = query.order_by(Alert.created_at.desc(), Alert.id.desc())
    if limit is not None:
        query = query.limit(limit).offset(offset)
    rows = db.execute(query).all()

    return [
        {
            "id": alert.id,
            "field_id": alert.field_id,
            "field_name": field_name,
            "alert_type": alert.alert_type,
            "category": _alert_category(alert.alert_type),
            "severity": alert.severity,
            "title": alert.alert_type.replace("_", " ").title(),
            "source": {
                "weather": "Weather service",
                "irrigation": "Irrigation schedule and monitoring",
                "sensors": "Sensor monitoring",
                "crops": "Crop monitoring",
                "system": "JalSaathi",
                "fields": "Field monitoring",
            }[_alert_category(alert.alert_type)],
            "message": alert.message,
            "reason": alert.reason,
            "is_read": alert.is_read,
            "status": alert.status,
            "created_at": alert.created_at,
        }
        for alert, field_name in rows
    ]


@app.get("/api/alerts/counts")
def get_farmer_alert_counts(
    read_status: Literal["all", "read", "unread"] = Query(default="all"),
    category: Literal["weather", "irrigation", "sensors", "crops", "system", "fields"] | None = Query(default=None),
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    farmer_id = context[0].id
    base = select(Alert.id).where(
        Alert.farmer_id == farmer_id,
        _visible_in_app_alert_filter(),
    )
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    unread = db.scalar(
        select(func.count(Alert.id)).where(
            Alert.farmer_id == farmer_id,
            Alert.is_read.is_(False),
            _visible_in_app_alert_filter(),
        )
    ) or 0
    matching = base
    if read_status == "unread":
        matching = matching.where(Alert.is_read.is_(False))
    elif read_status == "read":
        matching = matching.where(Alert.is_read.is_(True))
    if category is not None:
        matching = matching.where(_alert_category_conditions(category))
    matching_count = db.scalar(
        select(func.count()).select_from(matching.subquery())
    ) or 0
    return {
        "total": total,
        "unread": unread,
        "read": total - unread,
        "matching": matching_count,
    }


@app.post("/api/alerts/refresh")
def refresh_farmer_alerts(
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    created = _refresh_automated_alerts(db, context[0].id)
    return {"created": created}


@app.patch("/api/alerts/{alert_id}/read")
def mark_farmer_alert_read(
    alert_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    alert = mark_alert_as_read(
        db=db,
        alert_id=alert_id,
        farmer_id=context[0].id,
    )

    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found.")

    return {"message": "Alert marked as read.", "alert_id": alert.id}


@app.patch("/api/alerts/{alert_id}/unread")
def mark_farmer_alert_unread(
    alert_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    alert = mark_alert_as_unread(
        db=db,
        alert_id=alert_id,
        farmer_id=context[0].id,
    )

    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found.")

    return {"message": "Alert marked as unread.", "alert_id": alert.id}


@app.patch("/api/alerts/read-all")
def mark_all_farmer_alerts_read(
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    updated = mark_all_alerts_as_read(db, context[0].id)
    return {"message": "Unread alerts marked as read.", "updated_count": updated}


@app.patch("/api/alerts/{alert_id}/resolve")
def resolve_farmer_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    alert = resolve_alert(
        db=db,
        alert_id=alert_id,
        farmer_id=context[0].id,
    )

    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found.")

    return {"message": "Alert marked as resolved.", "alert_id": alert.id}

def _has_active_push_subscription(db: Session, farmer_id: int) -> bool:
    now = datetime.now(timezone.utc)
    subscription_id = db.scalar(
        select(FarmNotificationSubscription.id)
        .where(
            FarmNotificationSubscription.farmer_id == farmer_id,
            FarmNotificationSubscription.revoked_at.is_(None),
            FarmNotificationSubscription.p256dh != "",
            FarmNotificationSubscription.auth != "",
            or_(
                FarmNotificationSubscription.expires_at.is_(None),
                FarmNotificationSubscription.expires_at > now,
            ),
        )
        .limit(1)
    )
    return subscription_id is not None


def _notification_preferences_payload(
    db: Session, farmer: Farmer
) -> dict[str, bool | str | None]:
    sms_available = bool(farmer.phone and farmer.phone_verified_at)
    return {
        "in_app_notifications_enabled": farmer.in_app_notifications_enabled,
        "web_push_enabled": farmer.web_push_enabled,
        "push_subscription_available": _has_active_push_subscription(db, farmer.id),
        "sms_enabled": farmer.sms_enabled,
        "email_enabled": farmer.email_enabled,
        "sms_available": sms_available,
        "sms_unavailable_reason": (
            None if sms_available
            else "SMS is unavailable until a phone number is verified."
        ),
    }


@app.get("/api/notification-preferences")
def get_notification_preferences(
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(get_auth_context),
):
    return _notification_preferences_payload(db, context[0])


@app.patch("/api/notification-preferences")
def update_notification_preferences(
    preferences: NotificationPreferencesUpdate,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    farmer = context[0]

    updates = preferences.model_dump(exclude_unset=True, exclude_none=True)
    if not updates:
        raise HTTPException(status_code=422, detail="At least one preference is required.")
    if updates.get("sms_enabled") and not (farmer.phone and farmer.phone_verified_at):
        raise HTTPException(
            status_code=422,
            detail="SMS notifications require a verified phone number.",
        )
    if updates.get("web_push_enabled") and not _has_active_push_subscription(db, farmer.id):
        raise HTTPException(
            status_code=422,
            detail="Browser push notifications require an active subscription.",
        )

    for key, value in updates.items():
        setattr(farmer, key, value)

    try:
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        logging.error("Notification preference update failed (%s).", type(error).__name__)
        raise HTTPException(status_code=500, detail="Notification preferences could not be saved.") from error
    db.refresh(farmer)

    return {
        "message": "Notification preferences updated successfully.",
        **_notification_preferences_payload(db, farmer),
    }

@app.post("/api/push/subscribe")
def subscribe_to_push_notifications(
    subscription: PushSubscriptionRequest,
    db: Session = Depends(get_db),
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    farmer = context[0]

    endpoint = urlsplit(subscription.endpoint)
    if endpoint.scheme != "https" or not endpoint.netloc:
        raise HTTPException(status_code=422, detail="Push endpoint must use HTTPS.")
    subscription_expires_at = (
        datetime.fromtimestamp(subscription.expirationTime / 1000, timezone.utc)
        if subscription.expirationTime is not None
        else None
    )
    if subscription_expires_at is not None and subscription_expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="Push subscription has expired.")

    existing = db.scalar(
        select(FarmNotificationSubscription).where(
            FarmNotificationSubscription.endpoint == subscription.endpoint
        )
    )
    if existing:
        if existing.farmer_id != farmer.id:
            raise HTTPException(status_code=409, detail="Push endpoint is already registered.")
        existing.p256dh = subscription.keys["p256dh"]
        existing.auth = subscription.keys["auth"]
        existing.revoked_at = None
        existing.expires_at = subscription_expires_at
    else:
        db.add(FarmNotificationSubscription(
            farmer_id=farmer.id,
            endpoint=subscription.endpoint,
            p256dh=subscription.keys["p256dh"],
            auth=subscription.keys["auth"],
            expires_at=subscription_expires_at,
        ))

    farmer.web_push_enabled = True
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Push endpoint is already registered.") from error
    except SQLAlchemyError as error:
        db.rollback()
        logging.error("Push subscription update failed (%s).", type(error).__name__)
        raise HTTPException(status_code=500, detail="Push subscription could not be saved.") from error

    return {"message": "Browser push subscription saved."}


@app.get("/api/push/public-key")
def get_push_public_key():
    configured_key = os.getenv("VAPID_PUBLIC_KEY", "").strip()
    if not configured_key:
        raise HTTPException(status_code=503, detail="Browser push is not configured.")
    try:
        if len(configured_key) == 130 and all(char in "0123456789abcdefABCDEF" for char in configured_key):
            key_bytes = bytes.fromhex(configured_key)
        else:
            encoded = configured_key.replace("-", "+").replace("_", "/")
            key_bytes = base64.b64decode(encoded + "=" * (-len(encoded) % 4), validate=True)
        if len(key_bytes) != 65 or key_bytes[0] != 4:
            raise ValueError("Invalid public key.")
    except (ValueError, binascii.Error) as error:
        logging.error("VAPID public key configuration is invalid.")
        raise HTTPException(status_code=503, detail="Browser push is not configured.") from error

    public_key = base64.urlsafe_b64encode(key_bytes).decode("ascii").rstrip("=")
    return {"public_key": public_key}
