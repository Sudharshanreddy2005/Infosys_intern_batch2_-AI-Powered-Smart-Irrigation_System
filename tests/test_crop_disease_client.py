import asyncio

import crop_disease_client


def valid_prediction():
    return {
        "success": True,
        "predicted_crop": "Rice",
        "predicted_disease": "Leaf blight",
        "confidence": 82,
        "is_uncertain": False,
        "uncertainty_warning": None,
        "top_predictions": [
            {"crop": "Rice", "disease": "Leaf blight", "confidence": 82},
            {"crop": "Rice", "disease": "Healthy", "confidence": 12},
            {"crop": "Rice", "disease": "Brown spot", "confidence": 6},
        ],
        "top_three_predictions": [
            {
                "class_name": "Rice___Leaf_blight",
                "crop_name": "Rice",
                "disease_name": "Leaf blight",
                "confidence": 0.82,
            },
            {
                "class_name": "Rice___Healthy",
                "crop_name": "Rice",
                "disease_name": "Healthy",
                "confidence": 0.12,
            },
            {
                "class_name": "Rice___Brown_spot",
                "crop_name": "Rice",
                "disease_name": "Brown spot",
                "confidence": 0.06,
            },
        ],
    }


def test_disease_client_posts_image_and_validates_authoritative_prediction(monkeypatch):
    monkeypatch.setenv("CROP_DISEASE_API_URL", "http://127.0.0.1:8001/")
    captured = {}

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            return valid_prediction()

    class FakeClient:
        def __init__(self, **kwargs):
            captured["client_options"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, *, files):
            captured["url"] = url
            captured["files"] = files
            return FakeResponse()

    monkeypatch.setattr(crop_disease_client.httpx2, "AsyncClient", FakeClient)
    result = asyncio.run(
        crop_disease_client.predict_crop_disease(b"test-image", "image/png")
    )

    assert result["disease_name"] == "Leaf blight"
    assert result["confidence"] == 0.82
    assert result["top_three_predictions"][0]["class_name"] == "Rice___Leaf_blight"
    assert captured["url"] == "http://127.0.0.1:8001/api/crop-disease/predict"
    assert captured["files"]["image"] == ("leaf-image", b"test-image", "image/png")
    assert captured["client_options"]["follow_redirects"] is False


def test_disease_client_rejects_inconsistent_or_invalid_service_output(monkeypatch):
    monkeypatch.setenv("CROP_DISEASE_API_URL", "http://127.0.0.1:8001")

    class FakeResponse:
        status_code = 200

        @staticmethod
        def json():
            result = valid_prediction()
            result["confidence"] = 140
            return result

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, _url, *, files):
            return FakeResponse()

    monkeypatch.setattr(crop_disease_client.httpx2, "AsyncClient", FakeClient)
    try:
        asyncio.run(crop_disease_client.predict_crop_disease(b"test-image", "image/png"))
    except crop_disease_client.CropDiseaseServiceError as error:
        assert error.status_code == 502
        assert "invalid prediction data" in error.detail
    else:
        raise AssertionError("Invalid prediction data must be rejected.")


def test_disease_client_rejects_unsafe_service_origin_and_bad_image(monkeypatch):
    monkeypatch.setenv("CROP_DISEASE_API_URL", "http://user:secret@127.0.0.1:8001")
    try:
        asyncio.run(crop_disease_client.predict_crop_disease(b"test-image", "image/png"))
    except crop_disease_client.CropDiseaseServiceError as error:
        assert error.status_code == 503
        assert "secret" not in error.detail
    else:
        raise AssertionError("Credential-bearing service origins must be rejected.")

    try:
        asyncio.run(crop_disease_client.predict_crop_disease(b"image", "image/svg+xml"))
    except crop_disease_client.CropDiseaseServiceError as error:
        assert error.status_code == 415
    else:
        raise AssertionError("Unsupported image types must be rejected.")
