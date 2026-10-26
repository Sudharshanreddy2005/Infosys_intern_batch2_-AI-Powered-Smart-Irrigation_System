
# Milestone 2 — Data Preparation & Feature Engineering

## Overview

This module prepares the Smart Irrigation dataset for the machine-learning workflow.

## Work completed

* Inspected the dataset and generated data-quality reports.
* Checked missing values, duplicates, and data consistency.
* Investigated redundant and potentially ambiguous columns.
* Selected 16 initial input features: 13 numerical and 3 categorical.
* Generated model-ready feature and proxy-target datasets.
* Created an 80/20 chronological train/test split.
* Documented data limitations and preprocessing requirements.

## Main outputs

* `output/cleaned_dataset_m2.csv`
* `output/model_ready/features_all.csv`
* `output/model_ready/proxy_target_all.csv`
* `output/model_ready/X_train_demo.csv`
* `output/model_ready/X_test_demo.csv`
* `output/model_ready/y_train_proxy_demo.csv`
* `output/model_ready/y_test_proxy_demo.csv`

## Reports

See the `reports/` directory for the inspection, preparation, target assessment, feature dictionary, and feature-engineering reports.

## Important limitations

The dataset is synthetic or synthetic-augmented. The `irrigation_needed_proxy` target is generated using the illustrative rule `soil_moisture <= 20.0`; it is not validated ground truth. Since soil moisture is included in the input features, model scores against this proxy should not be interpreted as genuine irrigation prediction accuracy.

No validated required-water target has been created. `water_used_liters` must not be assumed to represent required water.
