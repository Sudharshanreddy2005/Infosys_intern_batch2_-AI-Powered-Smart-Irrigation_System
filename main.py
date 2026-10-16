
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine, text

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="Smart Irrigation System API",
    description="Backend for predictive water management and crop optimization",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./smart_irrigation.db",
)

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
else:
    engine = create_engine(DATABASE_URL)

# Serve frontend assets when the directory exists.
STATIC_DIR = BASE_DIR / "static"
if STATIC_DIR.is_dir():
    app.mount(
        "/static",
        StaticFiles(directory=str(STATIC_DIR)),
        name="static",
    )


@app.get("/")
def serve_dashboard():
    index_file = BASE_DIR / "templates" / "index.html"

    if index_file.is_file():
        return FileResponse(index_file)

    return {
        "message": "Welcome to the Smart Irrigation System!",
        "status": "Backend is running successfully",
    }


@app.get("/api/dashboard")
def dashboard_data():
    # Demo values only; replace with real API/database values
    # when those integrations are connected.
    return {
        "greeting": "Namaste, Ramesh!",
        "hero_title": "Smart Water. Healthy Crops. Stronger Farmers.",
        "weather": {
            "temperature": "28°C",
            "description": "Partly Cloudy",
            "location": "Mandya, Karnataka",
            "humidity": "68%",
            "wind_speed": "12 km/h",
            "rainfall": "20% chance",
        },
        "fields": [
            {
                "name": "Field 1",
                "crop": "Paddy",
                "status": "Optimal",
                "moisture": "32%",
                "last_irrigated": "2 days ago",
            },
            {
                "name": "Field 2",
                "crop": "Sugarcane",
                "status": "Needs Water",
                "moisture": "18%",
                "last_irrigated": "3 days ago",
            },
            {
                "name": "Field 3",
                "crop": "Ragi",
                "status": "Low Moisture",
                "moisture": "12%",
                "last_irrigated": "5 days ago",
            },
        ],
        "recommendation": {
            "field": "Field 2 - East Plot",
            "crop": "Sugarcane",
            "status": "Needs Water",
            "time": "Today, 5:00 PM",
            "duration": "2 hours",
            "message": (
                "Based on soil moisture (18%) and weather forecast, "
                "irrigate 2 hours today to maintain optimal crop health."
            ),
        },
        "season": {
            "name": "Kharif Season 2024",
            "range": "June - October",
            "progress": 45,
            "major_crop": "Paddy",
            "growth_stage": "Vegetative",
            "days_remaining": "65 days",
        },
    }


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/db-test")
def test_database():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        return {"database": "connected successfully"}

    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Database connection failed",
        )


@app.get("/sensor-readings")
def get_sensor_readings(
    limit: int = Query(default=10, ge=1, le=100),
):
    try:
        with engine.connect() as connection:
            result = connection.execute(
                text(
                    """
                    SELECT *
                    FROM sensor_readings
                    ORDER BY synthetic_record_number
                    LIMIT :limit
                    """
                ),
                {"limit": limit},
            )

            rows = result.mappings().all()

            return {
                "count": len(rows),
                "data": [dict(row) for row in rows],
            }

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve sensor readings",
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
