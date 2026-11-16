import os

import requests

from alerts.config import notifications_enabled


def send_sms(to_number: str, message: str) -> dict[str, str]:
    if not to_number:
        return {"status": "skipped", "reason": "recipient_not_configured"}
    if not notifications_enabled():
        return {"status": "skipped", "reason": "delivery_disabled"}

    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    auth_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    from_number = os.getenv("TWILIO_PHONE_NUMBER", "").strip()
    if not all((account_sid, auth_token, from_number)):
        return {"status": "skipped", "reason": "sms_configuration_missing"}

    try:
        response = requests.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json",
            data={"To": to_number, "From": from_number, "Body": message},
            auth=(account_sid, auth_token),
            timeout=10,
        )
        response.raise_for_status()
        if response.status_code != 201:
            return {"status": "failed", "reason": "sms_provider_rejected"}
    except (requests.RequestException, ValueError):
        return {"status": "failed", "reason": "sms_provider_error"}

    return {"status": "sent", "reason": "provider_accepted"}
