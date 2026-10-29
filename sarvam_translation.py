import logging
import os
import re
import secrets
import threading
import time
from collections import OrderedDict

import requests

logger = logging.getLogger(__name__)


SARVAM_TRANSLATE_URL = "https://api.sarvam.ai/translate"
MAX_INPUT_CHARACTERS = 2000
CACHE_MAX_ENTRIES = 2048
TRANSIENT_RETRY_COUNT = 1
TRANSIENT_RETRY_DELAY_SECONDS = 0.25
PROVIDER_FAILURE_COOLDOWN_SECONDS = 30
_NUMBER_PATTERN = re.compile(
    r"(?<![\w.])\d+(?:[.,]\d+)*(?:\s*(?:%|°[CF]|mm|cm|km|ha|acres?|hectares?|liters?|litres?|L|kg|g|m/s|km/h))?",
    re.IGNORECASE,
)
_OPAQUE_MARKER_PATTERN = re.compile(r"Q[XY][0-9A-F]{32}XZ", re.IGNORECASE)
_cache: OrderedDict[tuple[str, str, str], str] = OrderedDict()
_failure_cache: dict[tuple[str, str, tuple[str, ...]], tuple[float, str, int | None]] = {}
_cache_lock = threading.Lock()


def _remember_failure(
    batch_key: tuple[str, str, tuple[str, ...]],
    retry_after_seconds: int,
    category: str,
    status_code: int | None = None,
) -> None:
    _failure_cache[batch_key] = (
        time.monotonic() + retry_after_seconds,
        category,
        status_code,
    )
    while len(_failure_cache) > CACHE_MAX_ENTRIES:
        _failure_cache.pop(next(iter(_failure_cache)))


class TranslationConfigurationError(Exception):
    pass


class TranslationRateLimitError(Exception):
    def __init__(self, retry_after_seconds: int | None = None):
        super().__init__()
        self.retry_after_seconds = retry_after_seconds


class TranslationProviderError(Exception):
    def __init__(self, category: str = "provider_error", status_code: int | None = None):
        super().__init__()
        self.category = category
        self.status_code = status_code


def _new_marker(prefix: str) -> str:
    return f"{prefix}{secrets.token_hex(16).upper()}XZ"


def _parse_segments(translated: str, markers: list[str]) -> list[str]:
    matches = []
    for marker in markers:
        occurrences = list(re.finditer(re.escape(marker), translated, re.IGNORECASE))
        if len(occurrences) != 1:
            raise TranslationProviderError(category="invalid_response_markers")
        matches.append((occurrences[0].start(), occurrences[0].end(), marker))
    matches.sort()

    translated_by_marker = {}
    for index, (_, marker_end, marker) in enumerate(matches):
        end = matches[index + 1][0] if index + 1 < len(matches) else len(translated)
        value = translated[marker_end:end].strip()
        if not value:
            raise TranslationProviderError(category="empty_translation_segment")
        translated_by_marker[marker] = value
    if set(translated_by_marker) != set(markers):
        raise TranslationProviderError(category="missing_translation_segment")
    return [translated_by_marker[marker] for marker in markers]


