from fastapi import FastAPI, HTTPException, Query
from sqlalchemy import create_engine, text
import os

app = FastAPI(
    title="Smart Irrigation System API",
    description="Backend for predictive water management and crop optimization",
    version="1.0.0"
)

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set")

engine = create_engine(DATABASE_URL)


@app.get("/")
def home():
    return {
        "message": "Welcome to the Smart Irrigation System!",
        "status": "Backend is running successfully"
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
            detail="Database connection failed"
        )


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