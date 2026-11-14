ALTER TABLE farmer_fields
    ADD CONSTRAINT uq_farmer_fields_id_owner UNIQUE (id, farmer_id);

CREATE TABLE farmer_sensor_readings (
    id SERIAL PRIMARY KEY,
    farmer_id INTEGER NOT NULL
        REFERENCES farmers(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    soil_moisture_percent DOUBLE PRECISION,
    soil_temperature_c DOUBLE PRECISION,
    humidity_percent DOUBLE PRECISION,
    source VARCHAR(32) NOT NULL DEFAULT 'sensor',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_farmer_sensor_readings_owned_field
        FOREIGN KEY (field_id, farmer_id)
        REFERENCES farmer_fields(id, farmer_id) ON DELETE CASCADE,
    CONSTRAINT ck_farmer_sensor_readings_has_measurement
        CHECK (
            soil_moisture_percent IS NOT NULL
            OR soil_temperature_c IS NOT NULL
            OR humidity_percent IS NOT NULL
        ),
    CONSTRAINT ck_farmer_sensor_readings_moisture_range
        CHECK (
            soil_moisture_percent IS NULL
            OR (soil_moisture_percent >= 0 AND soil_moisture_percent <= 100)
        ),
    CONSTRAINT ck_farmer_sensor_readings_humidity_range
        CHECK (
            humidity_percent IS NULL
            OR (humidity_percent >= 0 AND humidity_percent <= 100)
        ),
    CONSTRAINT ck_farmer_sensor_readings_temperature_range
        CHECK (
            soil_temperature_c IS NULL
            OR (soil_temperature_c >= -50 AND soil_temperature_c <= 100)
        ),
    CONSTRAINT ck_farmer_sensor_readings_source
        CHECK (source IN ('sensor', 'farmer_entered', 'test_fixture'))
);

CREATE INDEX ix_farmer_sensor_readings_owner_field_time
    ON farmer_sensor_readings (farmer_id, field_id, recorded_at);
