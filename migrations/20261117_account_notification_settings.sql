BEGIN;

ALTER TABLE farmers
    ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS notification_deliveries (
    id SERIAL PRIMARY KEY,
    alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    farmer_id INTEGER NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
    channel VARCHAR(16) NOT NULL
        CHECK (channel IN ('email', 'sms', 'push')),
    status VARCHAR(16) NOT NULL
        CHECK (status IN ('pending', 'sent', 'partial', 'skipped', 'failed')),
    reason VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    CONSTRAINT uq_notification_deliveries_alert_channel UNIQUE (alert_id, channel)
);

CREATE INDEX IF NOT EXISTS ix_notification_deliveries_farmer_created
    ON notification_deliveries (farmer_id, created_at);

COMMIT;
