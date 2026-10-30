
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException, Query, Depends, Header
from sqlalchemy import create_engine, text
from irrigation_optimizer.api import router as irrigation_router

import os
import hmac
import joblib
import pandas as pd
from pathlib import Path


app = FastAPI(
    title="Smart Irrigation System API",
    description="Backend for predictive water management and crop optimization",
    version="1.0.0"
)


# --------------------------------------------------
# DATABASE CONFIGURATION
# --------------------------------------------------

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set")

engine = create_engine(DATABASE_URL)


# --------------------------------------------------
# LOAD TRAINED ML MODELS
# --------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent

model2 = joblib.load(
    BASE_DIR / "model2" / "model2_water_requirement.joblib"
)

model3 = joblib.load(
    BASE_DIR / "model3" / "zone4_ridge.joblib"
)


# --------------------------------------------------
# MODEL 2: WATER REQUIREMENT REQUEST
# --------------------------------------------------

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


# --------------------------------------------------
# MODEL 3: SOIL MOISTURE REQUEST
# --------------------------------------------------

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


# --------------------------------------------------
# IRRIGATION API AUTHENTICATION
# --------------------------------------------------

IRRIGATION_API_KEY = os.getenv("IRRIGATION_API_KEY")


def irrigation_guard(
    x_irrigation_key: str = Header(default="")
):
    if not IRRIGATION_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Irrigation API authentication is not configured"
        )

    if not hmac.compare_digest(
        x_irrigation_key,
        IRRIGATION_API_KEY
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid irrigation API key"
        )


# Register protected irrigation optimizer router
app.include_router(
    irrigation_router,
    dependencies=[Depends(irrigation_guard)]
)


# --------------------------------------------------
# BASIC BACKEND ENDPOINTS
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "message": "Welcome to the Smart Irrigation System!",
        "status": "Backend is running successfully"
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}


# --------------------------------------------------
# DATABASE TEST
# --------------------------------------------------

@app.get("/db-test")
def test_database():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        return {
            "database": "connected successfully"
        }

    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Database connection failed"
        )


# --------------------------------------------------
# GET SENSOR READINGS
# --------------------------------------------------

@app.get("/sensor-readings")
def get_sensor_readings(
    limit: int = Query(default=10, ge=1, le=100)
):
    try:
        with engine.connect() as connection:
            result = connection.execute(
                text("""
                    SELECT *
                    FROM sensor_readings
                    ORDER BY synthetic_record_number
                    LIMIT :limit
                """),
                {"limit": limit}
            )

            rows = result.mappings().all()

            return {
                "count": len(rows),
                "data": [dict(row) for row in rows]
            }

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve sensor readings"
        )


# --------------------------------------------------
# MODEL 2: WATER REQUIREMENT PREDICTION
# --------------------------------------------------

@app.post("/api/models/model2/predict")
def predict_water_requirement(request: Model2Request):

    try:
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

    try:
        current_moisture = request.current_moisture_percent

        # Zones 1, 2, 3 and 5 use persistence strategy
        if request.zone in [1, 2, 3, 5]:

            response = {
                "model": "Model 3 - 24-Hour Soil Moisture Prediction",
                "zone": request.zone,
                "strategy": "persistence",
                "current_moisture_percent": current_moisture,
                "predicted_moisture_24h_percent": current_moisture,
                "unit": "percent",
                "note": "Persistence estimate: current moisture is carried forward."
            }

            if request.zone == 3:
                response["warning"] = (
                    "Limited reliable data; predictions require caution."
                )

            return response

        # Zone 4 requires all 13 model features
        required_features = [
            "weather_temp",
            "weather_humidity",
            "weather_rain",
            "weather_pressure",
            "weather_wind_speed",
            "weather_radiation",
            "soil_temperature_0-7cm",
            "soil_temperature_7-18cm",
            "month",
            "day",
            "hour",
            "day_period",
            "quarter"
        ]

        input_values = {
            "weather_temp": request.weather_temp,
            "weather_humidity": request.weather_humidity,
            "weather_rain": request.weather_rain,
            "weather_pressure": request.weather_pressure,
            "weather_wind_speed": request.weather_wind_speed,
            "weather_radiation": request.weather_radiation,
            "soil_temperature_0-7cm": request.soil_temperature_0_7cm,
            "soil_temperature_7-18cm": request.soil_temperature_7_18cm,
            "month": request.month,
            "day": request.day,
            "hour": request.hour,
            "day_period": request.day_period,
            "quarter": request.quarter
        }

        missing_features = [
            name for name, value in input_values.items()
            if value is None
        ]

        if missing_features:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Zone 4 requires all model input features.",
                    "missing_features": missing_features
                }
            )

        input_data = pd.DataFrame(
            [input_values],
            columns=required_features
        )

        predicted_change = float(
            model3.predict(input_data)[0]
        )

        return {
            "model": "Model 3 - 24-Hour Soil Moisture Prediction",
            "zone": 4,
            "strategy": "ridge_change",
            "current_moisture_percent": current_moisture,
            "predicted_change": predicted_change,
            "unit": "percentage points",
            "note": (
                "Raw Ridge model output. Final 24-hour moisture "
                "calculation requires confirmation of the training target."
            )
        }

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Soil moisture prediction failed"
        )
