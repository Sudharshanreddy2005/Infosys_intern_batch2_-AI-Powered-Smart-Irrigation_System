import json
import math
import os


def _read_boolean(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().casefold()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off", ""}:
        return False
    raise RuntimeError(f"{name} must be a boolean value.")


def _load_field_thresholds() -> dict[str, dict[str, float | bool]]:
    raw = os.getenv("FIELD_SOIL_MOISTURE_THRESHOLDS", "{}")
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError("FIELD_SOIL_MOISTURE_THRESHOLDS must be valid JSON.") from error
    if not isinstance(values, dict):
        raise RuntimeError("FIELD_SOIL_MOISTURE_THRESHOLDS must be a JSON object.")

    thresholds: dict[str, dict[str, float | bool]] = {}
    for field_id, threshold in values.items():
        if (
            not str(field_id).isdigit()
            or isinstance(threshold, bool)
            or not isinstance(threshold, (int, float))
        ):
            raise RuntimeError("Field threshold keys and values must be numeric.")
        numeric_threshold = float(threshold)
        if not math.isfinite(numeric_threshold) or not 0 <= numeric_threshold <= 100:
            raise RuntimeError("Soil moisture thresholds must be between 0 and 100.")
        normalized_field_id = str(int(field_id))
        if normalized_field_id in thresholds:
            raise RuntimeError("Field threshold IDs must not be duplicated.")
        thresholds[normalized_field_id] = {
            "irrigation_trigger": numeric_threshold,
            "is_validated": True,
        }
    return thresholds


def notifications_enabled() -> bool:
    environment = os.getenv("APP_ENV", "development").strip().casefold()
    if environment in {"test", "testing"}:
        return False
    return _read_boolean("NOTIFICATION_DELIVERY_ENABLED", False)


FIELD_THRESHOLDS = _load_field_thresholds()

WEATHER_ALERT_THRESHOLDS = {
    "heavy_rain": {
        "rain_probability_percent": 70,
        "rainfall_mm_per_hr": 5.0,
    },
    "high_temperature": {"temperature_c": 35.0},
    "heatwave": {"temperature_c": 40.0},
    "strong_wind": {"wind_speed_mps": 15.0},
    "frost": {"temperature_c": 2.0},
    "drought": {"rainfall_mm": 5.0, "soil_moisture_percent": 20.0},
}
OVERWATERING_WARNING_HOURS = 6
OVERWATERING_CRITICAL_HOURS = 12
