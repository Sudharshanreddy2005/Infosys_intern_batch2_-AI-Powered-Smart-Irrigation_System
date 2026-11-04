# AI Model Prediction Input Feature Mapping

## Status and scope

This document records the model input contracts and their verified sources in
the current repository. It is an inspection artifact only; no model, API, or
frontend prediction behavior is changed in this phase.

Training-source availability is incomplete: this checkout contains no Python
training sources under `model-building`; Model 1's README points there, the
Model 2 production loader references an absent package/artifact, and no Model 3
training script or notebook is present. Model 4's training notebook is
available. Where training-time unit semantics or transformations are not
recoverable from the shipped artifacts/configuration, this mapping marks them
unverified rather than inferring them.

The mapping distinguishes:

- **Model features**: columns actually passed to a fitted estimator.
- **Request metadata**: IDs and labels used for ownership checks or display but
  not passed to the estimator.
- **Candidate source**: a project record or service that may contain related
  data, but is not yet a verified, correctly scoped source for the feature.

## Contract summary

| Model | Current AI page endpoint | Exact estimator feature contract | Current automatic availability |
|---|---|---|---|
| Model 1 | `POST /api/ml/reduced-weather-prediction` | `temperature_c`, `humidity_percent` in artifact metadata order | Available from fresh weather at the selected saved field's coordinates, subject to ownership, freshness, and training-range checks. This is an experimental synthetic proxy. |
| Model 2 | `POST /api/ml/water-requirement` | Production endpoint accepts field/crop IDs, but currently does not call an estimator. The legacy artifact's 14-feature order is documented below. | Unavailable: production artifact/integration is absent, and the handler explicitly rejects prediction because validated prediction-time soil-moisture and measured-rainfall sources are unavailable. |
| Model 3 | `POST /api/ml/soil-moisture-prediction` | Zones 1, 2, 3, 5 use the current moisture input with persistence; Zone 4 uses current moisture plus 13 ordered features. | Not fully automatic: current moisture has no authenticated, persisted, farmer-field-linked sensor source. Zone 4 additionally lacks several weather and soil-temperature sources. |
| Model 4 | `POST /api/ml/crop-stress-prediction` | 20 ordered features in `model4/inference.py::FEATURE_NAMES` | Not automatic: the farmer field/crop schema does not store the soil, nutrient, moisture-regime, or plant-category observations required by the artifact. |

## Model 1 — Weather-based prediction

### Active AI page path

The AI page sends only `field_id` to `POST /api/ml/reduced-weather-prediction`.
The backend validates that the field belongs to the authenticated farmer, uses
the saved latitude/longitude to request current weather, and passes the
following estimator features in the artifact's exact order:

| Order | Feature | Estimator type | Current source | Availability/validation |
|---:|---|---|---|---|
| 1 | `temperature_c` | Numeric | Current weather for the selected field coordinates | Required; the backend requires a fresh observation, finite value, and artifact range 8.83–43.68 °C. |
| 2 | `humidity_percent` | Numeric | Current weather for the selected field coordinates | Required; finite percentage 0–100 and artifact range 14.26–99.98. |

The request ID is metadata, not a feature. The backend returns the observation
timestamp and identifies both feature sources as
`selected_field_current_weather_api`. The response marks this model
**Experimental** and its source dataset `synthetic_or_synthetic_augmented`;
the artifact target is the proxy rule `soil_moisture <= 20.0`, not a validated
irrigation recommendation.

The endpoint response now also exposes `feature_inputs`, the exact two-value
record passed to the fitted pipeline. The Model 1 card's expandable
**Model Input Details** section renders those returned values, units, source,
observation time, and availability. It does not make a second weather request
for this card. Switching fields clears the prior values before the next
field-specific request is rendered.

### Separate full-feature Model 1 artifact/API

The repository also contains a separate 15-feature candidate artifact and
`POST /api/models/model1/full/predict`. Its artifact metadata order is:

1. `temperature_c`
2. `humidity_percent`
3. `rain_probability_percent`
4. `N`
5. `P`
6. `K`
7. `ph`
8. `organic_matter`
9. `crop_density`
10. `sunlight_exposure`
11. `wind_speed`
12. `frost_risk`
13. `crop_name`
14. `soil_type`
15. `growth_stage`

The request model requires numeric values for the numeric features, text for
`crop_name`, and integer codes 1–3 for `soil_type` and `growth_stage`.
The fitted pipeline has numeric median imputation and categorical
most-frequent imputation/one-hot encoding. This is not the current AI page's
weather prediction path. The current farmer-field schema does not contain
most of these agricultural measurements; the existing scheduler's crop-stage
conversion is not verified as this artifact's training contract.

