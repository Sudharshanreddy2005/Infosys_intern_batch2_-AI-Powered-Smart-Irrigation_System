"""
All tunable values live here. Change them here instead of hardcoding them in the logic.

NOTE: These are approximate FAO-56 / textbook numbers.
Verify them with a local agronomist / KVK before any real deployment.
"""

# ---- Crop data -------------------------------------------------------------
# kc   : crop coefficient per growth stage (ETc = ET0 * kc)
# root_depth_m : effective root zone depth
# mad  : management allowed depletion (fraction of TAW the crop can lose
#        without stress). Irrigate once depletion goes beyond this.
CROPS = {
    "wheat":     {"kc": {"initial": 0.40, "mid": 1.15, "late": 0.35}, "root_depth_m": 1.0, "mad": 0.55},
    "maize":     {"kc": {"initial": 0.40, "mid": 1.20, "late": 0.60}, "root_depth_m": 1.0, "mad": 0.55},
    "potato":    {"kc": {"initial": 0.50, "mid": 1.15, "late": 0.75}, "root_depth_m": 0.6, "mad": 0.35},
    "sugarcane": {"kc": {"initial": 0.40, "mid": 1.25, "late": 0.75}, "root_depth_m": 1.2, "mad": 0.65},
    # --- crop labels used in the team dataset (data/cleaned_dataset.csv) ---
    "cotton":     {"kc": {"initial": 0.35, "mid": 1.15, "late": 0.70}, "root_depth_m": 1.0, "mad": 0.65},
    "chickpea":   {"kc": {"initial": 0.40, "mid": 1.15, "late": 0.35}, "root_depth_m": 0.8, "mad": 0.50},
    "lentil":     {"kc": {"initial": 0.40, "mid": 1.10, "late": 0.35}, "root_depth_m": 0.8, "mad": 0.50},
    "mungbean":   {"kc": {"initial": 0.40, "mid": 1.15, "late": 0.35}, "root_depth_m": 0.6, "mad": 0.45},
    "blackgram":  {"kc": {"initial": 0.40, "mid": 1.15, "late": 0.35}, "root_depth_m": 0.6, "mad": 0.45},
    "mothbeans":  {"kc": {"initial": 0.40, "mid": 1.15, "late": 0.35}, "root_depth_m": 0.6, "mad": 0.45},
    "kidneybeans": {"kc": {"initial": 0.40, "mid": 1.15, "late": 0.35}, "root_depth_m": 0.6, "mad": 0.45},
    "pigeonpeas": {"kc": {"initial": 0.40, "mid": 1.15, "late": 0.35}, "root_depth_m": 1.0, "mad": 0.50},
    "watermelon": {"kc": {"initial": 0.40, "mid": 1.00, "late": 0.75}, "root_depth_m": 1.0, "mad": 0.40},
    "muskmelon":  {"kc": {"initial": 0.50, "mid": 1.05, "late": 0.75}, "root_depth_m": 1.0, "mad": 0.40},
    "banana":     {"kc": {"initial": 0.50, "mid": 1.10, "late": 1.00}, "root_depth_m": 0.9, "mad": 0.35},
    "rice":       {"kc": {"initial": 1.05, "mid": 1.20, "late": 0.90}, "root_depth_m": 0.5, "mad": 0.20,
                   "note": "Rice: ponded (standing) water is not modelled - treat this plan as indicative only"},
}
# These dataset crops are not configured yet (perennial/orchard crops, or Kc data not verified):
# jute, mango, grapes, apple, orange, papaya, pomegranate, coconut, coffee
# Get Kc / root depth / MAD values for them from an agronomist and add them above.

# ---- Soil data (volumetric fraction, m3/m3) -------------------------------
# fc = field capacity, wp = wilting point
SOILS = {
    "sandy":      {"fc": 0.12, "wp": 0.05},
    "clay":       {"fc": 0.38, "wp": 0.22},
    "sandy_loam": {"fc": 0.23, "wp": 0.10},
    "loam":       {"fc": 0.30, "wp": 0.14},
    "silt_loam":  {"fc": 0.33, "wp": 0.13},
    "clay_loam":  {"fc": 0.36, "wp": 0.20},
}

# ---- Irrigation method efficiency (net water / gross water) ---------------
METHOD_EFFICIENCY = {
    "drip": 0.90,
    "sprinkler": 0.75,
    "surface": 0.60,   # flood / furrow
}

# ---- Rainfall handling -----------------------------------------------------
RAIN_PROB_THRESHOLD = 0.50    # rain with a lower probability than this is ignored
MIN_EFFECTIVE_RAIN_MM = 3.0   # lighter rain than this does not reach the root zone
RAIN_EFFICIENCY = 0.80        # share of rainfall that actually benefits the crop

# ---- Irrigation limit (per-event maximum, as agreed with the team leader) ---
# Maximum net water (mm) applied to the crop in one irrigation event.
# Any leftover deficit is RECALCULATED the next day from the latest soil moisture,
# rainfall and weather (it is not blindly carried over).
# 60 is only an example value. Validate it per crop and soil type before finalizing.
# To use a different limit for one field, pass FieldConfig(max_event_mm=...).
MAX_IRRIGATION_MM_PER_EVENT = 60.0

# ---- Scheduling ------------------------------------------------------------
# (start_minute, end_minute) from midnight. 05:00-08:00 and 17:00-19:30
IRRIGATION_WINDOWS = [(5 * 60, 8 * 60), (17 * 60, 19 * 60 + 30)]
MAX_SESSION_MIN = 90          # maximum length of one session (to avoid runoff)
MIN_SESSION_MIN = 10          # do not schedule fragments shorter than this
REST_BETWEEN_SESSIONS_MIN = 30  # rest gap between two sessions of the same field

# ---- Misc ------------------------------------------------------------------
GSC = 0.0820                  # solar constant, MJ m-2 min-1 (FAO-56)
