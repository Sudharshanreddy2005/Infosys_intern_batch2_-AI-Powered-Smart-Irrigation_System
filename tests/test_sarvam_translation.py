import os
import re

os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest
from fastapi.testclient import TestClient

import main
import sarvam_translation


SEGMENT_MARKER_PATTERN = re.compile(r"QX[0-9A-F]{32}XZ", re.IGNORECASE)
NUMBER_MARKER_PATTERN = re.compile(r"QY[0-9A-F]{32}XZ", re.IGNORECASE)


class ProviderResponse:
    def __init__(self, status_code, translated_text=None, headers=None):
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.translated_text = translated_text
        self.headers = headers or {}

    def json(self):
        return {"translated_text": self.translated_text}


@pytest.fixture(autouse=True)
def clear_state():
    sarvam_translation.clear_translation_cache()
    with main.translation_attempts_lock:
        main.translation_attempts.clear()
    yield
    sarvam_translation.clear_translation_cache()


def test_translation_batches_text_and_preserves_numbers(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-secret")
    calls = []

    def provider(_url, *, headers, json, timeout):
        calls.append((headers, json, timeout))
        assert headers["api-subscription-key"] == "test-secret"
        assert timeout == (3, 15)
        assert "model" not in json
        assert "numerals_format" not in json
        assert "21.5%" not in json["input"]
        markers = SEGMENT_MARKER_PATTERN.findall(json["input"])
        number_markers = NUMBER_MARKER_PATTERN.findall(json["input"])
        return ProviderResponse(
            200,
            f"{markers[0]} सिंचाई {number_markers[0]} "
            f"{markers[1]} मौसम",
        )

    monkeypatch.setattr(sarvam_translation.requests, "post", provider)
    translated = sarvam_translation.translate_texts(
        ["Irrigation is 21.5% complete", "Weather"],
        "en-IN",
        "hi-IN",
    )

    assert translated == ["सिंचाई 21.5%", "मौसम"]
    assert len(calls) == 1
    assert "Irrigation is" in calls[0][1]["input"]
    assert "complete" in calls[0][1]["input"]
    assert NUMBER_MARKER_PATTERN.search(calls[0][1]["input"])
    assert len(SEGMENT_MARKER_PATTERN.findall(calls[0][1]["input"])) == 2
    assert "Weather" in calls[0][1]["input"]
    assert calls[0][1]["target_language_code"] == "hi-IN"


def test_transient_provider_failure_retries_once_without_splitting_batch(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-secret")
    calls = []

    def provider(_url, *, json, **_kwargs):
        calls.append(json["input"])
        if len(calls) == 1:
            return ProviderResponse(502)
        markers = SEGMENT_MARKER_PATTERN.findall(json["input"])
        return ProviderResponse(
            200,
            f"{markers[0]} सिंचाई {markers[1]} मौसम",
        )

    monkeypatch.setattr(sarvam_translation.requests, "post", provider)
    monkeypatch.setattr(sarvam_translation.time, "sleep", lambda _seconds: None)

    translated = sarvam_translation.translate_texts(
        ["Irrigation", "Weather"],
        "en-IN",
        "hi-IN",
    )

    assert translated == ["सिंचाई", "मौसम"]
    assert len(calls) == 2
    assert calls[0] == calls[1]


def test_transient_provider_failure_uses_bounded_retry_limit(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-secret")
    calls = []

    def provider(*_args, **_kwargs):
        calls.append(True)
        return ProviderResponse(503)

    monkeypatch.setattr(sarvam_translation.requests, "post", provider)
    monkeypatch.setattr(sarvam_translation.time, "sleep", lambda _seconds: None)

    with pytest.raises(sarvam_translation.TranslationProviderError):
        sarvam_translation.translate_texts(["Hello"], "en-IN", "hi-IN")

    assert len(calls) == 2


def test_translation_cache_avoids_repeated_provider_calls(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-secret")
    calls = []

    def provider(_url, *, json, **_kwargs):
        calls.append(json["input"])
        marker = SEGMENT_MARKER_PATTERN.search(json["input"]).group(0)
        return ProviderResponse(200, f"{marker} नमस्ते")

    monkeypatch.setattr(sarvam_translation.requests, "post", provider)
    first = sarvam_translation.translate_texts(["Hello"], "en-IN", "hi-IN")
    second = sarvam_translation.translate_texts(["Hello"], "en-IN", "hi-IN")

    assert first == second == ["नमस्ते"]
    assert len(calls) == 1


def test_missing_api_key_fails_closed(monkeypatch):
    monkeypatch.delenv("SARVAM_API_KEY", raising=False)

    with pytest.raises(sarvam_translation.TranslationConfigurationError):
        sarvam_translation.translate_texts(["Hello"], "en-IN", "hi-IN")


def test_malformed_provider_response_is_rejected(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-secret")
    monkeypatch.setattr(
        sarvam_translation.requests,
        "post",
        lambda *_args, **_kwargs: ProviderResponse(200, {"unexpected": "payload"}),
    )

    with pytest.raises(sarvam_translation.TranslationProviderError):
        sarvam_translation.translate_texts(["Hello"], "en-IN", "hi-IN")


def test_identical_failed_translation_batch_is_cooled_down(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-secret")
    provider_calls = []
    monkeypatch.setattr(
        sarvam_translation.requests,
        "post",
        lambda *_args, **_kwargs: provider_calls.append(True)
        or ProviderResponse(200, {"unexpected": "payload"}),
    )

    with pytest.raises(sarvam_translation.TranslationProviderError) as first:
        sarvam_translation.translate_texts(["Hello"], "en-IN", "hi-IN")
    with pytest.raises(sarvam_translation.TranslationProviderError) as second:
        sarvam_translation.translate_texts(["Hello"], "en-IN", "hi-IN")

    assert first.value.category == "invalid_response_shape"
    assert second.value.category == "provider_cooldown"
    assert provider_calls == [True]


def test_translation_provider_rate_limit_uses_bounded_cooldown_and_retry_after(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-secret")
    calls = []

    def provider(*_args, **_kwargs):
        calls.append(True)
        return ProviderResponse(429, headers={"Retry-After": "45"})

    monkeypatch.setattr(sarvam_translation.requests, "post", provider)

    with pytest.raises(sarvam_translation.TranslationRateLimitError) as first:
        sarvam_translation.translate_texts(["Hello"], "en-IN", "hi-IN")
    with pytest.raises(sarvam_translation.TranslationRateLimitError) as second:
        sarvam_translation.translate_texts(["Hello"], "en-IN", "hi-IN")

    assert first.value.retry_after_seconds == 45
    assert second.value.retry_after_seconds >= 1
    assert calls == [True]


def test_translate_endpoint_rejects_invalid_codes_and_overlong_text():
    with TestClient(main.app) as client:
        invalid_language = client.post(
            "/api/translate",
            json={
                "texts": ["Hello"],
                "source_language_code": "en",
                "target_language_code": "hi-IN",
            },
        )
        overlong = client.post(
            "/api/translate",
            json={
                "texts": ["x" * 2001],
                "source_language_code": "en-IN",
                "target_language_code": "hi-IN",
            },
        )

    assert invalid_language.status_code == 422
    assert overlong.status_code == 422


def test_translate_endpoint_rejects_numbers_that_expand_past_provider_limit(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-secret")
    provider_calls = []

    def provider(*_args, **_kwargs):
        provider_calls.append(True)
        return ProviderResponse(200, "unexpected translation")

    monkeypatch.setattr(sarvam_translation.requests, "post", provider)

    with TestClient(main.app) as client:
        response = client.post(
            "/api/translate",
            json={
                "texts": ["1 " * 1001],
                "source_language_code": "en-IN",
                "target_language_code": "hi-IN",
            },
        )

    assert response.status_code == 422
    detail = response.json()["detail"]
    messages = detail if isinstance(detail, list) else [detail]
    assert any("2000" in str(item.get("msg", "")).lower() or "input" in str(item.get("msg", "")).lower() for item in messages)
    assert provider_calls == []


def test_translate_endpoint_reports_missing_configuration_safely(monkeypatch):
    monkeypatch.delenv("SARVAM_API_KEY", raising=False)

    with TestClient(main.app) as client:
        response = client.post(
            "/api/translate",
            json={
                "texts": ["Hello"],
                "source_language_code": "en-IN",
                "target_language_code": "hi-IN",
            },
        )

    assert response.status_code == 503
    assert "test-secret" not in response.text
    assert "not configured" in response.json()["detail"].lower()


def test_translation_key_is_absent_from_browser_assets(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "browser-must-not-see-this-secret")

    with TestClient(main.app) as client:
        script = client.get("/static/i18n.js")
        page = client.get("/static/auth.html")

    assert script.status_code == 200
    assert page.status_code == 200
    assert "SARVAM_API_KEY" not in script.text
    assert "api-subscription-key" not in script.text
    assert "browser-must-not-see-this-secret" not in script.text
    assert "browser-must-not-see-this-secret" not in page.text


def test_public_landing_page_has_language_selector_and_translation_fallback():
    with TestClient(main.app) as client:
        response = client.get("/")

    assert response.status_code == 200
    assert 'data-language-select aria-label="Select language"' in response.text
    assert "/static/i18n.js?v=20261028-translation-batching" in response.text
    assert 'data-translation-status' in response.text


@pytest.mark.parametrize(
    ("exception", "status_code", "retry_after"),
    [
        (sarvam_translation.TranslationRateLimitError(), 429, "60"),
        (sarvam_translation.TranslationRateLimitError(17), 429, "17"),
        (sarvam_translation.TranslationProviderError(), 502, None),
    ],
)
def test_translate_endpoint_maps_provider_failures_safely(
    monkeypatch, exception, status_code, retry_after
):
    monkeypatch.setenv("SARVAM_API_KEY", "test-secret")
    monkeypatch.setattr(main, "translate_texts", lambda *_args: (_ for _ in ()).throw(exception))

    with TestClient(main.app) as client:
        response = client.post(
            "/api/translate",
            json={
                "texts": ["Hello"],
                "source_language_code": "en-IN",
                "target_language_code": "hi-IN",
            },
        )

    assert response.status_code == status_code
    assert "test-secret" not in response.text
    if retry_after:
        assert response.headers["retry-after"] == retry_after


def test_upstream_payment_required_is_not_retried_and_maps_safely(monkeypatch, caplog):
    monkeypatch.setenv("SARVAM_API_KEY", "test-secret")
    provider_calls = []

    def provider(*_args, **_kwargs):
        provider_calls.append(True)
        return ProviderResponse(402)

    monkeypatch.setattr(sarvam_translation.requests, "post", provider)

    with TestClient(main.app) as client:
        response = client.post(
            "/api/translate",
            json={
                "texts": ["Hello"],
                "source_language_code": "en-IN",
                "target_language_code": "hi-IN",
            },
        )

    assert response.status_code == 502
    assert response.json()["detail"] == (
        "Translation is temporarily unavailable. Untranslated text remains in English."
    )
    assert provider_calls == [True]
    assert "category=upstream_http_error upstream_status=402" in caplog.text
    assert "test-secret" not in response.text
    assert "test-secret" not in caplog.text


def test_translate_endpoint_applies_per_client_rate_limit(monkeypatch):
    monkeypatch.setattr(main, "TRANSLATION_MAX_ATTEMPTS", 1)
    monkeypatch.setattr(main, "translate_texts", lambda texts, *_args: texts)

    with TestClient(main.app) as client:
        payload = {
            "texts": ["Hello"],
            "source_language_code": "en-IN",
            "target_language_code": "hi-IN",
        }
        first = client.post("/api/translate", json=payload)
        second = client.post("/api/translate", json=payload)

    assert first.status_code == 200
    assert second.status_code == 429