## Model 2 — Water requirement prediction

### Current production endpoint contract

The current AI page sends `field_id`, `crop_id`, and
`prediction_period_hours: 24` to `POST /api/ml/water-requirement`. These are
request metadata; they are not estimator features. The backend checks that
the field and crop belong to the authenticated farmer and that the crop is
associated with that field.

The handler does not assemble or call the legacy 14-feature estimator. It
tries to load the separate validated production integration and otherwise
returns HTTP 503. It also explicitly returns HTTP 503 when the required
prediction-time soil-moisture and measured-rainfall sources are unavailable.
The loader references `model-building/models/water_requirement_regressor.joblib`
and an integration package that are not present as source/artifact files in
this checkout.

### Legacy artifact contract (not a currently available production prediction)

`model2/model2_config.json`, the legacy `model2_water_requirement.joblib`
pipeline's `feature_names_in_`, and `Model2Request` agree on this ordered
14-feature record:

| Order | Feature | Contract type/constraint | Candidate source and gap |
|---:|---|---|---|
| 1 | `crop_type` | String/category | `FarmerCrop.name` exists; verify label normalization against training categories before use. |
| 2 | `growth_stage` | Integer 1–3 | `FarmerCrop.growth_stage` is free text. No verified Model 2 stage-code mapping is defined. |
| 3 | `soil_type` | Integer 1–3 | No soil type/code is stored on `FarmerField` or `FarmerCrop`. |
| 4 | `soil_moisture_percent` | Numeric, 0–100 | No verified, persisted sensor reading linked to the authenticated farmer's field is available. |
| 5 | `temperature_c` | Numeric | Current field weather can provide temperature in °C. |
| 6 | `humidity_percent` | Numeric, 0–100 | Current field weather can provide humidity percentage. |
| 7 | `rainfall_mm` | Numeric, nonnegative | Current provider field is rainfall intensity in mm/hour, not an observed accumulated rainfall quantity in mm. It is not interchangeable without a defined interval/source. |
| 8 | `forecast_rainfall_mm` | Numeric, nonnegative | Forecast exposes hourly rainfall intensity and precipitation probability; the model contract does not define the aggregation window in its request schema/config. |
| 9 | `field_area_acres` | Numeric, greater than 0 | `FarmerField.area` and `area_unit` exist; unit conversion is possible when the stored unit is supported. |
| 10 | `irrigation_method` | String/category | Stored on irrigation schedules, not as a field/crop attribute. A per-field selection rule is not defined. |
| 11 | `wind_speed` | Numeric, nonnegative | Current weather exposes `wind_speed_mps`; the Model 2 contract does not document the training unit. |
| 12 | `et0_mm_day` | Numeric, nonnegative | No verified Model 2 feature-preparation source is wired to the active endpoint. |
| 13 | `crop_coefficient_kc` | Numeric, greater than 0 | No verified Model 2 feature-preparation source is wired to the active endpoint. |
| 14 | `previous_irrigation_mm` | Numeric, nonnegative | Schedules store water in liters, not this feature in millimeters; conversion window and effective irrigated area are not defined by the model contract. |

The legacy artifact's config labels the dataset synthetic and reports a
`HistGradientBoostingRegressor`. The existence of this artifact does not
override the production endpoint's explicit no-prediction/503 behavior.

## Model 3 — Future soil moisture

### Shared request metadata and input

`SoilMoisturePredictionRequest` includes `field_id` (positive integer, checked
against the authenticated farmer), `zone` (integer 1–5), and
`current_moisture_percent` (number 1–100). The current-moisture value is a
required model input for every zone.

For Zones 1, 2, 3, and 5, the backend uses a persistence strategy: the returned
24-hour moisture equals the supplied current moisture. No historical series,
weather, crop, or additional estimator feature is used by those zone branches.
Zone 3 additionally returns a limited-data warning.

### Zone 4 estimator features

For Zone 4, the artifact/config order is verified by
`tests/test_model3.py` against the loaded artifact's `feature_names_in_`:

