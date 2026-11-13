export type FarmerProfile = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  state: string | null;
  district: string | null;
  village: string | null;
};

export type FarmField = {
  id: number;
  name: string;
  crop: string | null;
  area: number;
  area_unit: "acres" | "hectares" | string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  soil_moisture_percent?: number | null;
  last_sensor_update?: string | null;
  created_at: string;
  updated_at: string;
};

export type FarmCrop = {
  id: number;
  field_id: number | null;
  name: string;
  variety: string | null;
  planting_date: string | null;
  expected_harvest_date: string | null;
  growth_stage: string | null;
  created_at: string;
  updated_at: string;
};

export type SchedulePlan = {
  action?: string;
  notes?: string[];
  reason?: string;
};

export type IrrigationSchedule = {
  id: number;
  field_id: number;
  field_name: string;
  crop_name: string;
  reservoir_id: number;
  scheduled_date: string;
  start_time: string | null;
  end_time: string | null;
  water_liters: number;
  duration_minutes: number;
  irrigation_method: string;
  status: "recommended" | "insufficient_water" | "confirmed" | "completed" | "cancelled" | string;
  plan: SchedulePlan | null;
  created_at: string;
  updated_at: string;
};

export type ScheduleListResponse = {
  schedules: IrrigationSchedule[];
  summary: {
    total_scheduled_liters: number;
    total_reserved_liters: number;
    remaining_available_liters: number;
    upcoming_events: number;
    completed_events: number;
  };
};

export type IrrigationReservoirSummary = {
  id: number;
  farmer_id: number;
  field_id: number | null;
  name: string;
  capacity_liters: number;
  available_liters: number;
  reserved_liters: number;
  remaining_liters: number;
  updated_at: string;
};

export type ScheduleActionResponse = {
  schedule: IrrigationSchedule;
  reservoir: IrrigationReservoirSummary;
};

export type ScheduleAction = "confirm" | "cancel" | "complete";

export type CurrentWeather = {
  location?: string;
  locality?: string | null;
  temperature_c?: number | null;
  feels_like_c?: number | null;
  weather_code?: number | null;
  humidity_percent?: number | null;
  rainfall_mm_per_hr?: number | null;
  precipitation_probability_percent?: number | null;
  wind_speed_mps?: number | null;
  observation_time?: string | null;
  is_stale?: boolean;
  data_age_minutes?: number;
};

export type ForecastPeriod = {
  time: string;
  temperature_c?: number | null;
  feels_like_c?: number | null;
  temperature_high_c?: number | null;
  temperature_low_c?: number | null;
  weather_code?: number | null;
  humidity_percent?: number | null;
  rainfall_mm_per_hr?: number | null;
  rain_probability_percent?: number | null;
  is_stale?: boolean;
  data_age_minutes?: number;
};

export type ForecastResponse = {
  location: string;
  hours: number | null;
  timestep: "1h" | "1d";
  periods: number;
  data: ForecastPeriod[];
  is_stale: boolean;
  data_age_minutes: number;
};

export type FarmSnapshot = {
  profile: FarmerProfile;
  fields: FarmField[];
  crops: FarmCrop[];
  schedules: IrrigationSchedule[];
  weather: CurrentWeather | null;
  weatherUpdatedAt?: string | null;
  weatherTemporarilyUnavailable?: boolean;
  hourlyForecast: ForecastResponse | null;
  dailyForecast: ForecastResponse | null;
  lastUpdated: string;
};

export type FarmerProfileUpdate = Pick<FarmerProfile, "name" | "phone" | "state" | "district" | "village">;

export type FieldCreatePayload = {
  name: string;
  crop: string | null;
  area: number;
  area_unit: "acres" | "hectares";
  location: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type FieldPatchPayload = Partial<FieldCreatePayload>;

export type CropCreatePayload = {
  name: string;
  variety: string | null;
  planting_date: string | null;
  expected_harvest_date: string | null;
  growth_stage: string | null;
  field_id: number | null;
};

export type CropPatchPayload = Partial<CropCreatePayload>;

export type FarmerRegistration = {
  name: string;
  email: string;
  password: string;
  phone?: string;
  state?: string;
  district?: string;
  village?: string;
};

export type ApiValidationIssue = { field: string; message: string };
export type ApiError = Error & { status?: number; validationErrors?: ApiValidationIssue[] };