def _translate_uncached(
    texts: list[str],
    source_language_code: str,
    target_language_code: str,
) -> list[str]:
    api_key = os.getenv("SARVAM_API_KEY", "").strip()
    if not api_key:
        raise TranslationConfigurationError

    markers = [_new_marker("QX") for _ in texts]
    number_values: list[list[tuple[str, str]]] = []
    segments = []
    for marker, text in zip(markers, texts):
        if not isinstance(text, str):
            raise ValueError("Translation text must be a string.")
        if not text.strip():
            raise ValueError("Translation text cannot be empty.")
        if len(text) > MAX_INPUT_CHARACTERS:
            raise ValueError("Text exceeds Sarvam's 2000-character limit.")

        if "JALSAATHI_SEGMENT_" in text or "JALSAATHI_NUMBER_" in text or _OPAQUE_MARKER_PATTERN.search(text):
            raise ValueError("Translation text contains a reserved token.")
        numbers = []

        def protect_number(match):
            token = _new_marker("QY")
            numbers.append((token, match.group(0)))
            return token

        protected = _NUMBER_PATTERN.sub(protect_number, text)
        number_values.append(numbers)
        segments.append(f"{marker}\n{protected}")

    request_text = "\n".join(segments)
    if len(request_text) > MAX_INPUT_CHARACTERS:
        raise ValueError("Combined translation text exceeds Sarvam's 2000-character limit.")

    start = time.monotonic()
    response = None
    network_error = None
    for attempt in range(TRANSIENT_RETRY_COUNT + 1):
        try:
            response = requests.post(
                SARVAM_TRANSLATE_URL,
                headers={
                    "api-subscription-key": api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "input": request_text,
                    "source_language_code": source_language_code,
                    "target_language_code": target_language_code,
                },
                timeout=(3, 15),
            )
            network_error = None
        except requests.RequestException as error:
            network_error = error

        transient_response = response is not None and response.status_code in {502, 503, 504}
        if attempt < TRANSIENT_RETRY_COUNT and (network_error or transient_response):
            time.sleep(TRANSIENT_RETRY_DELAY_SECONDS)
            continue
        break

    if network_error is not None:
        duration_ms = round((time.monotonic() - start) * 1000)
        logger.warning(
            "Sarvam translation provider network error: category=%s duration_ms=%s",
            "network_error",
            duration_ms,
        )
        raise TranslationProviderError(category="network_error") from network_error

    if response is None:
        raise TranslationProviderError(category="missing_provider_response")

    duration_ms = round((time.monotonic() - start) * 1000)
    if response.status_code == 429:
        logger.warning(
            "Sarvam translation provider rate limit: category=%s status=%s duration_ms=%s",
            "rate_limit",
            response.status_code,
            duration_ms,
        )
        retry_after = response.headers.get("Retry-After")
        try:
            retry_after_seconds = max(1, int(float(retry_after))) if retry_after else None
        except (TypeError, ValueError, OverflowError):
            retry_after_seconds = None
        raise TranslationRateLimitError(retry_after_seconds)
    if response.status_code in {401, 403}:
        logger.warning(
            "Sarvam translation provider auth failure: category=%s status=%s duration_ms=%s",
            "authentication_error",
            response.status_code,
            duration_ms,
        )
        raise TranslationConfigurationError
    if not response.ok:
        logger.warning(
            "Sarvam translation provider response failed: category=%s status=%s duration_ms=%s",
            "upstream_error",
            response.status_code,
            duration_ms,
        )
        raise TranslationProviderError(
            category="upstream_http_error",
            status_code=response.status_code,
        )

    try:
        body = response.json()
        translated_text = body.get("translated_text") if isinstance(body, dict) else None
        if not isinstance(translated_text, str):
            raise TranslationProviderError(category="invalid_response_shape")
        translations = _parse_segments(translated_text, markers)
    except TranslationProviderError as error:
        logger.warning(
            "Sarvam translation response rejected: category=%s status=%s duration_ms=%s",
            error.category,
            response.status_code,
            duration_ms,
        )
        raise
    except (ValueError, TypeError, AttributeError) as error:
        logger.warning(
            "Sarvam translation provider payload parse failed: category=%s status=%s duration_ms=%s",
            "invalid_response",
            response.status_code,
            duration_ms,
        )
        raise TranslationProviderError(category="invalid_response_json") from error

    restored = []
    for translation, numbers in zip(translations, number_values):
        for token, number in numbers:
            matches = list(re.finditer(re.escape(token), translation, re.IGNORECASE))
            if len(matches) != 1:
                raise TranslationProviderError(category="numeric_placeholder_loss")
            match = matches[0]
            translation = f"{translation[:match.start()]}{number}{translation[match.end():]}"
        restored.append(translation)
    return restored


def translate_texts(
    texts: list[str],
    source_language_code: str,
    target_language_code: str,
) -> list[str]:
    if source_language_code == target_language_code:
        return list(texts)

    keys = [(source_language_code, target_language_code, text) for text in texts]
    with _cache_lock:
        results: dict[tuple[str, str, str], str] = {}
        missing_keys = []
        missing_texts = []
        for key, text in zip(keys, texts):
            if key in _cache:
                _cache.move_to_end(key)
                results[key] = _cache[key]
            else:
                missing_keys.append(key)
                missing_texts.append(text)

        if missing_texts:
            batch_key = (
                source_language_code,
                target_language_code,
                tuple(missing_texts),
            )
            failure = _failure_cache.get(batch_key)
            retry_after = failure[0] - time.monotonic() if failure else 0
            if retry_after > 0 and failure:
                if failure[1] == "rate_limit":
                    raise TranslationRateLimitError(max(1, int(retry_after + 0.999)))
                raise TranslationProviderError(category="provider_cooldown")
            _failure_cache.pop(batch_key, None)
            try:
                translations = _translate_uncached(
                    missing_texts,
                    source_language_code,
                    target_language_code,
                )
            except TranslationProviderError as error:
                _remember_failure(
                    batch_key,
                    PROVIDER_FAILURE_COOLDOWN_SECONDS,
                    error.category,
                    error.status_code,
                )
                raise error
            except TranslationRateLimitError as error:
                cooldown = max(PROVIDER_FAILURE_COOLDOWN_SECONDS, error.retry_after_seconds or 60)
                _remember_failure(
                    batch_key,
                    cooldown,
                    "rate_limit",
                )
                raise
            for key, translation in zip(missing_keys, translations):
                _cache[key] = translation
                _cache.move_to_end(key)
                results[key] = translation
            while len(_cache) > CACHE_MAX_ENTRIES:
                _cache.popitem(last=False)

        return [results[key] for key in keys]


def clear_translation_cache() -> None:
    with _cache_lock:
        _cache.clear()
        _failure_cache.clear()
