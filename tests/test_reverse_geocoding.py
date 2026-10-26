import requests
import pytest

from weather_api.integrations import reverse_geocoding


@pytest.fixture(autouse=True)
def reset_reverse_geocoding_cache(monkeypatch):
    reverse_geocoding._cache.clear()
    monkeypatch.setattr(reverse_geocoding, "_last_request_time", 0.0)
    monkeypatch.setattr(reverse_geocoding, "_MIN_REQUEST_INTERVAL_SECONDS", 0)


def test_reverse_geocoding_returns_and_caches_locality(monkeypatch):
    calls = []

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"address": {"village": "  Hunsur  "}}

    def get(*args, **kwargs):
        calls.append((args, kwargs))
        return Response()

    monkeypatch.setattr(reverse_geocoding.requests, "get", get)

    assert reverse_geocoding.get_locality(12.50001, 77.60001) == "Hunsur"
    assert reverse_geocoding.get_locality(12.50002, 77.60002) == "Hunsur"
    assert len(calls) == 1
    assert calls[0][0] == (reverse_geocoding._ENDPOINT,)
    assert calls[0][1]["params"]["format"] == "jsonv2"
    assert calls[0][1]["headers"]["User-Agent"] == reverse_geocoding._USER_AGENT
    assert calls[0][1]["timeout"] == reverse_geocoding._REQUEST_TIMEOUT


def test_reverse_geocoding_failure_returns_no_locality(monkeypatch):
    def timeout(*_args, **_kwargs):
        raise requests.Timeout("upstream timeout")

    monkeypatch.setattr(reverse_geocoding.requests, "get", timeout)

    assert reverse_geocoding.get_locality(12.5, 77.6) is None


def test_reverse_geocoding_missing_locality_returns_no_locality(monkeypatch):
    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"address": {"country": "India"}}

    monkeypatch.setattr(reverse_geocoding.requests, "get", lambda *_args, **_kwargs: Response())

    assert reverse_geocoding.get_locality(12.5, 77.6) is None


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [(91, 0), (0, 181), (float("nan"), 0), (0, float("inf")), (True, 0)],
)
def test_reverse_geocoding_rejects_invalid_coordinates(latitude, longitude):
    with pytest.raises(ValueError):
        reverse_geocoding.get_locality(latitude, longitude)
