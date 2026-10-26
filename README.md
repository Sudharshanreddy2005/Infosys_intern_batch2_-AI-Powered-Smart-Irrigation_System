# JalSaathi Smart Irrigation

JalSaathi is a FastAPI service with a browser dashboard, historical PostgreSQL sensor records, and an optional Tomorrow.io weather integration.

## Run locally with Docker Compose

1. If this is a new installation, copy `.env.example` to `.env` and set `DB_PASSWORD`. For an existing database volume, keep its current database password; do not replace it with a new value or remove the volume.
2. Set `TOMORROW_API_KEY` in `.env` to enable provider weather. `WEATHER_LOCATION` is an optional fallback location for requests without live coordinates or a manually selected place.
3. Start the application without removing persistent data:

   ```powershell
   docker compose up --build -d
   ```

   The PostgreSQL data is stored in the `postgres_data` named volume. Do not use `docker compose down -v` if you need to retain it.

4. Open `http://localhost:8000/` for the public JalSaathi landing page. Register or sign in with an email address; successful sign-in opens `/dashboard`, which requires an active farmer session. API health checks are available at `/health` (process liveness), `/ready` (database readiness), and `/db-test`.

The backend image includes the frontend templates, static assets, ORM models, and weather integration. At startup, SQLAlchemy `create_all` adds missing farmer, session, field, and crop tables without dropping or rewriting existing tables. This is an additive bootstrap only; future schema changes require reviewed migrations. Compose waits for PostgreSQL health before starting the backend and checks backend readiness afterward.

## Historical sensor data

`GET /sensor-readings?limit=100` returns the newest bounded records from the existing `sensor_readings` table. The response explicitly marks these as historical, not live telemetry, and includes the stored `data_origin` classification. Dataset `field_id` values are not assumed to identify farmer-owned fields.

## Farmer accounts and data

- `POST /api/auth/register`, `POST /api/auth/login`, `GET/PATCH /api/auth/me`, and `POST /api/auth/logout` manage farmer accounts and sessions.
- Passwords are hashed with Argon2id. The browser receives an HttpOnly session cookie while PostgreSQL stores only its SHA-256 digest. A separate readable CSRF cookie is required in the `X-CSRF-Token` header for mutations; unsafe cross-origin requests are rejected.
- Sessions expire server-side after `SESSION_TTL_HOURS` (1–720; default 12). Login and registration attempts have an in-process per-IP limit. For multiple backend workers or replicas, enforce equivalent limits at a shared gateway.
- `APP_ENV=production` enables Secure cookies; serve the app over HTTPS in production. Development defaults to non-Secure cookies for local HTTP. Set `COOKIE_SECURE=true` when TLS is terminated before the app and the environment is not marked production.
- `GET/POST /api/fields`, `GET/PATCH/DELETE /api/fields/{id}`, and the corresponding `/api/crops` endpoints only expose the authenticated farmer's records. Crop-to-field links are validated against field ownership.
- Existing browser-local demonstration data is left intact but is not used as authenticated farmer data.

`load_dataset.py` is a one-time importer for `data/cleaned_dataset.csv`. It refuses to run if `sensor_readings` already exists; inspect and back up existing data before considering any replacement. It does not drop tables or volumes.

## Weather configuration

The optional weather service reads `TOMORROW_API_KEY` and `WEATHER_LOCATION` from the environment or the project `.env` file. It uses bounded request timeouts/retries and an in-memory cache. Responses identify stale cached data. Provider errors do not expose request URLs or API keys in application messages. Weather and forecasts remain unavailable when provider credentials are missing. Users may enter a location or allow a one-time browser geolocation request; authenticated coordinate requests are limited to 30 per minute, sent in a POST body, bypass weather caching, and are not saved to the account, database, request URL, or browser storage. The browser stores a manually chosen place name only. Coordinates are sent to Tomorrow.io for weather and to OpenStreetMap Nominatim for locality lookup; locality results are cached in memory, and geocoding failures display “Current location.” If location access is unavailable, the app can use the manual place or optional `WEATHER_LOCATION` fallback.

The forecast endpoint serves normalized hourly (`timestep=1h`) or daily (`timestep=1d`) provider periods; daily high/low temperatures and precipitation probability are shown when supplied by Tomorrow.io.

The dashboard field carousel and crop timeline use the signed-in farmer's saved field and crop records. A crop's growth stage is shown only when entered by the farmer. A progress percentage, when valid planting and expected-harvest dates are present, is only a linear calendar estimate; without a configured regional crop calendar the crop season is not classified.

## Tests and development

Install development dependencies and run focused tests:

```powershell
python -m pip install -r requirements-dev.txt
python -m pytest tests weather_api/integrations/test_cache.py
node --check static/auth.js
node --check static/app.js
node --check static/sections.js
node --check static/weather.js
node --check static/landing.js
node --check static/field-store.js
node --check static/profile-store.js
```

## Current integration limits

- Historical sensor readings remain a synthetic or synthetic-augmented dataset, not live sensor telemetry.
- No live sensor ingestion or irrigation recommendation engine is connected.
- No irrigation time or duration should be treated as a recommendation from this application.

See [reports/APPLICATION_HEALTH_REPORT.md](reports/APPLICATION_HEALTH_REPORT.md) for the audit evidence and deployment status.
