# JalSaathi Smart Irrigation

JalSaathi is a Next.js farmer PWA backed by FastAPI and PostgreSQL, with an optional host-run crop disease service and weather integration.

## Run locally with Docker Compose

1. If this is a new installation, copy `.env.example` to `.env` and set `DB_PASSWORD`. For an existing database volume, keep its current database password; do not replace it with a new value or remove the volume.
2. Set `TOMORROW_API_KEY` in `.env` to enable provider weather. `WEATHER_LOCATION` is an optional fallback location for requests without live coordinates or a manually selected place.
3. Start the application without removing persistent data:

   ```powershell
   docker compose config --services
   docker compose build
   docker compose up -d
   docker compose ps
   ```

   The PostgreSQL data is stored in the `postgres_data` named volume. Do not use `docker compose down -v` if you need to retain it.

4. Open the Next.js PWA at `http://localhost:8000/`. FastAPI is available at `http://localhost:8002/` (`/health` for liveness and `/ready` for database readiness); PostgreSQL is exposed at `localhost:5433`. The PWA proxies API calls to the Compose service at `http://backend:8000`, and PostgreSQL is reached at `db:5432`. The Compose deployment keeps the existing `postgres_data` volume.

The PWA includes English, Telugu, Hindi, Kannada, Tamil, and Malayalam. The dedicated legacy JalSaathi AI page uses the authenticated `/api/assistant/chat` endpoint in chart mode with Gemini; its API key remains server-side. Non-persistent chart-assistant requests, including the existing PWA and shared modal, retain the OpenAI provider. The legacy `/api/assistant/image` endpoint sends an uploaded leaf image to the separate crop disease detector on host port `8001`, then sends only its validated prediction and the authenticated farmer context to Gemini. The image is not saved by the application. The backend uses `CROP_DISEASE_API_URL`; keep the service running and set that variable if its host address differs. The legacy backend is available at `http://localhost:8002`.

The backend image includes the frontend templates, static assets, ORM models, and weather integration. At startup, SQLAlchemy `create_all` adds missing farmer, session, field, crop, and assistant-conversation tables without dropping or rewriting existing tables. This is an additive bootstrap only; future schema changes require reviewed migrations. Compose waits for PostgreSQL health before starting the backend and checks backend readiness afterward.

## Historical sensor data

`GET /sensor-readings?limit=100` returns the newest bounded records from the existing `sensor_readings` table. The response explicitly marks these as historical, not live telemetry, and includes the stored `data_origin` classification. Dataset `field_id` values are not assumed to identify farmer-owned fields.

Farmer-linked measurements use the separate `farmer_sensor_readings` table, whose rows are constrained to the owning farmer and field. The additive SQL migration is `migrations/001_add_farmer_sensor_readings.sql`; review and apply it explicitly to the intended database before starting a backend build that includes the new ORM model. No migration is run automatically by this change. The historical `sensor_readings` dataset is not used as a farmer's sensor history. This repository does not yet include a live sensor-ingestion endpoint for the farmer-owned table, so soil history remains unavailable until trusted, correctly owned readings are supplied. Irrigation schedule volumes remain planned values, not measured water consumption.

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

`POST /api/assistant/chat` requires an authenticated farmer session and the same CSRF token as other mutations. Questions are limited to 1,500 characters and each farmer is limited to 10 requests per minute per backend process. Provider requests have a 20-second timeout and no automatic retries. Non-persistent requests are sent to OpenAI and are not stored by the application; avoid sending sensitive personal information. Provider/configuration failures return safe error messages without exposing credentials or upstream response details.

The PWA Chart Assistant reuses this route with `assistant_mode: "chart"` and remains non-persistent. Its server-generated context is limited to the selected farmer-owned field and crop, saved irrigation schedules, and available weather/forecast values. Soil history and actual water usage are explicitly unavailable unless backed by verified sources; chart answers are not fabricated or stored.

## Gemini JalSaathi AI

