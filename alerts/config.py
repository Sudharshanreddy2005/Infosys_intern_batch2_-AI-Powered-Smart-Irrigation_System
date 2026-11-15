
"""
Alert configuration.
Actual field-specific thresholds will be added after validation.
"""

# No verified field thresholds are available yet.
# TEMPORARY DEVELOPMENT TEST ONLY.
# Replace with validated field-specific thresholds later.
FIELD_THRESHOLDS = {
    "1": {
        "irrigation_trigger": 30.0,
        "is_validated": True,
    },
    "2": {
        "irrigation_trigger": None,
        "is_validated": False,
    },
    "3": {
        "irrigation_trigger": None,
        "is_validated": False,
    },
}

# Prevent real farmer notifications for now.
ALLOW_REAL_NOTIFICATIONS = True

# Overwatering duration rules from the team lead.
OVERWATERING_WARNING_HOURS = 6
OVERWATERING_CRITICAL_HOURS = 12

# Weather alert thresholds (initial development defaults only).
# These must be validated before real farmer notifications.

WEATHER_ALERT_THRESHOLDS = {
    "heavy_rain": {
        "rain_probability_percent": 70,
        "rainfall_mm_per_hr": 5.0,
    },
    "heatwave": {
        "temperature_c": 40.0,
    },
    "strong_wind": {
        "wind_speed_mps": 15.0,
    },
    "frost": {
        "temperature_c": 2.0,
    },
    "drought": {
        "rainfall_mm": 5.0,
        "soil_moisture_percent": 20.0,
},
}
