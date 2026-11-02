"""Pure functions with no state, so they are easy to test."""
import math
from datetime import date

from . import config
from .models import FieldConfig


# ---------- ET0 -------------------------------------------------------------
def extraterrestrial_radiation_mm(lat_deg: float, day: date) -> float:
    """FAO-56 Eq.21. Ra in mm/day (equivalent evaporation)."""
    j = day.timetuple().tm_yday
    phi = math.radians(lat_deg)
    dr = 1 + 0.033 * math.cos(2 * math.pi * j / 365)
    delta = 0.409 * math.sin(2 * math.pi * j / 365 - 1.39)
    x = max(-1.0, min(1.0, -math.tan(phi) * math.tan(delta)))
    ws = math.acos(x)
    ra_mj = (24 * 60 / math.pi) * config.GSC * dr * (
        ws * math.sin(phi) * math.sin(delta)
        + math.cos(phi) * math.cos(delta) * math.sin(ws)
    )
    return 0.408 * ra_mj


def hargreaves_et0(tmin: float, tmax: float, lat_deg: float, day: date) -> float:
    """Hargreaves-Samani: needs only temperature and latitude."""
    tmean = (tmin + tmax) / 2
    ra = extraterrestrial_radiation_mm(lat_deg, day)
    return max(0.0, 0.0023 * (tmean + 17.8) * math.sqrt(max(tmax - tmin, 0.0)) * ra)


# ---------- Crop water need -------------------------------------------------
def crop_params(crop: str) -> dict:
    try:
        return config.CROPS[crop]
    except KeyError:
        raise ValueError(
            f"Crop '{crop}' is not in config.CROPS. Supported: {sorted(config.CROPS)}")


def get_kc(f: FieldConfig) -> float:
    if f.kc_override is not None:
        return f.kc_override
    stages = crop_params(f.crop)["kc"]
    if f.growth_stage == "development":
        # Vegetative stage: Kc rises from initial to mid (as in FAO-56) -> use the midpoint
        return (stages["initial"] + stages["mid"]) / 2
    if f.growth_stage not in stages:
        raise ValueError(
            f"Invalid growth_stage '{f.growth_stage}'. Use: initial, development, mid, late")
    return stages[f.growth_stage]


def crop_etc(et0: float, kc: float) -> float:
    return et0 * kc


# ---------- Rainfall --------------------------------------------------------
def effective_rainfall(rain_mm: float, rain_prob: float) -> float:
    """Rainfall that actually benefits the crop."""
    if rain_prob < config.RAIN_PROB_THRESHOLD:
        return 0.0
    if rain_mm < config.MIN_EFFECTIVE_RAIN_MM:
        return 0.0
    return rain_mm * config.RAIN_EFFICIENCY


# ---------- Soil water ------------------------------------------------------
def _soil(name: str) -> dict:
    try:
        return config.SOILS[name]
    except KeyError:
        raise ValueError(f"Soil '{name}' is not in config.SOILS. Supported: {sorted(config.SOILS)}")


def soil_water_limits(f: FieldConfig):
    """Returns (taw_mm, raw_mm). TAW = total available water in root zone."""
    soil = _soil(f.soil_type)
    crop = crop_params(f.crop)
    taw = (soil["fc"] - soil["wp"]) * crop["root_depth_m"] * 1000
    raw = crop["mad"] * taw
    return taw, raw


def initial_depletion(f: FieldConfig, taw: float):
    """Starting depletion (mm) from the sensor reading. Returns (depletion, warning|None)."""
    if f.soil_moisture is None:
        return 0.0, "No soil moisture reading available - assuming the soil is at field capacity"
    soil = _soil(f.soil_type)
    root_mm = crop_params(f.crop)["root_depth_m"] * 1000
    dep = (soil["fc"] - f.soil_moisture) * root_mm
    return max(0.0, min(dep, taw)), None


# ---------- Volume / time ---------------------------------------------------
def gross_litres(net_mm: float, f: FieldConfig) -> float:
    """1 mm over 1 m2 = 1 litre. Divide by system efficiency to get gross litres."""
    eff = config.METHOD_EFFICIENCY[f.irrigation_method]
    return net_mm * f.area_m2 / eff


def net_mm_from_litres(litres: float, f: FieldConfig) -> float:
    eff = config.METHOD_EFFICIENCY[f.irrigation_method]
    return litres * eff / f.area_m2
