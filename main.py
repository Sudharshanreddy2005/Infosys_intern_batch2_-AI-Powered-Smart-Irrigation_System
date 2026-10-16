import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import SQLAlchemyError

from weather_api.integrations.config import get_location
from weather_api.integrations.weather_api import (
    WeatherAuthError,
    WeatherUnavailableError,
    get_current_weather,
    get_forecast,
)

logger = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parent
STATIC_DIR = PROJECT_ROOT / "static"
TEMPLATES_DIR = PROJECT_ROOT / "templates"

app = FastAPI(
    title="Smart Irrigation System API",
    description="Backend for predictive water management and crop optimization",
    version="1.0.0",
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


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(TEMPLATES_DIR / "index.html")


@app.get("/management", include_in_schema=False)
def management_page():
    return FileResponse(TEMPLATES_DIR / "management.html")


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
    logger.warning("Weather provider data is unavailable: %s", error)
    return HTTPException(
        status_code=503,
        detail="Weather data is unavailable. Check the provider configuration and try again.",
    )


@app.get("/weather/current")
def current_weather(location: str | None = Query(default=None, min_length=1, max_length=100)):
    try:
        resolved_location = get_location(location)
        return {"location": resolved_location, **get_current_weather(resolved_location)}
    except (ValueError, WeatherUnavailableError, WeatherAuthError) as error:
        raise _weather_error(error) from error


@app.get("/weather/forecast")
def weather_forecast(
    hours: int = Query(default=24, ge=1, le=120),
    location: str | None = Query(default=None, min_length=1, max_length=100),
):
    try:
        resolved_location = get_location(location)
        data = get_forecast(resolved_location, hours)
        return {
            "location": resolved_location,
            "hours": len(data),
            "data": data,
            "is_stale": bool(data) and all(item["is_stale"] for item in data),
            "data_age_minutes": max(
                (item["data_age_minutes"] for item in data),
                default=0,
            ),
        }
    except (ValueError, WeatherUnavailableError, WeatherAuthError) as error:
        raise _weather_error(error) from error
