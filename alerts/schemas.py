from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel


class AlertSchema(BaseModel):
    field_id: str
    alert_type: str
    severity: Literal["low", "medium", "high"]
    message: str
    reason: str
    created_at: datetime
    status: Literal["unresolved", "resolved"] = "unresolved"
    is_read: bool = False


class AlertResponse(BaseModel):
    alert_generated: bool
    alert: Optional[AlertSchema] = None
    message: str

class NotificationPreferences(BaseModel):
    web_push_enabled: bool = True
    sms_enabled: bool = False
    email_enabled: bool = False

class NotificationPreferencesUpdate(BaseModel):
    web_push_enabled: Optional[bool] = None
    sms_enabled: Optional[bool] = None
    email_enabled: Optional[bool] = None

class PushSubscriptionRequest(BaseModel):
    endpoint: str
    expirationTime: Optional[int] = None
    keys: dict[str, str]