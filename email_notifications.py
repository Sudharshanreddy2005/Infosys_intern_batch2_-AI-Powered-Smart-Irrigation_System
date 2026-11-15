
import os
import logging

from dotenv import load_dotenv
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail

# Load environment variables from project root
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(ROOT_DIR, ".env"))


def send_email(to_email, subject, message):
    api_key = os.getenv("SENDGRID_API_KEY")
    from_email = os.getenv("SENDGRID_FROM_EMAIL")

    if not api_key or not from_email or not to_email:
        logging.error("SendGrid configuration or recipient email is missing.")
        return False

    try:
        email = Mail(
            from_email=from_email,
            to_emails=to_email,
            subject=subject,
            plain_text_content=message
        )

        client = SendGridAPIClient(api_key)
        response = client.send(email)

        logging.info("SendGrid email response: %s", response.status_code)

        return response.status_code in (200, 201, 202)

    except Exception:
        logging.exception("Failed to send email notification.")
        return False
