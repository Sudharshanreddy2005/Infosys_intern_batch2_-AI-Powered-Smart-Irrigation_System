import json
import logging
import os
from pathlib import Path

from pywebpush import webpush, WebPushException
from alerts.config import ALLOW_REAL_NOTIFICATIONS

from models import Farmer, PushSubscription


def send_web_push_notification(db, farmer_id, title, message):
    if not ALLOW_REAL_NOTIFICATIONS:
        logging.info("Real push notifications are disabled.")
        return
    # Check whether the farmer has enabled browser notifications
    farmer = db.query(Farmer).filter(
        Farmer.id == farmer_id
    ).first()

    if not farmer or not farmer.web_push_enabled:
        return

    # Get the farmer's saved browser subscriptions
    subscriptions = db.query(PushSubscription).filter(
        PushSubscription.farmer_id == farmer_id
    ).all()

    if not subscriptions:
        return

    # Locate the VAPID private key
    private_key_path = os.getenv("VAPID_PRIVATE_KEY_PATH")

    if not private_key_path:
        logging.error("VAPID private key path is not configured.")
        return

    key_path = Path(private_key_path)

    if not key_path.is_absolute():
        key_path = Path(__file__).resolve().parent / key_path

    if not key_path.is_file():
        logging.error("VAPID private key file was not found.")
        return

    # Send notification to each subscribed browser
    stale_subscriptions = []

    for subscription in subscriptions:
        try:
            webpush(
                subscription_info=subscription.subscription_data,
                data=json.dumps({
                    "title": title,
                    "body": message,
                    "url": "/dashboard",
                }),
                vapid_private_key=str(key_path),
                vapid_claims={
                    "sub": os.getenv(
                        "VAPID_SUBJECT",
                        "mailto:admin@example.com",
                    )
                },
            )

            logging.info(
                "Push notification sent to farmer %s",
                farmer_id,
            )

        except WebPushException as error:
            logging.error("Web Push failed: %s", error)

            if (
                error.response
                and error.response.status_code in (404, 410)
            ):
                stale_subscriptions.append(subscription)

    # Remove expired browser subscriptions
    for subscription in stale_subscriptions:
        db.delete(subscription)

    if stale_subscriptions:
        db.commit()
