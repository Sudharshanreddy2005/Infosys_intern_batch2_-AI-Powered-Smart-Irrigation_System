import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from alerts.config import notifications_enabled
from models import FarmNotificationSubscription, Farmer


def send_web_push_notification(
    db: Session,
    farmer_id: int,
    title: str,
    message: str,
) -> dict[str, int | str]:
    if not notifications_enabled():
        return {"status": "skipped", "reason": "delivery_disabled", "sent": 0, "failed": 0}

    farmer = db.get(Farmer, farmer_id)
    if farmer is None or not farmer.web_push_enabled:
        return {"status": "skipped", "reason": "preference_disabled", "sent": 0, "failed": 0}

    subscriptions = db.scalars(
        select(FarmNotificationSubscription).where(
            FarmNotificationSubscription.farmer_id == farmer_id,
            FarmNotificationSubscription.revoked_at.is_(None),
        )
    ).all()
    if not subscriptions:
        return {"status": "skipped", "reason": "subscription_missing", "sent": 0, "failed": 0}

    private_key = os.getenv("VAPID_PRIVATE_KEY_PATH", "").strip()
    subject = os.getenv("VAPID_SUBJECT", "").strip()
    subject_parts = urlsplit(subject)
    valid_subject = (
        subject.startswith("mailto:") and bool(subject[7:])
    ) or (
        subject_parts.scheme == "https" and bool(subject_parts.netloc)
    )
    if not private_key or not valid_subject:
        return {"status": "skipped", "reason": "vapid_configuration_missing", "sent": 0, "failed": 0}

    key_path = Path(private_key)
    if not key_path.is_file():
        return {"status": "skipped", "reason": "vapid_private_key_unavailable", "sent": 0, "failed": 0}

    sent = 0
    failed = 0
    stale = []
    for subscription in subscriptions:
        if not subscription.p256dh or not subscription.auth:
            failed += 1
            continue
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=json.dumps(
                    {"title": title, "body": message, "url": "/dashboard"}
                ),
                vapid_private_key=str(key_path),
                vapid_claims={"sub": subject},
            )
        except WebPushException as error:
            failed += 1
            if error.response is not None and error.response.status_code in {404, 410}:
                stale.append(subscription)
        except (OSError, ValueError, TypeError):
            failed += 1
        else:
            sent += 1

    if stale:
        for subscription in stale:
            subscription.revoked_at = datetime.now(timezone.utc)
        try:
            db.commit()
        except SQLAlchemyError:
            db.rollback()
            logging.error("Failed to persist stale browser push subscription cleanup.")

    status = "sent" if sent and not failed else "partial" if sent else "failed" if failed else "skipped"
    return {"status": status, "reason": "provider_results", "sent": sent, "failed": failed}
