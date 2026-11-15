
import sys
import os
from pathlib import Path


from fastapi import FastAPI, HTTPException

from app.schemas import SensorData
from app.validation import clean_sensor_data
from app.database import SessionLocal

# Access the main project models and alert modules
ROOT_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_DIR))
from dotenv import load_dotenv
load_dotenv(ROOT_DIR / ".env")

from models import (
    Farmer,
    LiveSensorReading,
    SensorFieldMapping,
    FarmerField,
    Alert,
)
from sms_notifications import send_sms
from email_notifications import send_email
from alerts.config import FIELD_THRESHOLDS
from alerts.service import process_soil_moisture
from alerts.database import create_alert
from push_notifications import send_web_push_notification


app = FastAPI(
    title="Smart Irrigation Sensor Data API",
    version="1.0.0",
)


@app.get("/")
def home():
    return {
        "message": "Sensor Data Ingestion API is running"
    }


@app.post("/sensor-data")
def receive_sensor_data(data: SensorData):
    cleaned_data = clean_sensor_data(data)
    db = SessionLocal()

    try:
        # 1. Find external field mapping
        mapping = (
            db.query(SensorFieldMapping)
            .filter(
                SensorFieldMapping.external_field_id == data.field_id
            )
            .first()
        )

        if mapping is None:
            raise HTTPException(
                status_code=404,
                detail="Unknown field ID. Please register the field mapping first."
            )

        # 2. Find the registered field and its owner
        field = db.get(FarmerField, mapping.field_id)

        if field is None:
            raise HTTPException(
                status_code=404,
                detail="Registered field not found."
            )

        # 3. Save the sensor reading
        reading = LiveSensorReading(
            field_id=mapping.field_id,
            sensor_id=data.sensor_id,
            soil_moisture=cleaned_data.soil_moisture,
            timestamp=data.timestamp,
        )

        db.add(reading)
        db.flush()

        # 4. Check the soil moisture threshold
        alert_result = process_soil_moisture(
            field_id=str(mapping.field_id),
            soil_moisture=cleaned_data.soil_moisture,
            field_thresholds=FIELD_THRESHOLDS,
        )

        saved_alert = None

        # 5. Save the alert for the correct farmer
        if alert_result["alert_generated"]:
            alert_data = alert_result["alert"].copy()

            # Use database IDs, not external IDs
            alert_data["farmer_id"] = field.farmer_id
            alert_data["field_id"] = mapping.field_id

            # Let PostgreSQL generate the created_at timestamp
            alert_data.pop("created_at", None)
            existing_alert = db.query(Alert).filter(
                Alert.farmer_id == alert_data["farmer_id"],
                Alert.field_id == alert_data["field_id"],
                Alert.alert_type == alert_data["alert_type"],
                Alert.status == "unresolved",
            ).first()


            saved_alert = create_alert(
                db=db,
                alert_data=alert_data,
            )

            if not existing_alert and saved_alert:
                print("DEBUG: New alert condition reached:", not existing_alert and saved_alert is not None)
                print("DEBUG: Sending Web Push notification...")

                 # Web Push notification
                send_web_push_notification(
                    db=db,
                    farmer_id=alert_data["farmer_id"],
                    title="Smart Irrigation Alert",
                    message=alert_data["message"],
                )

                print("DEBUG: Web Push function completed.")

                print("DEBUG: Reached supervisor email section")                # Supervisor Email notification
                supervisor_email = os.getenv("SUPERVISOR_EMAIL")


                if supervisor_email:
                    print("DEBUG: Sending supervisor email...")
                    print("DEBUG: Supervisor email recipient configured:", bool(supervisor_email))

                    email_sent = send_email(
                        to_email=supervisor_email,
                        subject="Smart Irrigation Alert",
                        message=(
                            f"An irrigation alert has been generated.\n\n"
                            f"Farmer ID: {alert_data['farmer_id']}\n"
                            f"Field ID: {alert_data['field_id']}\n"
                            f"Alert Type: {alert_data['alert_type']}\n"
                            f"Severity: {alert_data['severity']}\n"
                            f"Message: {alert_data['message']}\n\n"
                            f"Please check the field."
                        ),
                    )

                    print("Email result:", email_sent)

                else:
                    print("Email skipped: Supervisor email is not configured.")

                # SMS notification
                farmer = db.get(Farmer, field.farmer_id)

                if farmer and farmer.sms_enabled and farmer.phone:
                    print("DEBUG: Sending SMS notification...")

                    sms_sent = send_sms(
                        to_number=farmer.phone,
                        message=alert_data["message"],
                    )

                    print("SMS result:", sms_sent)

                else:
                    print("SMS skipped: Farmer has no phone number or SMS is disabled.")

            else:
                 db.commit()


        db.commit()
        db.refresh(reading)

        response_data = {
            "reading_id": reading.id,
            "field_id": reading.field_id,
            "sensor_id": reading.sensor_id,
            "soil_moisture": reading.soil_moisture,
            "timestamp": reading.timestamp,
            "alert_generated": saved_alert is not None,
            "alert_id": saved_alert.id if saved_alert else None,
        }

        return {
            "status": "success",
            "message": "Sensor data received and saved successfully",
            **response_data,
            "data": response_data,
        }

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()
