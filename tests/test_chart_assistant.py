import asyncio
from types import SimpleNamespace

import httpx2
import pytest
from google.genai import _interactions as interaction_errors

import chart_assistant


def make_client(create, captured=None, accepted_api_keys=("test-gemini-key",)):
    captured = captured if captured is not None else {}

    class FakeInteractions:
        async def create(self, **kwargs):
            return await create(**kwargs)

    class FakeAio:
        def __init__(self):
            self.interactions = FakeInteractions()
            self.closed = False

        async def aclose(self):
            self.closed = True

    class FakeClient:
        def __init__(self, *, api_key, http_options):
            assert api_key in accepted_api_keys
            captured.setdefault("api_key_labels", []).append(
                accepted_api_keys.index(api_key)
            )
            captured["http_options"] = http_options
            self.aio = FakeAio()

    return FakeClient


def make_rate_limit_error(*, retry_after=None, body=None):
    headers = {"Retry-After": str(retry_after)} if retry_after is not None else {}
    response = httpx2.Response(
        429,
        headers=headers,
        request=httpx2.Request("POST", "https://api.invalid"),
    )
    return interaction_errors.RateLimitError(
        "rate limited",
        response=response,
        body=body or {"message": "rate limited"},
    )


def test_chart_assistant_uses_stateless_gemini_and_selected_language(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.setenv("GEMINI_MODEL", "test-gemini-model")
    captured = {}

    async def create(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(status="completed", output_text="  ಬೆಳೆ ಉತ್ತರ.  ")

    fake_client = make_client(create, captured)
    monkeypatch.setattr(chart_assistant.genai, "Client", fake_client)
    answer = asyncio.run(
        chart_assistant.answer_chart_question(
            "Explain my field data.",
            {"field": {"name": "North plot"}},
            [{"role": "user", "content": "Earlier question."}],
            "kn-IN",
        )
    )

    assert answer == "ಬೆಳೆ ಉತ್ತರ."
    assert captured["model"] == "test-gemini-model"
    assert captured["store"] is False
    assert captured["generation_config"]["max_output_tokens"] == 1500
    assert "Kannada" in captured["system_instruction"]
    assert captured["automatic_continuation"] is False
    assert captured["http_options"].retry_options.attempts == 1
    assert captured["timeout"].connect == chart_assistant.GEMINI_CONNECT_TIMEOUT_SECONDS
    assert captured["timeout"].read == chart_assistant.GEMINI_RESPONSE_TIMEOUT_SECONDS
    assert captured["timeout"].write == chart_assistant.GEMINI_WRITE_TIMEOUT_SECONDS
    assert captured["timeout"].pool == chart_assistant.GEMINI_POOL_TIMEOUT_SECONDS
    assert "test-gemini-key" not in repr(captured)
    assert '"name": "North plot"' in captured["input"]


def test_chart_assistant_reads_the_current_primary_key_each_call(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "first-primary-key")
    monkeypatch.delenv("GEMINI_API_KEY_BACKUP", raising=False)
    captured = {}

    async def create(**_kwargs):
        return SimpleNamespace(status="completed", output_text="Answer.")

    monkeypatch.setattr(
        chart_assistant.genai,
        "Client",
        make_client(
            create,
            captured,
            accepted_api_keys=("first-primary-key", "second-primary-key"),
        ),
    )

    assert asyncio.run(chart_assistant.answer_chart_question("Question", {})) == "Answer."
    monkeypatch.setenv("GEMINI_API_KEY", "second-primary-key")
    assert asyncio.run(chart_assistant.answer_chart_question("Question", {})) == "Answer."

    assert captured["api_key_labels"] == [0, 1]


def test_temporary_gemini_rate_limit_retries_after_provider_delay(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    calls = []
    delays = []
    error = make_rate_limit_error(retry_after=1)

    async def create(**_kwargs):
        calls.append(True)
        if len(calls) == 1:
            raise error
        return SimpleNamespace(status="completed", output_text="Answer.")

    async def sleep(delay):
        delays.append(delay)

    monkeypatch.setattr(chart_assistant.genai, "Client", make_client(create))
    monkeypatch.setattr(chart_assistant.asyncio, "sleep", sleep)

    answer = asyncio.run(chart_assistant.answer_chart_question("Question", {}))

    assert answer == "Answer."
    assert len(calls) == 2
    assert delays == [1]


def test_daily_gemini_quota_is_not_retried(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.delenv("GEMINI_API_KEY_BACKUP", raising=False)
    calls = []
    error = make_rate_limit_error(
        body={
            "error": {
                "status": "RESOURCE_EXHAUSTED",
                "details": [{
                    "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                    "violations": [{
                        "quotaId": "GenerateRequestsPerDayPerProjectPerModel",
                    }],
                }],
            },
        },
    )

    async def create(**_kwargs):
        calls.append(True)
        raise error

    monkeypatch.setattr(chart_assistant.genai, "Client", make_client(create))

    with pytest.raises(chart_assistant.AssistantServiceError) as raised:
        asyncio.run(chart_assistant.answer_chart_question("Question", {}))

    assert raised.value.status_code == 429
    assert "daily" in raised.value.detail
    assert raised.value.retry_after is None
    assert len(calls) == 1


def test_daily_gemini_quota_uses_configured_backup_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "primary-test-key")
    monkeypatch.setenv("GEMINI_API_KEY_BACKUP", "backup-test-key")
    captured = {}
    calls = []
    primary_error = make_rate_limit_error(
        body={
            "error": {
                "details": [{
                    "violations": [{
                        "quotaId": "GenerateRequestsPerDayPerProjectPerModel",
                    }],
                }],
            },
        },
    )

    async def create(**_kwargs):
        calls.append(True)
        if len(calls) == 1:
            raise primary_error
        return SimpleNamespace(status="completed", output_text="Backup answer.")

    monkeypatch.setattr(
        chart_assistant.genai,
        "Client",
        make_client(
            create,
            captured,
            accepted_api_keys=("primary-test-key", "backup-test-key"),
        ),
    )

    answer = asyncio.run(chart_assistant.answer_chart_question("Question", {}))

    assert answer == "Backup answer."
    assert len(calls) == 2
    assert captured["api_key_labels"] == [0, 1]
    assert "primary-test-key" not in repr(captured)
    assert "backup-test-key" not in repr(captured)


def test_gemini_availability_failure_uses_backup_key(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "primary-test-key")
    monkeypatch.setenv("GEMINI_API_KEY_BACKUP", "backup-test-key")
    captured = {}
    calls = []
    primary_error = interaction_errors.APITimeoutError(
        request=httpx2.Request("POST", "https://api.invalid"),
    )

    async def create(**_kwargs):
        calls.append(True)
        if len(calls) == 1:
            raise primary_error
        return SimpleNamespace(status="completed", output_text="Backup answer.")

    monkeypatch.setattr(
        chart_assistant.genai,
        "Client",
        make_client(
            create,
            captured,
            accepted_api_keys=("primary-test-key", "backup-test-key"),
        ),
    )

    answer = asyncio.run(chart_assistant.answer_chart_question("Question", {}))

    assert answer == "Backup answer."
    assert len(calls) == 2
    assert captured["api_key_labels"] == [0, 1]


def test_invalid_gemini_primary_does_not_trigger_quota_fallback(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "primary-test-key")
    monkeypatch.setenv("GEMINI_API_KEY_BACKUP", "backup-test-key")
    captured = {}
    calls = []
    error = interaction_errors.AuthenticationError(
        "provider authentication failed",
        response=httpx2.Response(
            401,
            request=httpx2.Request("POST", "https://api.invalid"),
        ),
        body={"message": "unauthorized"},
    )

    async def create(**_kwargs):
        calls.append(True)
        raise error

    monkeypatch.setattr(
        chart_assistant.genai,
        "Client",
        make_client(
            create,
            captured,
            accepted_api_keys=("primary-test-key", "backup-test-key"),
        ),
    )

    with pytest.raises(chart_assistant.AssistantServiceError) as raised:
        asyncio.run(chart_assistant.answer_chart_question("Question", {}))

    assert raised.value.status_code == 503
    assert len(calls) == 1
    assert captured["api_key_labels"] == [0]
    assert "primary-test-key" not in raised.value.detail
    assert "backup-test-key" not in raised.value.detail


def test_missing_backup_returns_clear_provider_error(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.delenv("GEMINI_API_KEY_BACKUP", raising=False)
    error = make_rate_limit_error(
        body={
            "error": {
                "details": [{
                    "violations": [{
                        "quotaId": "GenerateRequestsPerDayPerModel",
                    }],
                }],
            },
        },
    )

    async def create(**_kwargs):
        raise error

    monkeypatch.setattr(chart_assistant.genai, "Client", make_client(create))

    with pytest.raises(chart_assistant.AssistantServiceError) as raised:
        asyncio.run(chart_assistant.answer_chart_question("Question", {}))

    assert raised.value.status_code == 429
    assert "daily provider quota" in raised.value.detail
    assert "No backup API key is configured" in raised.value.detail


def test_long_gemini_retry_after_is_returned_without_waiting(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.delenv("GEMINI_API_KEY_BACKUP", raising=False)
    calls = []
    error = make_rate_limit_error(retry_after=9)

    async def create(**_kwargs):
        calls.append(True)
        raise error

    monkeypatch.setattr(chart_assistant.genai, "Client", make_client(create))

    with pytest.raises(chart_assistant.AssistantServiceError) as raised:
        asyncio.run(chart_assistant.answer_chart_question("Question", {}))

    assert raised.value.status_code == 429
    assert raised.value.retry_after == 9
    assert len(calls) == 1


def test_gemini_rate_limit_retries_at_most_twice_with_exponential_backoff(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
    monkeypatch.delenv("GEMINI_API_KEY_BACKUP", raising=False)
    calls = []
    delays = []
    error = make_rate_limit_error()

    async def create(**_kwargs):
        calls.append(True)
        raise error

    async def sleep(delay):
        delays.append(delay)

    monkeypatch.setattr(chart_assistant.genai, "Client", make_client(create))
    monkeypatch.setattr(chart_assistant.asyncio, "sleep", sleep)

    with pytest.raises(chart_assistant.AssistantServiceError) as raised:
        asyncio.run(chart_assistant.answer_chart_question("Question", {}))

    assert raised.value.status_code == 429
    assert len(calls) == 3
    assert delays == [
        chart_assistant.GEMINI_RATE_LIMIT_BACKOFF_SECONDS,
        chart_assistant.GEMINI_RATE_LIMIT_BACKOFF_SECONDS * 2,
    ]


def test_gemini_is_instructed_to_explain_not_replace_disease_model_results():
    instructions = " ".join(chart_assistant.CHART_ASSISTANT_INSTRUCTIONS.split())
    assert "verified prediction is authoritative" in instructions
    assert "do not reclassify the image" in instructions


def test_missing_gemini_key_fails_closed(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    with pytest.raises(chart_assistant.AssistantServiceError) as raised:
        asyncio.run(chart_assistant.answer_chart_question("Question", {}))

    assert raised.value.status_code == 503
    assert "configuration" in raised.value.detail


@pytest.mark.parametrize(
    ("exception", "status_code"),
    [
        (
            interaction_errors.RateLimitError(
                "rate limited",
                response=httpx2.Response(
                    429,
                    request=httpx2.Request("POST", "https://api.invalid"),
                ),
                body={"message": "rate limited"},
            ),
            429,
        ),
        (
            interaction_errors.APITimeoutError(
                request=httpx2.Request("POST", "https://api.invalid"),
            ),
            504,
        ),
        (
            interaction_errors.AuthenticationError(
                "provider authentication failed",
                response=httpx2.Response(
                    401,
                    request=httpx2.Request("POST", "https://api.invalid"),
                ),
                body={"message": "unauthorized"},
            ),
            503,
        ),
        (httpx2.ReadTimeout("provider timed out"), 504),
        (httpx2.ConnectError("provider unavailable"), 503),
    ],
)
def test_gemini_provider_failures_are_reported_safely(monkeypatch, exception, status_code):
    monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")

    async def sleep(_delay):
        return None

    async def create(**_kwargs):
        raise exception

    monkeypatch.setattr(chart_assistant.genai, "Client", make_client(create))
    monkeypatch.setattr(chart_assistant.asyncio, "sleep", sleep)

    with pytest.raises(chart_assistant.AssistantServiceError) as raised:
        asyncio.run(chart_assistant.answer_chart_question("Question", {}))

    assert raised.value.status_code == status_code
    assert "test-gemini-key" not in raised.value.detail
