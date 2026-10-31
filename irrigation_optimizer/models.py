from dataclasses import dataclass, field
from datetime import date
from typing import List, Optional


@dataclass
class FieldConfig:
    field_id: str
    crop: str                       # key of config.CROPS
    growth_stage: str               # "initial" | "development" | "mid" | "late"
    area_m2: float
    soil_type: str                  # key of config.SOILS
    latitude: float                 # degrees (Muzaffarpur ~ 26.12)
    irrigation_method: str          # "drip" | "sprinkler" | "surface"
    pump_flow_lpm: float            # litres per minute
    pump_id: str = "pump-1"         # fields sharing a pump use the same id
    soil_moisture: Optional[float] = None   # volumetric fraction 0-1 (sensor)
    kc_override: Optional[float] = None     # optional Kc from an ML model / agronomist
    max_event_mm: Optional[float] = None    # per-event cap for this field (None = config default)


@dataclass
class DailyForecast:
    date: date
    temp_min: float                 # deg C
    temp_max: float                 # deg C
    rain_mm: float = 0.0
    rain_prob: float = 1.0          # 0-1. Use 1.0 if the API gives no probability
    et0_mm: Optional[float] = None  # set this if the API provides ET0


@dataclass
class Session:
    start: str                      # "HH:MM"
    end: str
    minutes: int
    litres: float


@dataclass
class DayPlan:
    field_id: str
    date: date
    action: str     # irrigate | skip_no_need | skip_rain | deferred_rain
    et0_mm: float
    kc: float
    etc_mm: float
    rain_mm: float
    effective_rain_mm: float
    depletion_start_mm: float
    depletion_end_mm: float
    raw_mm: float
    taw_mm: float
    net_mm: float = 0.0             # water that actually reaches the crop
    litres: float = 0.0             # water pumped out (includes system efficiency losses)
    sessions: List[Session] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
    