| Order | API request field | Estimator column | Contract type | Verified source status |
|---:|---|---|---|---|
| 1 | `weather_temp` | `weather_temp` | Optional float in schema; required at runtime for Zone 4 | Current weather has temperature in °C; mapping to the training feature still needs training-unit confirmation. |
| 2 | `weather_humidity` | `weather_humidity` | Optional float; required for Zone 4 | Current weather has humidity percentage. |
| 3 | `weather_rain` | `weather_rain` | Optional float; required for Zone 4 | Provider has current rainfall intensity and forecast rainfall intensity; the artifact's exact rain meaning/unit is not documented in this checkout. |
| 4 | `weather_pressure` | `weather_pressure` | Optional float; required for Zone 4 | Not returned by the existing current/forecast weather adapter. |
| 5 | `weather_wind_speed` | `weather_wind_speed` | Optional float; required for Zone 4 | Current provider has wind speed in m/s; training unit is not documented in the artifact config. |
| 6 | `weather_radiation` | `weather_radiation` | Optional float; required for Zone 4 | Not returned by the existing current/forecast weather adapter. |
| 7 | `soil_temperature_0_7cm` | `soil_temperature_0-7cm` | Optional float; required for Zone 4 | No verified soil-temperature sensor source is linked to a farmer field. |
| 8 | `soil_temperature_7_18cm` | `soil_temperature_7-18cm` | Optional float; required for Zone 4 | No verified soil-temperature sensor source is linked to a farmer field. |
| 9 | `month` | `month` | Optional integer 1–12; required for Zone 4 | Calendar derivation requires an explicit prediction timezone/clock convention. |
| 10 | `day` | `day` | Optional integer 1–31; required for Zone 4 | Calendar derivation requires an explicit prediction timezone/clock convention. |
| 11 | `hour` | `hour` | Optional integer 0–23; required for Zone 4 | Calendar derivation requires an explicit prediction timezone/clock convention. |
| 12 | `day_period` | `day_period` | Optional integer; required for Zone 4 | No definition or code mapping for this feature is documented. |
| 13 | `quarter` | `quarter` | Optional integer 1–4; required for Zone 4 | Calendar derivation requires an explicit prediction timezone/clock convention. |

`current_moisture_percent` is the current baseline input, not one of the
artifact's 13 Zone 4 columns. The backend adds the estimated change to this
baseline and clips the resulting percentage to 1–100. The backend response
warns that the training target/calculation interpretation needs confirmation.
There is no established current or historical soil-moisture source in the
main application's authenticated field data.

## Model 4 — Crop stress risk

### Estimator feature order

The following exact order is defined by `model4/inference.py::FEATURE_NAMES`,
checked against the loaded artifact in `tests/test_model4.py`, and used to
build the estimator dataframe:

| Order | Feature | Type / learned category values | Farmer-field source status |
|---:|---|---|---|
| 1 | `soil_type` | String; artifact categories: Alluvial, Chalky, Clayey, Laterite, Loamy, Peaty, Saline, Sandy, Silty | Not stored on the farmer field/crop. |
| 2 | `bulk_density` | Numeric | Not stored; no verified field-linked measurement source. |
| 3 | `organic_matter_pct` | Numeric | Not stored; no verified field-linked measurement source. |
| 4 | `cation_exchange_capacity` | Numeric | Not stored; no verified field-linked measurement source. |
| 5 | `salinity_ec` | Numeric | Not stored; no verified field-linked measurement source. |
| 6 | `buffering_capacity` | Numeric | Not stored; no verified field-linked measurement source. |
| 7 | `soil_moisture_pct` | Numeric | No verified persisted field-linked sensor source. |
| 8 | `moisture_limit_dry` | Numeric | Not stored; no verified field-linked measurement/source. |
| 9 | `moisture_limit_wet` | Numeric | Not stored; no verified field-linked measurement/source. |
| 10 | `moisture_regime` | String; artifact categories: dry, optimal, waterlogged | Not stored; must not be inferred from absent data. |
| 11 | `soil_temp_c` | Numeric | No verified field-linked soil-temperature source. |
| 12 | `air_temp_c` | Numeric | Field weather can provide temperature; exact training-time alignment is not established. |
| 13 | `thermal_regime` | String; artifact categories: cold, heat_stress, optimal | Not stored; must not be inferred from absent data. |
| 14 | `light_intensity_par` | Numeric | Not returned by the weather adapter or stored for the field. |
| 15 | `soil_ph` | Numeric | Not stored; no verified field-linked measurement source. |
| 16 | `nitrogen_ppm` | Numeric | Not stored; no verified field-linked measurement source. |
| 17 | `phosphorus_ppm` | Numeric | Not stored; no verified field-linked measurement source. |
| 18 | `potassium_ppm` | Numeric | Not stored; no verified field-linked measurement source. |
| 19 | `nutrient_balance` | String; artifact categories: deficient, excessive, optimal | Not stored; must not be inferred from absent data. |
| 20 | `plant_category` | String; artifact categories: cereal, legume, vegetable | Farmer crop name exists, but no verified crop-name-to-training-category mapping is defined. |

