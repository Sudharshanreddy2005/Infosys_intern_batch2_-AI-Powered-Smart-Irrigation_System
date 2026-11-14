import asyncio
from types import SimpleNamespace

from datetime import date, datetime, timezone

import httpx
import pytest
from openai import APITimeoutError
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

import farmer_assistant
from models import Base, Farmer, FarmerCrop, FarmerField, FarmerSensorReading, IrrigationSchedule


def test_missing_api_key_fails_closed(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with pytest.raises(farmer_assistant.AssistantServiceError) as raised:
        asyncio.run(farmer_assistant.answer_farmer_question("How should I monitor rainfall?"))

    assert raised.value.status_code == 503
    assert "configuration" in raised.value.detail


def test_chat_uses_responses_api_and_server_configured_model(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-never-logged")
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    captured = {}

    class FakeResponses:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(output_text="  General guidance.  ")

    class FakeClient:
        def __init__(self, **kwargs):
            assert kwargs == {
                "api_key": "test-key-never-logged",
                "timeout": 20.0,
                "max_retries": 0,
            }
            self.responses = FakeResponses()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

    monkeypatch.setattr(farmer_assistant, "AsyncOpenAI", FakeClient)
    answer = asyncio.run(
        farmer_assistant.answer_farmer_question("How should I monitor rainfall?")
    )

    assert answer == "General guidance."
    assert captured["model"] == "test-model"
    assert captured["input"] == "How should I monitor rainfall?"
    assert captured["max_output_tokens"] == 500
    assert "Do not invent irrigation\nquantities" in captured["instructions"]


@pytest.mark.parametrize(
    ("language_code", "language_name"),
    [
        ("en-IN", "English"),
        ("te-IN", "Telugu"),
        ("hi-IN", "Hindi"),
        ("kn-IN", "Kannada"),
        ("ta-IN", "Tamil"),
        ("ml-IN", "Malayalam"),
    ],
)
def test_chat_requests_the_selected_language_and_preserves_measurements(
    monkeypatch,
    language_code,
    language_name,
):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    captured = {}

    class FakeResponses:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(output_text="Localized guidance.")

    class FakeClient:
        def __init__(self, **_kwargs):
            self.responses = FakeResponses()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

    monkeypatch.setattr(farmer_assistant, "AsyncOpenAI", FakeClient)
    asyncio.run(
        farmer_assistant.answer_farmer_question(
            "How much rain fell?",
            language_code,
        )
    )

    assert f"natural, farmer-friendly {language_name}" in captured["instructions"]
    assert "Preserve all provided numbers, measurements, units, and sensor values exactly" in captured["instructions"]


def test_provider_timeout_is_converted_to_safe_error(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    class FakeResponses:
        async def create(self, **_kwargs):
            raise APITimeoutError(request=httpx.Request("POST", "https://api.openai.com"))

    class FakeClient:
        def __init__(self, **_kwargs):
            self.responses = FakeResponses()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

    monkeypatch.setattr(farmer_assistant, "AsyncOpenAI", FakeClient)
    with pytest.raises(farmer_assistant.AssistantServiceError) as raised:
        asyncio.run(farmer_assistant.answer_farmer_question("Question"))

    assert raised.value.status_code == 504
    assert "test-key" not in raised.value.detail


def test_empty_provider_output_is_rejected(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    class FakeResponses:
        async def create(self, **_kwargs):
            return SimpleNamespace(output_text="  ")

    class FakeClient:
        def __init__(self, **_kwargs):
            self.responses = FakeResponses()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

    monkeypatch.setattr(farmer_assistant, "AsyncOpenAI", FakeClient)
    with pytest.raises(farmer_assistant.AssistantServiceError) as raised:
        asyncio.run(farmer_assistant.answer_farmer_question("Question"))

    assert raised.value.status_code == 502


def test_direct_calls_fail_closed_for_blank_and_invalid_language(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    with pytest.raises(farmer_assistant.AssistantServiceError) as blank:
        asyncio.run(farmer_assistant.answer_farmer_question("   "))
    assert blank.value.status_code == 400

    with pytest.raises(farmer_assistant.AssistantServiceError) as bad_language:
        asyncio.run(farmer_assistant.answer_farmer_question("Question", "fr-FR"))
    assert bad_language.value.status_code == 400

    with pytest.raises(farmer_assistant.AssistantServiceError) as bad_model2:
        asyncio.run(
            farmer_assistant.explain_model2_prediction(
                "Question",
                "not-a-dict",
                "fr-FR",
            )
        )
    assert bad_model2.value.status_code == 400


def test_farmer_question_includes_authenticated_context(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    engine = create_engine("sqlite://")
    Base.metadata.create_all(bind=engine)
    captured = {}

    class FakeResponses:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(output_text="Context-aware answer.")

    class FakeClient:
        def __init__(self, **_kwargs):
            self.responses = FakeResponses()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

    monkeypatch.setattr(farmer_assistant, "AsyncOpenAI", FakeClient)
    monkeypatch.setattr(
        farmer_assistant,
        "get_current_weather",
        lambda *_args, **_kwargs: {
            "temperature_c": 29,
            "humidity_percent": 62,
            "is_stale": False,
            "data_age_minutes": 8,
        },
    )
    with Session(engine) as db:
        farmer = Farmer(
            name="Rani",
            email="rani@example.com",
            password_hash="hash",
        )
        db.add(farmer)
        db.commit()
        db.refresh(farmer)
        field = FarmerField(
            farmer_id=farmer.id,
            name="North Plot",
            area=2.5,
            area_unit="acres",
            location="Hassan",
            latitude=12.5,
            longitude=76.0,
            crop="Rice",
        )
        db.add(field)
        db.commit()
        db.refresh(field)
        crop = FarmerCrop(
            farmer_id=farmer.id,
            field_id=field.id,
            name="Rice",
            growth_stage="flowering",
        )
        db.add(crop)
        db.add(
            IrrigationSchedule(
                farmer_id=farmer.id,
                field_id=field.id,
                reservoir_id=1,
                field_name=field.name,
                crop_name="Rice",
                scheduled_date=date(2026, 11, 16),
                start_time="06:00",
                end_time="07:00",
                water_liters=150.0,
                duration_minutes=60,
                irrigation_method="drip",
                status="recommended",
                plan_snapshot={"status": "recommended"},
            )
        )
        db.commit()
        token = farmer_assistant.assistant_request_context.set({"db": db, "farmer_id": farmer.id})
        try:
            response = asyncio.run(
                farmer_assistant.answer_farmer_question("Which field needs water?")
            )
        finally:
            farmer_assistant.assistant_request_context.reset(token)

    assert response == "Context-aware answer."
    assert "North Plot" in captured["input"]
    assert "Recent irrigation schedules" in captured["input"]


def test_farmer_context_includes_weather_and_sensor_values(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    engine = create_engine("sqlite://")
    Base.metadata.create_all(bind=engine)
    captured = {}

    class FakeResponses:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(output_text="Context-aware answer.")

    class FakeClient:
        def __init__(self, **_kwargs):
            self.responses = FakeResponses()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

    monkeypatch.setattr(farmer_assistant, "AsyncOpenAI", FakeClient)
    monkeypatch.setattr(
        farmer_assistant,
        "get_current_weather",
        lambda *_args, **_kwargs: {
            "temperature_c": 31.5,
            "humidity_percent": 56,
            "is_stale": False,
            "data_age_minutes": 7,
        },
    )
    monkeypatch.setattr(
        farmer_assistant,
        "get_forecast",
        lambda *_args, **_kwargs: [{"temperature_c": 30, "precipitation_probability_percent": 25}],
    )

    with Session(engine) as db:
        farmer = Farmer(
            name="Priya",
            email="priya@example.com",
            password_hash="hash",
        )
        db.add(farmer)
        db.commit()
        db.refresh(farmer)
        field = FarmerField(
            farmer_id=farmer.id,
            name="West Plot",
            area=4.0,
            area_unit="acres",
            location="Coimbatore",
            latitude=11.1,
            longitude=77.1,
            crop="Cotton",
        )
        db.add(field)
        db.commit()
        db.refresh(field)
        db.execute(
            text(
                "CREATE TABLE sensor_readings (field_id INTEGER, soil_moisture FLOAT, recorded_at TEXT)"
            )
        )
        db.execute(
            text("INSERT INTO sensor_readings (field_id, soil_moisture, recorded_at) VALUES (:field_id, :soil_moisture, :recorded_at)"),
            {"field_id": field.id, "soil_moisture": 88.8, "recorded_at": "2026-11-16T06:00:00Z"},
        )
        db.add(
            FarmerSensorReading(
                farmer_id=farmer.id,
                field_id=field.id,
                recorded_at=datetime(2026, 11, 16, 6, tzinfo=timezone.utc),
                soil_moisture_percent=34.6,
                source="test_fixture",
            )
        )
        db.commit()
        token = farmer_assistant.assistant_request_context.set({"db": db, "farmer_id": farmer.id})
        try:
            asyncio.run(farmer_assistant.answer_farmer_question("Is the soil dry?"))
        finally:
            farmer_assistant.assistant_request_context.reset(token)

    assert "current weather" in captured["input"]
    assert "soil_moisture=34.6" in captured["input"]
    assert "88.8" not in captured["input"]


def test_model_status_notes_cover_water_and_crop_risk_questions():
    notes = farmer_assistant._model_status_notes(
        "What is the water requirement and crop stress for my field?"
    )
    assert any("Model 2 is fail-closed" in note for note in notes)
    assert any("Crop stress: Model 4" in note for note in notes)


def test_seasonal_guidance_and_model_status_are_added_to_farmer_context():
    monkeypatch = pytest.MonkeyPatch()
    try:
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")
        engine = create_engine("sqlite://")
        Base.metadata.create_all(bind=engine)
        captured = {}

        class FakeResponses:
            async def create(self, **kwargs):
                captured.update(kwargs)
                return SimpleNamespace(output_text="Seasonal answer.")

        class FakeClient:
            def __init__(self, **_kwargs):
                self.responses = FakeResponses()

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

        monkeypatch.setattr(farmer_assistant, "AsyncOpenAI", FakeClient)
        with Session(engine) as db:
            farmer = Farmer(name="Asha", email="asha@example.com", password_hash="hash")
            db.add(farmer)
            db.commit(); db.refresh(farmer)
            token = farmer_assistant.assistant_request_context.set({"db": db, "farmer_id": farmer.id})
            try:
                asyncio.run(farmer_assistant.answer_farmer_question("Which season is best for kharif and rabi?"))
            finally:
                farmer_assistant.assistant_request_context.reset(token)
        assert "Kharif crops are usually sown" in captured["input"]
        assert "Rabi crops are typically grown" in captured["input"]
    finally:
        monkeypatch.undo()


def test_model2_explanation_uses_server_prediction_as_context(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    prediction = {
        "estimated_water_liters": 123.5,
        "unit": "liters_per_field_per_24_hours",
        "prediction_period_hours": 24,
        "target_basis": "gross_irrigation_requirement",
        "dataset_provenance": "real_observed_with_independently_verified_labels",
    }
    captured = {}

    class FakeResponses:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(output_text="Explanation only.")

    class FakeClient:
        def __init__(self, **_kwargs):
            self.responses = FakeResponses()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

    monkeypatch.setattr(farmer_assistant, "AsyncOpenAI", FakeClient)
    explanation = asyncio.run(
        farmer_assistant.explain_model2_prediction(
            "Explain limitations.",
            prediction,
            "te-IN",
        )
    )

    assert explanation == "Explanation only."
    assert '"estimated_water_liters": 123.5' in captured["input"]
    assert "Do not generate, revise, estimate, or restate its water quantity" in captured["instructions"]
    assert "natural, farmer-friendly Telugu" in captured["instructions"]
