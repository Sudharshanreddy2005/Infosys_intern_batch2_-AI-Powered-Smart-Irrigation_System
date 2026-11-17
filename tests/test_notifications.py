import hashlib
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock

import pytest
import requests
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

ROOT = Path(__file__).resolve().parents[1]
SENSOR_DIR = ROOT / "sensor-ingestion"
sys.path.insert(0, str(SENSOR_DIR))

import app.main as sensor_api  # type: ignore[reportMissingImports]
import email_notifications
import alerts.config as alert_config
import alerts.delivery as notification_delivery
import push_notifications
import sms_notifications
from models import (
    Alert,
    Base,
    FarmNotificationSubscription,
    Farmer,
    FarmerField,
    FarmerSensorDevice,
    FarmerSensorReading,
    NotificationDelivery,
)

SENSOR_TOKEN = "test-only-device-token"
SENSOR_ID = "JAL-TEST-DEVICE"


@pytest.fixture
def database():
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    event.listen(
        engine,
        "connect",
        lambda connection, _: connection.execute("PRAGMA foreign_keys=ON"),
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    with factory() as db:
        farmer = Farmer(
            name="Test Farmer",
            email="test-farmer@example.test",
            password_hash="not-a-real-password-hash",
            phone="+10000000000",
        )
        db.add(farmer)
        db.flush()
        field = FarmerField(
            farmer_id=farmer.id,
            name="Isolated Test Field",
            area=1,
            area_unit="acres",
        )
        db.add(field)
        db.flush()
        db.add(
            FarmerSensorDevice(
                farmer_id=farmer.id,
                field_id=field.id,
                device_id=SENSOR_ID,
                name="Isolated test sensor",
                token_hash=hashlib.sha256(SENSOR_TOKEN.encode()).hexdigest(),
                is_active=True,
            )
        )
        db.commit()

    def override_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    sensor_api.app.dependency_overrides[sensor_api.get_db] = override_db
    try:
        yield factory
    finally:
        sensor_api.app.dependency_overrides.clear()
        engine.dispose()


@pytest.fixture
def client(database, monkeypatch):
    monkeypatch.setenv("APP_ENV", "testing")
    monkeypatch.setenv("NOTIFICATION_DELIVERY_ENABLED", "false")
    monkeypatch.setattr(sensor_api, "FIELD_THRESHOLDS", {})
    with database() as db:
        assert db.scalar(select(1)) == 1
    with TestClient(sensor_api.app) as test_client:
        yield test_client


def payload(*, field_id=1, moisture=50.0):
    return {
        "sensor_id": SENSOR_ID,
        "field_id": field_id,
        "soil_moisture": moisture,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def test_field_threshold_ids_are_normalized(monkeypatch):
    monkeypatch.setenv("FIELD_SOIL_MOISTURE_THRESHOLDS", '{"001": 30}')

    assert alert_config._load_field_thresholds() == {
        "1": {"irrigation_trigger": 30.0, "is_validated": True},
    }


@pytest.mark.parametrize(
    "configuration",
    ['{"1": "30"}', '{"1": 101}', '{"1": NaN}', '{"1": 30, "01": 40}'],
)
def test_invalid_field_threshold_configuration_is_rejected(monkeypatch, configuration):
    monkeypatch.setenv("FIELD_SOIL_MOISTURE_THRESHOLDS", configuration)

    with pytest.raises(RuntimeError):
        alert_config._load_field_thresholds()


def post_reading(client, *, field_id=1, moisture=50.0, sensor_id=SENSOR_ID):
    reading = payload(field_id=field_id, moisture=moisture)
    reading["sensor_id"] = sensor_id
    return client.post(
        "/sensor-data",
        json=reading,
        headers={"X-Sensor-Token": SENSOR_TOKEN},
    )


def test_valid_sensor_reading_is_saved_to_existing_schema(client, database):
    response = post_reading(client, moisture=49.126)

    assert response.status_code == 200
    assert response.json()["status"] == "saved"
    assert response.json()["soil_moisture"] == 49.13
    with database() as db:
        assert db.scalar(select(func.count()).select_from(FarmerSensorReading)) == 1
        assert db.scalar(select(func.count()).select_from(Alert)) == 0


def test_invalid_soil_moisture_is_rejected(client, database):
    response = post_reading(client, moisture=101)

    assert response.status_code == 422
    with database() as db:
        assert db.scalar(select(func.count()).select_from(FarmerSensorReading)) == 0


def test_unknown_sensor_is_rejected(client):
    response = post_reading(client, sensor_id="UNKNOWN")
    assert response.status_code == 404


def test_invalid_sensor_token_is_rejected(client):
    response = client.post(
        "/sensor-data",
        json=payload(),
        headers={"X-Sensor-Token": "invalid-test-token"},
    )
    assert response.status_code == 401


def test_unregistered_field_mapping_is_rejected(client):
    response = post_reading(client, field_id=999)
    assert response.status_code == 404


def test_registered_field_mapping_is_verified(client):
    response = post_reading(client, field_id=1)
    assert response.status_code == 200
    assert response.json()["field_id"] == 1


def test_moisture_above_threshold_does_not_create_alert(client, database, monkeypatch):
    monkeypatch.setattr(sensor_api, "FIELD_THRESHOLDS", {
        "1": {"irrigation_trigger": 30, "is_validated": True},
    })
    response = post_reading(client, moisture=31)

    assert response.status_code == 200
    assert response.json()["alert_generated"] is False
    with database() as db:
        assert db.scalar(select(func.count()).select_from(Alert)) == 0


def test_moisture_below_threshold_creates_alert(client, database, monkeypatch):
    monkeypatch.setattr(sensor_api, "FIELD_THRESHOLDS", {
        "1": {"irrigation_trigger": 30, "is_validated": True},
    })
    response = post_reading(client, moisture=20)

    assert response.status_code == 200
    assert response.json()["alert_generated"] is True
    with database() as db:
        alert = db.scalar(select(Alert))
        assert alert is not None
        assert alert.status == "unresolved"
        assert alert.field_id == 1


def test_duplicate_unresolved_alert_notifies_only_once(
    client, database, monkeypatch
):
    monkeypatch.setattr(sensor_api, "FIELD_THRESHOLDS", {
        "1": {"irrigation_trigger": 30, "is_validated": True},
    })
    monkeypatch.setenv("SUPERVISOR_EMAIL", "supervisor@example.test")
    with database() as db:
        farmer = db.scalar(select(Farmer))
        farmer.web_push_enabled = True
        farmer.sms_enabled = True
        farmer.email_enabled = True
        farmer.phone_verified_at = datetime.now(timezone.utc)
        db.commit()
    push = Mock(return_value={"status": "sent", "reason": "provider_accepted", "sent": 1, "failed": 0})
    email = Mock(return_value={"status": "sent", "reason": "provider_accepted"})
    sms = Mock(return_value={"status": "sent", "reason": "provider_accepted"})
    monkeypatch.setattr(notification_delivery, "send_web_push_notification", push)
    monkeypatch.setattr(notification_delivery, "send_email", email)
    monkeypatch.setattr(notification_delivery, "send_sms", sms)

    first = post_reading(client, moisture=20)
    second = post_reading(client, moisture=19)

    assert first.json()["alert_generated"] is True
    assert second.json()["alert_generated"] is False
    assert push.call_count == email.call_count == sms.call_count == 1
    email.assert_called_once()
    assert email.call_args.args[0] == "test-farmer@example.test"
    with database() as db:
        assert db.scalar(select(func.count()).select_from(Alert)) == 1
        assert db.scalar(select(func.count()).select_from(NotificationDelivery)) == 4


def test_push_delivery_is_disabled_by_default(database, monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NOTIFICATION_DELIVERY_ENABLED", "false")
    with database() as factory:
        farmer = factory.scalar(select(Farmer))
        result = push_notifications.send_web_push_notification(
            factory, farmer.id, "Test", "Test message"
        )
    assert result["reason"] == "delivery_disabled"


def test_push_skips_when_subscription_is_missing(database, monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NOTIFICATION_DELIVERY_ENABLED", "true")
    with database() as factory:
        farmer = factory.scalar(select(Farmer))
        farmer.web_push_enabled = True
        factory.commit()
        result = push_notifications.send_web_push_notification(
            factory, farmer.id, "Test", "Test message"
        )
    assert result["reason"] == "subscription_missing"


def test_push_preference_disabled_skips_notification(database, monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NOTIFICATION_DELIVERY_ENABLED", "true")
    with database() as db:
        farmer = db.scalar(select(Farmer))
        result = push_notifications.send_web_push_notification(
            db, farmer.id, "Test", "Test message"
        )
    assert result["reason"] == "preference_disabled"


def test_push_skips_when_vapid_private_key_is_missing(database, monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NOTIFICATION_DELIVERY_ENABLED", "true")
    monkeypatch.delenv("VAPID_PRIVATE_KEY_PATH", raising=False)
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:test@example.test")
    with database() as factory:
        farmer = factory.scalar(select(Farmer))
        farmer.web_push_enabled = True
        factory.add(FarmNotificationSubscription(
            farmer_id=farmer.id,
            endpoint="https://push.example.test/endpoint",
            p256dh="test-p256dh",
            auth="test-auth",
        ))
        factory.commit()
        result = push_notifications.send_web_push_notification(
            factory, farmer.id, "Test", "Test message"
        )
    assert result["reason"] == "vapid_configuration_missing"


def test_email_skips_when_configuration_is_missing(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NOTIFICATION_DELIVERY_ENABLED", "true")
    for key in ("SMTP_HOST", "EMAIL_FROM", "SMTP_USERNAME", "SMTP_PASSWORD"):
        monkeypatch.delenv(key, raising=False)
    result = email_notifications.send_email(
        "supervisor@example.test", "Test", "No live email is sent."
    )
    assert result == {"status": "skipped", "reason": "email_configuration_missing"}


def test_sms_skips_when_configuration_is_missing(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NOTIFICATION_DELIVERY_ENABLED", "true")
    for key in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"):
        monkeypatch.delenv(key, raising=False)
    result = sms_notifications.send_sms("+10000000000", "Test")
    assert result == {"status": "skipped", "reason": "sms_configuration_missing"}


def test_sms_preference_disabled_skips_notification(
    client, database, monkeypatch
):
    monkeypatch.setattr(sensor_api, "FIELD_THRESHOLDS", {
        "1": {"irrigation_trigger": 30, "is_validated": True},
    })
    sms = Mock()
    monkeypatch.setattr(notification_delivery, "send_sms", sms)
    response = post_reading(client, moisture=20)

    assert response.status_code == 200
    assert response.json()["notifications"]["sms"]["reason"] == "preference_disabled"
    sms.assert_not_called()
    with database() as db:
        delivery = db.scalar(
            select(NotificationDelivery).where(NotificationDelivery.channel == "sms")
        )
        assert delivery is not None
        assert delivery.status == "skipped"
        assert delivery.reason == "preference_disabled"


def test_unverified_sms_and_disabled_channels_are_not_dispatched(
    database, monkeypatch
):
    with database() as db:
        farmer = db.scalar(select(Farmer))
        farmer.email_enabled = True
        farmer.sms_enabled = True
        farmer.web_push_enabled = False
        field = db.scalar(select(FarmerField))
        alert = Alert(
            farmer_id=farmer.id,
            field_id=field.id,
            alert_type="low_moisture",
            severity="high",
            message="Soil moisture is low.",
            reason="The threshold was crossed.",
        )
        db.add(alert)
        db.commit()
        alert_id = alert.id

    email = Mock(return_value={"status": "sent", "reason": "provider_accepted"})
    sms = Mock()
    push = Mock()
    monkeypatch.setattr(notification_delivery, "send_email", email)
    monkeypatch.setattr(notification_delivery, "send_sms", sms)
    monkeypatch.setattr(notification_delivery, "send_web_push_notification", push)

    with database() as db:
        first_result = notification_delivery.dispatch_alert_notifications(db, alert_id)
        repeated_result = notification_delivery.dispatch_alert_notifications(db, alert_id)

    assert first_result == repeated_result
    assert first_result["in_app"] == {"status": "sent", "reason": "stored_in_app"}
    assert first_result["sms"] == {"status": "skipped", "reason": "phone_unverified"}
    assert first_result["push"] == {"status": "skipped", "reason": "preference_disabled"}
    email.assert_called_once()
    assert email.call_args.args[0] == "test-farmer@example.test"
    sms.assert_not_called()
    push.assert_not_called()


def test_email_provider_failure_is_reported_without_network(
    monkeypatch,
):
    smtp = Mock()
    smtp.__enter__ = Mock(return_value=smtp)
    smtp.__exit__ = Mock(return_value=False)
    smtp.send_message.side_effect = email_notifications.smtplib.SMTPException("mock failure")
    monkeypatch.setattr(email_notifications.smtplib, "SMTP", Mock(return_value=smtp))
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NOTIFICATION_DELIVERY_ENABLED", "true")
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("EMAIL_FROM", "alerts@example.test")

    result = email_notifications.send_email(
        "supervisor@example.test", "Test", "Mocked provider failure."
    )

    assert result == {"status": "failed", "reason": "email_provider_error"}


def test_sms_provider_failure_is_reported_without_network(monkeypatch):
    post = Mock(side_effect=requests.Timeout("mock failure"))
    monkeypatch.setattr(sms_notifications.requests, "post", post)
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NOTIFICATION_DELIVERY_ENABLED", "true")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "test-account")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "test-token")
    monkeypatch.setenv("TWILIO_PHONE_NUMBER", "+10000000001")

    result = sms_notifications.send_sms("+10000000000", "Test")

    assert result == {"status": "failed", "reason": "sms_provider_error"}
    post.assert_called_once()


def test_push_provider_failure_is_reported_without_network(
    database, monkeypatch, tmp_path
):
    key_file = tmp_path / "vapid-test-key.pem"
    key_file.write_text("test-only-key", encoding="utf-8")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NOTIFICATION_DELIVERY_ENABLED", "true")
    monkeypatch.setenv("VAPID_PRIVATE_KEY_PATH", str(key_file))
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:test@example.test")
    webpush = Mock(side_effect=push_notifications.WebPushException("mock failure"))
    monkeypatch.setattr(push_notifications, "webpush", webpush)
    with database() as factory:
        farmer = factory.scalar(select(Farmer))
        farmer.web_push_enabled = True
        factory.add(FarmNotificationSubscription(
            farmer_id=farmer.id,
            endpoint="https://push.example.test/failure",
            p256dh="test-p256dh",
            auth="test-auth",
        ))
        factory.commit()

        result = push_notifications.send_web_push_notification(
            factory, farmer.id, "Test", "Mocked provider failure."
        )

    assert result["status"] == "failed"
    assert result["failed"] == 1
    webpush.assert_called_once()


def test_stale_push_subscription_is_revoked(
    database, monkeypatch, tmp_path
):
    key_file = tmp_path / "vapid-test-key.pem"
    key_file.write_text("test-only-key", encoding="utf-8")
    response = Mock(status_code=410)
    exception = push_notifications.WebPushException("stale", response=response)
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NOTIFICATION_DELIVERY_ENABLED", "true")
    monkeypatch.setenv("VAPID_PRIVATE_KEY_PATH", str(key_file))
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:test@example.test")
    webpush = Mock(side_effect=exception)
    monkeypatch.setattr(push_notifications, "webpush", webpush)
    with database() as factory:
        farmer = factory.scalar(select(Farmer))
        farmer.web_push_enabled = True
        subscription = FarmNotificationSubscription(
            farmer_id=farmer.id,
            endpoint="https://push.example.test/stale",
            p256dh="test-p256dh",
            auth="test-auth",
        )
        factory.add(subscription)
        factory.commit()
        subscription_id = subscription.id

        result = push_notifications.send_web_push_notification(
            factory, farmer.id, "Test", "Stale subscription."
        )
        factory.refresh(subscription)

        assert result["failed"] == 1
        assert subscription.revoked_at is not None
        assert factory.get(FarmNotificationSubscription, subscription_id) is not None
        webpush.assert_called_once()


def test_test_environment_always_disables_provider_calls(monkeypatch):
    smtp = Mock()
    monkeypatch.setattr(email_notifications.smtplib, "SMTP", smtp)
    monkeypatch.setenv("APP_ENV", "testing")
    monkeypatch.setenv("NOTIFICATION_DELIVERY_ENABLED", "true")

    result = email_notifications.send_email(
        "supervisor@example.test", "Test", "Must stay mocked."
    )

    assert result["reason"] == "delivery_disabled"
    smtp.assert_not_called()


def test_database_transaction_failure_does_not_notify(
    database, monkeypatch
):
    monkeypatch.setattr(sensor_api, "FIELD_THRESHOLDS", {
        "1": {"irrigation_trigger": 30, "is_validated": True},
    })
    notifications = Mock()

    def failing_db():
        db = database()
        event.listen(
            db,
            "before_commit",
            lambda _: (_ for _ in ()).throw(SQLAlchemyError("test transaction failure")),
        )
        try:
            yield db
        finally:
            db.close()

    sensor_api.app.dependency_overrides[sensor_api.get_db] = failing_db
    monkeypatch.setattr(notification_delivery, "send_web_push_notification", notifications)
    monkeypatch.setattr(notification_delivery, "send_email", notifications)
    monkeypatch.setattr(notification_delivery, "send_sms", notifications)
    with TestClient(sensor_api.app) as test_client:
        response = post_reading(test_client, moisture=20)

    assert response.status_code == 500
    notifications.assert_not_called()
    with database() as db:
        assert db.scalar(select(func.count()).select_from(FarmerSensorReading)) == 0
        assert db.scalar(select(func.count()).select_from(Alert)) == 0