The dedicated legacy Chart Assistant page uses Google Gemini for persistent conversations. Configure `GEMINI_API_KEY`, optional `GEMINI_API_KEY_BACKUP`, and `GEMINI_MODEL` (default `gemini-2.5-flash`) in the application environment or local `.env`; Compose forwards them only to the backend. Recreate the backend after changing either key so the container receives the updated value. The backup key is attempted only after primary quota or provider availability failures; it must belong to a separately provisioned project to provide independent quota. Transient rate limits use bounded retries and respect provider retry delays; daily quota exhaustion is not retried. If no distinct backup key is configured, the assistant returns a clear provider error. Keys are never sent to the browser or written to logs. Conversation history is stored by the application in farmer-owned records and every conversation API filters by the authenticated farmer. Gemini server-side interaction storage is disabled. The page uses the selected farmer's available profile, fields, crops, irrigation schedules, and weather context; unavailable readings are not invented. Leave the primary key unset to keep the dedicated assistant safely unavailable.

Voice input uses the browser's Web Speech recognition interface after the farmer taps the microphone control. Audio is not stored by the application; browser speech-service processing depends on browser settings. Uploaded JPEG, PNG, and WebP leaf images are sent to the configured crop disease service, limited to 10 MB, and are not persisted. Gemini receives the server-validated disease result and farmer-owned context, never the image bytes, and must explain rather than replace the trained disease model. The saved conversation records that an image was attached plus the result and explanation, not the original photo.

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

## Multilingual interface

The website supports English, Telugu, Hindi, Kannada, Tamil, and Malayalam through its existing shared localization systems. User-interface text must have reviewed local entries in all six languages; the interface must not depend on remote machine translation or an English fallback. If a translation is missing at runtime, the selected language's localized “Translation unavailable” message is shown, and the localization audit fails so the gap can be fixed before release.

Legacy pages use `static/i18n/{en,te,hi,kn,ta,ml}.js`; use a stable semantic key with `data-i18n-key` or `JalSaathiI18n.t()`. React PWA pages use `farmer-pwa/locales/{en,te,hi,kn,ta,ml}.json` and `useI18n().t()`. PWA-only phrases belong in `farmer-pwa/locales/pwa.json`, whose translations are ordered English, Hindi, Telugu, Kannada, Tamil, Malayalam. Add every new key to all six language resources and do not pass arbitrary server errors or farmer-entered content to `t()`.

Mark farmer-entered values with `data-user-content` in legacy pages and render account data separately from translated labels. Map known API failures to reviewed translation keys; do not show raw server error text. Keep numeric, date, measurement, model, and API values separate from translated UI labels, and use the locale-aware number/date helpers.

Run the localization gate from `farmer-pwa` after installing its development dependencies:

```powershell
npm run test:i18n
```

The gate type-checks translation-key usage, runs the legacy language-switch tests, validates all six catalogs, and fails on untranslated HTML/template phrases, unknown/missing keys, or hardcoded visible JSX text. For an in-browser legacy audit, use `?i18nCheck=1` or `JalSaathiI18n.audit()`.

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
## Model 4 - Crop Stress Prediction

The trained Model 4 artifact is hosted on Google Drive because of its large file size.

### Download Model 4 Artifacts

Google Drive Link:
https://drive.google.com/file/d/1JSoEdI4IDeT8u30In2NT1WVHce19R4hI/view

The ZIP file contains:
- model4_crop_stress.joblib
- evaluation_metrics.json
- feature_importance.csv
- model_comparison.csv

### Setup Instructions

1. Download the ZIP file from Google Drive.
2. Extract the ZIP file.
3. Copy model4_crop_stress.joblib into the project root directory (same folder as main.py).
4. Install the project dependencies.
5. Start the FastAPI backend.

### Model 4 API Endpoint

POST /api/models/model4/predict

Note: The trained model artifact is optional at startup. The endpoint returns HTTP 503
until `model4_crop_stress.joblib` is restored to the project root.

## Irrigation optimizer

The milestone irrigation planner is available at `POST /api/irrigation/plan`.
Set `IRRIGATION_API_KEY` and send it as the `X-Irrigation-Key` header. The
planner uses the project-local weather adapter and returns an explicit error
when weather configuration or provider data is unavailable.
