from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class NotificationPreferencesUpdate(BaseModel):
    web_push_enabled: bool | None = None
    sms_enabled: bool | None = None
    email_enabled: bool | None = None


class PushSubscriptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: str = Field(min_length=8, max_length=500)
    expirationTime: int | None = Field(default=None, ge=0)
    keys: dict[str, str]

    @field_validator("keys")
    @classmethod
    def validate_keys(cls, keys: dict[str, str]) -> dict[str, str]:
        if not keys.get("p256dh") or not keys.get("auth"):
            raise ValueError("Push subscription keys are incomplete.")
        return keys


class AlertSchema(BaseModel):
    field_id: int
    alert_type: str
    severity: Literal["low", "medium", "high"]
    message: str = Field(max_length=500)
    reason: str
    status: Literal["unresolved", "resolved"] = "unresolved"
    is_read: bool = False