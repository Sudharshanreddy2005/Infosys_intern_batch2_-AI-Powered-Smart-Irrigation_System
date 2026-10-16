# JalSaathi Smart Irrigation

JalSaathi is a FastAPI service with a browser dashboard, historical PostgreSQL sensor records, and an optional Tomorrow.io weather integration.

## Run locally with Docker Compose

1. If this is a new installation, copy `.env.example` to `.env` and set `DB_PASSWORD`. For an existing database volume, keep its current database password; do not replace it with a new value or remove the volume.
2. Optionally set `TOMORROW_API_KEY` and `WEATHER_LOCATION` in `.env`. The location can be a Tomorrow.io-supported location string or `latitude,longitude`. Without both values, weather endpoints report that weather is unavailable.
3. Start the application without removing persistent data:

   ```powershell
   docker compose up --build -d
   ```

   The PostgreSQL data is stored in the `postgres_data` named volume. Do not use `docker compose down -v` if you need to retain it.

4. Open `http://localhost:8000/`. API health checks are available at `/health` (process liveness), `/ready` (database readiness), and `/db-test`.

The backend image includes the frontend templates, static assets, and weather integration. Compose waits for PostgreSQL health before starting the backend and checks backend readiness afterward.

## Historical sensor data

`GET /sensor-readings?limit=100` returns the newest bounded records from the existing `sensor_readings` table. The response explicitly marks these as historical, not live telemetry, and includes the stored `data_origin` classification. My Fields presents these records separately from browser-local field examples; dataset `field_id` values are not assumed to identify the sample fields.

`load_dataset.py` is a one-time importer for `data/cleaned_dataset.csv`. It refuses to run if `sensor_readings` already exists; inspect and back up existing data before considering any replacement. It does not drop tables or volumes.

## Weather configuration

The optional weather service reads `TOMORROW_API_KEY` and `WEATHER_LOCATION` from the environment or the project `.env` file. It uses bounded request timeouts/retries and an in-memory cache. Responses identify stale cached data. Provider errors do not expose request URLs or API keys in application messages. Weather and forecasts remain unavailable when credentials or location are missing.

## Tests and development

Install development dependencies and run focused tests:

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest tests weather_api/integrations/test_cache.py
node --check static/app.js
node --check static/sections.js
node --check static/field-store.js
```

## Current integration limits

- Browser-local field/profile examples are demonstrations only and are not stored in PostgreSQL.
- Historical sensor readings are a synthetic or synthetic-augmented dataset, not live sensor telemetry.
- Farmer/field/crop server CRUD APIs, real authentication, live sensor ingestion, and an irrigation recommendation engine are not implemented. The management page identifies its persistence limitation instead of presenting its forms as working.
- No irrigation time or duration should be treated as a recommendation from this application.

See [reports/APPLICATION_HEALTH_REPORT.md](reports/APPLICATION_HEALTH_REPORT.md) for the audit evidence and deployment status.
