# AI Powered Smart Irrigation System

## Model 4 - Crop Stress Prediction

The trained Model 4 artifact is hosted on Google Drive because of its large file size.

### Download Model 4 Artifacts

Google Drive Link:
https://drive.google.com/file/d/1JSoEdI4IDeT8u30In2NT1WVHce19R4hI/view

The ZIP file contains:
- model4_crop_stress.joblib
- evaluation_metrics.json
- feature_importance.csv
- model_comparison.csv

### Setup Instructions

1. Download the ZIP file from Google Drive.
2. Extract the ZIP file.
3. Copy model4_crop_stress.joblib into the project root directory (same folder as main.py).
4. Install the project dependencies.
5. Start the FastAPI backend.

### Model 4 API Endpoint

POST /api/models/model4/predict

Note: The trained model artifact must be present locally before starting the backend.