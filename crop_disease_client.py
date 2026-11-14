import math
import os
from typing import Literal
from urllib.parse import urlsplit

import httpx2
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


MAX_CROP_IMAGE_BYTES = 10 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


class RankedDiseasePrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    crop: str = Field(min_length=1, max_length=100)
    disease: str = Field(min_length=1, max_length=160)
    confidence: float = Field(ge=0, le=100, allow_inf_nan=False)


class LegacyRankedDiseasePrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    class_name: str = Field(min_length=1, max_length=160)
    crop_name: str = Field(min_length=1, max_length=100)
    disease_name: str = Field(min_length=1, max_length=160)
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)


class CropDiseaseServiceResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: Literal[True]
    predicted_crop: str = Field(min_length=1, max_length=100)
    predicted_disease: str = Field(min_length=1, max_length=160)
    confidence: float = Field(ge=0, le=100, allow_inf_nan=False)
    is_uncertain: bool
    uncertainty_warning: str | None = Field(default=None, max_length=500)
    top_predictions: list[RankedDiseasePrediction] = Field(min_length=3, max_length=3)
    top_three_predictions: list[LegacyRankedDiseasePrediction] = Field(min_length=3, max_length=3)

    @model_validator(mode="after")
    def validate_consistency(self):
        if not self.is_uncertain and self.uncertainty_warning:
            raise ValueError("The disease service returned inconsistent uncertainty fields.")
        for primary, legacy in zip(self.top_predictions, self.top_three_predictions, strict=True):
            if (
                primary.crop != legacy.crop_name
                or primary.disease != legacy.disease_name
                or not math.isclose(primary.confidence / 100, legacy.confidence, rel_tol=1e-6)
            ):
                raise ValueError("The disease service's prediction lists are inconsistent.")
        highest = self.top_predictions[0]
        if (
            self.predicted_crop != highest.crop
            or self.predicted_disease != highest.disease
            or not math.isclose(self.confidence, highest.confidence, rel_tol=1e-6)
        ):
            raise ValueError("The disease service's top prediction is inconsistent.")
        return self

    def normalized_prediction(self) -> dict:
        return {
            "crop_name": self.predicted_crop,
            "disease_name": self.predicted_disease,
            "confidence": self.confidence / 100,
            "top_three_predictions": [
                prediction.model_dump()
                for prediction in self.top_three_predictions
            ],
            "is_uncertain": self.is_uncertain,
            "uncertainty_status": "uncertain" if self.is_uncertain else "confident",
            "uncertainty_warning": self.uncertainty_warning,
        }


class CropDiseaseServiceError(RuntimeError):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _prediction_url() -> str:
    origin = os.getenv("CROP_DISEASE_API_URL", "http://127.0.0.1:8001").strip()
    try:
        parsed = urlsplit(origin)
        _ = parsed.port
    except ValueError as error:
        raise CropDiseaseServiceError(
            503,
            "The crop disease service is not configured correctly.",
        ) from error
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise CropDiseaseServiceError(
            503,
            "The crop disease service is not configured correctly.",
        )
    return f"{origin.rstrip('/')}/api/crop-disease/predict"


async def predict_crop_disease(image_bytes: bytes, content_type: str) -> dict:
    if not image_bytes or len(image_bytes) > MAX_CROP_IMAGE_BYTES:
        raise CropDiseaseServiceError(422, "Choose a non-empty image no larger than 10 MB.")
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise CropDiseaseServiceError(
            415,
            "Choose a JPEG, PNG, or WebP leaf image.",
        )

    url = _prediction_url()
    try:
        async with httpx2.AsyncClient(timeout=15, follow_redirects=False) as client:
            response = await client.post(
                url,
                files={"image": ("leaf-image", image_bytes, content_type)},
            )
    except httpx2.TimeoutException as error:
        raise CropDiseaseServiceError(
            504,
            "The crop disease service did not respond in time.",
        ) from error
    except httpx2.RequestError as error:
        raise CropDiseaseServiceError(
            503,
            "The crop disease service is unavailable. Try again later.",
        ) from error

    if response.status_code == 422:
        raise CropDiseaseServiceError(
            422,
            "The crop disease service could not read this image. Try a clear JPEG, PNG, or WebP photo.",
        )
    if response.status_code == 429:
        raise CropDiseaseServiceError(
            503,
            "The crop disease service is busy. Please try again later.",
        )
    if response.status_code >= 500:
        raise CropDiseaseServiceError(
            503,
            "The crop disease service is temporarily unavailable.",
        )
    if response.status_code != 200:
        raise CropDiseaseServiceError(
            502,
            "The crop disease service returned an unexpected response.",
        )
    try:
        prediction = CropDiseaseServiceResponse.model_validate(response.json())
    except (ValueError, ValidationError) as error:
        raise CropDiseaseServiceError(
            502,
            "The crop disease service returned invalid prediction data.",
        ) from error
    return prediction.normalized_prediction()
