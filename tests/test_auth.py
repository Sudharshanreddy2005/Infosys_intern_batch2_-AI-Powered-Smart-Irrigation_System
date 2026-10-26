import os

os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.pool import StaticPool

import main
from models import AuthSession


@pytest.fixture
def client_pair(monkeypatch):
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    monkeypatch.setattr(main, "engine", test_engine)
    monkeypatch.setattr(main, "auth_attempts", main.OrderedDict())
    with TestClient(main.app) as first, TestClient(main.app) as second:
        yield first, second
    test_engine.dispose()


def register(client, email="farmer@example.com", password="CorrectHorse9!"):
    return client.post(
        "/api/auth/register",
        json={
            "name": "  Asha   Rao ",
            "email": email,
            "password": password,
            "phone": "+91 98765 43210",
            "state": "Karnataka",
            "district": "Mysuru",
            "village": "Hunsur",
        },
    )


def csrf_headers(client):
    return {"X-CSRF-Token": client.cookies.get(main.CSRF_COOKIE)}


def test_registration_creates_hashed_farmer_and_server_session(client_pair):
    client, _ = client_pair
    response = register(client)

    assert response.status_code == 201
    assert response.json()["name"] == "Asha Rao"
    assert "password_hash" not in response.json()
    assert client.cookies.get(main.SESSION_COOKIE)
    assert client.cookies.get(main.CSRF_COOKIE)
    assert "httponly" in response.headers["set-cookie"].lower()
    assert client.get("/api/auth/me").json()["email"] == "farmer@example.com"

    session = main.Session(main.engine)
    try:
        auth_session = session.scalar(select(AuthSession))
        assert auth_session is not None
        assert auth_session.token_hash != client.cookies.get(main.SESSION_COOKIE)
        assert len(auth_session.token_hash) == 64
    finally:
        session.close()


def test_authenticated_dashboard_is_available_after_registration(client_pair):
    client, _ = client_pair
    assert client.get("/dashboard", follow_redirects=False).status_code == 303
    assert register(client).status_code == 201

    response = client.get("/dashboard")

    assert response.status_code == 200
    assert "JalSaathi | Smart Irrigation" in response.text


def test_login_uses_generic_errors_and_sets_session(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201
    client.post("/api/auth/logout", headers=csrf_headers(client))

    invalid = client.post(
        "/api/auth/login",
        json={"email": "farmer@example.com", "password": "incorrect"},
    )
    assert invalid.status_code == 401
    assert invalid.json()["detail"] == "Email or password is incorrect."

    valid = client.post(
        "/api/auth/login",
        json={"email": "FARMER@example.com", "password": "CorrectHorse9!"},
    )
    assert valid.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_farmer_data_is_owner_scoped_and_csrf_protected(client_pair):
    first, second = client_pair
    assert register(first).status_code == 201
    assert register(second, email="another@example.com").status_code == 201

    body = {"name": "North plot", "crop": "Paddy", "area": 2.5, "area_unit": "acres"}
    without_csrf = first.post("/api/fields", json=body)
    assert without_csrf.status_code == 403

    created = first.post("/api/fields", json=body, headers=csrf_headers(first))
    assert created.status_code == 201
    field_id = created.json()["id"]
    assert "farmer_id" not in created.json()
    assert first.get("/api/fields").json()[0]["id"] == field_id
    assert second.get("/api/fields").json() == []
    assert second.get(f"/api/fields/{field_id}").status_code == 404
    assert second.patch(
        f"/api/fields/{field_id}",
        json={"name": "Stolen"},
        headers=csrf_headers(second),
    ).status_code == 404

    crop = first.post(
        "/api/crops",
        json={"name": "Paddy", "field_id": field_id},
        headers=csrf_headers(first),
    )
    assert crop.status_code == 201
    foreign_crop = second.post(
        "/api/crops",
        json={"name": "Maize", "field_id": field_id},
        headers=csrf_headers(second),
    )
    assert foreign_crop.status_code == 404

    updated_field = first.patch(
        f"/api/fields/{field_id}",
        json={"latitude": 12.5, "longitude": 77.6, "area": 3},
        headers=csrf_headers(first),
    )
    assert updated_field.status_code == 200
    assert updated_field.json()["latitude"] == 12.5
    assert first.patch(
        f"/api/fields/{field_id}",
        json={"latitude": None},
        headers=csrf_headers(first),
    ).status_code == 422

    updated_crop = first.patch(
        f"/api/crops/{crop.json()['id']}",
        json={"growth_stage": "Vegetative", "planting_date": "2026-01-10"},
        headers=csrf_headers(first),
    )
    assert updated_crop.status_code == 200
    assert updated_crop.json()["planting_date"] == "2026-01-10"
    assert first.delete(
        f"/api/crops/{crop.json()['id']}",
        headers=csrf_headers(first),
    ).status_code == 204
    assert first.delete(
        f"/api/fields/{field_id}",
        headers=csrf_headers(first),
    ).status_code == 204


def test_authenticated_profile_can_be_updated(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201

    updated = client.patch(
        "/api/auth/me",
        json={"name": "Asha N Rao", "village": "Hunsur Town"},
        headers=csrf_headers(client),
    )

    assert updated.status_code == 200
    assert updated.json()["name"] == "Asha N Rao"
    assert updated.json()["village"] == "Hunsur Town"


def test_origin_and_extra_owner_fields_are_rejected(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201

    cross_origin = client.post(
        "/api/fields",
        json={"name": "North plot", "area": 1, "area_unit": "acres"},
        headers={**csrf_headers(client), "Origin": "https://attacker.example"},
    )
    assert cross_origin.status_code == 403

    owner_override = client.post(
        "/api/fields",
        json={
            "name": "North plot",
            "area": 1,
            "area_unit": "acres",
            "farmer_id": 900,
        },
        headers=csrf_headers(client),
    )
    assert owner_override.status_code == 422


def test_expired_session_is_rejected(client_pair):
    client, _ = client_pair
    assert register(client).status_code == 201
    with main.Session(main.engine) as db:
        auth_session = db.scalar(select(AuthSession))
        assert auth_session is not None
        auth_session.expires_at = main.datetime.now(main.timezone.utc) - main.timedelta(seconds=1)
        db.commit()

    assert client.get("/api/auth/me").status_code == 401
