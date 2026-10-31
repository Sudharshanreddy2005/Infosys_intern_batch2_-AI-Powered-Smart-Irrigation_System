# Model 1 inference

Model 1 is an **experimental synthetic-proxy classifier**, not a validated
irrigation-need model. Its target is `irrigation_needed_proxy`, defined by the
source experiment as `soil_moisture <= 20.0`; the source data is synthetic or
synthetic-augmented. Predictions must not drive irrigation equipment or be
presented as agronomic recommendations.

The runtime exposes two existing contracts:

- The Experimental Model Lab uses the 15-feature
  `random_forest_without_soil_moisture_tuned_candidate_v3.joblib` artifact.
  Features are ordered as stored in the artifact metadata. Numeric missing
  values are median-imputed; categorical values are most-frequent-imputed and
  one-hot encoded.
- The field dashboard uses
  `reduced_weather_proxy_v1.joblib`, with only `temperature_c` and
  `humidity_percent`. The backend obtains these from fresh weather for an
  authenticated, farmer-owned field and applies the artifact's observed-range
  guard before prediction.

The fitted preprocessing pipeline is embedded in each trusted joblib artifact.
`inference.py` validates artifact metadata, feature names, types, finite numeric
values, and categorical values before calling the fitted pipeline. Joblib uses
pickle serialization, so these artifacts must remain trusted project files.

Training scripts, datasets, evaluation reports, and tests remain under
`model-building/`; they are not runtime dependencies.
