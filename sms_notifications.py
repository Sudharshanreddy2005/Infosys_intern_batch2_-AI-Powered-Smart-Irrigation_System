
import os
import logging
from twilio.rest import Client
from dotenv import load_dotenv

load_dotenv()

def send_sms(to_number, message):
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    from_number = os.getenv("TWILIO_PHONE_NUMBER")

    if not all([account_sid, auth_token, from_number, to_number]):
        logging.error("Twilio configuration or recipient number is missing.")
        return False

    try:
        client = Client(account_sid, auth_token)

        sms = client.messages.create(
            body=message,
            from_=from_number,
            to=to_number
        )

        logging.info("SMS submitted to Twilio. SID: %s", sms.sid)
        return True

    except Exception:
        logging.exception("Failed to send SMS notification.")
        return False
