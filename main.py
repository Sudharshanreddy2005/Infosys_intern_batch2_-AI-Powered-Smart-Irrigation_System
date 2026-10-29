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
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from models import AuthSession, Base, Farmer, FarmerCrop, FarmerField
from schemas import (
    CropCreate,
    CropPatch,
    CropResponse,
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
)
from weather_api.integrations.config import get_location
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
from backend.models.model1.inference import load_artifact_bundle, predict_records

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
        / "backend"
        / "models"
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
        / "backend"
        / "models"
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
        observed_at = datetime.fromisoformat(observation_time.replace("Z", "+00:00"))
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
            if not training_range["minimum"] <= value <= training_range["maximum"]:
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
            or not isinstance(prediction.get("proxy_positive_probability"), (int, float))
            or not math.isfinite(prediction["proxy_positive_probability"])
            or not 0 <= prediction["proxy_positive_probability"] <= 1
        ):
            raise ValueError("The reduced-weather model returned an invalid binary result.")
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
        "feature_sources": {
            "temperature_c": "selected_field_current_weather_api",
            "humidity_percent": "selected_field_current_weather_api",
        },
        "observation_time": observed_at,
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
