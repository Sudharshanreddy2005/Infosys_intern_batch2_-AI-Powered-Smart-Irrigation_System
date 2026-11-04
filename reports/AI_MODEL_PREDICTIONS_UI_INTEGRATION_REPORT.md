# AI Model Predictions UI Integration Report

## Result

Added a dedicated **AI Model Predictions** page to the existing JalSaathi dashboard, reachable from the existing sidebar. The page preserves the current dashboard shell and the prior **Field Predictions** page.

## Files changed

- `static/sections.html` — added the new sidebar link, topbar context area, dashboard script, and updated cache versions.
- `static/sections.js` — registered the new dashboard view and its initializer.
- `static/sections.css` — added the screenshot-inspired model cards, summary strip, model-specific colors, topbar context, and responsive layouts.
- `static/ai-model-dashboard.html` — added the dashboard partial containing field selection, summary, four model cards, and observation forms.
- `static/ai-model-dashboard.js` — loads account fields/crops, calls the existing APIs, validates responses, and updates independent model states.
- `tests_js/ai-model-dashboard-contract.test.cjs` — added frontend integration and layout contract coverage.

## Navigation and layout

- The new page is available at `/static/sections.html?view=ai-model-predictions`.
- The existing sidebar, branding, mobile menu, profile, and topbar remain in place. The AI page presents JalSaathi branding, actual selected-field location/weather when available, and the farmer name in the topbar context.
- The header contains field and zone selectors, saved crop and area details, and a manual **Refresh Predictions** action.
- Summary values are updated from prediction request states. The model count derives from the four integrated model entries; successful/unavailable counts change only as API responses arrive. Incomplete user inputs are not counted as prediction failures.
- Models 1–3 are arranged in three columns on wide screens, two columns at tablet widths, and one column on mobile. Model 4 spans the full row.
- The former **Field Predictions** route and sidebar link remain available.

## Backend connections and data integrity

| Card | Existing endpoint | Inputs and behavior |
|---|---|---|
| Model 1 — Weather-Based Prediction | `POST /api/ml/reduced-weather-prediction` | Uses the selected saved field ID. Field-specific temperature/humidity prediction remains explicitly marked as an experimental proxy. Current weather readings are separately loaded from `POST /weather/current` using saved coordinates. No coordinates or fresh-weather errors are shown as unavailable. |
| Model 2 — Water Requirement Prediction | `POST /api/ml/water-requirement` | Uses the selected saved field and associated crop record. Only a valid API estimate is displayed. HTTP 503 is surfaced as unavailable; the legacy synthetic Model 2 endpoint is not used. Growth stage/field area are shown only when saved; the irrigation method is shown as not recorded because the account API does not provide it. |
| Model 3 — Future Soil Moisture Prediction | `POST /api/ml/soil-moisture-prediction` | Requires a user-selected zone and entered current moisture. Zone 4 additionally requires all 13 actual weather/soil inputs. Bars, horizon, strategy, and timestamp use returned values; missing response fields display as not returned. The card states that comparative performance against persistence is not established. |
| Model 4 — Crop Stress Risk Prediction | `POST /api/ml/crop-stress-prediction` | Requires saved field/crop/zone and the 20 entered feature values. The UI displays the returned numeric class and model-estimated probability only. It does not assign Low/Moderate/High meanings and warns that class mapping is unverified. |

Model requests keep their own loading, success, unavailable, and input-required states. A failure from one endpoint does not prevent the other requests from completing. Changing field, crop, or zone clears field-specific observation inputs so values from a previous selection cannot be applied silently.

## Testing and verification

- Python suite: **132 passed, 1 warning**.
- JavaScript suite: **64 passed, 0 failed**.
- Focused dashboard/frontend contract tests: **7 passed, 0 failed**.
- `node --check` passed for the new dashboard script and `sections.js`.
- `git diff --check` passed for the dashboard changes.
- Local FastAPI `/health`: HTTP 200.
- New partial, dashboard script, CSS, and sidebar route: HTTP 200.
- Browser navigation was attempted, but the page redirected to the sign-in view because the browser session was unauthenticated. Therefore a signed-in visual inspection, responsive screenshot comparison, live prediction interaction, and browser-console verification could not be completed in this session.

## Remaining limitations

- Account fields do not contain a zone or current/live soil moisture. Users must select a zone and enter the actual observation before Models 3/4 can run.
- Model 3's performance relative to persistence has not been established by evaluation metrics.
- The validated production Model 2 artifact/input path is unavailable; the backend returns HTTP 503 and no water estimate is shown.
- Model 1 remains an experimental proxy, not a validated agronomic recommendation.
- Model 4 numeric class semantics remain unverified; numeric-only display is intentional.
- Signed-in browser visual validation remains outstanding.