The authenticated prediction request also requires `field_id`, `crop_type`, and
`zone`. These values are validated/returned as request metadata and are not
among the 20 estimator features. The inference helper preserves the exact
feature order. The fitted pipeline uses median numeric imputation and
most-frequent categorical imputation plus one-hot encoding; however, the
authenticated Pydantic request currently requires all 20 feature values, so
this preprocessing does not make missing request fields optional. The
artifact's numeric class meanings remain unverified.

## Verified application data sources and limitations

### Authenticated records

- `FarmerField` stores farmer ownership, numeric field ID, name, optional
  crop-name text, area/unit, location, and optional coordinates. It has no soil
  or sensor fields.
- `FarmerCrop` stores farmer/field IDs, crop name, optional variety, planting
  and expected harvest dates, and free-text growth stage. It has no measured
  irrigation method, soil, nutrient, or sensor fields.
- `IrrigationSchedule` stores owner/field IDs, scheduled date, water liters,
  irrigation method, status, and a plan snapshot. It does not define how to
  convert schedule history to Model 2's `previous_irrigation_mm`.
- Backend field/crop ownership checks exist and should remain the authority
  for any future automatic collection.

### Weather

The existing provider adapter exposes current-field weather:
temperature °C, humidity %, rainfall intensity mm/hour, precipitation
probability %, wind speed m/s, weather code, observation time, and cache/stale
metadata. Its forecast adapter exposes per-entry time, temperature, humidity,
rain intensity, and precipitation probability. The adapters do not expose
pressure, solar radiation, or soil temperature. Field-specific prediction
must use the selected field's saved coordinates and preserve weather freshness
checks.

### Sensor readings

- The root `/sensor-readings` endpoint selects the latest rows from
  `sensor_readings` without authentication or a farmer/field filter and marks
  them historical (`is_live: false`). The ORM has no corresponding
  field-owned sensor-reading model, so this endpoint cannot establish that a
  row belongs to the selected authenticated field.
- `sensor-ingestion/README.md` states that its initial service does not store
  readings. Its API accepts string `field_id`, string `sensor_id`, a
  `soil_moisture` value, and a timestamp, then returns the validated input;
  it does not authenticate ownership or persist the reading.
- Its included simulator generates a random moisture value. Its included
  8,500-row CSVs mark every row
  `synthetic_or_synthetic_augmented`, with string field IDs; these rows must
  not be represented as real readings for a farmer's integer field ID.

## Readiness conclusion

Automatic predictions for all four models cannot currently be implemented
without making up values or bypassing existing model-integrity safeguards:

1. Model 1's active two-feature weather proxy can already collect its exact
   features from the owned field's coordinates. The separate 15-feature
   candidate path lacks verified sources for many features.
2. Model 2's active production endpoint is explicitly unavailable and the
   checked-in legacy artifact is a synthetic-data model, not the validated
   production integration. Its feature units/source semantics also need
   confirmation before automatic mapping.
3. Model 3 needs a persisted, authenticated reading linked to the selected
   field; Zone 4 further requires weather fields that the existing adapter
   does not expose and soil temperatures with no current source.
4. Model 4 needs a verified source for its 20 soil, nutrient, and plant
   features; the current farmer field/crop records and sensor-ingestion
   service do not provide those observations.

No values from a different field, the synthetic dataset, or generated defaults
can safely fill these gaps. The next implementation phase requires a verified
field-linked sensor/soil data source and an approved Model 2 production
artifact/feature-preparation contract. Model 3's zone-4 feature units,
`day_period` definition, target interpretation, and timezone must also be
confirmed before automatically constructing those inputs.

## Evidence inspected

- `main.py`, `schemas.py`, `models.py`
- `static/ai-model-dashboard.js`, `static/ai-model-dashboard.html`
- `model1/inference.py`, `model1/README.md`, and both Model 1 artifact metadata
- `model2/model2_config.json`, `model2/model2_water_requirement.joblib`,
  `model2_integration.py`
- `model3/model3_config.json`, `model3/zone4_ridge.joblib`,
  `tests/test_model3.py`
- `model4/inference.py`, `model4/model4.ipynb`, `model4/model4_crop_stress.joblib`,
  `tests/test_model4.py`
- `weather_api/integrations/weather_api.py`
- `sensor-ingestion/README.md`, its API/schema/simulator, and the CSV cleaning
  report/data-origin fields
