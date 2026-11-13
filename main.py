import hashlib
import hmac
import logging
import math
import os
import secrets
import threading
import time
from collections import OrderedDict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from pydantic import BaseModel, Field
import joblib
import pandas as pd
from sqlalchemy import create_engine, select, text, update
from sqlalchemy.engine import URL
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session


from models import (
    FarmerSensorReading,
    AuthSession,
    Base,
    Farmer,
    FarmerCrop,
    FarmerField,
    IrrigationReservoir,
    IrrigationSchedule,
    FarmerSensorDevice,
)
from schemas import (
    CropCreate,
    CropPatch,
    CropResponse,
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
    ReducedWeatherPredictionRequest,
    ReducedWeatherPredictionResponse,
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
)
from sarvam_translation import (
    TranslationConfigurationError,
    TranslationProviderError,
    TranslationRateLimitError,
    translate_texts,
)
from weather_api.integrations.reverse_geocoding import get_locality
from farmer_assistant import (
    AssistantServiceError,
    answer_farmer_question,
    explain_model2_prediction,
)
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


def _validate_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin:
        supplied = urlsplit(origin)
        expected = urlsplit(str(request.base_url))
        if (
            supplied.scheme != expected.scheme
            or supplied.netloc.casefold() != expected.netloc.casefold()
        ):
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
    payload: FarmerAssistantRequest,
    response: Response,
    context: tuple[Farmer, AuthSession] = Depends(require_csrf),
):
    response.headers["Cache-Control"] = "no-store"
    _limit_assistant_requests(context[0].id)
    try:
        answer = await answer_farmer_question(payload.question)
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
    return {"answer": answer}


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
        explanation = await explain_model2_prediction(payload.question, prediction)
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
    except TranslationProviderError as error:
        logger.warning(
            "Sarvam translation request failed: category=%s upstream_status=%s",
            error.category,
            error.status_code,
        )
        raise HTTPException(
            status_code=502,
            detail="Translation is temporarily unavailable. Untranslated text remains in English.",
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
