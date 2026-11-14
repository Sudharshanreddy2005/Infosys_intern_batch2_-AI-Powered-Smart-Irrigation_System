from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from .data_pipeline import PROJECT_ROOT
from .predict import CropDiseasePredictor, DEFAULT_UNCERTAINTY_THRESHOLD


MODEL_DIR = PROJECT_ROOT / "models" / "crop_disease"
MODEL_PATH = Path(
    os.environ.get(
        "CROP_DISEASE_MODEL_PATH",
        str(MODEL_DIR / "best_crop_disease_model.keras"),
    )
)
CLASS_MAPPING_PATH = Path(
    os.environ.get(
        "CROP_DISEASE_CLASS_MAPPING_PATH",
        str(MODEL_DIR / "class_mapping.json"),
    )
)
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class RankedPrediction(BaseModel):
    class_name: str
    crop_name: str
    disease_name: str
    confidence: float


class CropDiseasePrediction(BaseModel):
    crop_name: str
    disease_name: str
    confidence: float
    top_three_predictions: list[RankedPrediction]
    is_uncertain: bool
    uncertainty_status: str


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    try:
        threshold = float(
            os.environ.get(
                "CROP_DISEASE_UNCERTAINTY_THRESHOLD",
                str(DEFAULT_UNCERTAINTY_THRESHOLD),
            )
        )
    except ValueError as error:
        raise ValueError("CROP_DISEASE_UNCERTAINTY_THRESHOLD must be numeric.") from error
    app.state.crop_disease_predictor = CropDiseasePredictor.from_paths(
        MODEL_PATH,
        CLASS_MAPPING_PATH,
        uncertainty_threshold=threshold,
    )
    yield
    del app.state.crop_disease_predictor


app = FastAPI(
    title="Isolated Crop Disease Prediction API",
    lifespan=lifespan,
)


@app.post(
    "/api/crop-disease/predict",
    response_model=CropDiseasePrediction,
)
async def predict_crop_disease(
    request: Request,
    image: UploadFile = File(...),
) -> CropDiseasePrediction:
    image_bytes = await image.read(MAX_UPLOAD_BYTES + 1)
    await image.close()
    if len(image_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image upload exceeds the 10 MB limit.")
    predictor: CropDiseasePredictor = request.app.state.crop_disease_predictor
    try:
        result = await run_in_threadpool(predictor.predict_bytes, image_bytes)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return CropDiseasePrediction(**result)
