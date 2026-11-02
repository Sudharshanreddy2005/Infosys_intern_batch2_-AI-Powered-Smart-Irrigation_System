# Milestone 2 — Data Preparation & Feature Engineering

## Overview

This module prepares Smart Irrigation data for the Milestone 2 machine-learning workflow. It contains the original demonstration preparation workflow and a separate water-requirement simulation workflow.

## Existing preparation workflow

The original workflow inspects data quality, prepares features, and creates demonstration datasets using an irrigation-need proxy.

Main outputs:

- `output/cleaned_dataset_m2.csv`
- `output/model_ready/features_all.csv`
- `output/model_ready/proxy_target_all.csv`
- `output/model_ready/X_train_demo.csv`
- `output/model_ready/X_test_demo.csv`
- `output/model_ready/y_train_proxy_demo.csv`
- `output/model_ready/y_test_proxy_demo.csv`

The `irrigation_needed_proxy` target uses the illustrative rule `soil_moisture <= 20.0`. It is not validated ground truth. Because soil moisture is also an input feature, model performance against this proxy must not be interpreted as genuine irrigation-prediction accuracy.

## Separate water-requirement simulation workflow

Run from the repository root:

```powershell
python "sensor-ingestion\data-preparation\prepare_model2_dataset.py"
```

The script reads the original raw CSV without modifying it and generates a separate dataset.

Main outputs:

- `output/model2/model2_dataset.csv`
- `output/model2/X_train.csv`
- `output/model2/X_test.csv`
- `output/model2/y_train.csv`
- `output/model2/y_test.csv`
- `output/model2/feature_manifest.csv`
- `reports/model2_dataset_report.txt`

The prepared dataset contains 8,500 rows, 14 model input features, trace columns, the target `required_water_liters`, and provenance fields. The chronological split contains 6,800 training rows and 1,700 test rows.

The target represents simulated required water in litres per 24 hours. It is generated from illustrative demand assumptions with added variability; it is not measured water demand or validated ground truth.

## Important limitations

- The source data is synthetic or synthetic-augmented.
- Forecast rainfall, field area, irrigation method, reference evapotranspiration (ET0), crop coefficient, and previous irrigation are simulated inputs in the water-requirement workflow.
- The rainfall conversion assumes the source rainfall rate is in mm/hour and represents a one-hour period. Confirm this assumption with the team.
- Confirm wind-speed units and source measurement definitions before interpreting the features.
- Performance scores against either proxy or simulated targets measure agreement with the constructed target, not verified real-world irrigation accuracy.
- Replace simulated inputs and targets with validated observations before making real-world accuracy claims.
- `water_used_liters` must not be treated as required water without evidence that it represents that quantity.

## Reports

The `reports/` directory contains the data inspection, quality, target assessment, feature-engineering, and Model 2 preparation reports.
