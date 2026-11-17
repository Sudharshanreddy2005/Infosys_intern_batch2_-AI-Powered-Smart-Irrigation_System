
from datetime import datetime, timezone


def check_low_moisture(
    field_id: str,
    soil_moisture: float,
    field_thresholds: dict,
):
    """
    Check whether soil moisture is below the
    verified irrigation trigger for a field.
    """

    if field_id not in field_thresholds:
        return None

    threshold = field_thresholds[field_id]

    if not threshold.get("is_validated", False):
        return None

    irrigation_trigger = threshold.get("irrigation_trigger")

    if irrigation_trigger is None:
        return None

    if soil_moisture <= irrigation_trigger:
        return {
            "field_id": field_id,
            "alert_type": "low_soil_moisture",
            "severity": "high",
            "message": "Soil moisture is below the field irrigation trigger.",
            "reason": (
                f"Soil moisture is {soil_moisture}, "
                f"which is at or below the configured trigger "
                f"of {irrigation_trigger}."
            ),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "unresolved",
        }

    return None


def check_weather_alerts(
    field_id: str,
    forecast_data: list,
    weather_thresholds: dict,
):
    """
    Check weather forecast data for possible weather alerts.
    Returns at most one alert of each type per evaluation.
    """

    alerts = []

    rules = [
        {
            "type": "heavy_rain",
            "severity": "high",
            "message": "Heavy rainfall is expected. Reconsider planned irrigation.",
        },
        {
            "type": "high_temperature",
            "severity": "medium",
            "message": "High temperatures are expected. Check crop water requirements.",
        },
        {
            "type": "heatwave",
            "severity": "high",
            "message": "High temperature is expected. Check crop water requirements.",
        },
        {
            "type": "strong_wind",
            "severity": "medium",
            "message": "Strong winds are expected. Review irrigation plans.",
        },
        {
            "type": "frost",
            "severity": "high",
            "message": "Very low temperatures are expected. Protect sensitive crops.",
        },
        {
            "type": "storm",
            "severity": "high",
            "message": "Thunderstorms are forecast. Review field and irrigation plans.",
        },
    ]

    for rule in rules:
        alert_type = rule["type"]
        threshold = weather_thresholds.get(alert_type, {})
        matched_period = None
        reason = ""

        for period in forecast_data:
            if period.get("is_stale", False):
                continue

            if alert_type == "heavy_rain":
                rainfall = period.get("rainfall_mm_per_hr")
                probability = period.get("rain_probability_percent")

                if (
                    (rainfall is not None and rainfall >= threshold.get("rainfall_mm_per_hr", float("inf")))
                    or
                    (probability is not None and probability >= threshold.get("rain_probability_percent", float("inf")))
                ):
                    matched_period = period
                    reason = (
                        f"Forecast rainfall intensity: {rainfall} mm/hr; "
                        f"rain probability: {probability}%."
                    )

            elif alert_type == "heatwave":
                temperature = period.get("temperature_c")

                if temperature is not None and temperature >= threshold.get("temperature_c", float("inf")):
                    matched_period = period
                    reason = f"Forecast temperature: {temperature}°C."

            elif alert_type == "high_temperature":
                temperature = period.get("temperature_c")

                if (
                    temperature is not None
                    and threshold.get("temperature_c", float("inf")) <= temperature
                    < weather_thresholds.get("heatwave", {}).get("temperature_c", float("inf"))
                ):
                    matched_period = period
                    reason = f"Forecast temperature: {temperature}°C."

            elif alert_type == "strong_wind":
                wind_speed = period.get("wind_speed_mps")

                if wind_speed is not None and wind_speed >= threshold.get("wind_speed_mps", float("inf")):
                    matched_period = period
                    reason = f"Forecast wind speed: {wind_speed} m/s."

            elif alert_type == "frost":
                temperature = period.get("temperature_c")

                if temperature is not None and temperature <= threshold.get("temperature_c", float("-inf")):
                    matched_period = period
                    reason = f"Forecast temperature: {temperature}°C."

            elif alert_type == "storm":
                if period.get("weather_code") == 8000:
                    matched_period = period
                    reason = "The weather forecast indicates thunderstorms."

            if matched_period:
                break

        if matched_period:
            alerts.append({
                "field_id": field_id,
                "alert_type": alert_type,
                "severity": rule["severity"],
                "message": rule["message"],
                "reason": reason,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "unresolved",
            })

    return alerts
def check_drought_risk(
    field_id: str,
    soil_moisture: float,
    rainfall_mm: float,
    drought_thresholds: dict,
):
    """
    Detect possible drought risk using soil moisture
    and rainfall measurements.
    """

    moisture_limit = drought_thresholds.get("soil_moisture_percent")
    rainfall_limit = drought_thresholds.get("rainfall_mm")

    if moisture_limit is None or rainfall_limit is None:
        return None

    if soil_moisture <= moisture_limit and rainfall_mm <= rainfall_limit:
        return {
            "field_id": field_id,
            "alert_type": "drought_risk",
            "severity": "high",
            "message": "Possible drought risk detected.",
            "reason": (
                f"Soil moisture is {soil_moisture}% and "
                f"rainfall is {rainfall_mm} mm."
            ),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "status": "unresolved",
        }

    return None

def check_overwatering(
    field_id: str,
    continuous_wet_hours: float,
):
    """
    Detect possible over-watering based on continuous wet duration.
    """

    from alerts.config import (
        OVERWATERING_WARNING_HOURS,
        OVERWATERING_CRITICAL_HOURS,
    )

    if continuous_wet_hours >= OVERWATERING_CRITICAL_HOURS:
        severity = "high"
        message = "Critical over-watering risk detected."

    elif continuous_wet_hours >= OVERWATERING_WARNING_HOURS:
        severity = "medium"
        message = "Possible over-watering detected."

    else:
        return None

    return {
        "field_id": field_id,
        "alert_type": "overwatering",
        "severity": severity,
        "message": message,
        "reason": (
            f"Soil has remained wet for "
            f"{continuous_wet_hours} hours."
        ),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "unresolved",
    }

def check_sensor_failure(
    field_id: str,
    sensor_id: str,
    last_reading_hours: float,
):
    """
    Detect a sensor that has stopped sending readings.
    """

    if last_reading_hours < 2:
        return None

    severity = "high" if last_reading_hours >= 6 else "medium"

    return {
        "field_id": field_id,
        "alert_type": "sensor_failure",
        "severity": severity,
        "message": "Sensor is not sending readings.",
        "reason": (
            f"Sensor {sensor_id} has not sent data for "
            f"{last_reading_hours} hours."
        ),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "unresolved",
    }
