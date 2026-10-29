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

The optional weather service reads `TOMORROW_API_KEY` and `WEATHER_LOCATION` from the environment or the project `.env` file. It uses bounded request timeouts/retries and an in-memory cache. Responses identify stale cached data. Provider errors do not expose request URLs or API keys in application messages. Weather and forecasts remain unavailable when provider credentials are missing. Users may enter a location or allow a one-time browser geolocation request; public location-query endpoints are limited to 30 requests per minute per client address, while authenticated coordinate requests are limited to 30 per minute per farmer. These limits are in-process; deployments with multiple workers or replicas should also enforce a shared limit at a trusted gateway. Coordinate requests are sent in a POST body, bypass weather caching, and are not saved to the account, database, request URL, or browser storage. The browser stores a manually chosen place name only. Coordinates are sent to Tomorrow.io for weather and to OpenStreetMap Nominatim for locality lookup; locality results are cached in memory, and geocoding failures display “Current location.” If location access is unavailable, the app can use the manual place or optional `WEATHER_LOCATION` fallback.

The forecast endpoint serves normalized hourly (`timestep=1h`) or daily (`timestep=1d`) provider periods; daily high/low temperatures and precipitation probability are shown when supplied by Tomorrow.io.

The dashboard field carousel and crop timeline use the signed-in farmer's saved field and crop records. A crop's growth stage is shown only when entered by the farmer. A progress percentage, when valid planting and expected-harvest dates are present, is only a linear calendar estimate; without a configured regional crop calendar the crop season is not classified.

## OpenAI Farmer Assistant

The Experimental Model Lab includes an optional educational chat assistant. It uses the official OpenAI Python SDK and Responses API on the server; the browser never receives the API key. Configure `OPENAI_API_KEY` and, optionally, `OPENAI_MODEL` (default `gpt-4.1-mini`) in the application environment or local `.env`, then rebuild/restart the backend. `compose.yaml` forwards these values to the backend container. Leave the key unset to keep the assistant safely unavailable; do not commit real credentials.

`POST /api/assistant/chat` requires an authenticated farmer session and the same CSRF token as other mutations. Questions are limited to 1,500 characters and each farmer is limited to 10 requests per minute per backend process. Provider requests have a 20-second timeout and no automatic retries. Questions are sent to OpenAI and are not stored by the application; avoid sending sensitive personal information. Provider/configuration failures return safe error messages without exposing credentials or upstream response details.

General chat does not receive saved field data, current weather, sensor readings, or Model 2 values. The separate “Check and explain validated estimate” action can only obtain a prediction through the server-side Model 2 path, checks field and crop ownership, and passes the server-generated result—not a browser-supplied number—to the assistant. It preserves the exact prediction separately from generated explanatory text. Model 2 currently has no eligible production model or trusted prediction-time feature source, so this action remains unavailable (HTTP 503); no estimate is fabricated. This assistant is educational and does not control irrigation equipment.

Model 2 integration loads only the metadata-rich production bundle produced by
`model-building/regression/predict_water_requirement.py`. The legacy
`backend/models/model2/model2_water_requirement.joblib` pipeline is not accepted
because it has a different feature contract and lacks the required provenance
and evaluation metadata. The current repository has no production bundle:
`datasets/model2/model2_dataset.csv` does contain a
`required_water_liters` column, but all its rows explicitly identify the target
as `synthetic_stochastic_simulation`, not measured or independently verified.
The audited raw sensor dataset has synthetic provenance and no such target.
The separate Model 3 `liters_total` values are derived from valve duration and
nominal flow rates, so they represent applied-volume estimates, not required
water. There are also no calibrated, field-mapped soil-moisture readings or
measured preceding-24-hour rainfall inputs in the application. See the
[Model 2 evidence and collection plan](model-building/reports/model2_water_requirement_report.md).
The endpoint therefore remains fail-closed with HTTP 503 until eligible labels
and prediction-time inputs are collected and validated.

## Multilingual interface and Sarvam AI

The interface uses a shared translation registry with local translations for common labels in Telugu, Hindi, Kannada, Tamil, Malayalam, Marathi, and Bengali. Approved static UI strings without a local translation can use [Sarvam Translate](https://docs.sarvam.ai/api-reference/text/translate-text) (`sarvam-translate:v1`) when configured. The language selector lists only language codes documented by Sarvam, including Assamese, Bodo, Dogri, Gujarati, Kashmiri, Konkani, Maithili, Manipuri, Nepali, Odia, Punjabi, Sanskrit, Santali, Sindhi, and Urdu. If the provider is unavailable, verified local translations remain available and other text falls back to English.

Set `SARVAM_API_KEY` in the backend environment (or `.env` used by Docker Compose) and rebuild/restart the backend to enable remote translation. The key is only read by the backend and is never placed in browser assets. Leave it empty to retain local translations and English fallback. The public `POST /api/translate` endpoint validates documented language codes and text limits, enforces a limit of 20 requests per client IP per 60 seconds, and accepts up to 16 strings per request. The shared frontend service batches approved UI text (up to 16 strings and 1,800 estimated characters per batch), deduplicates concurrent translations, and keeps up to 512 successful translations in the browser tab's session cache. This request limit permits up to 320 short strings per minute while retaining a per-client guard; the frontend uses local dictionaries first and stops sending translation requests during the `Retry-After` period after a provider rate limit. Only authored UI strings are eligible for remote translation; farmer-entered content, credentials, field/crop identifiers, and weather/model values are excluded. Numeric values are kept intact. Important model and safety labels use local dictionary entries. Provider failures preserve local/English fallback text without triggering immediate retries. Backend translation caching and rate limits are per process; use an API gateway/shared rate limiter for multi-worker or replicated deployments.

### Adding translation-ready UI

- Add a stable key to `translationKeys` in `static/i18n.js`, such as `fields.title` or `actions.save`, and use `data-i18n-key="fields.title"` in markup or `JalSaathiI18n.t("fields.title")` in JavaScript. Keep the English source and local dictionary entries in sync.
- For dynamically rendered UI, put `data-i18n-static` on the trusted UI container and call `JalSaathiI18n.translate(container)` after rendering. The shared observer also translates later child insertions and reapplies the selected language on language changes. Only strings under an explicitly trusted static UI container or registered by a stable translation key may use Sarvam; do not approve an entire page or a container with user-provided text.
- Mark farmer/user-supplied values with `data-user-content`; do not mark a parent containing such values as trusted static UI unless those values are individually excluded. Use `data-i18n-crop` only for exact, known crop names so the local dictionary can translate the display without changing stored names or API values.
- Keep labels and numeric/weather/model values in separate elements. Add `data-i18n-ignore` to live values that must remain unchanged.
- To audit a rendered page in development, open it with `?i18nCheck=1` and inspect the console report, or run `JalSaathiI18n.audit()`; it reports missing local keys and static UI text still unchanged in the selected locale.

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
node --check static/i18n.js
node --check static/farmer-assistant.js
node --test tests_js/*.test.cjs tests/test_weather_frontend.cjs
```

## Current integration limits

- Historical sensor readings remain a synthetic or synthetic-augmented dataset, not live sensor telemetry.
- No live sensor ingestion or irrigation recommendation engine is connected.
- No irrigation time or duration should be treated as a recommendation from this application.

See [reports/APPLICATION_HEALTH_REPORT.md](reports/APPLICATION_HEALTH_REPORT.md) for the audit evidence and deployment status.
