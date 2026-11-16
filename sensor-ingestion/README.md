# JalSaathi notifications and sensor ingestion

## Architecture

The sensor API runs separately on port `8003`; the main JalSaathi FastAPI app remains on `8001`, the Farmer PWA on `8000`, and PostgreSQL on host port `5434`. The sensor API authenticates `X-Sensor-Token` against a registered `FarmerSensorDevice`, verifies its field ownership, and saves readings to the existing `farmer_sensor_readings` table. Threshold-triggered alerts use the `alerts` table and a partial unique index so an unresolved alert of the same type is created and notified only once.

Push subscriptions reuse `farm_notification_subscriptions`. Push, supervisor email, and farmer SMS are attempted after the reading and alert transaction commits. Provider outcomes are returned as `sent`, `failed`, or `skipped`; a skipped channel is not represented as a successful delivery.

## Environment

Use the existing database settings (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`). In Docker, the database host is `db` and port is `5432`; on the host, use `127.0.0.1:5434`.

Notification delivery is disabled unless `NOTIFICATION_DELIVERY_ENABLED=true`. It is always disabled when `APP_ENV=test` or `APP_ENV=testing`. Farmer notification preferences default to off. `FIELD_SOIL_MOISTURE_THRESHOLDS` is a JSON object keyed by registered numeric field IDs, with a threshold from 0 to 100, for example `{"12":28}`. Configure only agronomically validated thresholds; an empty object creates no soil-moisture alerts.

Email uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_USE_TLS`, and `EMAIL_FROM`; `SUPERVISOR_EMAIL` selects the optional supervisor recipient. SMS uses `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER`, and additionally requires the farmer's SMS preference and phone number. Browser push uses `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY_PATH`, and `VAPID_SUBJECT`. Mount the private key into the service using a read-only secret mount and set its in-container path. Never put private credentials in source control or logs.

## Safe automated tests

Tests use an isolated in-memory SQLite database and mock every external provider. They do not connect to SMTP, Twilio, or browser push services.

```powershell
$env:APP_ENV = "testing"
$env:NOTIFICATION_DELIVERY_ENABLED = "false"
.\.venv\Scripts\python.exe -m pytest -q tests\test_notifications.py
```

Provider-failure tests replace the SMTP/Twilio/Web Push call with mocks before enabling the delivery flag; they do not send live requests.

## Database migration

The migration is additive and idempotent. It adds disabled-by-default notification preference columns, the alert table, and uniqueness indexes; it does not delete or rewrite existing rows.

```powershell
Get-Content migrations\20261116_notifications.sql | docker exec -i jalsaathi_m3_test_db psql -v ON_ERROR_STOP=1 -U irrigation_user -d smart_irrigation_db
```

Verify the table and columns with read-only `information_schema` queries before starting the updated backend. Do not drop or truncate tables.

## Start the API

From the repository root, using the existing M3 test Compose project:

```powershell
docker compose -p jalsaathi_m3_test -f compose.yaml -f compose.m3-test.yaml up -d --no-deps --build sensor-ingestion
Invoke-WebRequest http://127.0.0.1:8003/
Invoke-WebRequest http://127.0.0.1:8003/docs
```

`/ready` also checks database connectivity. The service uses the same database and model definitions as the main app; it does not create another database.

## Run the simulator

Only send readings for an explicitly registered device/field and a valid device token. The API token is stored as a hash and cannot be recovered from the database. If the registration token is unavailable, do not bypass authentication; use the isolated automated tests instead.

```powershell
$env:SENSOR_API_URL = "http://127.0.0.1:8003"
$env:SENSOR_ID = "<registered-device-id>"
$env:SENSOR_FIELD_ID = "<registered-field-id>"
$env:SENSOR_TOKEN = "<securely-held-registration-token>"
python sensor-ingestion\simulator\sensor_simulator.py
```

The simulator does not print the token. Running it against the shared database writes a real sensor reading, so automated verification should use the mock-backed tests.

## Troubleshooting

- `401`: the sensor token is missing or does not match the stored registration hash.
- `404`: the sensor is not active/registered, or its field mapping does not match.
- `503` from `/ready`: check that the existing PostgreSQL container is healthy and that the API has the correct `DB_*` values.
- No alert: verify the exact registered field ID and its validated threshold in `FIELD_SOIL_MOISTURE_THRESHOLDS`; no threshold is enabled by default.
- Notifications skipped: check the global delivery opt-in, `APP_ENV`, farmer preferences, configured provider variables, and push subscriptions. A skipped result means no provider call was made.
- Push `503` from `/api/push/public-key`: configure a valid VAPID key pair and subject, then restart only the relevant service.
- Provider failure: check provider-side configuration privately; logs intentionally omit credentials, phone numbers, and full provider responses.
