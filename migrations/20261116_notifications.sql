ALTER TABLE farmers
    ADD COLUMN IF NOT EXISTS web_push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_farmer_fields_id_owner
    ON farmer_fields (id, farmer_id);

CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    farmer_id INTEGER NOT NULL,
    field_id INTEGER NOT NULL,
    alert_type VARCHAR(80) NOT NULL,
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
    message VARCHAR(500) NOT NULL,
    reason TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(16) NOT NULL DEFAULT 'unresolved'
        CHECK (status IN ('unresolved', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_alerts_owned_field
        FOREIGN KEY (field_id, farmer_id)
        REFERENCES farmer_fields (id, farmer_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_alerts_farmer_created
    ON alerts (farmer_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_unresolved_field_type
    ON alerts (farmer_id, field_id, alert_type)
    WHERE status = 'unresolved';

CREATE UNIQUE INDEX IF NOT EXISTS uq_farm_notification_active_endpoint
    ON farm_notification_subscriptions (endpoint)
    WHERE revoked_at IS NULL;
