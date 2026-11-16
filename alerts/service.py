
from alerts.rules import (
    check_low_moisture,
    check_weather_alerts,
    check_drought_risk,
    check_overwatering,
    check_sensor_failure,
)
from alerts.config import WEATHER_ALERT_THRESHOLDS, FIELD_THRESHOLDS


def process_soil_moisture(
    field_id: str,
    soil_moisture: float,
    field_thresholds: dict,
):
    """Process soil moisture and generate an alert if needed."""

    alert = check_low_moisture(
        field_id=field_id,
        soil_moisture=soil_moisture,
        field_thresholds=field_thresholds,
    )

    if alert is None:
        return {
            "alert_generated": False,
            "message": "No alert generated. Threshold is missing or moisture is normal.",
        }

    return {
        "alert_generated": True,
        "alert": alert,
    }


def process_weather_forecast(
    field_id: str,
    forecast_data: list,
    weather_thresholds: dict = None,
):
    """Process weather forecast and return matching alerts."""

    if weather_thresholds is None:
        weather_thresholds = WEATHER_ALERT_THRESHOLDS

    alerts = check_weather_alerts(
        field_id=field_id,
        forecast_data=forecast_data,
        weather_thresholds=weather_thresholds,
    )

    return {
        "alert_generated": bool(alerts),
        "alerts": alerts,
        "message": (
            "Weather alerts generated."
            if alerts
            else "No weather alerts detected."
        ),
    }


def process_drought_risk(
    field_id: str,
    soil_moisture: float,
    rainfall_mm: float,
    drought_thresholds: dict = None,
):
    """Process soil moisture and rainfall for drought risk."""

    if drought_thresholds is None:
        drought_thresholds = WEATHER_ALERT_THRESHOLDS.get("drought", {})

    alert = check_drought_risk(
        field_id=field_id,
        soil_moisture=soil_moisture,
        rainfall_mm=rainfall_mm,
        drought_thresholds=drought_thresholds,
    )

    if alert is None:
        return {
            "alert_generated": False,
            "message": "No drought risk detected.",
        }

    return {
        "alert_generated": True,
        "alert": alert,
    }
def process_overwatering(
    field_id: str,
    continuous_wet_hours: float,
):
    """Process continuous wet duration for over-watering alerts."""

    alert = check_overwatering(
        field_id=field_id,
        continuous_wet_hours=continuous_wet_hours,
    )

    if alert is None:
        return {
            "alert_generated": False,
            "message": "No over-watering detected.",
        }

    return {
        "alert_generated": True,
        "alert": alert,
    }
def process_sensor_failure(
    field_id: str,
    sensor_id: str,
    last_reading_hours: float,
):
    """Process sensor inactivity and generate an alert."""

    alert = check_sensor_failure(
        field_id=field_id,
        sensor_id=sensor_id,
        last_reading_hours=last_reading_hours,
    )

    if alert is None:
        return {
            "alert_generated": False,
            "message": "Sensor is working normally.",
        }

    return {
        "alert_generated": True,
        "alert": alert,
    }