from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import tensorflow as tf

from .data_pipeline import DEFAULT_IMAGE_SIZE, preprocess_image_bytes
from .models import ResNet50Preprocess


DEFAULT_UNCERTAINTY_THRESHOLD = 0.60


class CropDiseasePredictor:
    def __init__(
        self,
        model: tf.keras.Model,
        class_mapping: dict[str, Any],
        *,
        uncertainty_threshold: float = DEFAULT_UNCERTAINTY_THRESHOLD,
    ) -> None:
        if not 0 <= uncertainty_threshold <= 1:
            raise ValueError("uncertainty_threshold must be between 0 and 1.")
        classes = class_mapping.get("classes")
        if not isinstance(classes, list) or len(classes) < 2:
            raise ValueError("Class mapping must contain at least two class entries.")
        if model.output_shape[-1] != len(classes):
            raise ValueError(
                f"Model has {model.output_shape[-1]} outputs but class mapping has {len(classes)} classes."
            )
        self.model = model
        self.classes = classes
        self.image_size = int(class_mapping.get("image_size", DEFAULT_IMAGE_SIZE))
        self.uncertainty_threshold = uncertainty_threshold

    @classmethod
    def from_paths(
        cls,
        model_path: Path,
        class_mapping_path: Path,
        *,
        uncertainty_threshold: float = DEFAULT_UNCERTAINTY_THRESHOLD,
    ) -> CropDiseasePredictor:
        if not model_path.is_file():
            raise FileNotFoundError(f"Crop disease model not found: {model_path}")
        if not class_mapping_path.is_file():
            raise FileNotFoundError(f"Class mapping not found: {class_mapping_path}")
        mapping = json.loads(class_mapping_path.read_text(encoding="utf-8"))
        model = tf.keras.models.load_model(
            model_path,
            compile=False,
            custom_objects={"ResNet50Preprocess": ResNet50Preprocess},
        )
        return cls(
            model,
            mapping,
            uncertainty_threshold=uncertainty_threshold,
        )

    def predict_bytes(self, image_bytes: bytes) -> dict[str, Any]:
        if not image_bytes:
            raise ValueError("Uploaded image is empty.")
        image = preprocess_image_bytes(image_bytes, self.image_size)
        probabilities = np.asarray(
            self.model(image[np.newaxis, ...], training=False).numpy()[0],
            dtype=np.float64,
        )
        if probabilities.shape != (len(self.classes),):
            raise RuntimeError("Model prediction output does not match the class mapping.")
        if not np.isfinite(probabilities).all():
            raise RuntimeError("Model returned non-finite prediction probabilities.")
        best_index = int(np.argmax(probabilities))
        best_class = self.classes[best_index]
        confidence = float(probabilities[best_index])
        top_indexes = np.argsort(probabilities)[::-1][:3]
        top_three = [
            {
                "class_name": self.classes[int(index)]["class_name"],
                "crop_name": self.classes[int(index)]["crop_name"],
                "disease_name": self.classes[int(index)]["disease_name"],
                "confidence": float(probabilities[int(index)]),
            }
            for index in top_indexes
        ]
        uncertain = confidence < self.uncertainty_threshold
        return {
            "crop_name": best_class["crop_name"],
            "disease_name": best_class["disease_name"],
            "confidence": confidence,
            "top_three_predictions": top_three,
            "is_uncertain": uncertain,
            "uncertainty_status": "uncertain" if uncertain else "confident",
        }
