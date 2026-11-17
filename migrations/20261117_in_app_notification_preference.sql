BEGIN;

ALTER TABLE farmers
    ADD COLUMN IF NOT EXISTS in_app_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE notification_deliveries
    DROP CONSTRAINT IF EXISTS ck_notification_deliveries_channel;

ALTER TABLE notification_deliveries
    DROP CONSTRAINT IF EXISTS notification_deliveries_channel_check;

ALTER TABLE notification_deliveries
    ADD CONSTRAINT ck_notification_deliveries_channel
    CHECK (channel IN ('in_app', 'email', 'sms', 'push'));

COMMIT;
