import asyncio
from types import SimpleNamespace

import httpx
import pytest
from openai import APITimeoutError

import farmer_assistant


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
        farmer_assistant.explain_model2_prediction("Explain limitations.", prediction)
    )

    assert explanation == "Explanation only."
    assert '"estimated_water_liters": 123.5' in captured["input"]
    assert "Do not generate, revise, estimate, or restate its water quantity" in captured["instructions"]
