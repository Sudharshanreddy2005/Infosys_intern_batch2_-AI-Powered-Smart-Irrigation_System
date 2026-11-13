(async () => {
  const views = {
    fields: {
      title: "My Fields",
      subtitle: "Manage your account's saved fields and historical sensor records.",
      render: `
        <div class="portal-page-heading">
          <div><h1>My Fields</h1><p>Your fields are saved to your JalSaathi account. Sensor records below are historical dataset values, not live readings.</p></div>
          <div class="portal-fields-heading-actions">
            <span class="portal-demo-tag">Account-saved fields</span>
            <button class="portal-action portal-add-field" type="button" data-open-add-field>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              Add Field
            </button>
          </div>
        </div>
        <div class="portal-grid portal-grid--2">
          <section class="portal-card portal-card--padded" aria-label="Illustrative field map">
            <div class="portal-card-heading"><h2>Illustrative field layout</h2><span class="portal-muted">Not geolocated</span></div>
            <div class="portal-field-map" data-field-map role="img" aria-label="Illustrative layout of browser-saved sample fields">
              <div class="portal-map-overlay"></div>
              <svg class="portal-map-boundaries" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-map-boundaries></svg>
              <div data-map-pins></div>
              <div class="portal-map-caption"><strong data-map-count></strong><span>Illustrative only</span></div>
            </div>
          </section>
          <section class="portal-card portal-card--padded">
            <div class="portal-card-heading"><h2>Your fields</h2><span class="portal-muted">Saved to your account</span></div>
            <div class="portal-field-list" data-field-list></div>
            <div class="portal-field-empty" data-field-empty hidden>
              <strong>No fields yet</strong>
              <span>Add a field to see its details here and on the map.</span>
              <button class="portal-action" type="button" data-open-add-field>Add Field</button>
            </div>
          </section>
        </div>
        <section class="portal-card portal-table-card portal-section-gap" aria-labelledby="sensor-management-title">
          <div class="portal-card-heading">
            <h2 id="sensor-management-title">Sensor Management</h2>
            <span class="portal-muted">Manage devices by field</span>
          </div>
          <p class="portal-muted">Register sensors, check device details and manage sensor access for each field.</p>
          <div class="portal-field-list" data-sensor-management-list>
            <p class="portal-empty-note">Loading your fields...</p>
          </div>
        </section>
        <p class="portal-field-feedback" data-field-feedback role="status" aria-live="polite"></p>
        <dialog class="portal-dialog portal-add-dialog" data-add-dialog aria-labelledby="portal-add-title">
          <form class="portal-dialog-card" data-add-form novalidate>
            <div class="portal-dialog-heading">
              <div><p class="portal-eyebrow">FIELD DETAILS</p><h2 id="portal-add-title" data-add-title>Add Field</h2></div>
              <button class="portal-dialog-close" type="button" data-close-add aria-label="Close Add Field form">&times;</button>
            </div>
            <p class="portal-dialog-description">Field details are saved to your JalSaathi account.</p>
            <div class="portal-form-grid">
              <label class="portal-form-field">Field Name
                <input name="name" type="text" maxlength="80" required autocomplete="off" />
              </label>
              <label class="portal-form-field">Field Location or Village
                <input name="location" maxlength="100" placeholder="e.g. Hyderabad, Karimnagar, Mumbai, Delhi" autocomplete="address-level2" required />
              </label>
              <label class="portal-form-field">Crop Type
                <select name="crop" required>
                  <option value="">Select a crop</option>
                  <option value="Paddy" data-i18n-crop>Paddy</option><option value="Sugarcane" data-i18n-crop>Sugarcane</option><option value="Ragi" data-i18n-crop>Ragi</option><option value="Maize" data-i18n-crop>Maize</option><option value="Cotton" data-i18n-crop>Cotton</option><option value="Other">Other</option>
                </select>
              </label>
              <div class="portal-form-field">Field Area
                <div class="portal-form-inline">
                  <input name="area" type="number" min="0.01" step="0.01" required aria-label="Field area" />
                  <select name="areaUnit" aria-label="Field area unit">
                    <option value="acres">Acres</option><option value="hectares">Hectares</option>
                  </select>
                </div>
              </div>
              <div class="portal-field-coordinates portal-form-field--wide">
                <strong>Field coordinates <span class="portal-form-optional">(optional)</span></strong>
                <p class="portal-dialog-description">Enter the actual field location, not necessarily your current location. Coordinates are used for field-specific weather.</p>
                <div class="portal-form-inline portal-coordinate-inputs">
                  <label class="portal-form-field">Latitude
                    <input name="latitude" type="number" min="-90" max="90" step="any" inputmode="decimal" autocomplete="off" />
                  </label>
                  <label class="portal-form-field">Longitude
                    <input name="longitude" type="number" min="-180" max="180" step="any" inputmode="decimal" autocomplete="off" />
                  </label>
                </div>
                <button class="portal-secondary-action" type="button" data-use-current-location>Use My Current Location</button>
                <p class="portal-location-status" data-location-status role="status" aria-live="polite"></p>
                <label class="portal-coordinate-confirmation">
                  <input name="coordinatesConfirmed" type="checkbox" />
                  <span>I confirm these saved coordinates represent this field's actual location.</span>
                </label>
              </div>
            </div>
            <p class="portal-form-error" data-add-error role="alert" hidden></p>
            <div class="portal-dialog-actions">
              <button class="portal-secondary-action" type="button" data-cancel-add>Cancel</button>
              <button class="portal-action" type="submit" data-add-submit>Save Field</button>
            </div>
          </form>
        </dialog>
        <section class="portal-card portal-table-card portal-section-gap" aria-labelledby="sensor-history-title">
  <div class="portal-card-heading">
    <h2 id="sensor-history-title">Historical sensor records</h2>
    <span class="portal-muted" data-sensor-provenance>Not loaded</span>
  </div>

  <p class="portal-muted">
    Records from the PostgreSQL dataset; this data is historical and synthetic or synthetic-augmented, not live telemetry.
  </p>

  <p class="portal-empty-note" data-sensor-state role="status" aria-live="polite">
    Loading historical records…
  </p>

  <details class="portal-historical-records" data-sensor-details>
    <summary>
      View historical records
      <span data-sensor-match-count>0 records</span>
    </summary>

    <div class="portal-history-filters" data-sensor-filters hidden>
      <label>
        From date
        <input type="date" data-sensor-date-from>
      </label>

      <label>
        To date
        <input type="date" data-sensor-date-to>
      </label>

      <button class="portal-secondary-action" type="button" data-sensor-clear>
        Clear dates
      </button>
    </div>

    <p class="portal-empty-note" data-sensor-filter-state hidden>
      No records match the selected date range.
    </p>

    <div class="portal-table-wrap portal-historical-table-wrap" data-sensor-table-wrap hidden>
      <table class="portal-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Field ID</th>
            <th>Soil moisture</th>
            <th>Temperature</th>
            <th>Humidity</th>
          </tr>
        </thead>
        <tbody data-sensor-rows></tbody>
      </table>
    </div>
  </details>

  <button class="portal-secondary-action" type="button" data-sensor-retry hidden>
    Retry
  </button>
</section>
        <dialog class="portal-dialog portal-confirm-dialog" data-delete-dialog aria-labelledby="portal-delete-title" aria-describedby="portal-delete-message">
          <div class="portal-dialog-card">
            <div class="portal-dialog-heading">
              <div><p class="portal-eyebrow">CONFIRM ACTION</p><h2 id="portal-delete-title">Delete Field?</h2></div>
              <button class="portal-dialog-close" type="button" data-close-delete aria-label="Close delete confirmation">&times;</button>
            </div>
            <p class="portal-dialog-description" id="portal-delete-message">Are you sure you want to delete this field? This action cannot be undone.</p>
            <div class="portal-dialog-actions">
              <button class="portal-secondary-action" type="button" data-cancel-delete>Cancel</button>
              <button class="portal-danger-action" type="button" data-confirm-delete>Delete Field</button>
            </div>
          </div>
        </dialog>
                <dialog
          class="portal-dialog portal-confirm-dialog"
          data-sensor-dialog
          aria-labelledby="portal-sensor-title"
        >
          <div class="portal-dialog-card">
            <div class="portal-dialog-heading">
              <div>
                <p class="portal-eyebrow">FIELD DEVICE</p>
                <h2 id="portal-sensor-title">Manage Sensor</h2>
              </div>
              <button
                class="portal-dialog-close"
                type="button"
                data-close-sensor
                aria-label="Close sensor management"
              >&times;</button>
            </div>

            <p
              class="portal-dialog-description"
              data-sensor-field-label
            ></p>

            <p
              class="portal-empty-note"
              data-sensor-feedback
              role="status"
              aria-live="polite"
            >Loading sensor details...</p>

            <div data-sensor-device-state></div>

            <form data-sensor-register-form hidden>
              <label class="portal-form-label">
                Sensor device name
                <input
                  type="text"
                  name="name"
                  maxlength="100"
                  placeholder="Example: Field 1 Soil Sensor"
                  required
                >
              </label>

              <p
                class="portal-form-error"
                data-sensor-register-error
                role="alert"
                hidden
              ></p>

              <div class="portal-dialog-actions">
                <button
                  class="portal-secondary-action"
                  type="button"
                  data-close-sensor
                >Close</button>
                <button
                  class="portal-primary-action"
                  type="submit"
                  data-sensor-register-button
                >Register Sensor</button>
              </div>
            </form>

            <section data-sensor-token-panel hidden>
              <p class="portal-dialog-description">
                Sensor registered. Copy this secret token now.
                It will not be shown again after you close this dialog.
              </p>
              <code data-sensor-token></code>
              <div class="portal-dialog-actions">
                <button
                  class="portal-secondary-action"
                  type="button"
                  data-copy-sensor-token
                >Copy Token</button>
              </div>
            </section>

            <div class="portal-dialog-actions">
              <button
                class="portal-danger-action"
                type="button"
                data-revoke-sensor
                hidden
              >Revoke Sensor</button>
            </div>
          </div>
        </dialog>
      `,
    },
     "field-details": {
      title: "Field Details",
      subtitle: "Field information and recorded sensor readings.",
      render: `
        <div class="portal-page-heading">
          <div>
            <h1>Field Details</h1>
            <p>View the saved information and recorded sensor measurements for this field.</p>
          </div>
          <a class="portal-secondary-action" href="/static/sections.html?view=fields">Back to My Fields</a>
        </div>
        <section class="portal-card portal-card--padded portal-section-gap" data-field-details-loading role="status" aria-live="polite">
          Loading field details...
        </section>
      `,
    },
     "field-monitoring": {
      title: "Field Monitoring",
      subtitle: "Monitor your field conditions, sensor readings and irrigation activity.",
      render: `
        <div class="portal-page-heading">
          <div>
            <h1>Field Monitoring</h1>
            <p>
              View field details, sensor measurements, irrigation history
              and reservoir availability.
            </p>
          </div>
          <span class="portal-demo-tag">Field monitoring</span>
        </div>

        <div
          class="portal-card portal-card--padded"
          data-field-monitoring-loading
          role="status"
          aria-live="polite"
        >
          Loading field monitoring...
        </div>
      `,
    },
    crops: {
      title: "Crops",
      subtitle: "Crop information saved to your JalSaathi account.",
      render: `
        <div class="portal-page-heading">
          <div>
            <h1>Crops</h1>
            <p>Monitor crop growth and harvest schedules for your fields.</p>
          </div>
          <span class="portal-demo-tag">Account data</span>
        </div>

        <div class="portal-grid portal-grid--3 portal-section-gap" data-crop-summary>
          <article class="portal-card portal-card--padded">
            <span class="portal-muted">Total Crops</span>
            <h2 data-crop-total>0</h2>
          </article>
          <article class="portal-card portal-card--padded">
            <span class="portal-muted">Active Crops</span>
            <h2 data-crop-active>0</h2>
          </article>
          <article class="portal-card portal-card--padded">
            <span class="portal-muted">Nearing Harvest</span>
            <h2 data-crop-nearing>0</h2>
          </article>
        </div>

        <section class="portal-card portal-card--padded portal-section-gap">
          <form data-crop-form class="portal-form-grid">
            <label class="portal-form-field">Crop name
              <input name="name" maxlength="80" required />
            </label>
            <label class="portal-form-field">Variety
              <input name="variety" maxlength="100" />
            </label>
            <label class="portal-form-field">Field
              <select name="field_id" data-crop-field-options>
                <option value="">No field selected</option>
              </select>
            </label>
            <label class="portal-form-field">Growth stage
              <input name="growth_stage" maxlength="80" />
            </label>
            <label class="portal-form-field">Planting date
              <input name="planting_date" type="date" />
            </label>
            <label class="portal-form-field">Expected harvest date
              <input name="expected_harvest_date" type="date" />
            </label>
            <p class="portal-form-error" data-crop-error role="alert" hidden></p>
            <div class="portal-dialog-actions">
              <button class="portal-action" type="submit" data-crop-submit>Save Crop</button>
              <button class="portal-secondary-action" type="button" data-crop-cancel hidden>Cancel edit</button>
            </div>
          </form>
        </section>

        <section class="portal-card portal-card--padded portal-section-gap">
          <div class="portal-grid portal-grid--2">
            <label class="portal-form-field">Search crops
              <input type="search" data-crop-search placeholder="Search crop name or variety..." />
            </label>
            <label class="portal-form-field">Filter by growth stage
              <select data-crop-stage-filter>
                <option value="">All growth stages</option>
              </select>
            </label>
          </div>
        </section>

        <div class="portal-grid portal-grid--3 portal-section-gap" data-crop-list></div>
      `,
    },
    schedule: {
      title: "Irrigation Schedule",
      subtitle: "Plan irrigation from your saved fields, measured inputs, local weather, and recorded reservoir water.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Irrigation Schedule</h1><p>Recommendations use the selected field's saved crop, area, and coordinates. Enter a current measured soil-moisture reading and actual irrigation equipment details; unavailable information is never estimated.</p></div>
          <span class="portal-demo-tag">Account data</span>
        </div>
        <p data-irrigation-feedback class="portal-field-feedback" role="status" aria-live="polite">Loading your fields and water sourcesâ€¦</p>
        <div class="portal-grid portal-grid--2 portal-section-gap">
          <section class="portal-card portal-card--padded" aria-labelledby="irrigation-field-title">
            <div class="portal-card-heading"><h2 id="irrigation-field-title">Selected field</h2><span class="portal-muted">Saved to your account</span></div>
            <label class="portal-form-field">Field
              <select data-irrigation-field required><option value="">Loading fieldsâ€¦</option></select>
            </label>
            <dl class="portal-irrigation-details" data-irrigation-field-details>
              <div><dt>Field name</dt><dd data-irrigation-field-name>Not selected</dd></div>
              <div><dt>Crop type</dt><dd data-irrigation-field-crop>Not recorded</dd></div>
              <div><dt>Area</dt><dd data-irrigation-field-area>Not recorded</dd></div>
              <div><dt>Zone</dt><dd data-irrigation-field-zone>Not recorded</dd></div>
              <div><dt>Saved crop stage</dt><dd data-irrigation-saved-stage>Not recorded</dd></div>
              <div><dt>Field coordinates</dt><dd data-irrigation-field-location>Not recorded</dd></div>
            </dl>
          </section>
          <section class="portal-card portal-card--padded" aria-labelledby="irrigation-water-title">
            <div class="portal-card-heading"><h2 id="irrigation-water-title">Water availability</h2><span class="portal-muted">Litres</span></div>
            <label class="portal-form-field">Reservoir / water source
              <select data-irrigation-reservoir required><option value="">Select a field first</option></select>
            </label>
            <dl class="portal-irrigation-details">
              <div><dt>Total capacity</dt><dd data-irrigation-capacity>Not available</dd></div>
              <div><dt>Water on hand</dt><dd data-irrigation-available>Not available</dd></div>
              <div><dt>Reserved for confirmed schedules</dt><dd data-irrigation-reserved>Not available</dd></div>
              <div><dt>Available after reservations</dt><dd data-irrigation-remaining>Not available</dd></div>
              <div><dt>Last updated</dt><dd data-irrigation-water-updated>Not available</dd></div>
            </dl>
            <form class="portal-irrigation-inline-form" data-irrigation-water-form hidden>
              <label class="portal-form-field">Current measured water (L)
                <input name="available_liters" type="number" min="0" step="any" required />
              </label>
              <button class="portal-secondary-action" type="submit">Save water level</button>
            </form>
            <button class="portal-secondary-action" type="button" data-irrigation-water-edit hidden>Update Water Availability</button>
            <details class="portal-irrigation-configure">
              <summary data-irrigation-configure-label>Configure a water source</summary>
              <form class="portal-form-grid" data-irrigation-reservoir-form>
                <label class="portal-form-field">Reservoir name<input name="name" maxlength="100" required /></label>
                <label class="portal-form-field">Total capacity (L)<input name="capacity_liters" type="number" min="0.01" step="any" required /></label>
                <label class="portal-form-field">Current water (L)<input name="available_liters" type="number" min="0" step="any" required /></label>
                <label class="portal-form-field">Applies to
                  <select name="field_id" data-irrigation-reservoir-field><option value="">All my fields</option></select>
                </label>
                <button class="portal-action" type="submit">Save water source</button>
              </form>
            </details>
          </section>
        </div>
        <section class="portal-card portal-card--padded portal-section-gap" aria-labelledby="irrigation-plan-title">
          <div class="portal-card-heading"><h2 id="irrigation-plan-title">Generate irrigation recommendation</h2><span class="portal-muted">Requires a measured reading</span></div>
          <form class="portal-form-grid" data-irrigation-plan-form>
            <label class="portal-form-field">Current soil moisture (%)
              <input name="soil_moisture_pct" type="number" min="0" max="100" step="any" required />
              <span class="portal-form-help">Enter a current field measurement; historical dataset records are not live readings.</span>
            </label>
            <label class="portal-form-field">Crop growth stage
              <select name="growth_stage_code" required>
                <option value="">Select a stage</option><option value="1">Seedling</option><option value="2">Vegetative</option><option value="3">Flowering / fruiting</option>
              </select>
            </label>
            <label class="portal-form-field">Soil type
              <select name="soil_type_code" required>
                <option value="">Select a soil type</option><option value="1">Sandy</option><option value="2">Loamy</option><option value="3">Clay</option>
              </select>
            </label>
            <label class="portal-form-field">Irrigation method
              <select name="irrigation_method" required>
                <option value="">Select a method</option><option value="drip">Drip</option><option value="sprinkler">Sprinkler</option><option value="surface">Surface / furrow</option>
              </select>
            </label>
            <label class="portal-form-field">Pump flow (L/min)
              <input name="pump_flow_lpm" type="number" min="0.01" step="any" required />
            </label>
            <div class="portal-form-field portal-form-field--wide">
              <button class="portal-action" type="submit" data-irrigation-plan-submit>Generate Irrigation Plan</button>
              <span class="portal-form-help">The server verifies field ownership, fetches the configured field forecast, and checks unreserved water before saving a recommendation.</span>
            </div>
          </form>
          <p class="portal-form-error" data-irrigation-plan-error role="alert" hidden></p>
          <div class="portal-irrigation-result" data-irrigation-plan-result hidden></div>
        </section>
        <section class="portal-card portal-card--padded portal-section-gap portal-manual-schedule-panel"
         aria-labelledby="manual-irrigation-title">
  <div class="portal-card-heading">
    <div>
      <h2 id="manual-irrigation-title">＋ Create a manual schedule</h2>
      <p class="portal-muted">Choose when and how much water to apply to your selected field.</p>
    </div>
    <span class="portal-demo-tag">Farmer controlled</span>
  </div>

  <form data-irrigation-manual-form class="portal-manual-schedule-form">
    <div class="portal-form-field">
      <label for="manual-irrigation-date">Scheduled date</label>
      <input id="manual-irrigation-date" name="scheduled_date"
             type="date" required />
    </div>

    <div class="portal-form-field">
      <label for="manual-irrigation-time">Start time</label>
      <input id="manual-irrigation-time" name="start_time"
             type="time" required />
    </div>

    <div class="portal-form-field">
      <label for="manual-irrigation-duration">Duration (minutes)</label>
      <input id="manual-irrigation-duration" name="duration_minutes"
             type="number" min="1" max="1440" step="1" required />
    </div>

    <div class="portal-form-field">
      <label for="manual-irrigation-water">Water volume (litres)</label>
      <input id="manual-irrigation-water" name="water_liters"
             type="number" min="0.01" step="any" required />
    </div>

    <div class="portal-form-field">
      <label for="manual-irrigation-method">Irrigation method</label>
      <select id="manual-irrigation-method" name="irrigation_method" required>
        <option value="">Select a method</option>
        <option value="drip">Drip</option>
        <option value="sprinkler">Sprinkler</option>
        <option value="surface">Surface / furrow</option>
      </select>
    </div>

    <div class="portal-form-field portal-form-field--wide">
      <button class="portal-action" type="submit"
              data-irrigation-manual-submit>
        Create manual schedule
      </button>
      <span class="portal-form-help">
        The selected field and water source will be used. Water is reserved
        only after you review and confirm the schedule.
      </span>
    </div>
  </form>

  <p class="portal-form-error" data-irrigation-manual-error
     role="alert" hidden></p>
</section>
        <section class="portal-card portal-card--padded portal-section-gap portal-irrigation-schedule-panel" aria-labelledby="irrigation-schedules-title">
  <div class="portal-card-heading">
    <div>
      <h2 id="irrigation-schedules-title">Irrigation schedules</h2>
      <p class="portal-muted">Manage your field irrigation events</p>
    </div>
    <span class="portal-demo-tag">Live account records</span>
  </div>

  <div class="portal-grid portal-grid--3 portal-irrigation-summary">
    <article><span>Total scheduled water</span><strong data-irrigation-summary-scheduled>—</strong></article>
    <article><span>Water reserved</span><strong data-irrigation-summary-reserved>—</strong></article>
    <article><span>Available water</span><strong data-irrigation-summary-remaining>—</strong></article>
    <article><span>Upcoming events</span><strong data-irrigation-summary-upcoming>—</strong></article>
    <article><span>Completed events</span><strong data-irrigation-summary-completed>—</strong></article>
  </div>

  <div class="portal-irrigation-toolbar">
    <label class="portal-form-field">
      Search schedules
      <input type="search" data-irrigation-search placeholder="Search field, crop or method..." />
    </label>
    <label class="portal-form-field">
      Filter by status
      <select data-irrigation-status-filter>
        <option value="all">All statuses</option>
        <option value="recommended">Recommended</option>
        <option value="confirmed">Confirmed</option>
        <option value="completed">Completed</option>
        <option value="insufficient_water">Insufficient water</option>
        <option value="cancelled">Cancelled</option>
      </select>
    </label>
  </div>

  <p class="portal-empty-note" data-irrigation-schedules-empty hidden>
    No irrigation schedules have been generated for this field.
  </p>

  <div class="portal-irrigation-card-list" data-irrigation-schedules-wrap hidden>
    <div data-irrigation-schedules></div>
  </div>
</section>
      `,
    },
        reports: {
      title: "Reports",
      subtitle: "Field summaries, sensor readings and irrigation history.",
      render: `
        <div class="portal-page-heading">
          <div>
            <h1>Reports</h1>
            <p>Reports based on actual account records and saved irrigation schedules.</p>
          </div>
          <div class="portal-fields-heading-actions">
            <button class="portal-action" type="button" data-report-download-csv>
              Download CSV
            </button>
            <button class="portal-secondary-action" type="button" data-report-download-pdf>
              Print / Save PDF
            </button>
          </div>
        </div>

        <p class="portal-field-feedback" data-report-feedback role="status" aria-live="polite"></p>
        <div class="portal-report-stats">
  <article class="portal-report-stat portal-report-stat--green">
    <span class="portal-report-stat-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6" /></svg>
    </span>
    <div>
      <span class="portal-report-stat-label">Total fields</span>
      <strong data-report-total-fields>0</strong>
      <small>Registered fields</small>
    </div>
  </article>

  <article class="portal-report-stat portal-report-stat--blue">
    <span class="portal-report-stat-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M12 3C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-12z" /><path d="M9 16a3 3 0 0 0 3 3" /></svg>
    </span>
    <div>
      <span class="portal-report-stat-label">Sensor readings</span>
      <strong data-report-total-readings>0</strong>
      <small>Recorded observations</small>
    </div>
  </article>

  <article class="portal-report-stat portal-report-stat--orange">
    <span class="portal-report-stat-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13H4V6a1 1 0 0 1 1-1z" /><path d="M8 13h3m2 0h3m-8 4h3" /></svg>
    </span>
    <div>
      <span class="portal-report-stat-label">Irrigation records</span>
      <strong data-report-total-schedules>0</strong>
      <small>Saved schedules</small>
    </div>
  </article>

  <article class="portal-report-stat portal-report-stat--purple">
    <span class="portal-report-stat-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /><circle cx="12" cy="12" r="9" /></svg>
    </span>
    <div>
      <span class="portal-report-stat-label">Completed irrigation</span>
      <strong data-report-total-completed>0</strong>
      <small>Successfully completed</small>
    </div>
  </article>
</div>

        <section class="portal-card portal-table-card portal-section-gap">
          <div class="portal-card-heading">
            <h2 class="portal-report-section-title">
  <span class="portal-report-heading-icon portal-icon-green" aria-hidden="true">
    <svg viewBox="0 0 24 24"><path d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6" /></svg>
  </span>
  Field summary
</h2>
            <span class="portal-muted">Latest verified records</span>
          </div>

          <div class="portal-report-filters">
            <label>Field
              <select data-report-field>
                <option value="all">All fields</option>
              </select>
            </label>
            <label>Crop
              <select data-report-crop>
                <option value="all">All crops</option>
              </select>
            </label>
          </div>

          <div class="portal-table-wrap">
            <table class="portal-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Crop</th>
                  <th>Area</th>
                  <th>Planting date</th>
                  <th>Latest soil moisture</th>
                  <th>Last completed irrigation</th>
                  <th>Analysis</th>
                </tr>
              </thead>
              <tbody data-report-rows></tbody>
            </table>
          </div>

          <p class="portal-report-empty" data-report-empty hidden>
            No fields match these filters.
          </p>
        </section>

        <section class="portal-card portal-table-card portal-section-gap">
          <div class="portal-card-heading">
            <h2 class="portal-report-section-title">
  <span class="portal-report-heading-icon portal-icon-blue" aria-hidden="true">
    <svg viewBox="0 0 24 24"><path d="M12 3C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-12z" /></svg>
  </span>
  Sensor reading history
</h2>
            <span class="portal-muted">Recorded observations only</span>
          </div>

<div class="portal-report-history-filters" data-report-sensor-filters>
  <label>Field
    <select data-report-sensor-field>
      <option value="all">All fields</option>
    </select>
  </label>

  <label>Date range
    <select data-report-sensor-range>
      <option value="all">All time</option>
      <option value="1">Last 24 hours</option>
      <option value="7">Last 7 days</option>
      <option value="30">Last 30 days</option>
    </select>
  </label>

  <label>Rows per page
    <select data-report-sensor-page-size>
      <option value="5">5</option>
      <option value="10" selected>10</option>
      <option value="25">25</option>
      <option value="50">50</option>
    </select>
  </label>
</div>

<div class="portal-report-pagination" data-report-sensor-pagination>
  <span data-report-sensor-page-info>Page 1</span>
  <div>
    <button type="button" class="portal-secondary-action"
      data-report-sensor-prev disabled>Previous</button>
    <button type="button" class="portal-secondary-action"
      data-report-sensor-next disabled>Next</button>
  </div>
</div>

          <p class="portal-empty-note" data-report-sensor-empty>
            Loading sensor readings...
          </p>
          <div class="portal-table-wrap" data-report-sensor-wrap hidden>
            <table class="portal-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Recorded at</th>
                  <th>Soil moisture</th>
                  <th>Temperature</th>
                  <th>Humidity</th>
                  <th>pH</th>
                  <th>EC (ÂµS/cm)</th>
                </tr>
              </thead>
              <tbody data-report-sensor-rows></tbody>
            </table>
          </div>
        </section>

        <section class="portal-card portal-table-card portal-section-gap">
          <div class="portal-card-heading">
            <h2 class="portal-report-section-title">
  <span class="portal-report-heading-icon portal-icon-orange" aria-hidden="true">
    <svg viewBox="0 0 24 24"><path d="M12 3C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-12z" /></svg>
  </span>
  Irrigation history
</h2>
            <span class="portal-muted">Saved schedule records</span>
          </div>

<div class="portal-report-history-filters" data-report-irrigation-filters>
  <label>Field
    <select data-report-irrigation-field>
      <option value="all">All fields</option>
    </select>
  </label>

  <label>Status
    <select data-report-irrigation-status>
      <option value="all">All statuses</option>
    </select>
  </label>

  <label>Date range
    <select data-report-irrigation-range>
      <option value="all">All time</option>
      <option value="7">Last 7 days</option>
      <option value="30">Last 30 days</option>
    </select>
  </label>

  <label>Rows per page
    <select data-report-irrigation-page-size>
      <option value="5">5</option>
      <option value="10" selected>10</option>
      <option value="25">25</option>
      <option value="50">50</option>
    </select>
  </label>
</div>

<div class="portal-report-pagination" data-report-irrigation-pagination>
  <span data-report-irrigation-page-info>Page 1</span>
  <div>
    <button type="button" class="portal-secondary-action"
      data-report-irrigation-prev disabled>Previous</button>
    <button type="button" class="portal-secondary-action"
      data-report-irrigation-next disabled>Next</button>
  </div>
</div>

          <p class="portal-empty-note" data-report-irrigation-empty>
            Loading irrigation history...
          </p>
          <div class="portal-table-wrap" data-report-irrigation-wrap hidden>
            <table class="portal-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Date</th>
                  <th>Start time</th>
                  <th>Water (L)</th>
                  <th>Duration</th>
                  <th>Method</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody data-report-irrigation-rows></tbody>
            </table>
          </div>
          <p class="portal-form-help">
            Water quantities are schedule records. They are not independent physical flow-meter measurements.
          </p>
        </section>

        <section class="portal-card portal-card--padded portal-section-gap">
          <div class="portal-card-heading">
            <h2 class="portal-report-section-title">
  <span class="portal-report-heading-icon portal-icon-purple" aria-hidden="true">
    <svg viewBox="0 0 24 24"><path d="M4 19h16M6 16l4-5 3 2 5-7" /></svg>
  </span>
  Analysis and recommendations
</h2>
            <span class="portal-muted">Verified inputs only</span>
          </div>
          <p class="portal-empty-note">
            No verified analysis results or recommendations are currently connected to this report.
          </p>
        </section>
      `,
    },
    alerts: {
  title: "Alerts",
  subtitle: "Field conditions, sensor updates and irrigation reminders.",
  render: `
    <div class="portal-page-heading">
      <div>
        <h1>Alerts & Advisories</h1>
        <p>Stay informed about your fields, sensors and irrigation.</p>
      </div>
      <button class="portal-button" type="button" data-alert-refresh>↻ Refresh</button>
    </div>

    <div class="portal-alert-summary">
      <div class="portal-alert-stat"><span>Active alerts</span><strong data-alert-total>0</strong></div>
      <div class="portal-alert-stat"><span>Urgent</span><strong data-alert-urgent>0</strong></div>
      <div class="portal-alert-stat"><span>Advisories</span><strong data-alert-advisory>0</strong></div>
    </div>

    <section class="portal-card portal-card--padded portal-section-gap">
      <div class="portal-alert-filters">
        <button type="button" class="is-active" data-alert-filter="all">All</button>
        <button type="button" data-alert-filter="emergency">Emergency</button>
        <button type="button" data-alert-filter="soil">Soil & Water</button>
        <button type="button" data-alert-filter="sensor">Sensors</button>
        <button type="button" data-alert-filter="irrigation">Irrigation</button>
        <button type="button" data-alert-filter="weather">Weather</button>
      </div>
      <p class="portal-empty-note" data-alert-status role="status">Loading field alerts...</p>
      <div class="portal-alert-list" data-alert-list></div>
    </section>
  `,
},
    weather: {
      title: "Weather",
      subtitle: "Current conditions and hourly forecasts from Tomorrow.io, when configured.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Weather</h1><p>Search current weather and forecasts for cities, towns and districts across India.</p></div>
          <span class="portal-demo-tag" data-weather-status data-user-content>Loading</span>
        </div>
        <section class="portal-card portal-card--padded portal-section-gap">
          <form data-weather-location-form class="portal-weather-location-form">
            <label class="portal-form-field">Manual location
              <input name="location" maxlength="100" placeholder="e.g. Hyderabad, Karimnagar, Mumbai, Delhi" autocomplete="address-level2" required />
              </label>
            <button class="portal-action" type="submit">Search weather</button>
          </form>
        </section>
        <section data-weather-view>
          <section class="portal-card portal-weather-hero">
            <div><div class="portal-weather-place" data-weather-location data-user-content>Finding locationâ€¦</div><div class="portal-temperature" data-weather-temperature data-user-content>Loadingâ€¦</div><span class="portal-temperature-indicator" data-weather-temperature-indicator aria-hidden="true" hidden></span><div class="portal-weather-condition" data-weather-condition data-user-content>Loading weatherâ€¦</div><p class="portal-weather-condition">Feels like <strong data-weather-feels-like data-user-content>Loadingâ€¦</strong></p><p class="portal-weather-condition">High / low <strong data-weather-high-low data-user-content>Loadingâ€¦</strong></p><p class="portal-weather-condition">Updated <span data-weather-updated data-user-content>Loadingâ€¦</span> Â· <span data-weather-observation data-user-content>Loading</span></p></div>
            <div class="portal-weather-icon" aria-hidden="true">
              <svg viewBox="0 0 72 72" width="78" height="78"><circle cx="27" cy="24" r="12" fill="#f4bf59"/><path d="M20 52h35a10 10 0 0 0 0-20 14 14 0 0 0-26-4 12 12 0 0 0-9 24Z" fill="#fff" stroke="#c5dfea" stroke-width="3"/><path d="M32 58v5m12-5v5" stroke="#77b9d4" stroke-width="3" stroke-linecap="round"/></svg>
            </div>
          </section>
          <div class="portal-weather-stats portal-section-gap">
            <div class="portal-card portal-weather-stat">
              <span>💧 Humidity</span>
              <strong data-weather-humidity data-user-content>Loading…</strong>
            </div>
            <div class="portal-card portal-weather-stat">
              <span>🌬️ Wind speed</span>
              <strong data-weather-wind data-user-content>Loading…</strong>
            </div>
            <div class="portal-card portal-weather-stat">
              <span>🌧️ Rainfall intensity</span>
              <strong data-weather-rainfall data-user-content>Loading…</strong>
            </div>
            <div class="portal-card portal-weather-stat">
              <span>☔ Rain probability</span>
              <strong data-weather-rain-probability data-user-content>Loading…</strong>
            </div>
          </div>
          </div>
        </section>
        <section class="portal-card portal-table-card portal-section-gap">
          <div class="portal-card-heading"><h2>Hourly forecast</h2><span class="portal-muted" data-forecast-status data-user-content>Loading forecastâ€¦</span></div>
          <div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>Time</th><th>Temperature</th><th>Feels like</th><th>Precipitation intensity</th><th>Rain probability</th></tr></thead><tbody data-forecast-rows></tbody></table></div>
        </section>
        <section class="portal-card portal-table-card portal-section-gap">
          <div class="portal-card-heading"><h2>Daily forecast</h2><span class="portal-muted" data-daily-forecast-status data-user-content>Loading forecastâ€¦</span></div>
          <div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>Day</th><th>Condition</th><th>High</th><th>Low</th><th>Rain probability</th></tr></thead><tbody data-daily-forecast-rows></tbody></table></div>
        </section>
      `,
    },
    profile: {
      title: "Profile",
      subtitle: "Your JalSaathi profile and account settings.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Profile</h1><p>Farmer profile information shown in this dashboard preview.</p></div>
          <span class="portal-demo-tag">Account profile</span>
        </div>
        <section class="portal-card portal-profile-card" data-profile-private hidden>
          <div class="portal-profile-cover"></div>
          <div class="portal-profile-head"><div class="portal-avatar" data-profile-initial data-user-content aria-hidden="true">F</div><div><h2 data-profile-name data-user-content>Farmer</h2><p>JalSaathi farmer account</p></div></div>
          <form class="portal-profile-name-form" data-profile-name-form>
            <label class="portal-form-field">Your name
              <input name="displayName" type="text" maxlength="80" required autocomplete="name" />
            </label>
            <button class="portal-action" type="submit">Update Name</button>
            <p class="portal-profile-message" data-profile-message role="status" aria-live="polite"></p>
          </form>
          <div class="portal-profile-body">
            <div class="portal-profile-detail"><span>Email</span><strong data-profile-email data-user-content>Not provided</strong></div>
            <div class="portal-profile-detail"><span>Phone</span><strong data-profile-phone data-user-content>Not provided</strong></div>
            <div class="portal-profile-detail"><span>Location</span><strong data-profile-location data-user-content>Not provided</strong></div>
            <div class="portal-profile-detail"><span>Preferred language</span><strong data-profile-language data-i18n-ignore>English</strong></div>
            <div class="portal-profile-detail"><span>Managed fields</span><strong>Account-saved fields</strong></div>
            <div class="portal-profile-detail"><span>Account status</span><strong>Active</strong></div>
          </div>
        </section>
        <section class="portal-card portal-card--padded portal-profile-logged-out" data-profile-logged-out hidden>
          <h2>Sign in to view your profile</h2>
          <p class="portal-muted">Sign in to view and update your account profile.</p>
          <a class="portal-action" href="/static/auth.html?view=login">Open Login</a>
        </section>
        <section class="portal-card portal-profile-access portal-section-gap">
          <div><h2>Account access</h2><p class="portal-muted">Your account is protected by a server-side session.</p></div>
          <a class="portal-action" href="/static/auth.html?view=login">Open Sign In</a>
        </section>
      `,
    },

    predictions: {
      title: "Field Predictions",
      subtitle: "Run Model 3 and Model 4 with explicit field observations.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Field Predictions</h1><p>Enter observed values from the selected field. No sensor values are invented when data is missing.</p></div>
          <span class="portal-demo-tag">Input required</span>
        </div>

        <section class="field-prediction-overview">
          <div class="ai-dashboard-heading">
            <span class="ai-heading-mark">🌱</span>
            <div>
              <h1>Field-wise decision centre</h1>
              <p>Review predictions and irrigation guidance for each registered field.</p>
            </div>
          </div>

          <div class="field-prediction-toolbar">
            <label class="portal-form-field">
              <strong>🌾 Select your field</strong>
              <select data-overview-field>
                <option value="">Loading registered fields…</option>
              </select>
            </label>
            <div class="field-prediction-facts">
              <div><small>Crop</small><strong data-overview-crop>Not recorded</strong></div>
              <div><small>Field area</small><strong data-overview-area>Not recorded</strong></div>
              <div><small>Location</small><strong data-overview-location>Not recorded</strong></div>
            </div>
          </div>

          <div class="field-prediction-section-heading">
            <h2>Field prediction summary</h2>
            <p>Each result is shown only when its data and prediction source are available.</p>
          </div>

          <div class="ai-model-grid field-prediction-grid">
            <article class="ai-model-card ai-model-card--blue">
              <div class="ai-model-heading">
                <span class="ai-model-icon">💧</span>
                <div><p>01 · Future soil moisture</p><h2>Expected moisture after 24 hours</h2></div>
              </div>
              <div class="ai-model-body">
                <span class="ai-status" data-state="input" data-summary-moisture-status>Awaiting prediction</span>
                <div class="ai-result-box" data-summary-moisture-result>Run Model 3 with a verified current moisture reading.</div>
                <small>Source: Model 3 · Predicted, not an actual sensor reading.</small>
              </div>
            </article>

            <article class="ai-model-card ai-model-card--green">
              <div class="ai-model-heading">
                <span class="ai-model-icon">🌱</span>
                <div><p>02 · Irrigation requirement</p><h2>Does this field need irrigation?</h2></div>
              </div>
              <div class="ai-model-body">
                <span class="ai-status" data-state="input" data-summary-irrigation-status>Waiting for Model 3</span>
<div class="ai-result-box" data-summary-irrigation-result>Run Model 3 to view its irrigation-related output.</div>
                <small>Requires validated soil, crop and water-requirement inputs.</small>
              </div>
            </article>

            <article class="ai-model-card ai-model-card--gold">
              <div class="ai-model-heading">
                <span class="ai-model-icon">🕒</span>
                <div><p>03 · Recommended timing</p><h2>When should irrigation happen?</h2></div>
              </div>
              <div class="ai-model-body">
                <span class="ai-status" data-state="input" data-summary-timing-status>Waiting for Model 3</span>
<div class="ai-result-box" data-summary-timing-result>Run Model 3 to view its prediction horizon and timing information.</div>
                <small>Requires field moisture, crop and weather information.</small>
              </div>
            </article>

            <article class="ai-model-card ai-model-card--blue">
              <div class="ai-model-heading">
                <span class="ai-model-icon">🌧️</span>
                <div><p>04 · Rainfall impact</p><h2>Expected rain and irrigation impact</h2></div>
              </div>
              <div class="ai-model-body">
                <span class="ai-status" data-state="input" data-summary-rainfall-status>Waiting for results</span>
<div class="ai-result-box" data-summary-rainfall-result>Weather information and Model 3 results will be shown here.</div>
                <small>Forecast information must be distinguished from measured rainfall.</small>
              </div>
            </article>

            <article class="ai-model-card ai-model-card--green">
              <div class="ai-model-heading">
                <span class="ai-model-icon">🚿</span>
                <div><p>05 · Water requirement</p><h2>Estimated crop water requirement</h2></div>
              </div>
              <div class="ai-model-body">
                <span class="ai-status" data-state="input" data-summary-water-status>Waiting for results</span>
<div class="ai-result-box" data-summary-water-result>Water quantity will be shown only if a model supplies it.</div>
                <small>Must use a validated crop and field-specific water model.</small>
              </div>
            </article>

            <article class="ai-model-card ai-model-card--red">
              <div class="ai-model-heading">
                <span class="ai-model-icon">🔔</span>
                <div><p>06 · Field-wise alerts</p><h2>Attention and irrigation alerts</h2></div>
              </div>
              <div class="ai-model-body">
                <span class="ai-status" data-state="input" data-summary-alert-status>Waiting for results</span>
<div class="ai-result-box" data-summary-alert-result>Run both models to view their outputs for this field.</div>
                <small>No alert does not mean the field has been confirmed healthy.</small>
              </div>
            </article>
          </div>
        </section>

        <div class="portal-grid portal-grid--2">
          <section class="portal-card portal-card--padded">
            <div class="portal-card-heading"><h2>Future soil moisture</h2>></div>
            <div class="portal-result-box" data-field-sensor-reading aria-live="polite">
              Select a field to retrieve its latest saved sensor reading.
            </div>
            <div class="portal-result-box" data-field-weather-reading aria-live="polite">
              Select a field to retrieve its weather observations and forecast.
            </div>
            <div class="field-input-mode" data-model3-mode>
  <strong>Choose input method</strong>
  <div class="field-input-mode-options">
    <button type="button" class="field-mode-button is-active"
      data-input-mode="auto">Auto-fill field data</button>
    <button type="button" class="field-mode-button"
      data-input-mode="manual">Manual entry</button>
  </div>
  <p data-input-mode-status>Available saved field and sensor data will be loaded automatically.</p>
  <p data-input-mode-status>Available saved field and sensor data will be loaded automatically.</p>
</div>

<form data-model3-form class="portal-form-grid">
              <label class="portal-form-field">Field<select name="field_id" data-model-field required><option value="">Loading fieldsâ€¦</option></select></label>
              <label class="portal-form-field">Zone<select name="zone" required><option value="1">Zone 1</option><option value="2">Zone 2</option><option value="3">Zone 3</option><option value="4">Zone 4</option><option value="5">Zone 5</option></select></label>
              <label class="portal-form-field">Current soil moisture (%)<input name="current_moisture_percent" type="number" min="1" max="100" step="any" required /></label>
             ${[
  ["weather_temp", "Weather temperature"],
  ["weather_humidity", "Weather humidity"],
  ["weather_rain", "Weather rain"],
  ["weather_wind_speed", "Weather wind speed"],
  ["month", "Month"],
  ["day", "Day"],
  ["hour", "Hour"],
  ["day_period", "Day period"],
  ["quarter", "Quarter"]
].map(([name, label]) => `<label class="portal-form-field"><span>${label}</span><input name="${name}" type="number" step="any" /></label>`).join("")}
              <p class="portal-form-error portal-form-field--wide" data-model3-error role="alert" hidden></p>
              <button class="portal-action" type="submit">Run soil moisture prediction</button>
            </form>
            <div class="portal-card portal-card--padded portal-section-gap" data-model3-result hidden></div>
          </section>
          <section class="portal-card portal-card--padded">
            <div class="portal-card-heading"><h2>Crop stress risk</h2></div>
            <div class="field-input-mode" data-model4-mode>
  <strong>Choose input method</strong>
  <div class="field-input-mode-options">
    <button type="button" class="field-mode-button is-active"
      data-input-mode="auto">Auto-fill field data</button>
    <button type="button" class="field-mode-button"
      data-input-mode="manual">Manual entry</button>
  </div>
  <p data-input-mode-status>Available crop, soil and sensor data will be loaded automatically.</p>
</div>

<form data-model4-form class="portal-form-grid">
              <label class="portal-form-field">Field<select name="field_id" data-model-field required><option value="">Loading fieldsâ€¦</option></select></label>
              <label class="portal-form-field">Crop type<input name="crop_type" maxlength="80" required /></label>
              <label class="portal-form-field">Zone<input name="zone" type="number" min="1" max="5" step="1" required /></label>
              ${[
                ["soil_type","Soil type","text"],["bulk_density","Bulk density","number"],["organic_matter_pct","Organic matter (%)","number"],["cation_exchange_capacity","Cation exchange capacity","number"],["salinity_ec","Salinity EC","number"],["buffering_capacity","Buffering capacity","number"],["soil_moisture_pct","Soil moisture (%)","number"],["moisture_limit_dry","Dry moisture limit","number"],["moisture_limit_wet","Wet moisture limit","number"],["moisture_regime","Moisture regime","text"],["thermal_regime","Thermal regime","text"],["nutrient_balance","Nutrient balance","text"],["plant_category","Plant category","text"],["soil_temp_c","Soil temperature (Â°C)","number"],["air_temp_c","Air temperature (Â°C)","number"],["light_intensity_par","Light intensity PAR","number"],["soil_ph","Soil pH","number"],["nitrogen_ppm","Nitrogen (ppm)","number"],["phosphorus_ppm","Phosphorus (ppm)","number"],["potassium_ppm","Potassium (ppm)","number"]
              ].map(([name, label, type]) => {
  const control = name === "soil_type"
    ? `<select name="soil_type" required>
        <option value="">Select soil type</option>
        <option value="Sandy">Sandy</option>
        <option value="Sandy loam">Sandy loam</option>
        <option value="Loamy">Loamy</option>
        <option value="Silty">Silty</option>
        <option value="Clay loam">Clay loam</option>
        <option value="Clay">Clay</option>
      </select>`
    : `<input name="${name}" type="${type}" step="${type === "number" ? "any" : undefined}" required />`;

  return `<label class="portal-form-field"><span>${label}</span>${control}</label>`;
}).join("")}
              <p class="portal-form-error portal-form-field--wide" data-model4-error role="alert" hidden></p>
              <button class="portal-action" type="submit">Run crop stress prediction</button>
            </form>
            <div class="portal-card portal-card--padded portal-section-gap" data-model4-result hidden></div>
          </section>
        </div>
      `,
    },
    "ai-model-predictions": {
      title: "AI Model Predictions",
      subtitle: "Real-time AI predictions to help you make better irrigation and crop management decisions.",
      render: `
        <p class="portal-empty-note" data-ai-dashboard-loading role="status" aria-live="polite">Loading your fields and model statusâ€¦</p>
      `,
    },
  };

  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get("view");
  const view = requestedView && Object.prototype.hasOwnProperty.call(views, requestedView) ? requestedView : "fields";
  const page = views[view];
  const content = document.getElementById("portal-content");

  if (!(content instanceof HTMLElement)) return;

  try {
    const profile = await window.JalSaathiProfile.refreshProfile();
    if (!profile) {
      window.location.replace("/static/auth.html?view=login");
      return;
    }
  } catch (error) {
    console.error("JalSaathi account could not be verified:", error);
    content.textContent = "Your account could not be verified. Please retry.";
    return;
  }

  content.setAttribute("data-i18n-static", "");
  content.innerHTML = page.render;
  window.JalSaathiI18n.translate(content);
  document.title = `JalSaathi | ${page.title}`;
  window.dispatchEvent(new CustomEvent("jalsaathi:page-changed"));
  document.querySelectorAll("[data-view-link]").forEach((link) => {
    const active = link.dataset.viewLink === view;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
    if (view === "field-monitoring") {
    await initializeFieldMonitoringView(content);
  }
  if (view === "field-details") await initializeFieldDetailsView(content);
  if (view === "fields") initializeFieldsView(content);
  if (view === "fields") initializeSensorHistory(content);
  if (view === "crops") initializeCropsView(content);
  if (view === "schedule") void initializeIrrigationSchedule(content);
  if (view === "reports") initializeReportsView(content);
  if (view === "weather") initializeWeatherView(content);
  if (view === "profile") initializeProfileView(content);
  if (view === "alerts") void initializeAlertsView(content);
  if (view === "predictions") void window.JalSaathiModelPredictions?.initialize(content);
  if (view === "ai-model-predictions") void window.JalSaathiAIDashboard?.initialize(content);

  const renderGreeting = () => {
    const userName = window.JalSaathiProfile.getDisplayName();
    document.querySelectorAll("[data-user-name]").forEach((node) => { node.textContent = userName; });
  };
  renderGreeting();
  window.addEventListener("jalsaathi:profile-changed", renderGreeting);

    async function initializeFieldMonitoringView(root) {
    const loadingState = root.querySelector(
      "[data-field-monitoring-loading]"
    );

    if (!(loadingState instanceof HTMLElement)) return;

    try {
      const response = await fetch("/static/field-monitoring.html", {
        credentials: "same-origin",
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          `Monitoring markup could not be loaded (${response.status}).`
        );
      }

      const markup = await response.text();
      loadingState.outerHTML = markup;

      if (
        !window.JalSaathiMonitoring ||
        typeof window.JalSaathiMonitoring.initialize !== "function"
      ) {
        throw new Error("The monitoring JavaScript initializer is unavailable.");
      }

      window.JalSaathiMonitoring.initialize();

    } catch (error) {
      console.error("Field Monitoring could not be initialized:", error);

      const message = root.querySelector(
        "#field-monitoring"
      ) || root.querySelector("[data-field-monitoring-loading]");

      if (message) {
        message.textContent =
          error instanceof Error
            ? error.message
            : "Field Monitoring could not be loaded. Please reload the page.";
      }
    }
  }

  async function initializeFieldDetailsView(root) {
    const panel = root.querySelector("[data-field-details-loading]");
    const fieldId = new URLSearchParams(window.location.search).get("field_id");
    const apiRequest = window.JalSaathiProfile?.apiRequest;

    const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);

    const formatValue = (value, unit = "", digits = 1) => {
      if (value === null || value === undefined || value === "") return "Not recorded";
      const number = Number(value);
      if (!Number.isFinite(number)) return "Not recorded";
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(number)}${unit ? ` ${unit}` : ""}`;
    };

    const formatTime = (value) => {
      if (!value) return "Time not recorded";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "Time not recorded" : date.toLocaleString();
    };

    if (!(panel instanceof HTMLElement)) return;

    if (!fieldId) {
      panel.textContent = "No field was selected. Return to My Fields and choose View Details.";
      return;
    }

    if (typeof apiRequest !== "function") {
      panel.textContent = "The account API is unavailable. Refresh the page and try again.";
      return;
    }

    try {
      const field = await apiRequest(`/api/fields/${encodeURIComponent(fieldId)}`);

      panel.innerHTML = `
        <div class="portal-field-details">
          <div class="portal-card-heading">
            <h2>${escape(field.name || "Unnamed field")}</h2>
            <span class="portal-status">Health: Not assessed</span>
          </div>
          <div class="portal-field-details-grid">
            <div><span>Crop</span><strong>${escape(field.crop || "Not set")}</strong></div>
            <div><span>Area</span><strong>${escape(formatValue(field.area, field.area_unit || field.areaUnit || ""))}</strong></div>
            <div><span>Location</span><strong>${escape(field.location || "Not set")}</strong></div>
            <div><span>Field ID</span><strong>${escape(field.id ?? field.field_id ?? fieldId)}</strong></div>
          </div>
          <section class="portal-field-details-history">
            <div class="portal-card-heading">
              <h2>Sensor readings</h2>
              <span class="portal-muted">Recorded measurements</span>
            </div>
            <div class="portal-detail-range" role="group" aria-label="Sensor history date range">
              <button type="button" class="portal-secondary-action" data-detail-range="24h">24 hours</button>
              <button type="button" class="portal-secondary-action" data-detail-range="7d" aria-pressed="true">7 days</button>
              <button type="button" class="portal-secondary-action" data-detail-range="30d">30 days</button>
            </div>
            <p data-detail-feedback role="status" aria-live="polite">Loading recorded measurements...</p>
            <div data-detail-latest></div>
            <div data-detail-history-table></div>
          </section>
        </div>
      `;

      const feedback = panel.querySelector("[data-detail-feedback]");
      const latestContainer = panel.querySelector("[data-detail-latest]");
      const historyContainer = panel.querySelector("[data-detail-history-table]");

      const metrics = [
        { key: "soil_moisture_percent", label: "Soil moisture", unit: "%", digits: 1 },
        { key: "soil_temperature_c", label: "Soil temperature", unit: "?C", digits: 1 },
        { key: "humidity_percent", label: "Humidity", unit: "%", digits: 1 },
        { key: "ph", label: "Soil pH", unit: "", digits: 2 },
        { key: "electrical_conductivity_us_cm", label: "Electrical conductivity", unit: "?S/cm", digits: 1 },
      ];

      const loadReadings = async (range) => {
        feedback.textContent = "Loading recorded measurements...";
        latestContainer.innerHTML = "";
        historyContainer.innerHTML = "";

        const duration = range === "24h" ? 24 : range === "30d" ? 24 * 30 : 24 * 7;
        const end = new Date();
        const start = new Date(end.getTime() - duration * 60 * 60 * 1000);
        const query = `?start_at=${encodeURIComponent(start.toISOString())}&end_at=${encodeURIComponent(end.toISOString())}&limit=5000`;

        try {
          const result = await apiRequest(
            `/api/fields/${encodeURIComponent(fieldId)}/sensor-readings${query}`
          );

          const readings = Array.isArray(result)
            ? result
            : Array.isArray(result?.items) ? result.items : [];

          readings.sort((a, b) => new Date(b.recorded_at || 0) - new Date(a.recorded_at || 0));

          panel.querySelectorAll("[data-detail-range]").forEach((button) => {
            button.setAttribute("aria-pressed", String(button.dataset.detailRange === range));
          });

          if (!readings.length) {
            feedback.textContent = `No sensor readings were recorded for this field in the selected ${range === "24h" ? "24-hour" : range === "30d" ? "30-day" : "7-day"} period.`;
            return;
          }

          const newest = readings[0];
          feedback.textContent = `${readings.length} recorded reading(s) in this period.`;

          latestContainer.innerHTML = `
            <h3>Latest recorded reading</h3>
            <p class="portal-muted">${escape(formatTime(newest.recorded_at))}</p>
            <div class="portal-field-details-grid">
              ${metrics.map((metric) => `
                <div>
                  <span>${escape(metric.label)}</span>
                  <strong>${escape(formatValue(newest[metric.key], metric.unit, metric.digits))}</strong>
                </div>
              `).join("")}
            </div>
          `;

          historyContainer.innerHTML = `
            <h3>Reading history</h3>
            <div class="portal-table-wrap">
              <table class="portal-table">
                <thead>
                  <tr>
                    <th>Recorded at</th>
                    ${metrics.map((metric) => `<th>${escape(metric.label)}</th>`).join("")}
                  </tr>
                </thead>
                <tbody>
                  ${readings.map((reading) => `
                    <tr>
                      <td>${escape(formatTime(reading.recorded_at))}</td>
                      ${metrics.map((metric) => `<td>${escape(formatValue(reading[metric.key], metric.unit, metric.digits))}</td>`).join("")}
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          `;
        } catch (error) {
          feedback.textContent = error instanceof Error
            ? error.message
            : "Could not load sensor readings for this field.";
        }
      };

      panel.addEventListener("click", (event) => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest("[data-detail-range]");
        if (!(button instanceof HTMLButtonElement)) return;
        void loadReadings(button.dataset.detailRange || "7d");
      });

      await loadReadings("7d");
    } catch (error) {
      panel.textContent = error instanceof Error
        ? error.message
        : "Could not load this field. Return to My Fields and try again.";
    }
  }

  async function initializeFieldsView(fieldsRoot) {
    let fields = window.JalSaathiFieldStore.getServerFields();
    const fieldList = fieldsRoot.querySelector("[data-field-list]");
    const sensorManagementList = fieldsRoot.querySelector("[data-sensor-management-list]");
    const boundaries = fieldsRoot.querySelector("[data-map-boundaries]");
    const pins = fieldsRoot.querySelector("[data-map-pins]");
    const mapCount = fieldsRoot.querySelector("[data-map-count]");
    const emptyState = fieldsRoot.querySelector("[data-field-empty]");
    const addDialog = fieldsRoot.querySelector("[data-add-dialog]");
    const addForm = fieldsRoot.querySelector("[data-add-form]");
    const addError = fieldsRoot.querySelector("[data-add-error]");
    const locationStatus = fieldsRoot.querySelector("[data-location-status]");
    const locationButton = fieldsRoot.querySelector("[data-use-current-location]");
    const deleteDialog = fieldsRoot.querySelector("[data-delete-dialog]");
    const feedback = fieldsRoot.querySelector("[data-field-feedback]");
    const sensorDialog = fieldsRoot.querySelector("[data-sensor-dialog]");
    const sensorFieldLabel = fieldsRoot.querySelector("[data-sensor-field-label]");
    const sensorFeedback = fieldsRoot.querySelector("[data-sensor-feedback]");
    const sensorDeviceState = fieldsRoot.querySelector("[data-sensor-device-state]");
    const sensorRegisterForm = fieldsRoot.querySelector("[data-sensor-register-form]");
    const sensorRegisterError = fieldsRoot.querySelector("[data-sensor-register-error]");
    const sensorRegisterButton = fieldsRoot.querySelector("[data-sensor-register-button]");
    const sensorTokenPanel = fieldsRoot.querySelector("[data-sensor-token-panel]");
    const sensorToken = fieldsRoot.querySelector("[data-sensor-token]");
    const copySensorTokenButton = fieldsRoot.querySelector("[data-copy-sensor-token]");
    const revokeSensorButton = fieldsRoot.querySelector("[data-revoke-sensor]");

    if (
      !(fieldList instanceof HTMLElement) ||
      !(sensorManagementList instanceof HTMLElement) ||
      !(boundaries instanceof SVGElement) ||
      !(pins instanceof HTMLElement) ||
      !(mapCount instanceof HTMLElement) ||
      !(emptyState instanceof HTMLElement) ||
      !(addDialog instanceof HTMLDialogElement) ||
      !(addForm instanceof HTMLFormElement) ||
      !(addError instanceof HTMLElement) ||
      !(locationStatus instanceof HTMLElement) ||
      !(locationButton instanceof HTMLButtonElement) ||
            !(deleteDialog instanceof HTMLDialogElement) ||
      !(feedback instanceof HTMLElement) ||
      !(sensorDialog instanceof HTMLDialogElement) ||
      !(sensorFieldLabel instanceof HTMLElement) ||
      !(sensorFeedback instanceof HTMLElement) ||
      !(sensorDeviceState instanceof HTMLElement) ||
      !(sensorRegisterForm instanceof HTMLFormElement) ||
      !(sensorRegisterError instanceof HTMLElement) ||
      !(sensorRegisterButton instanceof HTMLButtonElement) ||
      !(sensorTokenPanel instanceof HTMLElement) ||
      !(sensorToken instanceof HTMLElement) ||
      !(copySensorTokenButton instanceof HTMLButtonElement) ||
      !(revokeSensorButton instanceof HTMLButtonElement)
    ) {
      return;
    }

    const latitudeInput = addForm.elements.namedItem("latitude");
    const longitudeInput = addForm.elements.namedItem("longitude");
    const coordinateConfirmation = addForm.elements.namedItem("coordinatesConfirmed");
    if (
      !(latitudeInput instanceof HTMLInputElement) ||
      !(longitudeInput instanceof HTMLInputElement) ||
      !(coordinateConfirmation instanceof HTMLInputElement)
    ) {
      return;
    }

    let pendingDeleteId = null;
    let feedbackTimer = 0;
    let selectedSensorFieldId = null;
    let selectedSensorDevice = null;
    const palette = ["green", "yellow", "red"];
    const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);

    const fallbackBoundary = (index) => {
      const column = index % 4;
      const row = Math.floor(index / 4) % 3;
      const centerX = 14 + column * 23;
      const centerY = 23 + row * 27;
      return [
        [centerX - 8, centerY - 11],
        [centerX + 7, centerY - 9],
        [centerX + 9, centerY + 10],
        [centerX - 7, centerY + 12],
      ];
    };

    const fieldBoundary = (field, index) => field.boundary || fallbackBoundary(index);
    const fieldStatus = (field) => {
      return { label: "Account saved", className: "portal-status--neutral" };
    };
    const fieldDetails = (field) => {
      const items = [
        `<span data-user-content data-i18n-crop>${escapeHtml(field.crop || "Crop not set")}</span>`,
        `<span data-user-content>${escapeHtml(field.location)}</span>`,
        `<span data-user-content>${window.JalSaathiI18n.formatNumber(field.area)} ${escapeHtml(field.areaUnit)}</span>`,
      ];
      return items.join(" Â· ");
    };

    const renderFields = () => {
      const numberedFields = window.JalSaathiFieldNumbering.withDisplayNumbers(fields);
      fieldList.innerHTML = numberedFields.map((field, index) => {
        const color = palette[index % palette.length];
        const status = fieldStatus(field);
        return `<article class="portal-field-row portal-field-row--with-details">
          <span class="portal-color-dot portal-color-dot--${color}" aria-hidden="true"></span>
          <div class="portal-field-copy">
  <strong data-user-content>
    Field ${field.displayNumber}: ${escapeHtml(field.name)}
  </strong>
  <small>${fieldDetails(field)}</small>
</div>
          <span class="portal-status ${status.className}">${status.label}</span>
          <div class="portal-field-actions">
            <button class="portal-view-details" type="button" data-view-field="${escapeHtml(field.id)}">View Details</button>
            <button class="portal-edit-field" type="button" data-edit-field="${escapeHtml(field.id)}" aria-label="Edit ${escapeHtml(field.name)}" title="Edit field">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5ZM13.8 6.7l3.5 3.5" /></svg>
            </button>
            <button class="portal-delete-field" type="button" data-delete-field="${escapeHtml(field.id)}" aria-label="Delete ${escapeHtml(field.name)}" title="Delete field">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" /></svg>
            </button>
          </div>
        </article>`;
      }).join("");

      sensorManagementList.innerHTML = numberedFields.length
        ? numberedFields.map((field) => `
          <article class="portal-field-row">
            <div class="portal-field-copy">
              <strong>${escapeHtml(field.name)}</strong>
              <small>Field ${field.displayNumber} · ${escapeHtml(field.location || "Location not set")}</small>
            </div>
            <button
              class="portal-secondary-action portal-manage-sensor"
              type="button"
              data-manage-sensor="${escapeHtml(field.id)}"
              aria-label="Manage sensor for ${escapeHtml(field.name)}"
            >Manage Sensor</button>
          </article>
        `).join("")
        : '<p class="portal-empty-note">Add a field before managing its sensor.</p>';

      boundaries.innerHTML = fields.map((field, index) => {
        const points = fieldBoundary(field, index).map(([x, y]) => `${x},${y}`).join(" ");
        return `<polygon class="portal-map-polygon portal-map-polygon--${palette[index % palette.length]}" points="${points}"></polygon>`;
      }).join("");

      pins.innerHTML = fields.map((field, index) => {
        const points = fieldBoundary(field, index);
        const centerX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
        const centerY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
        return `<span class="portal-map-pin portal-map-pin--${palette[index % palette.length]}" style="left:${centerX}%;top:${centerY}%" aria-hidden="true"><span>${index + 1}</span></span>`;
      }).join("");

      const count = window.JalSaathiI18n.formatNumber(fields.length);
      mapCount.textContent = `${count} ${fields.length === 1 ? "field" : "fields"}`;
      emptyState.hidden = fields.length !== 0;
      fieldList.hidden = fields.length === 0;
    };

    const showFeedback = (message) => {
      window.clearTimeout(feedbackTimer);
      feedback.textContent = message;
      feedback.classList.add("is-visible");
      feedbackTimer = window.setTimeout(() => {
        feedback.textContent = "";
        feedback.classList.remove("is-visible");
      }, 4000);
    };
        const openSensorDialog = async (fieldId) => {
      const field = fields.find(
        (entry) => String(entry.id) === String(fieldId)
      );

      if (!field) return;

      selectedSensorFieldId = String(field.id);
      selectedSensorDevice = null;

      sensorFieldLabel.textContent =
        `Manage the sensor connected to ${field.name}.`;

      sensorFeedback.textContent = "Loading sensor details...";
      sensorDeviceState.replaceChildren();

      sensorRegisterForm.hidden = true;
      sensorRegisterError.hidden = true;
      sensorRegisterError.textContent = "";

      sensorTokenPanel.hidden = true;
      sensorToken.textContent = "";
      revokeSensorButton.hidden = true;

      sensorDialog.showModal();

      try {
        const devices = await window.JalSaathiProfile.apiRequest(
          `/api/fields/${encodeURIComponent(selectedSensorFieldId)}/sensor-devices`
        );

        if (!Array.isArray(devices)) {
          throw new Error("The sensor device response was invalid.");
        }

        const activeDevice = devices.find(
          (device) => device.is_active === true
        );

        selectedSensorDevice = activeDevice || devices[0] || null;

        if (!selectedSensorDevice) {
          sensorFeedback.textContent =
            "No sensor is registered for this field yet.";

          sensorRegisterForm.hidden = false;
          return;
        }

        const device = selectedSensorDevice;

        sensorDeviceState.innerHTML = `
          <div class="portal-dialog-description">
            <p>
              <strong>${escapeHtml(device.name || "Unnamed sensor")}</strong>
            </p>
            <p>Device ID: ${escapeHtml(device.device_id || "Unavailable")}</p>
            <p>
              Device status:
              <strong>${device.is_active ? "Active" : "Revoked"}</strong>
            </p>
            <p>
              Last report:
              ${device.last_seen_at
                ? escapeHtml(new Date(device.last_seen_at).toLocaleString())
                : "No readings received yet"}
            </p>
          </div>
        `;

        if (device.is_active) {
          const lastSeen = device.last_seen_at
            ? new Date(device.last_seen_at).getTime()
            : NaN;

          const recentlySeen =
            Number.isFinite(lastSeen) &&
            Date.now() - lastSeen <= 5 * 60 * 1000;

          sensorFeedback.textContent = !Number.isFinite(lastSeen)
            ? "Device registered. Waiting for its first reading."
            : recentlySeen
              ? "Device has reported recently."
              : "Device is registered, but has not reported in the last five minutes.";

          revokeSensorButton.hidden = false;
        } else {
          sensorFeedback.textContent =
            "This device has been revoked. You can register a replacement.";

          sensorRegisterForm.hidden = false;
        }
      } catch (error) {
        sensorFeedback.textContent = error instanceof Error
          ? error.message
          : "Sensor device details could not be loaded.";
      }
    };
    const closeAddDialog = () => {
      addDialog.close();
      addError.hidden = true;
      addError.textContent = "";
      locationStatus.textContent = "";
      addForm.reset();
      delete addForm.dataset.editingId;
      fieldsRoot.querySelector("[data-add-title]")?.replaceChildren(document.createTextNode("Add Field"));
      fieldsRoot.querySelector("[data-add-submit]")?.replaceChildren(document.createTextNode("Save Field"));
    };

    fieldsRoot.querySelectorAll("[data-open-add-field]").forEach((button) => {
      button.addEventListener("click", () => {
        addForm.reset();
        locationStatus.textContent = "";
        delete addForm.dataset.editingId;
        fieldsRoot.querySelector("[data-add-title]")?.replaceChildren(document.createTextNode("Add Field"));
        fieldsRoot.querySelector("[data-add-submit]")?.replaceChildren(document.createTextNode("Save Field"));
        addError.hidden = true;
        addError.textContent = "";
        addDialog.showModal();
        addForm.elements.namedItem("name")?.focus();
      });
    });
    locationButton.addEventListener("click", () => {
      locationButton.disabled = true;
      locationStatus.textContent = "Requesting your current location. Allow location access in your browser.";
      const requestCoordinates =
        window.JalSaathiFieldLocation?.requestCurrentCoordinates;
      const request = typeof requestCoordinates === "function"
        ? requestCoordinates()
        : Promise.reject(new Error("unavailable"));
      request.then(({ latitude, longitude }) => {
        latitudeInput.value = String(latitude);
        longitudeInput.value = String(longitude);
        coordinateConfirmation.checked = false;
        locationStatus.textContent = "Current location filled in. Confirm or adjust the coordinates to match this field before saving.";
      }).catch((error) => {
        const messages = {
          "permission-denied": "Location permission was denied. Allow access or enter the field coordinates manually.",
          "position-unavailable": "Your location is unavailable. Try again or enter the field coordinates manually.",
          timeout: "Location request timed out. Try again or enter the field coordinates manually.",
          invalid: "The browser returned invalid coordinates. Enter the field coordinates manually.",
          unavailable: "Location could not be retrieved. Use a secure connection or localhost, or enter the field coordinates manually.",
        };
        locationStatus.textContent = messages[error.message] || messages.unavailable;
      }).finally(() => {
        locationButton.disabled = false;
      });
    });
    for (const input of [latitudeInput, longitudeInput]) {
      input.addEventListener("input", () => {
        coordinateConfirmation.checked = false;
        if (locationStatus.textContent.startsWith("Current location filled in.")) {
          locationStatus.textContent = "Coordinates changed. Confirm they match this field before saving.";
        }
      });
    }
    fieldsRoot.querySelector("[data-close-add]")?.addEventListener("click", closeAddDialog);
    fieldsRoot.querySelector("[data-cancel-add]")?.addEventListener("click", closeAddDialog);
    addDialog.addEventListener("click", (event) => {
      if (event.target === addDialog) closeAddDialog();
    });
    addDialog.addEventListener("close", () => {
      addError.hidden = true;
      addError.textContent = "";
    });

    addForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      addError.hidden = true;
      addError.textContent = "";

      if (!addForm.checkValidity()) {
        const invalidInput = addForm.querySelector(":invalid");
        addError.textContent = "Check the required field details and area.";
        addError.hidden = false;
        if (invalidInput instanceof HTMLElement) invalidInput.focus();
        return;
      }

      const formData = new FormData(addForm);
      const latitudeValue = String(formData.get("latitude") ?? "").trim();
      const longitudeValue = String(formData.get("longitude") ?? "").trim();
      if ((latitudeValue === "") !== (longitudeValue === "")) {
        addError.textContent = "Enter both latitude and longitude, or leave both blank.";
        addError.hidden = false;
        return;
      }
      if (latitudeValue && !coordinateConfirmation.checked) {
        addError.textContent = "Confirm that these coordinates represent this field before saving.";
        addError.hidden = false;
        coordinateConfirmation.focus();
        return;
      }
      const existing = addForm.dataset.editingId ? fields.find((field) => field.id === addForm.dataset.editingId) : null;
      const fieldValues = {
        name: String(formData.get("name")).trim(),
        location: String(formData.get("location")).trim(),
        crop: String(formData.get("crop")),
        area: Number(formData.get("area")),
        areaUnit: String(formData.get("areaUnit")),
        latitude: latitudeValue ? Number(latitudeValue) : null,
        longitude: longitudeValue ? Number(longitudeValue) : null,
      };
      try {
        const field = existing
          ? await window.JalSaathiFieldStore.updateServerField(existing.id, fieldValues)
          : await window.JalSaathiFieldStore.addServerField(fieldValues);
        fields = window.JalSaathiFieldStore.getServerFields();
        renderFields();
        closeAddDialog();
        showFeedback(existing ? `${field.name} was updated.` : `${field.name} was added to your account.`);
      } catch (error) {
        addError.textContent = error instanceof Error ? error.message : "The field could not be saved.";
        addError.hidden = false;
      }
    });

    const openDeleteDialog = (id) => {
      const field = fields.find((entry) => entry.id === id);
      if (!field) return;
      pendingDeleteId = id;
      deleteDialog.showModal();
      fieldsRoot.querySelector("[data-cancel-delete]")?.focus();
    };
    const closeDeleteDialog = () => {
      pendingDeleteId = null;
      deleteDialog.close();
    };

    deleteDialog.addEventListener("close", () => {
      pendingDeleteId = null;
    });

    sensorManagementList.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;

      const sensorButton = event.target.closest("[data-manage-sensor]");
      if (sensorButton instanceof HTMLButtonElement) {
        void openSensorDialog(sensorButton.dataset.manageSensor || "");
      }
    });

    fieldList.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;

      const detailsButton = event.target.closest("[data-view-field]");
      if (detailsButton instanceof HTMLButtonElement) {
        const fieldId = detailsButton.dataset.viewField;
        if (fieldId) {
          window.location.href = `/static/sections.html?view=field-details&field_id=${encodeURIComponent(fieldId)}`;
        }
        return;
      }

      const editButton = event.target.closest("[data-edit-field]");
      if (editButton instanceof HTMLButtonElement) {
        const field = fields.find((entry) => entry.id === editButton.dataset.editField);
        if (field) {
          addForm.reset();
          locationStatus.textContent = "";
          addForm.dataset.editingId = field.id;
          fieldsRoot.querySelector("[data-add-title]")?.replaceChildren(document.createTextNode("Edit Field"));
          fieldsRoot.querySelector("[data-add-submit]")?.replaceChildren(document.createTextNode("Save Changes"));
          for (const name of ["name", "location", "crop", "area", "areaUnit"]) {
            const input = addForm.elements.namedItem(name);
            if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) input.value = field[name] ?? "";
          }
          latitudeInput.value = field.latitude ?? "";
          longitudeInput.value = field.longitude ?? "";
          addError.hidden = true;
          addDialog.showModal();
        }
        return;
      }
      const button = event.target.closest("[data-delete-field]");
      if (button instanceof HTMLButtonElement) {
        openDeleteDialog(button.dataset.deleteField || "");
      }
    });
    fieldsRoot.querySelector("[data-cancel-delete]")?.addEventListener("click", closeDeleteDialog);
        const closeSensorDialog = () => {
      if (sensorDialog.open) {
        sensorDialog.close();
      }
    };

    fieldsRoot.querySelectorAll("[data-close-sensor]").forEach((button) => {
      button.addEventListener("click", closeSensorDialog);
    });

    sensorDialog.addEventListener("click", (event) => {
      if (event.target === sensorDialog) {
        closeSensorDialog();
      }
    });

    sensorDialog.addEventListener("close", () => {
      sensorToken.textContent = "";
      sensorTokenPanel.hidden = true;
      sensorRegisterError.textContent = "";
      sensorRegisterError.hidden = true;
      selectedSensorFieldId = null;
      selectedSensorDevice = null;
    });

    sensorRegisterForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      sensorRegisterError.hidden = true;
      sensorRegisterError.textContent = "";

      if (!selectedSensorFieldId) {
        sensorRegisterError.textContent =
          "Please close and reopen the sensor dialog.";
        sensorRegisterError.hidden = false;
        return;
      }

      if (!sensorRegisterForm.reportValidity()) return;

      const formData = new FormData(sensorRegisterForm);
      const name = String(formData.get("name") || "").trim();

      if (!name || name.length > 100) {
        sensorRegisterError.textContent =
          "Enter a sensor name between 1 and 100 characters.";
        sensorRegisterError.hidden = false;
        return;
      }

      sensorRegisterButton.disabled = true;
      sensorRegisterButton.textContent = "Registering...";

      try {
        const device = await window.JalSaathiProfile.apiRequest(
          `/api/fields/${encodeURIComponent(selectedSensorFieldId)}/sensor-devices`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ name }),
          }
        );

        selectedSensorDevice = device;

        sensorDeviceState.innerHTML = `
          <div class="portal-dialog-description">
            <p><strong>${escapeHtml(device.name)}</strong></p>
            <p>Device ID: ${escapeHtml(device.device_id)}</p>
            <p>Device status: Active</p>
          </div>
        `;

        sensorFeedback.textContent =
          "Sensor registered successfully. Copy your secret token now.";

        sensorRegisterForm.hidden = true;
        revokeSensorButton.hidden = false;

        sensorToken.textContent = device.token;
        sensorTokenPanel.hidden = false;

        sensorRegisterForm.reset();

      } catch (error) {
        sensorRegisterError.textContent = error instanceof Error
          ? error.message
          : "Sensor registration failed.";
        sensorRegisterError.hidden = false;
      } finally {
        sensorRegisterButton.disabled = false;
        sensorRegisterButton.textContent = "Register Sensor";
      }
    });

        copySensorTokenButton.addEventListener("click", async () => {
      const token = sensorToken.textContent.trim();

      if (!token) {
        sensorFeedback.textContent = "No sensor token is available to copy.";
        return;
      }

      try {
        await navigator.clipboard.writeText(token);
        sensorFeedback.textContent =
          "Sensor token copied successfully. Store it securely.";
      } catch (error) {
        sensorFeedback.textContent =
          "Copy failed. Check browser clipboard permissions and try again.";
      }
    });
        revokeSensorButton.addEventListener("click", async () => {
      const fieldId = selectedSensorFieldId;
      const device = selectedSensorDevice;

      if (!fieldId || !device || !Number.isInteger(Number(device.id))) {
        sensorFeedback.textContent =
          "No valid registered device is selected.";
        return;
      }

      const confirmed = window.confirm(
        "Are you sure you want to revoke this sensor? Its token will stop working."
      );

      if (!confirmed) return;

      revokeSensorButton.disabled = true;
      revokeSensorButton.textContent = "Revoking...";

      try {
        const revokedDevice = await window.JalSaathiProfile.apiRequest(
          `/api/fields/${encodeURIComponent(fieldId)}/sensor-devices/${Number(device.id)}/revoke`,
          { method: "POST" }
        );

        selectedSensorDevice = revokedDevice;

        sensorDeviceState.innerHTML = `
          <div class="portal-dialog-description">
            <p><strong>${escapeHtml(revokedDevice.name || "Sensor")}</strong></p>
            <p>Device ID: ${escapeHtml(revokedDevice.device_id || "Unavailable")}</p>
            <p>Device status: Revoked</p>
          </div>
        `;

        sensorFeedback.textContent =
          "Sensor revoked successfully. You can now register a replacement.";

        revokeSensorButton.hidden = true;
        sensorRegisterForm.reset();
        sensorRegisterForm.hidden = false;
        sensorRegisterError.hidden = true;
        sensorToken.textContent = "";
        sensorTokenPanel.hidden = true;

      } catch (error) {
        sensorFeedback.textContent = error instanceof Error
          ? error.message
          : "The sensor could not be revoked.";
      } finally {
        revokeSensorButton.disabled = false;
        revokeSensorButton.textContent = "Revoke Sensor";
      }
    });
    fieldsRoot.querySelector("[data-close-delete]")?.addEventListener("click", closeDeleteDialog);
    deleteDialog.addEventListener("click", (event) => {
      if (event.target === deleteDialog) closeDeleteDialog();
    });
    fieldsRoot.querySelector("[data-confirm-delete]")?.addEventListener("click", async () => {
      try {
        const field = await window.JalSaathiFieldStore.deleteServerField(pendingDeleteId);
        if (!field) {
          closeDeleteDialog();
          return;
        }
        fields = window.JalSaathiFieldStore.getServerFields();
        pendingDeleteId = null;
        deleteDialog.close();
        renderFields();
        showFeedback(`${field.name} was removed from your account.`);
      } catch (error) {
        showFeedback(error instanceof Error ? error.message : "The field could not be deleted.");
      }
    });

    window.addEventListener("jalsaathi:fields-changed", () => {
      fields = window.JalSaathiFieldStore.getServerFields();
      renderFields();
    });
    window.addEventListener("jalsaathi:language-changed", renderFields);
    try {
      fields = await window.JalSaathiFieldStore.loadServerFields();
      renderFields();
      const requestedEditId = new URLSearchParams(window.location.search).get("edit_field");
      if (requestedEditId) {
        const editButton = Array.from(fieldList.querySelectorAll("[data-edit-field]"))
          .find((button) => button.dataset.editField === requestedEditId);
        editButton?.click();
      }
    } catch (error) {
      renderFields();
      showFeedback(error instanceof Error ? error.message : "Your fields could not be loaded.");
    }
  }

  async function initializeIrrigationSchedule(root) {
    const feedback = root.querySelector("[data-irrigation-feedback]");
    const fieldSelect = root.querySelector("[data-irrigation-field]");
    const reservoirSelect = root.querySelector("[data-irrigation-reservoir]");
    const reservoirForm = root.querySelector("[data-irrigation-reservoir-form]");
    const waterForm = root.querySelector("[data-irrigation-water-form]");
    const waterEdit = root.querySelector("[data-irrigation-water-edit]");
    const planForm = root.querySelector("[data-irrigation-plan-form]");
    const manualScheduleForm = root.querySelector("[data-irrigation-manual-form]");
    const manualScheduleError = root.querySelector("[data-irrigation-manual-error]");
    const planError = root.querySelector("[data-irrigation-plan-error]");
    const planResult = root.querySelector("[data-irrigation-plan-result]");
    const scheduleRows = root.querySelector("[data-irrigation-schedules]");
    const schedulesWrap = root.querySelector("[data-irrigation-schedules-wrap]");
    const schedulesEmpty = root.querySelector("[data-irrigation-schedules-empty]");
    if (!(feedback instanceof HTMLElement) || !(fieldSelect instanceof HTMLSelectElement) ||
        !(reservoirSelect instanceof HTMLSelectElement) || !(reservoirForm instanceof HTMLFormElement) ||
        !(waterForm instanceof HTMLFormElement) || !(waterEdit instanceof HTMLButtonElement) ||
        !(planForm instanceof HTMLFormElement) || !(planError instanceof HTMLElement) ||
        !(planResult instanceof HTMLElement) || !(scheduleRows instanceof HTMLElement) ||
        !(manualScheduleForm instanceof HTMLFormElement) ||
        !(manualScheduleError instanceof HTMLElement) ||
        !(schedulesWrap instanceof HTMLElement) || !(schedulesEmpty instanceof HTMLElement)) return;

    const fieldsForReservoir = root.querySelector("[data-irrigation-reservoir-field]");
    const fieldValues = {
      name: root.querySelector("[data-irrigation-field-name]"),
      crop: root.querySelector("[data-irrigation-field-crop]"),
      area: root.querySelector("[data-irrigation-field-area]"),
      zone: root.querySelector("[data-irrigation-field-zone]"),
      stage: root.querySelector("[data-irrigation-saved-stage]"),
      location: root.querySelector("[data-irrigation-field-location]"),
    };
    const waterValues = {
      capacity: root.querySelector("[data-irrigation-capacity]"),
      available: root.querySelector("[data-irrigation-available]"),
      reserved: root.querySelector("[data-irrigation-reserved]"),
      remaining: root.querySelector("[data-irrigation-remaining]"),
      updated: root.querySelector("[data-irrigation-water-updated]"),
    };
    const summaryValues = {
      scheduled: root.querySelector("[data-irrigation-summary-scheduled]"),
      reserved: root.querySelector("[data-irrigation-summary-reserved]"),
      remaining: root.querySelector("[data-irrigation-summary-remaining]"),
      upcoming: root.querySelector("[data-irrigation-summary-upcoming]"),
      completed: root.querySelector("[data-irrigation-summary-completed]"),
    };
    if (Object.values(fieldValues).some((node) => !(node instanceof HTMLElement)) ||
        Object.values(waterValues).some((node) => !(node instanceof HTMLElement)) ||
        Object.values(summaryValues).some((node) => !(node instanceof HTMLElement)) ||
        !(fieldsForReservoir instanceof HTMLSelectElement)) return;

    const apiRequest = window.JalSaathiProfile.apiRequest;
    const liters = (value) => `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} L`;
    const showError = (error) => {
      const status = Number(error?.status);
      if (status === 401) return "Your session has expired. Sign in again to manage irrigation.";
      if (status === 403) return "This action was blocked by the account security check. Refresh the page and retry.";
      if (status === 404) return "That field, water source, or schedule is not available to this account.";
      if (status === 409) return error.message || "The water balance or schedule changed. Refresh and retry.";
      if (status === 422) return error.message || "Check the required field and measured values.";
      if (status === 503) return error.message || "Weather or optimizer service is temporarily unavailable.";
      if (status >= 500) return "The irrigation service is temporarily unavailable. Try again later.";
      return error instanceof Error ? error.message : "The irrigation request could not be completed.";
    };
    const setFeedback = (message, isError = false) => {
      feedback.textContent = message;
      feedback.classList.toggle("is-error", isError);
    };
    let fields = [];
    let crops = [];
    let reservoirs = [];
    let schedules = [];
    let selectedField = null;
    let selectedReservoir = null;
    let latestRecommendation = null;

    const linkedCrop = (fieldId) => crops
      .filter((crop) => String(crop.field_id) === String(fieldId))
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))[0] || null;
    const stageCode = (stage) => {
      const value = String(stage || "").toLocaleLowerCase();
      if (value.includes("seed") || value.includes("initial")) return "1";
      if (value.includes("vegetative") || value.includes("development") || value.includes("growing")) return "2";
      if (value.includes("flower") || value.includes("fruit") || value.includes("mid")) return "3";
      return "";
    };
    const currentField = () => fields.find((field) => String(field.id) === fieldSelect.value) || null;

    const renderField = () => {
      selectedField = currentField();
      fieldValues.name.textContent = selectedField?.name || "Not selected";
      fieldValues.crop.textContent = (selectedField ? linkedCrop(selectedField.id)?.name : null)
        || selectedField?.crop || "Not recorded";
      fieldValues.area.textContent = selectedField
        ? `${selectedField.area} ${selectedField.area_unit}`
        : "Not recorded";
      fieldValues.zone.textContent = "Not recorded in field profile";
      const crop = selectedField ? linkedCrop(selectedField.id) : null;
      fieldValues.stage.textContent = crop?.growth_stage || "Not recorded";
      fieldValues.location.textContent = selectedField?.latitude !== null && selectedField?.latitude !== undefined
        ? `${selectedField.latitude}, ${selectedField.longitude}`
        : "Coordinates not recorded";
      const stageInput = planForm.elements.namedItem("growth_stage_code");
      if (stageInput instanceof HTMLSelectElement) stageInput.value = stageCode(crop?.growth_stage);

      const option = reservoirSelect.value;
      reservoirSelect.innerHTML = `<option value="">${selectedField ? "Select a water source" : "Select a field first"}</option>`;
      reservoirs.forEach((reservoir) => {
        const scope = reservoir.field_id === null ? " Â· shared" : "";
        reservoirSelect.insertAdjacentHTML(
          "beforeend",
          `<option value="${escapeText(reservoir.id)}">${escapeText(reservoir.name)}${scope}</option>`,
        );
      });
      if (reservoirs.some((reservoir) => String(reservoir.id) === option)) reservoirSelect.value = option;
      if (fieldsForReservoir) {
        const chosen = fieldsForReservoir.value;
        fieldsForReservoir.innerHTML = `<option value="">All my fields</option>${fields.map((field) =>
          `<option value="${escapeText(field.id)}">${escapeText(field.name)}</option>`).join("")}`;
        if (fields.some((field) => String(field.id) === chosen)) fieldsForReservoir.value = chosen;
        else if (selectedField) fieldsForReservoir.value = String(selectedField.id);
      }
      updateReservoirCard();
      planResult.hidden = true;
      latestRecommendation = null;
    };

    function updateReservoirCard() {
      selectedReservoir = reservoirs.find(
        (reservoir) => String(reservoir.id) === reservoirSelect.value,
      ) || null;
      waterValues.capacity.textContent = selectedReservoir ? liters(selectedReservoir.capacity_liters) : "Not available";
      waterValues.available.textContent = selectedReservoir ? liters(selectedReservoir.available_liters) : "Not available";
      waterValues.reserved.textContent = selectedReservoir ? liters(selectedReservoir.reserved_liters) : "Not available";
      waterValues.remaining.textContent = selectedReservoir ? liters(selectedReservoir.remaining_liters) : "Not available";
      waterValues.updated.textContent = selectedReservoir?.updated_at
        ? new Date(selectedReservoir.updated_at).toLocaleString()
        : "Not available";
      waterEdit.hidden = !selectedReservoir;
      waterForm.hidden = true;
      waterEdit.textContent = "Update Water Availability";
      const configureLabel = root.querySelector("[data-irrigation-configure-label]");
      if (configureLabel) {
        configureLabel.textContent = reservoirs.length
          ? "Configure another water source"
          : "No water source configured â€” add one";
      }
    }

    async function loadReservoirs(preserveSelection = true) {
      reservoirs = selectedField
        ? await apiRequest(`/api/irrigation/reservoirs?field_id=${encodeURIComponent(selectedField.id)}`)
        : [];
      const previous = preserveSelection ? reservoirSelect.value : "";
      reservoirSelect.innerHTML = `<option value="">${selectedField ? "Select a water source" : "Select a field first"}</option>`;
      reservoirs.forEach((reservoir) => {
        const scope = reservoir.field_id === null ? " Â· shared" : "";
        reservoirSelect.insertAdjacentHTML(
          "beforeend",
          `<option value="${escapeText(reservoir.id)}">${escapeText(reservoir.name)}${scope}</option>`,
        );
      });
      if (reservoirs.some((item) => String(item.id) === previous)) reservoirSelect.value = previous;
      else if (reservoirs.length === 1) reservoirSelect.value = String(reservoirs[0].id);
      updateReservoirCard();
      return reservoirs;
    }

    async function loadSchedules() {
      if (!selectedField) {
        schedules = [];
        renderSchedules({ schedules: [], summary: {} });
        return;
      }
      const result = await apiRequest(
        `/api/irrigation/schedules?field_id=${encodeURIComponent(selectedField.id)}`,
      );
      if (!result || !Array.isArray(result.schedules) || !result.summary) {
        throw new Error("The irrigation schedule response has an invalid format.");
      }
      schedules = result.schedules;
      renderSchedules(result);
    }

        const scheduleSearch = root.querySelector("[data-irrigation-search]");
    const scheduleStatusFilter = root.querySelector("[data-irrigation-status-filter]");
  let scheduleSummary = {};
    function renderSchedules(result) {
      if (result.summary) scheduleSummary = result.summary;
      const summary = scheduleSummary;

      summaryValues.scheduled.textContent = liters(summary.total_scheduled_liters || 0);
      summaryValues.reserved.textContent = liters(summary.total_reserved_liters || 0);
      summaryValues.remaining.textContent = liters(summary.remaining_available_liters || 0);
      summaryValues.upcoming.textContent = String(summary.upcoming_events || 0);
      summaryValues.completed.textContent = String(summary.completed_events || 0);

      schedules = result.schedules || [];

      const searchTerm = (scheduleSearch?.value || "").trim().toLowerCase();
      const selectedStatus = scheduleStatusFilter?.value || "all";

      const filteredSchedules = schedules.filter((schedule) => {
        const searchableText = [
          schedule.field_name,
          schedule.crop_name,
          schedule.irrigation_method,
          schedule.status,
          schedule.scheduled_date,
        ].join(" ").toLowerCase();

        const matchesSearch = searchableText.includes(searchTerm);
        const matchesStatus = selectedStatus === "all"
          || schedule.status === selectedStatus;

        return matchesSearch && matchesStatus;
      });

      schedulesEmpty.hidden = filteredSchedules.length > 0;
      schedulesWrap.hidden = filteredSchedules.length === 0;

      if (schedules.length > 0 && filteredSchedules.length === 0) {
        schedulesEmpty.textContent = "No schedules match your search or selected status.";
      } else {
        schedulesEmpty.textContent = "No irrigation schedules have been generated for this field.";
      }

      scheduleRows.innerHTML = filteredSchedules.map((schedule) => {
        const time = schedule.start_time
          ? `${escapeText(schedule.start_time)} – ${escapeText(schedule.end_time || "")}`
          : "Not scheduled";

        const duration = schedule.duration_minutes
          ? `${escapeText(schedule.duration_minutes)} min`
          : "Not scheduled";

        const statusLabels = {
          recommended: "Recommended",
          confirmed: "Confirmed",
          completed: "Completed",
          insufficient_water: "Insufficient water",
          cancelled: "Cancelled",
        };

        const statusClass = {
          recommended: "recommended",
          confirmed: "confirmed",
          completed: "completed",
          insufficient_water: "warning",
          cancelled: "cancelled",
        }[schedule.status] || "default";

        const actions = [
          `<button class="portal-secondary-action" type="button" data-irrigation-view="${escapeText(schedule.id)}">View details</button>`,
          schedule.status === "recommended"
            ? `<button class="portal-action" type="button" data-irrigation-confirm="${escapeText(schedule.id)}">Confirm</button>`
            : "",
          ["recommended", "insufficient_water", "confirmed"].includes(schedule.status)
            ? `<button class="portal-secondary-action" type="button" data-irrigation-cancel="${escapeText(schedule.id)}">Cancel</button>`
            : "",
          schedule.status === "confirmed"
            ? `<button class="portal-action" type="button" data-irrigation-complete="${escapeText(schedule.id)}">Mark completed</button>`
            : "",
        ].filter(Boolean).join("");

        return `
          <article class="portal-irrigation-schedule-card"
                   data-irrigation-schedule-row="${escapeText(schedule.id)}">

            <div class="portal-irrigation-schedule-top">
              <div class="portal-irrigation-schedule-identity">
              <span class="portal-irrigation-drop" aria-hidden="true">💧</span>                <div>
                  <h3>${escapeText(schedule.field_name || "Unnamed field")}</h3>
                  <p>${escapeText(schedule.crop_name || "Crop not specified")}</p>
                </div>
              </div>
              <span class="portal-irrigation-status portal-irrigation-status--${statusClass}">
                ${escapeText(statusLabels[schedule.status] || schedule.status || "Unknown")}
              </span>
            </div>

            <div class="portal-irrigation-schedule-metrics">
              <div>
                <span class="portal-irrigation-metric-label">Scheduled date</span>
                <strong>${escapeText(schedule.scheduled_date || "Not scheduled")}</strong>
              </div>
              <div>
                <span class="portal-irrigation-metric-label">Time</span>
                <strong>${time}</strong>
              </div>
              <div>
                <span class="portal-irrigation-metric-label">Water volume</span>
                <strong>${liters(schedule.water_liters)}</strong>
              </div>
              <div>
                <span class="portal-irrigation-metric-label">Duration</span>
                <strong>${duration}</strong>
              </div>
            </div>

            <div class="portal-irrigation-schedule-footer">
              <span>Method: <strong>${escapeText(schedule.irrigation_method || "Not specified")}</strong></span>
              <div class="portal-irrigation-actions">${actions}</div>
            </div>

            <div class="portal-irrigation-expanded-details"
                 data-irrigation-schedule-details
                 hidden></div>
          </article>
        `;
      }).join("");
    }

    scheduleSearch?.addEventListener("input", () => {
      renderSchedules({ schedules, summary: scheduleSummary });
    });

    scheduleStatusFilter?.addEventListener("change", () => {
      renderSchedules({ schedules, summary: scheduleSummary });
    });

    const refreshBalances = async () => {
      await Promise.all([loadReservoirs(), loadSchedules()]);
    };

    reservoirSelect.addEventListener("change", updateReservoirCard);
    fieldSelect.addEventListener("change", async () => {
      renderField();
      setFeedback("Loading water availability and schedulesâ€¦");
      try {
        await loadReservoirs(false);
        await loadSchedules();
        setFeedback("");
      } catch (error) {
        setFeedback(showError(error), true);
      }
    });
    waterEdit.addEventListener("click", () => {
      if (!selectedReservoir) return;
      const input = waterForm.elements.namedItem("available_liters");
      if (input instanceof HTMLInputElement) input.value = String(selectedReservoir.available_liters);
      waterForm.hidden = !waterForm.hidden;
      waterEdit.textContent = waterForm.hidden ? "Update Water Availability" : "Close water update";
    });
    waterForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!selectedReservoir || !waterForm.reportValidity()) return;
      const submit = waterForm.querySelector("button[type=submit]");
      if (submit instanceof HTMLButtonElement) submit.disabled = true;
      try {
        await apiRequest(`/api/irrigation/reservoirs/${encodeURIComponent(selectedReservoir.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            available_liters: Number(new FormData(waterForm).get("available_liters")),
          }),
        });
        await refreshBalances();
        setFeedback("The measured reservoir level was updated.");
      } catch (error) {
        setFeedback(showError(error), true);
      } finally {
        if (submit instanceof HTMLButtonElement) submit.disabled = false;
      }
    });
    reservoirForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!reservoirForm.reportValidity()) return;
      const submit = reservoirForm.querySelector("button[type=submit]");
      if (submit instanceof HTMLButtonElement) submit.disabled = true;
      const values = new FormData(reservoirForm);
      const fieldId = String(values.get("field_id") || "");
      try {
        await apiRequest("/api/irrigation/reservoirs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: String(values.get("name")).trim(),
            capacity_liters: Number(values.get("capacity_liters")),
            available_liters: Number(values.get("available_liters")),
            field_id: fieldId ? Number(fieldId) : null,
          }),
        });
        reservoirForm.reset();
        if (fieldsForReservoir && selectedField) fieldsForReservoir.value = String(selectedField.id);
        await refreshBalances();
        setFeedback("The water source was saved.");
      } catch (error) {
        setFeedback(showError(error), true);
      } finally {
        if (submit instanceof HTMLButtonElement) submit.disabled = false;
      }
    });
    planForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      planError.hidden = true;
      if (!planForm.reportValidity()) return;
      if (!selectedField) {
        planError.textContent = "Select one of your saved fields.";
        planError.hidden = false;
        return;
      }
      if (!selectedReservoir) {
        planError.textContent = "Configure or select a water source before requesting a plan.";
        planError.hidden = false;
        return;
      }
      const submit = root.querySelector("[data-irrigation-plan-submit]");
      if (submit instanceof HTMLButtonElement) {
        submit.disabled = true;
        submit.textContent = "Generating planâ€¦";
      }
      setFeedback("Checking field ownership, weather, and unreserved waterâ€¦");
      const values = new FormData(planForm);
      const body = {
        field_id: Number(selectedField.id),
        reservoir_id: Number(selectedReservoir.id),
        soil_moisture_pct: Number(values.get("soil_moisture_pct")),
        growth_stage_code: Number(values.get("growth_stage_code")),
        soil_type_code: Number(values.get("soil_type_code")),
        irrigation_method: String(values.get("irrigation_method")),
        pump_flow_lpm: Number(values.get("pump_flow_lpm")),
      };
      try {
        latestRecommendation = await apiRequest("/api/irrigation/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        renderRecommendation(latestRecommendation, body);
        await refreshBalances();
        setFeedback("Recommendation loaded. Water is not reserved until you confirm.");
      } catch (error) {
        planError.textContent = showError(error);
        planError.hidden = false;
        setFeedback(showError(error), true);
      } finally {
        if (submit instanceof HTMLButtonElement) {
          submit.disabled = false;
          submit.textContent = "Generate Irrigation Plan";
        }
      }
    });
    manualScheduleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  manualScheduleError.hidden = true;

  if (!manualScheduleForm.reportValidity()) return;

  if (!selectedField) {
    manualScheduleError.textContent = "Please select a saved field first.";
    manualScheduleError.hidden = false;
    return;
  }

  if (!selectedReservoir) {
    manualScheduleError.textContent = "Please select a water source first.";
    manualScheduleError.hidden = false;
    return;
  }

  const values = new FormData(manualScheduleForm);
  const submit = manualScheduleForm.querySelector(
    "[data-irrigation-manual-submit]"
  );

  const body = {
    field_id: Number(selectedField.id),
    reservoir_id: Number(selectedReservoir.id),
    scheduled_date: String(values.get("scheduled_date")),
    start_time: String(values.get("start_time")),
    duration_minutes: Number(values.get("duration_minutes")),
    water_liters: Number(values.get("water_liters")),
    irrigation_method: String(values.get("irrigation_method")),
  };

  if (submit instanceof HTMLButtonElement) {
    submit.disabled = true;
    submit.textContent = "Creating schedule...";
  }

  try {
    await apiRequest("/api/irrigation/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    manualScheduleForm.reset();

    await refreshBalances();

    setFeedback(
      "Manual schedule created. Review it in the schedule list and confirm it to reserve water."
    );
  } catch (error) {
    manualScheduleError.textContent = showError(error);
    manualScheduleError.hidden = false;
    setFeedback(showError(error), true);
  } finally {
    if (submit instanceof HTMLButtonElement) {
      submit.disabled = false;
      submit.textContent = "Create manual schedule";
    }
  }
});
    function renderRecommendation(result, inputs) {
      const plan = result.plan;
      const notes = Array.isArray(plan.notes) && plan.notes.length
        ? `<ul>${plan.notes.map((note) => `<li>${escapeText(note)}</li>`).join("")}</ul>`
        : "<p>No additional optimizer notes.</p>";
      const statusText = {
        irrigate: "Irrigation recommended",
        skip_no_need: "Irrigation not currently required",
        skip_rain: "Rainfall covers the modeled requirement",
        deferred_rain: "Irrigation deferred because of forecast rain",
        insufficient_water: "Insufficient water for the required event",
      }[plan.action] || escapeText(plan.action);
      const amount = plan.action === "insufficient_water"
        ? `<p><strong>Required event:</strong> ${liters(plan.required_liters)} Â· <strong>Shortage:</strong> ${liters(plan.water_shortage_liters)}</p>`
        : `<p><strong>Scheduled pump volume:</strong> ${liters(plan.litres)} Â· <strong>Duration:</strong> ${plan.sessions?.reduce((sum, session) => sum + session.minutes, 0) || 0} min</p>`;
      const scheduleAction = result.schedule?.status === "recommended"
        ? `<button class="portal-action" type="button" data-irrigation-confirm="${escapeText(result.schedule.id)}">Confirm schedule and reserve water</button>`
        : "";
      const weather = result.weather;
      const weatherInfo = weather
        ? `<p><strong>Forecast temperatures:</strong> ${escapeText(weather.temperature_min_c)}â€“${escapeText(weather.temperature_max_c)} Â°C Â· <strong>Rain probability:</strong> ${escapeText(Math.round(weather.rain_probability * 100))}%</p>`
        : "";
      const forecastWarning = result.warnings?.length
        ? `<p class="portal-form-help">${result.warnings.map(escapeText).join(" ")}</p>`
        : "";
      planResult.innerHTML = `
        <h3>${escapeText(statusText)}</h3>
        <p><strong>Date:</strong> ${escapeText(plan.date)} Â· <strong>Method:</strong> ${escapeText(inputs.irrigation_method)}</p>
        ${amount}
        <p><strong>Soil moisture provided:</strong> ${escapeText(inputs.soil_moisture_pct)}% Â· <strong>ETc:</strong> ${escapeText(plan.etc_mm)} mm</p>
        <p><strong>Forecast rainfall:</strong> ${escapeText(plan.rain_mm)} mm Â· <strong>Effective rainfall:</strong> ${escapeText(plan.effective_rain_mm)} mm</p>
        ${weatherInfo}
        <p><strong>Water remaining before confirmation:</strong> ${liters(result.reservoir.remaining_liters)}</p>
        ${forecastWarning}${notes}${scheduleAction}
      `;
      planResult.hidden = false;
    }

    scheduleRows.addEventListener("click", async (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("button");
      if (!(button instanceof HTMLButtonElement)) return;
      const scheduleId = button.dataset.irrigationConfirm
        || button.dataset.irrigationCancel
        || button.dataset.irrigationComplete
        || button.dataset.irrigationView;
      if (!scheduleId) return;
      button.disabled = true;
      try {
               if (button.dataset.irrigationView) {
          const details = await apiRequest(
            `/api/irrigation/schedules/${encodeURIComponent(scheduleId)}`
          );

          const card = button.closest("[data-irrigation-schedule-row]");
          const panel = card?.querySelector("[data-irrigation-schedule-details]");

          if (panel) {
            if (!panel.hidden) {
              panel.hidden = true;
              panel.innerHTML = "";
              button.textContent = "View details";
            } else {
              const plan = details.plan && typeof details.plan === "object"
                ? details.plan
                : {};

              const isManual =
                plan.action === "manual_schedule" ||
                plan.source === "farmer_entered";

              const statusMessages = {
                recommended: "This schedule is waiting for your confirmation. Water has not been reserved.",
                confirmed: "This schedule is confirmed and its water has been reserved.",
                completed: "This irrigation event has been marked completed.",
                insufficient_water: "There was not enough unreserved water for this recommendation.",
                cancelled: "This schedule has been cancelled. Any reservation was released.",
              };

              const information = [
                ["Available water when created", plan.available_water_liters],
                ["Requested water", plan.requested_water_liters],
                ["Required water", plan.required_liters],
                ["Water shortage", plan.water_shortage_liters],
              ].filter(([, value]) =>
                value !== undefined && value !== null &&
                Number.isFinite(Number(value))
              );

              const notes = Array.isArray(plan.notes)
                ? plan.notes
                : [];

              panel.innerHTML = `
                <div class="portal-irrigation-detail-heading">
                  <strong>${isManual ? "Manual schedule details" : "Recommendation details"}</strong>
                  <span>${isManual ? "Created by you" : "Generated by the irrigation planner"}</span>
                </div>

                <p class="portal-irrigation-detail-status">
                  ${escapeText(statusMessages[details.status] || "Schedule information")}
                </p>

                ${information.length ? `
                  <div class="portal-irrigation-detail-grid">
                    ${information.map(([label, value]) => `
                      <div>
                        <span>${escapeText(label)}</span>
                        <strong>${liters(value)}</strong>
                      </div>
                    `).join("")}
                  </div>
                ` : ""}

                ${notes.length ? `
                  <div class="portal-irrigation-detail-notes">
                    <strong>Additional information</strong>
                    <ul>${notes.map((note) =>
                      `<li>${escapeText(note)}</li>`
                    ).join("")}</ul>
                  </div>
                ` : ""}

                ${isManual ? `
                  <p class="portal-irrigation-detail-note">
                    Your manual schedule uses the selected field and water source.
                    Confirm it when you are ready; the system checks water availability
                    again before reserving it.
                  </p>
                ` : ""}
              `;

              panel.hidden = false;
              button.textContent = "Hide details";
            }
          }
        } else {
          const action = button.dataset.irrigationConfirm
            ? "confirm"
            : button.dataset.irrigationCancel
              ? "cancel"
              : "complete";
          await apiRequest(
            `/api/irrigation/schedules/${encodeURIComponent(scheduleId)}/${action}`,
            { method: "POST" },
          );
          await refreshBalances();
          if (latestRecommendation?.schedule?.id === Number(scheduleId)) {
            latestRecommendation.schedule.status = action === "confirm"
              ? "confirmed"
              : action === "cancel"
                ? "cancelled"
                : "completed";
            if (action === "confirm") {
              latestRecommendation.reservoir = selectedReservoir;
              const confirmButton = planResult.querySelector("[data-irrigation-confirm]");
              confirmButton?.remove();
            }
          }
          setFeedback(action === "confirm"
            ? "Schedule confirmed and water reserved."
            : action === "cancel"
              ? "Schedule cancelled; any reservation was released."
              : "Schedule marked completed; reserved water was recorded as used.");
        }
      } catch (error) {
        setFeedback(showError(error), true);
      } finally {
        button.disabled = false;
      }
    });
    planResult.addEventListener("click", async (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("[data-irrigation-confirm]");
      if (!(button instanceof HTMLButtonElement) || !latestRecommendation?.schedule) return;
      button.disabled = true;
      try {
        const result = await apiRequest(
          `/api/irrigation/schedules/${encodeURIComponent(button.dataset.irrigationConfirm)}/confirm`,
          { method: "POST" },
        );
        await refreshBalances();
        latestRecommendation.schedule = result.schedule;
        latestRecommendation.reservoir = result.reservoir;
        button.remove();
        setFeedback("Schedule confirmed and water reserved.");
      } catch (error) {
        setFeedback(showError(error), true);
      } finally {
        button.disabled = false;
      }
    });

    try {
      const [loadedFields, loadedCrops] = await Promise.all([
        apiRequest("/api/fields"),
        apiRequest("/api/crops"),
      ]);
      if (!Array.isArray(loadedFields) || !Array.isArray(loadedCrops)) {
        throw new Error("Field or crop records have an invalid format.");
      }
      fields = loadedFields;
      crops = loadedCrops;
      fieldSelect.innerHTML = `<option value="">Select a saved field</option>${fields.map((field) =>
        `<option value="${escapeText(field.id)}">${escapeText(field.name)}</option>`).join("")}`;
      if (fields.length === 0) {
        fieldSelect.disabled = true;
        setFeedback("No saved fields are available. Add a field before planning irrigation.", true);
      } else {
        fieldSelect.value = String(fields[0].id);
        renderField();
        await loadReservoirs(false);
        await loadSchedules();
        setFeedback("");
      }
    } catch (error) {
      setFeedback(showError(error), true);
      fieldSelect.innerHTML = '<option value="">Your saved fields could not be loaded</option>';
      reservoirSelect.innerHTML = '<option value="">Water availability unavailable</option>';
    }
  }

    async function initializeSensorHistory(root) {
      const state = root.querySelector("[data-sensor-state]");
      const provenance = root.querySelector("[data-sensor-provenance]");
      const rows = root.querySelector("[data-sensor-rows]");
      const tableWrap = root.querySelector("[data-sensor-table-wrap]");
      const retry = root.querySelector("[data-sensor-retry]");
      const details = root.querySelector("[data-sensor-details]");
      const filters = root.querySelector("[data-sensor-filters]");
      const fromDate = root.querySelector("[data-sensor-date-from]");
      const toDate = root.querySelector("[data-sensor-date-to]");
      const clearDates = root.querySelector("[data-sensor-clear]");
      const matchCount = root.querySelector("[data-sensor-match-count]");
      const filterState = root.querySelector("[data-sensor-filter-state]");

      if (
        !(state instanceof HTMLElement) ||
        !(provenance instanceof HTMLElement) ||
        !(rows instanceof HTMLElement) ||
        !(tableWrap instanceof HTMLElement) ||
        !(retry instanceof HTMLButtonElement) ||
        !(details instanceof HTMLDetailsElement) ||
        !(filters instanceof HTMLElement) ||
        !(fromDate instanceof HTMLInputElement) ||
        !(toDate instanceof HTMLInputElement) ||
        !(clearDates instanceof HTMLButtonElement) ||
        !(matchCount instanceof HTMLElement) ||
        !(filterState instanceof HTMLElement)
      ) return;

      let historicalReadings = [];

      const renderRows = () => {
        const startDate = fromDate.value;
        const endDate = toDate.value;

        const filteredReadings = historicalReadings.filter((reading) => {
          const timestamp = String(reading.timestamp ?? "");
          const recordDate = timestamp.slice(0, 10);

          if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) return false;
          if (startDate && recordDate < startDate) return false;
          if (endDate && recordDate > endDate) return false;

          return true;
        });

        matchCount.textContent =
          `${filteredReadings.length} of ${historicalReadings.length} records`;

        rows.innerHTML = filteredReadings.map((reading) => `<tr>
          <td data-user-content>${escapeText(reading.timestamp)}</td>
          <td data-user-content>${escapeText(reading.field_id)}</td>
          <td data-user-content>${escapeText(reading.soil_moisture ?? "Not recorded")}</td>
          <td data-user-content>${escapeText(reading.temperature_c ?? reading.temperature ?? "Not recorded")}</td>
          <td data-user-content>${escapeText(reading.humidity_percent ?? reading.humidity ?? "Not recorded")}</td>
        </tr>`).join("");

        const hasMatches = filteredReadings.length > 0;
        tableWrap.hidden = !hasMatches;
        filterState.hidden = hasMatches;
      };

      const load = async () => {
        retry.hidden = true;
        state.textContent = "Loading historical records…";
        state.hidden = false;
        tableWrap.hidden = true;
        filters.hidden = true;
        details.open = false;

        try {
          const response = await fetch("/sensor-readings?limit=100");
          if (!response.ok) {
            throw new Error("Historical sensor records could not be loaded.");
          }

          const payload = await response.json();

          if (!Array.isArray(payload.data)) {
            throw new Error("Historical sensor response has an invalid shape.");
          }

          historicalReadings = payload.data;

          const origin = payload.data_origin === "mixed_or_unavailable"
            ? "mixed or unavailable origin"
            : payload.data_origin;

          provenance.textContent =
            `${payload.count} historical records · ${origin}`;

          state.textContent = historicalReadings.length
            ? "Historical data; not live telemetry."
            : "No historical records are available.";

          state.hidden = false;
          filters.hidden = historicalReadings.length === 0;
          details.hidden = historicalReadings.length === 0;

          fromDate.value = "";
          toDate.value = "";

          renderRows();
        } catch (error) {
          state.textContent = error instanceof Error
            ? error.message
            : "Historical sensor records could not be loaded.";

          retry.hidden = false;
        }
      };

      fromDate.addEventListener("change", () => {
        if (toDate.value && fromDate.value > toDate.value) {
          toDate.value = "";
        }
        renderRows();
      });

      toDate.addEventListener("change", () => {
        if (fromDate.value && toDate.value < fromDate.value) {
          fromDate.value = "";
        }
        renderRows();
      });

      clearDates.addEventListener("click", () => {
        fromDate.value = "";
        toDate.value = "";
        renderRows();
      });

      retry.addEventListener("click", load);

      await load();
    }
    async function initializeAlertsView(root) {
  const list = root.querySelector("[data-alert-list]");
  const status = root.querySelector("[data-alert-status]");
  if (!list || !status) return;

  const apiRequest = window.JalSaathiProfile?.apiRequest;
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);

  const storageKey = "jalsaathi.alerts-state.v1";
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch (_) {}

  let alerts = [];
  let activeFilter = "all";

  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch (_) {}
  };

  const add = (item) => alerts.push({
    ...item,
    id: String(item.id),
    read: Boolean(saved[item.id]?.read),
    dismissed: Boolean(saved[item.id]?.dismissed),
  });

  const render = () => {
    const visible = alerts.filter(a =>
  !a.dismissed && (
    activeFilter === "all" ||
    (activeFilter === "emergency"
      ? a.severity === "critical"
      : a.category === activeFilter)
  )
);
    const active = alerts.filter(a => !a.dismissed);
    root.querySelector("[data-alert-total]").textContent = active.length;
    root.querySelector("[data-alert-urgent]").textContent =
      active.filter(a => a.severity === "critical").length;
    root.querySelector("[data-alert-advisory]").textContent =
      active.filter(a => a.severity !== "critical").length;

    root.querySelectorAll("[data-alert-filter]").forEach(button =>
      button.classList.toggle("is-active", button.dataset.alertFilter === activeFilter)
    );

    list.innerHTML = visible.length ? visible.map(a => `
      <article class="portal-alert-card portal-alert-card--${a.severity}">
        <div class="portal-alert-icon ${a.severity === "critical" ? "portal-alert-icon--red" : ""}">
          ${a.icon}
        </div>
        <div class="portal-alert-content">
          <div class="portal-alert-heading">
            <h3>${escape(a.title)}</h3>
            <span class="portal-alert-severity">${a.severity === "critical" ? "URGENT" : "ADVISORY"}</span>
          </div>
          <p>${escape(a.message)}</p>
          <small>${escape(a.field || "Farm-wide")} · ${escape(a.time || "Recently detected")}</small>
          <div class="portal-alert-actions">
            <button type="button" data-alert-action="read" data-alert-id="${escape(a.id)}">
              ${a.read ? "Mark unread" : "Mark read"}
            </button>
            <button type="button" data-alert-action="dismiss" data-alert-id="${escape(a.id)}">Dismiss</button>
          </div>
        </div>
      </article>
    `).join("") : (() => {
      const emptyStates = {
        all: {
          icon: "✓",
          title: "All clear!",
          message: "No active alerts right now. Your fields are looking good based on the available data."
        },
        emergency: {
          icon: "🌿",
          title: "No critical alerts",
          message: "No urgent field conditions need your attention right now."
        },
        soil: {
          icon: "💧",
          title: "Soil & water look good",
          message: "No soil moisture or water-related concerns detected in the latest readings."
        },
        sensor: {
          icon: "📡",
          title: "Sensors are looking good",
          message: "No new sensor connectivity alerts detected."
        },
        irrigation: {
          icon: "🚜",
          title: "No irrigation alerts",
          message: "There are no active irrigation reminders or concerns right now."
        },
        weather: {
          icon: "☀️",
          title: "Weather looks calm",
          message: "No weather advisories are currently triggered by the available forecast."
        }
      };

      const empty = emptyStates[activeFilter] || emptyStates.all;

      return `
        <div class="portal-alert-empty">
          <div class="portal-alert-empty-icon">${empty.icon}</div>
          <h3>${empty.title}</h3>
          <p>${empty.message}</p>
          <span>✓ Based on currently available data</span>
        </div>
      `;
    })();
  };

  const refresh = async () => {
    status.textContent = "Checking your fields and irrigation...";
    list.innerHTML = "";
    alerts = [];

    if (typeof apiRequest !== "function") {
      status.textContent = "Your account data service is unavailable. Please refresh the page.";
      return;
    }

    try {
      const fields = await window.JalSaathiFieldStore.loadServerFields();
      const results = await Promise.allSettled([
        apiRequest("/api/irrigation/schedules"),
        ...fields.map(field => apiRequest(
          `/api/fields/${encodeURIComponent(field.id)}/sensor-readings?limit=5000`
        )),
        ...fields.map(field => apiRequest(
          `/api/fields/${encodeURIComponent(field.id)}/sensor-devices`
        )),
      ]);

      const schedulesResult = results[0];
      const readingResults = results.slice(1, 1 + fields.length);
      const deviceResults = results.slice(1 + fields.length);

      // Soil alerts: use only recent, actual sensor readings.
      fields.forEach((field, index) => {
        const result = readingResults[index];
        if (result.status !== "fulfilled" || !Array.isArray(result.value)) return;

        const latest = result.value
          .filter(r => r.recorded_at && Number.isFinite(Number(r.soil_moisture_percent)))
          .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))[0];

        if (!latest) return;

        const ageHours = (Date.now() - new Date(latest.recorded_at).getTime()) / 3600000;
        if (!Number.isFinite(ageHours) || ageHours < -1 || ageHours > 24) return;

        const moisture = Number(latest.soil_moisture_percent);
        if (moisture < 20) {
          add({
            id: `soil-low-${field.id}-${latest.id}`,
            category: "soil", severity: "critical", icon: "💧",
            title: "Very low soil moisture",
            message: `Soil moisture is ${moisture.toFixed(1)}%. Check the field and consider irrigation.`,
            field: field.name, time: new Date(latest.recorded_at).toLocaleString(),
          });
        } else if (moisture < 30) {
          add({
            id: `soil-warn-${field.id}-${latest.id}`,
            category: "soil", severity: "warning", icon: "🌱",
            title: "Soil moisture is low",
            message: `Soil moisture is ${moisture.toFixed(1)}%. Monitor the crop and review its watering needs.`,
            field: field.name, time: new Date(latest.recorded_at).toLocaleString(),
          });
        } else if (moisture > 85) {
          add({
            id: `soil-high-${field.id}-${latest.id}`,
            category: "soil", severity: "warning", icon: "🌧️",
            title: "High soil moisture",
            message: `Soil moisture is ${moisture.toFixed(1)}%. Check drainage and avoid unnecessary watering.`,
            field: field.name, time: new Date(latest.recorded_at).toLocaleString(),
          });
        }
      });

      // Sensor connectivity: use registered device status and last-seen time.
      fields.forEach((field, index) => {
        const result = deviceResults[index];
        if (result.status !== "fulfilled" || !Array.isArray(result.value)) return;

        result.value.forEach(device => {
          const lastSeen = device.last_seen_at ? new Date(device.last_seen_at) : null;
          const stale = !lastSeen || (Date.now() - lastSeen.getTime()) > 24 * 3600000;

          if (!device.is_active || stale) {
            add({
              id: `device-${device.id}-${device.last_seen_at || "never"}`,
              category: "sensor", severity: "warning", icon: "📡",
              title: device.is_active ? "Sensor has not reported recently" : "Sensor is inactive",
              message: device.is_active
                ? "No sensor update has been received in the last 24 hours. Check its power and connection."
                : "This registered sensor is marked inactive. Check its status.",
              field: field.name,
              time: lastSeen ? lastSeen.toLocaleString() : "No recorded connection",
            });
          }
        });
      });

      // Irrigation reminders: only confirmed schedules.
      if (schedulesResult.status === "fulfilled") {
        const schedules = schedulesResult.value?.schedules || [];
        schedules.forEach(schedule => {
          if (schedule.status !== "confirmed") return;
          const scheduledAt = new Date(
            `${schedule.scheduled_date}T${schedule.start_time}`
          );
          const hours = (scheduledAt.getTime() - Date.now()) / 3600000;

          if (Number.isFinite(hours) && hours >= 0 && hours <= 24) {
            add({
              id: `schedule-${schedule.id}`,
              category: "irrigation", severity: "info", icon: "🚜",
              title: "Upcoming irrigation",
              message: `${schedule.water_liters} litres planned for ${schedule.duration_minutes} minutes, starting at ${schedule.start_time}.`,
              field: schedule.field_name || `Field ${schedule.field_id}`,
              time: scheduledAt.toLocaleString(),
            });
          }
        });
      }

      // Weather advisories from the existing configured weather service.
      // Current weather and upcoming forecast advisories.
try {
  const weather = await window.JalSaathiWeather?.load({}, { refresh: true });
  const current = weather?.current || {};
  const hourly = Array.isArray(weather?.hourly) ? weather.hourly : [];
  const daily = Array.isArray(weather?.daily) ? weather.daily : [];

  const temp = Number(current.temperature_c);
  const rain = Number(current.rainfall_mm_per_hr);

  // Current conditions.
  if (Number.isFinite(temp) && temp >= 38) {
    add({
      id: `weather-heat-${Math.floor(temp)}`,
      category: "weather",
      severity: "warning",
      icon: "☀️",
      title: "High temperature advisory",
      message: `The latest reported temperature is ${temp.toFixed(1)}°C. Monitor crops and soil moisture.`,
      field: "Weather",
      time: "Current weather",
    });
  }

  if (Number.isFinite(rain) && rain >= 10) {
    add({
      id: `weather-rain-${Math.floor(rain)}`,
      category: "weather",
      severity: "warning",
      icon: "🌧️",
      title: "Heavy rainfall advisory",
      message: `Reported rainfall intensity is ${rain.toFixed(1)} mm/hour. Check field drainage.`,
      field: "Weather",
      time: "Current weather",
    });
  }

  // Rain and heat expected in the next 24 hours.
  hourly.forEach(item => {
    const forecastTime = new Date(item.time);
    const hoursAhead = (forecastTime.getTime() - Date.now()) / 3600000;

    if (!Number.isFinite(hoursAhead) || hoursAhead < 0 || hoursAhead > 24) return;

    const probability = Number(item.rain_probability_percent);
    const rainfall = Number(item.rainfall_mm_per_hr);
    const forecastTemp = Number(item.temperature_c);

    if (
      (Number.isFinite(probability) && probability >= 70) ||
      (Number.isFinite(rainfall) && rainfall >= 5)
    ) {
      add({
        id: `forecast-rain-${item.time}`,
        category: "weather",
        severity: "warning",
        icon: "🌧️",
        title: "Rain expected soon",
        message: `Rain forecast: ${Number.isFinite(probability) ? `${probability}% probability` : "high rainfall"}${Number.isFinite(rainfall) ? `, ${rainfall.toFixed(1)} mm/hour expected` : ""}. Review irrigation plans and field drainage.`,
        field: "Weather forecast",
        time: forecastTime.toLocaleString(),
      });
    }

    if (Number.isFinite(forecastTemp) && forecastTemp >= 38) {
      add({
        id: `forecast-heat-${item.time}`,
        category: "weather",
        severity: "warning",
        icon: "☀️",
        title: "High temperature forecast",
        message: `Temperature may reach ${forecastTemp.toFixed(1)}°C. Monitor crop stress and soil moisture.`,
        field: "Weather forecast",
        time: forecastTime.toLocaleString(),
      });
    }
  });

  // Daily forecast advisories.
  daily.forEach(item => {
    const probability = Number(item.rain_probability_percent);
    const high = Number(item.temperature_high_c);
    const day = item.time || "Upcoming day";
    const weatherCode = Number(item.weather_code);

    if (
      (Number.isFinite(probability) && probability >= 70) ||
      [4201, 6201, 8000].includes(weatherCode)
    ) {
      add({
        id: `daily-rain-${day}`,
        category: "weather",
        severity: "warning",
        icon: "🌧️",
        title: "Rain forecast advisory",
        message: `Rain is forecast for ${day}${Number.isFinite(probability) ? ` with ${probability}% probability` : ""}. Check drainage and consider adjusting irrigation.`,
        field: "Weather forecast",
        time: day,
      });
    }

    if (Number.isFinite(high) && high >= 38) {
      add({
        id: `daily-heat-${day}`,
        category: "weather",
        severity: "warning",
        icon: "🌡️",
        title: "High temperature forecast",
        message: `Forecast high is ${high.toFixed(1)}°C for ${day}. Monitor crops and soil moisture.`,
        field: "Weather forecast",
        time: day,
      });
    }
  });
} catch (error) {
  console.warn("Weather advisories unavailable:", error);
}
      status.textContent = `Checked ${fields.length} field(s). These are data-based alerts and advisories, not SMS or push notifications.`;
      render();
    } catch (error) {
      console.error("Alerts could not be loaded:", error);
            status.textContent = "Could not load field alerts. Please try refreshing.";
    }
  };

  root.querySelectorAll("[data-alert-filter]").forEach(button => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.alertFilter;
      render();
    });
  });

  list.addEventListener("click", event => {
    const button = event.target.closest("[data-alert-action]");
    if (!button) return;
    const item = alerts.find(a => a.id === button.dataset.alertId);
    if (!item) return;

    saved[item.id] = saved[item.id] || {};
    if (button.dataset.alertAction === "read") {
      saved[item.id].read = !item.read;
    } else {
      saved[item.id].dismissed = true;
    }
    save();
    item.read = Boolean(saved[item.id].read);
    item.dismissed = Boolean(saved[item.id].dismissed);
    render();
  });

  root.querySelector("[data-alert-refresh]")?.addEventListener("click", refresh);
  // Load alerts immediately when the page opens.
await refresh();

// Automatically refresh alerts every 5 minutes.
const autoRefreshTimer = window.setInterval(() => {
  // Stop the timer when the user leaves the Alerts page.
  if (!root.isConnected) {
    window.clearInterval(autoRefreshTimer);
    return;
  }

  void refresh();
}, 5 * 60 * 1000);
}
  function initializeWeatherView(root) {
    window.JalSaathiWeather?.initializeWeatherPage(root);
  }

  function formatDate(value) {
    if (!value) return "Not recorded";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : window.JalSaathiI18n.formatDate(date);
  }

  function escapeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

    async function initializeCropsView(root) {
    const cropList = root.querySelector("[data-crop-list]");
    const form = root.querySelector("[data-crop-form]");
    const fieldOptions = root.querySelector("[data-crop-field-options]");
    const errorNode = root.querySelector("[data-crop-error]");
    const summaryTotal = root.querySelector("[data-crop-total]");
    const summaryActive = root.querySelector("[data-crop-active]");
    const summaryNearing = root.querySelector("[data-crop-nearing]");
    const searchInput = root.querySelector("[data-crop-search]");
    const stageFilter = root.querySelector("[data-crop-stage-filter]");

    if (!cropList || !form || !fieldOptions || !errorNode) return;

    const imageForCrop = (crop) => {
      const name = String(crop.name || "").toLowerCase();
      if (name.includes("sugar")) return "/static/images/field-sugarcane.jpg";
      if (name.includes("ragi")) return "/static/images/field-ragi.jpg";
      return "/static/images/field-rice.jpg";
    };

    let crops = [];
    let fields = [];

    const render = () => {
      cropList.innerHTML = "";
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const statusFor = (crop) => {
        if (/harvested|harvest complete/i.test(crop.growth_stage || "")) return "Harvested";
        if (!crop.expected_harvest_date) return "Harvest date not set";

        const [year, month, day] = crop.expected_harvest_date.split("-").map(Number);
        const date = new Date(year, month - 1, day);
        if (Number.isNaN(date.getTime())) return "Harvest date unavailable";

        const days = Math.ceil((date - today) / 86400000);
        if (days < 0) return "Harvest date passed";
        if (days <= 30) return "Harvest approaching";
        return "Growing";
      };

      const progressFor = (stage) => {
        const value = String(stage || "").toLowerCase();
        if (/harvested|harvest complete/.test(value)) return 100;
        if (/matur|ripen/.test(value)) return 95;
        if (/fruit|grain fill|grain develop/.test(value)) return 80;
        if (/flower|booting|heading/.test(value)) return 65;
        if (/vegetative|tillering/.test(value)) return 40;
        if (/seedling|germination|transplant/.test(value)) return 15;
        return null;
      };

      const harvested = crops.filter((crop) =>
        /harvested|harvest complete/i.test(crop.growth_stage || "")
      ).length;

      const nearing = crops.filter((crop) => statusFor(crop) === "Harvest approaching").length;

      if (summaryTotal) summaryTotal.textContent = String(crops.length);
      if (summaryActive) summaryActive.textContent = String(crops.length - harvested);
      if (summaryNearing) summaryNearing.textContent = String(nearing);

      const previousStage = stageFilter?.value || "";
      const stages = [...new Set(crops.map((crop) =>
        String(crop.growth_stage || "").trim()
      ).filter(Boolean))].sort();

      if (stageFilter) {
        stageFilter.innerHTML = `<option value="">All growth stages</option>` +
          stages.map((stage) =>
            `<option value="${escapeText(stage)}">${escapeText(stage)}</option>`
          ).join("");
        if (stages.includes(previousStage)) stageFilter.value = previousStage;
      }

      const search = searchInput?.value.trim().toLowerCase() || "";
      const selectedStage = stageFilter?.value || "";

      const visible = crops.filter((crop) => {
        const matchesSearch =
          `${crop.name || ""} ${crop.variety || ""}`.toLowerCase().includes(search);
        const matchesStage =
          !selectedStage || String(crop.growth_stage || "").trim() === selectedStage;
        return matchesSearch && matchesStage;
      });

      cropList.innerHTML = visible.length
        ? visible.map((crop) => {
          const progress = progressFor(crop.growth_stage);
          const fieldName = fields.find(
            (field) => String(field.id) === String(crop.field_id)
          )?.name || "Not assigned";

          return `<article class="portal-card portal-field-card">
            <img class="portal-field-photo" src="${imageForCrop(crop)}"
              alt="${escapeText(crop.name)} field" />
            <div class="portal-field-content">
              <h2>${escapeText(crop.name)}</h2>
              <p>${escapeText(crop.variety || "Variety not provided")}</p>
              <div class="portal-crop-association">
                <span>Field: ${escapeText(fieldName)}</span>
                <span>Planting: ${escapeText(formatDate(crop.planting_date))}</span>
                <span>Expected harvest: ${escapeText(formatDate(crop.expected_harvest_date))}</span>
                <span>Growth stage: ${escapeText(crop.growth_stage || "Not provided")}</span>
              </div>
              <div class="portal-crop-progress">
                <p>Growth progress: ${progress === null ? "Unavailable" : `${progress}%`}</p>
                ${progress === null ? "" : `
                  <div class="portal-crop-progress-track">
                    <span class="portal-crop-progress-fill" style="width:${progress}%"></span>
                  </div>`}
              </div>
              <p class="portal-crop-harvest-status">${escapeText(statusFor(crop))}</p>
              <button class="portal-secondary-action" type="button"
                data-edit-crop="${escapeText(crop.id)}">Edit crop</button>
              <button class="portal-danger-action" type="button"
                data-delete-crop="${escapeText(crop.id)}">Delete crop</button>
            </div>
          </article>`;
        }).join("")
        : `<section class="portal-card portal-card--padded portal-empty-note">
            ${crops.length ? "No crops match your search or filter." : "No crops are saved yet. Use the form above to add a crop."}
          </section>`;
    };

    try {
      fields = await window.JalSaathiFieldStore.loadServerFields();
      fieldOptions.innerHTML = `<option value="">No field selected</option>` +
        fields.map((field) =>
          `<option value="${escapeText(field.id)}">${escapeText(field.name)}</option>`
        ).join("");

      crops = await window.JalSaathiProfile.apiRequest("/api/crops");
      render();
    } catch (error) {
      cropList.textContent = error instanceof Error ? error.message : "Crops could not be loaded.";
      return;
    }

    searchInput?.addEventListener("input", render);
    stageFilter?.addEventListener("change", render);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorNode.hidden = true;
      if (!form.reportValidity()) return;

      const payload = Object.fromEntries(new FormData(form).entries());
      const cropId = form.dataset.editingId;
      payload.field_id = payload.field_id ? Number(payload.field_id) : null;

      for (const key of ["variety", "growth_stage", "planting_date", "expected_harvest_date"]) {
        if (!payload[key]) payload[key] = null;
      }

      try {
        const saved = await window.JalSaathiProfile.apiRequest(
          cropId ? `/api/crops/${encodeURIComponent(cropId)}` : "/api/crops",
          {
            method: cropId ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );

        crops = cropId
          ? crops.map((crop) => String(crop.id) === cropId ? saved : crop)
          : [...crops, saved];

        form.reset();
        delete form.dataset.editingId;
        root.querySelector("[data-crop-submit]").textContent = "Save Crop";
        root.querySelector("[data-crop-cancel]").hidden = true;
        render();
      } catch (error) {
        errorNode.textContent = error instanceof Error ? error.message : "The crop could not be saved.";
        errorNode.hidden = false;
      }
    });

    cropList.addEventListener("click", async (event) => {
      if (!(event.target instanceof Element)) return;

      const editButton = event.target.closest("[data-edit-crop]");
      if (editButton instanceof HTMLButtonElement) {
        const crop = crops.find((item) => String(item.id) === editButton.dataset.editCrop);
        if (!crop) return;

        form.dataset.editingId = String(crop.id);
        for (const key of ["name", "variety", "field_id", "growth_stage", "planting_date", "expected_harvest_date"]) {
          const control = form.elements.namedItem(key);
          if (control) control.value = crop[key] ?? "";
        }

        root.querySelector("[data-crop-submit]").textContent = "Update Crop";
        root.querySelector("[data-crop-cancel]").hidden = false;
        form.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      const deleteButton = event.target.closest("[data-delete-crop]");
      if (!(deleteButton instanceof HTMLButtonElement)) return;

      deleteButton.disabled = true;
      try {
        await window.JalSaathiProfile.apiRequest(
          `/api/crops/${encodeURIComponent(deleteButton.dataset.deleteCrop)}`,
          { method: "DELETE" },
        );
        crops = crops.filter((crop) => String(crop.id) !== deleteButton.dataset.deleteCrop);
        render();
      } catch (error) {
        deleteButton.disabled = false;
        errorNode.textContent = error instanceof Error ? error.message : "The crop could not be deleted.";
        errorNode.hidden = false;
      }
    });

    root.querySelector("[data-crop-cancel]")?.addEventListener("click", () => {
      form.reset();
      delete form.dataset.editingId;
      root.querySelector("[data-crop-submit]").textContent = "Save Crop";
      root.querySelector("[data-crop-cancel]").hidden = true;
      errorNode.hidden = true;
    });
  }
    async function initializeReportsView(root) {
    const fieldSelect = root.querySelector("[data-report-field]");
    const cropSelect = root.querySelector("[data-report-crop]");
    const rows = root.querySelector("[data-report-rows]");
    const empty = root.querySelector("[data-report-empty]");
    const feedback = root.querySelector("[data-report-feedback]");

    const sensorRows = root.querySelector("[data-report-sensor-rows]");
    const sensorWrap = root.querySelector("[data-report-sensor-wrap]");
    const sensorEmpty = root.querySelector("[data-report-sensor-empty]");

    const sensorFieldFilter = root.querySelector("[data-report-sensor-field]");
    const sensorRangeFilter = root.querySelector("[data-report-sensor-range]");
    const sensorPageSize = root.querySelector("[data-report-sensor-page-size]");
    const sensorPageInfo = root.querySelector("[data-report-sensor-page-info]");
    const sensorPrev = root.querySelector("[data-report-sensor-prev]");
    const sensorNext = root.querySelector("[data-report-sensor-next]");

    const irrigationFieldFilter = root.querySelector("[data-report-irrigation-field]");
    const irrigationStatusFilter = root.querySelector("[data-report-irrigation-status]");
    const irrigationRangeFilter = root.querySelector("[data-report-irrigation-range]");
    const irrigationPageSize = root.querySelector("[data-report-irrigation-page-size]");
    const irrigationPageInfo = root.querySelector("[data-report-irrigation-page-info]");
    const irrigationPrev = root.querySelector("[data-report-irrigation-prev]");
    const irrigationNext = root.querySelector("[data-report-irrigation-next]");

    let sensorCurrentPage = 1;
    let irrigationCurrentPage = 1;


    const irrigationRows = root.querySelector("[data-report-irrigation-rows]");
    const irrigationWrap = root.querySelector("[data-report-irrigation-wrap]");
    const irrigationEmpty = root.querySelector("[data-report-irrigation-empty]");

    const csvButton = root.querySelector("[data-report-download-csv]");
    const pdfButton = root.querySelector("[data-report-download-pdf]");
    const totalFieldsNode = root.querySelector("[data-report-total-fields]");
    const totalReadingsNode = root.querySelector("[data-report-total-readings]");
    const totalSchedulesNode = root.querySelector("[data-report-total-schedules]");
    const totalCompletedNode = root.querySelector("[data-report-total-completed]");

    if (
      !(fieldSelect instanceof HTMLSelectElement) ||
      !(cropSelect instanceof HTMLSelectElement) ||
      !(rows instanceof HTMLElement) ||
      !(empty instanceof HTMLElement) ||
      !(feedback instanceof HTMLElement) ||
      !(sensorRows instanceof HTMLElement) ||
      !(sensorWrap instanceof HTMLElement) ||
      !(sensorEmpty instanceof HTMLElement) ||
      !(irrigationRows instanceof HTMLElement) ||
      !(irrigationWrap instanceof HTMLElement) ||
      !(irrigationEmpty instanceof HTMLElement) ||
      !(csvButton instanceof HTMLButtonElement) ||
      !(pdfButton instanceof HTMLButtonElement)
    ) {
      console.error("Reports view is missing required elements.");
      return;
    }

    const apiRequest = window.JalSaathiProfile.apiRequest;

    let fields = [];
    let sensorReadings = [];
    let schedules = [];
    let sensorLoadError = "";
    let scheduleLoadError = "";

    const formatNumber = (value, digits = 1) => {
      if (value === null || value === undefined || value === "") {
        return "Not recorded";
      }

      const number = Number(value);
      return Number.isFinite(number)
        ? new Intl.NumberFormat(undefined, {
            maximumFractionDigits: digits,
          }).format(number)
        : "Not recorded";
    };

    const formatDate = (value) => {
      if (!value) return "Not recorded";

      const date = new Date(`${value}T00:00:00`);
      return Number.isNaN(date.getTime())
        ? escapeText(value)
        : escapeText(date.toLocaleDateString());
    };

    const formatDateTime = (value) => {
      if (!value) return "Not recorded";

      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? escapeText(value)
        : escapeText(date.toLocaleString());
    };

    const safeValue = (value) => {
      return value === null || value === undefined || value === ""
        ? "Not recorded"
        : escapeText(value);
    };

    const getFilteredFields = () => {
      return fields.filter((field) =>
        (fieldSelect.value === "all" ||
          String(field.id) === fieldSelect.value) &&
        (cropSelect.value === "all" ||
          String(field.crop || "").toLowerCase() ===
            cropSelect.value.toLowerCase())
      );
    };

    const getFilteredReadings = (filteredFields) => {
      const ids = new Set(filteredFields.map((field) => String(field.id)));

      return sensorReadings
        .filter((reading) => ids.has(String(reading.field_id)))
        .sort((a, b) =>
          new Date(b.recorded_at).getTime() -
          new Date(a.recorded_at).getTime()
        );
    };

    const getFilteredSchedules = (filteredFields) => {
      const ids = new Set(filteredFields.map((field) => String(field.id)));

      return schedules
        .filter((schedule) => ids.has(String(schedule.field_id)))
        .sort((a, b) => {
          const dateA = `${a.scheduled_date || ""} ${a.start_time || ""}`;
          const dateB = `${b.scheduled_date || ""} ${b.start_time || ""}`;
          return dateB.localeCompare(dateA);
        });
     };

const getHistoryFilteredReadings = (filteredFields) => {
  const selectedField = sensorFieldFilter.value;
  const rangeDays = sensorRangeFilter.value;
  const cutoff = rangeDays === "all"
    ? null
    : Date.now() - Number(rangeDays) * 24 * 60 * 60 * 1000;

  return getFilteredReadings(filteredFields).filter((reading) => {
    if (
      selectedField !== "all" &&
      String(reading.field_id) !== selectedField
    ) return false;

    if (cutoff !== null) {
      const timestamp = new Date(reading.recorded_at).getTime();
      if (!Number.isFinite(timestamp) || timestamp < cutoff) return false;
    }

    return true;
  });
};

const getHistoryFilteredSchedules = (filteredFields) => {
  const selectedField = irrigationFieldFilter.value;
  const selectedStatus = irrigationStatusFilter.value.toLowerCase();
  const rangeDays = irrigationRangeFilter.value;
  const cutoff = rangeDays === "all"
    ? null
    : Date.now() - Number(rangeDays) * 24 * 60 * 60 * 1000;

  return getFilteredSchedules(filteredFields).filter((schedule) => {
    if (
      selectedField !== "all" &&
      String(schedule.field_id) !== selectedField
    ) return false;

    if (
      selectedStatus !== "all" &&
      String(schedule.status || "").toLowerCase() !== selectedStatus
    ) return false;

    if (cutoff !== null) {
      const timestamp = new Date(
        `${schedule.scheduled_date || ""}T12:00:00`
      ).getTime();

      if (!Number.isFinite(timestamp) || timestamp < cutoff) return false;
    }

    return true;
  });
};

const getPageRecords = (records, page, pageSize) => {
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    records: records.slice(start, start + pageSize),
    page: safePage,
    totalPages,
  };
};


    const getLastCompleted = (fieldId) => {
      return schedules
        .filter((schedule) =>
          String(schedule.field_id) === String(fieldId) &&
          schedule.status === "completed"
        )
        .sort((a, b) => {
          const dateA = `${a.scheduled_date || ""} ${a.start_time || ""}`;
          const dateB = `${b.scheduled_date || ""} ${b.start_time || ""}`;
          return dateB.localeCompare(dateA);
        })[0] || null;
    };

   const render = () => {
  const filteredFields = getFilteredFields();
  const filteredReadings = getFilteredReadings(filteredFields);
  const filteredSchedules = getFilteredSchedules(filteredFields);
  const historyReadings = getHistoryFilteredReadings(filteredFields);
  const historySchedules = getHistoryFilteredSchedules(filteredFields);

const sensorPage = getPageRecords(
  historyReadings,
  sensorCurrentPage,
  Number(sensorPageSize.value)
);
sensorCurrentPage = sensorPage.page;

const irrigationPage = getPageRecords(
  historySchedules,
  irrigationCurrentPage,
  Number(irrigationPageSize.value)
);
irrigationCurrentPage = irrigationPage.page;

      rows.innerHTML = filteredFields.map((field) => {
        const latestReading = filteredReadings.find(
          (reading) => String(reading.field_id) === String(field.id)
        );

        const lastCompleted = getLastCompleted(field.id);

        const completedLabel = lastCompleted
          ? `${formatDate(lastCompleted.scheduled_date)} Â· ${safeValue(lastCompleted.status)}`
          : "Not recorded";

        return `<tr>
          <td>
            <strong data-user-content>${escapeText(field.name)}</strong><br>
            <span class="portal-muted" data-user-content>${escapeText(field.location || "Location not recorded")}</span>
          </td>
          <td>${safeValue(field.crop)}</td>
          <td>${formatNumber(field.area, 2)} ${escapeText(field.areaUnit || "acres")}</td>
          <td>Not recorded</td>
          <td>${latestReading
            ? `${formatNumber(latestReading.soil_moisture_percent)}%`
            : "Not recorded"}</td>
          <td>${completedLabel}</td>
          <td>Not available</td>
        </tr>`;
      }).join("");

      empty.hidden = filteredFields.length !== 0;

        sensorRows.innerHTML = sensorPage.records.map((reading) => {
        const field = fields.find(
          (entry) => String(entry.id) === String(reading.field_id)
        );

        return `<tr>
          <td>${escapeText(field?.name || `Field ${reading.field_id}`)}</td>
          <td>${formatDateTime(reading.recorded_at)}</td>
          <td>${formatNumber(reading.soil_moisture_percent)}%</td>
          <td>${formatNumber(reading.soil_temperature_c)} Â°C</td>
          <td>${formatNumber(reading.humidity_percent)}%</td>
          <td>${formatNumber(reading.ph, 2)}</td>
          <td>${formatNumber(reading.electrical_conductivity_us_cm)}</td>
        </tr>`;
      }).join("");

      sensorWrap.hidden = historyReadings.length === 0;
      sensorEmpty.hidden = historyReadings.length !== 0;

      sensorPageInfo.textContent =
        `Page ${sensorPage.page} of ${sensorPage.totalPages} (${historyReadings.length} records)`;
      sensorPrev.disabled = sensorPage.page <= 1;
      sensorNext.disabled = sensorPage.page >= sensorPage.totalPages;
      sensorEmpty.textContent = sensorLoadError ||
        "No recorded sensor readings are available for these fields.";

      irrigationRows.innerHTML = irrigationPage.records.map((schedule) => {
        return `<tr>
          <td>${escapeText(schedule.field_name || "Field")}</td>
          <td>${formatDate(schedule.scheduled_date)}</td>
          <td>${safeValue(schedule.start_time)}</td>
          <td>${formatNumber(schedule.water_liters)}</td>
          <td>${formatNumber(schedule.duration_minutes, 0)} min</td>
          <td>${safeValue(schedule.irrigation_method)}</td>
          <td>${safeValue(schedule.status)}</td>
        </tr>`;
      }).join("");

      irrigationWrap.hidden = historySchedules.length === 0;
      irrigationEmpty.hidden = historySchedules.length !== 0;

      irrigationPageInfo.textContent =
        `Page ${irrigationPage.page} of ${irrigationPage.totalPages} (${historySchedules.length} records)`;
      irrigationPrev.disabled = irrigationPage.page <= 1;
      irrigationNext.disabled = irrigationPage.page >= irrigationPage.totalPages;
      irrigationEmpty.textContent = scheduleLoadError ||
        "No irrigation schedule records are available for these fields.";
      if (totalFieldsNode) {
  totalFieldsNode.textContent = filteredFields.length;
}

if (totalReadingsNode) {
  totalReadingsNode.textContent = filteredReadings.length;
}

if (totalSchedulesNode) {
  totalSchedulesNode.textContent = filteredSchedules.length;
}

if (totalCompletedNode) {
  totalCompletedNode.textContent = filteredSchedules.filter(
    (schedule) => schedule.status === "completed"
  ).length;
}
      if (sensorLoadError || scheduleLoadError) {
        feedback.textContent = [
          sensorLoadError,
          scheduleLoadError,
        ].filter(Boolean).join(" ");
      } else {
        feedback.textContent =
          `${filteredFields.length} field(s), ` +
          `${filteredReadings.length} sensor reading(s), and ` +
          `${filteredSchedules.length} irrigation record(s) loaded.`;
      }
    };

    const csvEscape = (value) => {
      const text = String(value ?? "");
      return `"${text.replace(/"/g, '""')}"`;
    };

    const downloadCSV = () => {
      const filteredFields = getFilteredFields();
const filteredReadings = getFilteredReadings(filteredFields);
const historyReadings = getHistoryFilteredReadings(filteredFields);
const historySchedules = getHistoryFilteredSchedules(filteredFields);

      const output = [[
        "Record type",
        "Field",
        "Location",
        "Crop",
        "Date / time",
        "Soil moisture (%)",
        "Temperature (C)",
        "Humidity (%)",
        "pH",
        "EC (uS/cm)",
        "Water (L)",
        "Duration (min)",
        "Method",
        "Status",
      ]];

      filteredFields.forEach((field) => {
        const latest = filteredReadings.find(
          (reading) => String(reading.field_id) === String(field.id)
        );

        const completed = getLastCompleted(field.id);

        output.push([
          "Field summary",
          field.name,
          field.location,
          field.crop,
          completed?.scheduled_date || "",
          latest?.soil_moisture_percent ?? "",
          "",
          "",
          "",
          "",
          completed?.water_liters ?? "",
          completed?.duration_minutes ?? "",
          completed?.irrigation_method ?? "",
          completed ? "Completed" : "No completed event recorded",
        ]);
      });

      historyReadings.forEach((reading) => {
        const field = fields.find(
          (entry) => String(entry.id) === String(reading.field_id)
        );

        output.push([
          "Sensor reading",
          field?.name || `Field ${reading.field_id}`,
          field?.location || "",
          field?.crop || "",
          reading.recorded_at,
          reading.soil_moisture_percent,
          reading.soil_temperature_c,
          reading.humidity_percent,
          reading.ph,
          reading.electrical_conductivity_us_cm,
          "",
          "",
          "",
          "Observed reading",
        ]);
      });

      historySchedules.forEach((schedule) => {
        output.push([
          "Irrigation schedule",
          schedule.field_name,
          "",
          schedule.crop_name,
          `${schedule.scheduled_date || ""} ${schedule.start_time || ""}`,
          "",
          "",
          "",
          "",
          "",
          schedule.water_liters,
          schedule.duration_minutes,
          schedule.irrigation_method,
          schedule.status,
        ]);
      });

      output.push([]);
      output.push([
        "Note",
        "Irrigation water values are saved schedule quantities, not independent physical flow-meter measurements.",
      ]);

      const csv = "\uFEFF" + output
        .map((row) => row.map(csvEscape).join(","))
        .join("\r\n");

      const blob = new Blob([csv], {
        type: "text/csv;charset=utf-8;",
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "jalsaathi_field_reports.csv";

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      feedback.textContent = "Reports CSV downloaded successfully.";
    };

    const printReport = () => {
  const filteredFields = getFilteredFields();
  const filteredReadings = getFilteredReadings(filteredFields);
  const filteredSchedules = getFilteredSchedules(filteredFields);
  const historyReadings = getHistoryFilteredReadings(filteredFields);
  const historySchedules = getHistoryFilteredSchedules(filteredFields);
      const printWindow = window.open("", "_blank");

      if (!printWindow) {
        feedback.textContent =
          "Print window blocked. Allow pop-ups and try again.";
        return;
      }

      const makeTable = (headers, records) => {
        if (!records.length) {
          return "<p>No records available.</p>";
        }

        return `<table>
          <thead><tr>${headers.map((item) =>
            `<th>${escapeText(item)}</th>`).join("")}</tr></thead>
          <tbody>${records.map((record) =>
            `<tr>${record.map((item) =>
              `<td>${escapeText(item ?? "Not recorded")}</td>`
            ).join("")}</tr>`
          ).join("")}</tbody>
        </table>`;
      };

      const summary = filteredFields.map((field) => {
        const latest = filteredReadings.find(
          (reading) => String(reading.field_id) === String(field.id)
        );

        const completed = getLastCompleted(field.id);

        return [
          field.name,
          field.crop || "Not recorded",
          latest ? `${latest.soil_moisture_percent}%` : "Not recorded",
          completed ? completed.scheduled_date : "Not recorded",
        ];
      });

      const sensorData = filteredReadings.map((reading) => {
        const field = fields.find(
          (entry) => String(entry.id) === String(reading.field_id)
        );

        return [
          field?.name || `Field ${reading.field_id}`,
          reading.recorded_at,
          reading.soil_moisture_percent,
          reading.soil_temperature_c,
          reading.humidity_percent,
          reading.ph,
        ];
      });

      const irrigationData = historySchedules.map((schedule) => [
  schedule.field_name,
  schedule.scheduled_date,
  schedule.start_time,
  schedule.water_liters,
  schedule.duration_minutes,
  schedule.irrigation_method,
  schedule.status,
]);

      const printHTML = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>JalSaathi Field Reports</title>
          <style>
            body { font-family: Arial, sans-serif; color: #263b2c; padding: 24px; }
            h1 { color: #234634; }
            h2 { margin-top: 28px; color: #234634; }
            p { font-size: 12px; line-height: 1.5; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #dce5d9; padding: 8px; text-align: left; font-size: 10px; }
            th { background: #eef4eb; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <h1>JalSaathi Field Reports</h1>
          <p>Generated: ${escapeText(new Date().toLocaleString())}</p>
          <h2>Field summary</h2>
          ${makeTable(["Field", "Crop", "Latest moisture", "Last completed irrigation"], summary)}
          <h2>Sensor reading history</h2>
          ${makeTable(["Field", "Recorded at", "Moisture (%)", "Temperature (C)", "Humidity (%)", "pH"], sensorData)}
          <h2>Irrigation schedule history</h2>
          ${makeTable(["Field", "Date", "Start", "Water (L)", "Duration (min)", "Method", "Status"], irrigationData)}
          <p>Water quantities are saved schedule values, not independent physical flow-meter measurements.</p>
          <p>Planting dates and analysis results are not included where verified records are unavailable.</p>
        </body>
        </html>
      `;

      printWindow.document.open();
      printWindow.document.write(printHTML);
      printWindow.document.close();
      printWindow.focus();

      window.setTimeout(() => printWindow.print(), 500);
    };

    const resetHistoryPagesAndRender = () => {
  sensorCurrentPage = 1;
  irrigationCurrentPage = 1;
  render();
};

fieldSelect.addEventListener("change", resetHistoryPagesAndRender);
cropSelect.addEventListener("change", resetHistoryPagesAndRender);

// Sensor history filters
[
  sensorFieldFilter,
  sensorRangeFilter,
  sensorPageSize,
].forEach((control) => {
  control.addEventListener("change", () => {
    sensorCurrentPage = 1;
    render();
  });
});

// Sensor history pagination
sensorPrev.addEventListener("click", () => {
  sensorCurrentPage -= 1;
  render();
});

sensorNext.addEventListener("click", () => {
  sensorCurrentPage += 1;
  render();
});

// Irrigation history filters
[
  irrigationFieldFilter,
  irrigationStatusFilter,
  irrigationRangeFilter,
  irrigationPageSize,
].forEach((control) => {
  control.addEventListener("change", () => {
    irrigationCurrentPage = 1;
    render();
  });
});

// Irrigation history pagination
irrigationPrev.addEventListener("click", () => {
  irrigationCurrentPage -= 1;
  render();
});

irrigationNext.addEventListener("click", () => {
  irrigationCurrentPage += 1;
  render();
});

    csvButton.addEventListener("click", downloadCSV);
    pdfButton.addEventListener("click", printReport);

    try {
      await window.JalSaathiFieldStore.loadServerFields();
      fields = window.JalSaathiFieldStore.getServerFields();

      const previousField = fieldSelect.value;
      const previousCrop = cropSelect.value;

      fieldSelect.innerHTML =
        `<option value="all">All fields</option>` +
        fields.map((field) =>
          `<option value="${escapeText(field.id)}">${escapeText(field.name)}</option>`
        ).join("");

      const crops = [...new Map(
        fields
          .filter((field) => field.crop)
          .map((field) => [field.crop.toLowerCase(), field.crop])
      ).values()];

      cropSelect.innerHTML =
        `<option value="all">All crops</option>` +
        crops.map((crop) =>
          `<option value="${escapeText(crop)}">${escapeText(crop)}</option>`
        ).join("");

      if ([...fieldSelect.options].some((option) => option.value === previousField)) {
        fieldSelect.value = previousField;
      }

      if ([...cropSelect.options].some((option) =>
        option.value.toLowerCase() === previousCrop.toLowerCase()
      )) {
        cropSelect.value = previousCrop;
      }

      const sensorResults = await Promise.allSettled(
        fields.map((field) =>
          apiRequest(
            `/api/fields/${encodeURIComponent(field.id)}/sensor-readings?limit=5000`
          )
        )
      );

      sensorResults.forEach((result) => {
        if (result.status === "fulfilled" && Array.isArray(result.value)) {
          sensorReadings.push(...result.value);
        } else if (result.status === "rejected") {
          sensorLoadError = "Some sensor-reading records could not be loaded.";
        }
      });

      try {
        const scheduleResult = await apiRequest("/api/irrigation/schedules");
        schedules = Array.isArray(scheduleResult.schedules)
          ? scheduleResult.schedules
          : [];
      } catch (error) {
        scheduleLoadError = "Irrigation schedule history could not be loaded.";
      }

      // Populate history field filters from loaded fields.
      const historyFieldOptions =
        `<option value="all">All fields</option>` +
        fields.map((field) =>
          `<option value="${escapeText(field.id)}">${escapeText(field.name)}</option>`
        ).join("");

      sensorFieldFilter.innerHTML = historyFieldOptions;
      irrigationFieldFilter.innerHTML = historyFieldOptions;

      // Populate irrigation status filter from actual saved schedules.
      const availableStatuses = [...new Set(
        schedules
          .map((schedule) => String(schedule.status || "").trim())
          .filter(Boolean)
      )].sort();

      irrigationStatusFilter.innerHTML =
        `<option value="all">All statuses</option>` +
        availableStatuses.map((status) =>
          `<option value="${escapeText(status)}">${escapeText(status.replace(/_/g, " "))}</option>`
        ).join("");

      render();
    } catch (error) {
      feedback.textContent = error instanceof Error
        ? error.message
        : "Reports could not be loaded.";
      rows.replaceChildren();
      empty.hidden = false;
      empty.textContent = "Field report data could not be loaded.";
    }
  }

  function initializeProfileView(root) {
    const form = root.querySelector("[data-profile-name-form]");
    const profileName = root.querySelector("[data-profile-name]");
    const initial = root.querySelector("[data-profile-initial]");
    const message = root.querySelector("[data-profile-message]");
    const privateProfile = root.querySelector("[data-profile-private]");
    const loggedOut = root.querySelector("[data-profile-logged-out]");
    const emailNode = root.querySelector("[data-profile-email]");
    const phoneNode = root.querySelector("[data-profile-phone]");
    const locationNode = root.querySelector("[data-profile-location]");
    const languageNode = root.querySelector("[data-profile-language]");
    const input = form?.elements.namedItem("displayName");
    if (!(form instanceof HTMLFormElement) || !(profileName instanceof HTMLElement) || !(initial instanceof HTMLElement) || !(message instanceof HTMLElement) || !(input instanceof HTMLInputElement) || !(privateProfile instanceof HTMLElement) || !(loggedOut instanceof HTMLElement) || !(emailNode instanceof HTMLElement) || !(phoneNode instanceof HTMLElement) || !(locationNode instanceof HTMLElement) || !(languageNode instanceof HTMLElement)) return;

    const syncProfile = () => {
      const session = window.JalSaathiProfile.getProfile();
      privateProfile.hidden = !session;
      loggedOut.hidden = Boolean(session);
      if (!session) return;
      const name = session.name;
      profileName.textContent = name;
      initial.textContent = name.trim().charAt(0).toLocaleUpperCase() || "?";
      input.value = name;
      emailNode.textContent = session.email || "Not provided";
      phoneNode.textContent = session.phone || "Not provided";
      locationNode.textContent = [session.village, session.district, session.state].filter(Boolean).join(", ") || "Not provided";
      const selectedLanguage = window.JalSaathiProfile.getLanguages().find(
        ({ code }) => code === window.JalSaathiProfile.getLanguage(),
      );
      languageNode.textContent = selectedLanguage?.label || "English";
    };
    syncProfile();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      try {
        const updated = await window.JalSaathiProfile.apiRequest("/api/auth/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: input.value.trim() }),
        });
        window.JalSaathiProfile.setCurrentProfile(updated);
        message.textContent = "Your profile name was updated.";
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : "Could not update the display name.";
      }
    });
    window.addEventListener("jalsaathi:profile-changed", syncProfile);
    window.addEventListener("jalsaathi:language-changed", syncProfile);
  }
})();