import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from email_notifications import send_email
from models import Alert, Farmer, NotificationDelivery
from push_notifications import send_web_push_notification
from sms_notifications import send_sms

CHANNELS = ("in_app", "email", "sms", "push")
_E164_PHONE = re.compile(r"^\+[1-9]\d{7,14}$")


def _channel_decision(farmer: Farmer, channel: str) -> tuple[bool, str]:
    if channel == "in_app":
        if not farmer.in_app_notifications_enabled:
            return False, "preference_disabled"
        return True, "stored_in_app"

    if channel == "email":
        if not farmer.email_enabled:
            return False, "preference_disabled"
        if not farmer.email:
            return False, "recipient_not_configured"
        return True, "awaiting_delivery"

    if channel == "sms":
        if not farmer.sms_enabled:
            return False, "preference_disabled"
        if not farmer.phone:
            return False, "recipient_not_configured"
        if farmer.phone_verified_at is None:
            return False, "phone_unverified"
        phone = re.sub(r"[\s()-]", "", farmer.phone)
        if not _E164_PHONE.fullmatch(phone):
            return False, "invalid_phone_number"
        return True, "awaiting_delivery"

    if channel == "push":
        if not farmer.web_push_enabled:
            return False, "preference_disabled"
        return True, "awaiting_delivery"

    raise ValueError(f"Unsupported notification channel: {channel}")


def _delivery_result(db: Session, alert_id: int) -> dict[str, dict[str, str]]:
    rows = db.scalars(
        select(NotificationDelivery).where(NotificationDelivery.alert_id == alert_id)
    ).all()
    return {
        row.channel: {"status": row.status, "reason": row.reason}
        for row in rows
    }


def dispatch_alert_notifications(db: Session, alert_id: int) -> dict[str, dict[str, str]]:
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise LookupError(f"Alert {alert_id} does not exist.")

    existing = _delivery_result(db, alert_id)
    if existing:
        return existing

    farmer = db.get(Farmer, alert.farmer_id)
    if farmer is None:
        raise LookupError(f"Farmer {alert.farmer_id} for alert {alert_id} does not exist.")

    rows: dict[str, NotificationDelivery] = {}
    for channel in CHANNELS:
        should_send, reason = _channel_decision(farmer, channel)
        if channel == "in_app":
            status = "sent" if should_send else "skipped"
            completed_at = datetime.now(timezone.utc)
        else:
            status = "pending" if should_send else "skipped"
            completed_at = None if should_send else datetime.now(timezone.utc)
        row = NotificationDelivery(
            alert_id=alert.id,
            farmer_id=farmer.id,
            channel=channel,
            status=status,
            reason=reason,
            completed_at=completed_at,
        )
        db.add(row)
        rows[channel] = row

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = _delivery_result(db, alert_id)
        if existing:
            return existing
        raise

    for channel, row in rows.items():
        if row.status != "pending":
            continue

        farmer = db.scalar(
            select(Farmer)
            .where(Farmer.id == alert.farmer_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if farmer is None:
            raise LookupError(f"Farmer {alert.farmer_id} for alert {alert_id} does not exist.")

        permitted, reason = _channel_decision(farmer, channel)
        if not permitted:
            result: dict[str, str | int] = {"status": "skipped", "reason": reason}
        elif channel == "email":
            result = send_email(farmer.email, alert.alert_type, alert.message)
        elif channel == "sms":
            phone = re.sub(r"[\s()-]", "", farmer.phone or "")
            result = send_sms(phone, alert.message)
        else:
            result = send_web_push_notification(
                db, farmer.id, alert.alert_type, alert.message
            )

        status = result.get("status")
        delivery_reason = result.get("reason")
        if status not in {"sent", "partial", "skipped", "failed"} or not isinstance(
            delivery_reason, str
        ):
            raise ValueError(f"Invalid {channel} notification provider result.")

        row.status = status
        row.reason = delivery_reason[:120]
        row.completed_at = datetime.now(timezone.utc)
        db.commit()
        logging.info(
            "Alert notification delivery recorded: alert_id=%s channel=%s status=%s",
            alert_id,
            channel,
            status,
        )

    return _delivery_result(db, alert_id)
