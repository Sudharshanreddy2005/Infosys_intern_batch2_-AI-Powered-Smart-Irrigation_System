import hashlib
import hmac
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

ROOT_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_DIR))
load_dotenv(ROOT_DIR / ".env")

from alerts.config import FIELD_THRESHOLDS
from alerts.database import create_alert
from alerts.service import process_soil_moisture
from email_notifications import send_email
from models import Farmer, FarmerField, FarmerSensorDevice, FarmerSensorReading
from push_notifications import send_web_push_notification
from app.database import SessionLocal
from app.schemas import SensorData
from app.validation import clean_sensor_data
from sms_notifications import send_sms

logger = logging.getLogger(__name__)
app = FastAPI(title="JalSaathi Sensor Ingestion API", version="1.0.0")


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/")
def home() -> dict[str, str]:
    return {"message": "JalSaathi sensor ingestion API is running."}


@app.get("/ready")
def readiness(db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        logger.error("Sensor API database readiness check failed (%s).", type(error).__name__)
        raise HTTPException(status_code=503, detail="Database is unavailable.") from error
    return {"status": "ready"}


def _send_notifications(
    db: Session,
    farmer: Farmer,
    field: FarmerField,
    alert: object,
) -> dict[str, dict[str, str | int]]:
    outcomes: dict[str, dict[str, str | int]] = {}
    if farmer.web_push_enabled:
        try:
            outcomes["push"] = send_web_push_notification(
                db, farmer.id, "Smart Irrigation Alert", alert.message
            )
        except Exception as error:
            logger.error("Push notification processing failed (%s).", type(error).__name__)
            outcomes["push"] = {"status": "failed", "reason": "provider_error"}
    else:
        outcomes["push"] = {"status": "skipped", "reason": "preference_disabled"}

    supervisor_email = os.getenv("SUPERVISOR_EMAIL", "").strip()
    if supervisor_email:
        try:
            outcomes["email"] = send_email(
                supervisor_email,
                "Smart Irrigation Alert",
                f"An irrigation alert was generated for field {field.id}.\n"
                f"Type: {alert.alert_type}\nSeverity: {alert.severity}\n"
                f"Message: {alert.message}",
            )
        except Exception as error:
            logger.error("Email notification processing failed (%s).", type(error).__name__)
            outcomes["email"] = {"status": "failed", "reason": "provider_error"}
    else:
        outcomes["email"] = {"status": "skipped", "reason": "recipient_not_configured"}

    if farmer.sms_enabled and farmer.phone:
        try:
            outcomes["sms"] = send_sms(farmer.phone, alert.message)
        except Exception as error:
            logger.error("SMS notification processing failed (%s).", type(error).__name__)
            outcomes["sms"] = {"status": "failed", "reason": "provider_error"}
    else:
        outcomes["sms"] = {"status": "skipped", "reason": "preference_disabled"}
    return outcomes


@app.post("/sensor-data")
def receive_sensor_data(
    data: SensorData,
    x_sensor_token: str = Header(default="", alias="X-Sensor-Token"),
    db: Session = Depends(get_db),
) -> dict:
    if not x_sensor_token or len(x_sensor_token) > 256:
        raise HTTPException(status_code=401, detail="Sensor authentication is required.")

    device = db.scalar(
        select(FarmerSensorDevice).where(
            FarmerSensorDevice.device_id == data.sensor_id,
            FarmerSensorDevice.is_active.is_(True),
        )
    )
    if device is None:
        raise HTTPException(status_code=404, detail="Registered sensor not found.")

    token_digest = hashlib.sha256(x_sensor_token.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(token_digest, device.token_hash):
        raise HTTPException(status_code=401, detail="Invalid sensor credentials.")
    if device.field_id != data.field_id:
        raise HTTPException(status_code=404, detail="Sensor field mapping not found.")

    field = db.scalar(
        select(FarmerField).where(
            FarmerField.id == device.field_id,
            FarmerField.farmer_id == device.farmer_id,
        )
    )
    farmer = db.get(Farmer, device.farmer_id)
    if field is None or farmer is None:
        raise HTTPException(status_code=404, detail="Registered sensor field not found.")

    cleaned = clean_sensor_data(data)
    recorded_at = cleaned.timestamp
    if recorded_at.tzinfo is None:
        recorded_at = recorded_at.replace(tzinfo=timezone.utc)
    else:
        recorded_at = recorded_at.astimezone(timezone.utc)

    reading = FarmerSensorReading(
        farmer_id=farmer.id,
        field_id=field.id,
        soil_moisture_percent=cleaned.soil_moisture,
        recorded_at=recorded_at,
        source="sensor",
    )
    db.add(reading)
    device.last_seen_at = datetime.now(timezone.utc)

    alert_result = process_soil_moisture(
        field_id=str(field.id),
        soil_moisture=cleaned.soil_moisture,
        field_thresholds=FIELD_THRESHOLDS,
    )
    alert = None
    alert_created = False
    if alert_result["alert_generated"]:
        alert_data = dict(alert_result["alert"])
        alert_data.update(farmer_id=farmer.id, field_id=field.id, is_read=False)
        alert_data.pop("created_at", None)
        alert, alert_created = create_alert(db, alert_data)

    try:
        db.commit()
        db.refresh(reading)
    except SQLAlchemyError as error:
        db.rollback()
        logger.error("Sensor reading transaction failed (%s).", type(error).__name__)
        raise HTTPException(status_code=500, detail="Sensor reading could not be saved.") from error

    notification_results = (
        _send_notifications(db, farmer, field, alert)
        if alert is not None and alert_created
        else {
            "push": {"status": "skipped", "reason": "no_new_alert"},
            "email": {"status": "skipped", "reason": "no_new_alert"},
            "sms": {"status": "skipped", "reason": "no_new_alert"},
        }
    )

    return {
        "status": "saved",
        "reading_id": reading.id,
        "sensor_id": device.device_id,
        "field_id": field.id,
        "soil_moisture": reading.soil_moisture_percent,
        "timestamp": reading.recorded_at,
        "alert_generated": alert_created,
        "alert_id": alert.id if alert is not None else None,
        "notifications": notification_results,
    }
