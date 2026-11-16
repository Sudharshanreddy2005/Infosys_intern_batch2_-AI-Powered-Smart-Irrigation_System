import os
import smtplib
from email.message import EmailMessage
from email.utils import parseaddr

from alerts.config import notifications_enabled


def send_email(to_email: str, subject: str, message: str) -> dict[str, str]:
    if not to_email:
        return {"status": "skipped", "reason": "recipient_not_configured"}
    if not notifications_enabled():
        return {"status": "skipped", "reason": "delivery_disabled"}

    host = os.getenv("SMTP_HOST", "").strip()
    sender = os.getenv("EMAIL_FROM", "").strip()
    username = os.getenv("SMTP_USERNAME", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    try:
        port = int(os.getenv("SMTP_PORT", "587"))
    except ValueError:
        return {"status": "skipped", "reason": "invalid_smtp_port"}
    tls_setting = os.getenv("SMTP_USE_TLS", "true").strip().casefold()
    if tls_setting not in {"1", "true", "yes", "on", "0", "false", "no", "off"}:
        return {"status": "skipped", "reason": "invalid_smtp_tls_setting"}
    use_tls = tls_setting in {"1", "true", "yes", "on"}

    if (
        not host
        or not parseaddr(sender)[1]
        or not parseaddr(to_email)[1]
        or (username and not password)
        or (password and not username)
    ):
        return {"status": "skipped", "reason": "email_configuration_missing"}
    if not 1 <= port <= 65535:
        return {"status": "skipped", "reason": "invalid_smtp_port"}

    email = EmailMessage()
    email["From"] = sender
    email["To"] = to_email
    email["Subject"] = subject
    email.set_content(message)

    try:
        with smtplib.SMTP(host, port, timeout=10) as smtp:
            if use_tls:
                smtp.starttls()
            if username:
                smtp.login(username, password)
            refused = smtp.send_message(email)
            if refused:
                return {"status": "failed", "reason": "email_recipient_rejected"}
    except (OSError, smtplib.SMTPException):
        return {"status": "failed", "reason": "email_provider_error"}

    return {"status": "sent", "reason": "provider_accepted"}
