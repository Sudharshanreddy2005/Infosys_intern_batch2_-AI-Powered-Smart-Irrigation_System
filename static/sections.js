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
                <input name="location" type="text" maxlength="100" required autocomplete="address-level2" />
              </label>
              <label class="portal-form-field">Crop Type
                <select name="crop" required>
                  <option value="">Select a crop</option>
                  <option value="Paddy">Paddy</option><option value="Sugarcane">Sugarcane</option><option value="Ragi">Ragi</option><option value="Maize">Maize</option><option value="Cotton">Cotton</option><option value="Other">Other</option>
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
            </div>
            <p class="portal-form-error" data-add-error role="alert" hidden></p>
            <div class="portal-dialog-actions">
              <button class="portal-secondary-action" type="button" data-cancel-add>Cancel</button>
              <button class="portal-action" type="submit" data-add-submit>Save Field</button>
            </div>
          </form>
        </dialog>
        <section class="portal-card portal-table-card portal-section-gap" aria-labelledby="sensor-history-title">
          <div class="portal-card-heading"><h2 id="sensor-history-title">Historical sensor records</h2><span class="portal-muted" data-sensor-provenance>Not loaded</span></div>
          <p class="portal-muted">Records from the PostgreSQL dataset; this data is historical and synthetic or synthetic-augmented, not live telemetry.</p>
          <p class="portal-empty-note" data-sensor-state role="status" aria-live="polite">Loading historical records…</p>
          <div class="portal-table-wrap" data-sensor-table-wrap hidden>
            <table class="portal-table"><thead><tr><th>Timestamp</th><th>Field ID</th><th>Soil moisture</th><th>Temperature</th><th>Humidity</th></tr></thead><tbody data-sensor-rows></tbody></table>
          </div>
          <button class="portal-secondary-action" type="button" data-sensor-retry hidden>Retry</button>
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
      `,
    },
    crops: {
      title: "Crops",
      subtitle: "Crop information saved to your JalSaathi account.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Crops</h1><p>Crop information for the fields in your account.</p></div>
          <span class="portal-demo-tag">Account data</span>
        </div>
        <section class="portal-card portal-card--padded portal-section-gap">
          <form data-crop-form class="portal-form-grid">
            <label class="portal-form-field">Crop name<input name="name" maxlength="80" required /></label>
            <label class="portal-form-field">Variety<input name="variety" maxlength="100" /></label>
            <label class="portal-form-field">Field
              <select name="field_id" data-crop-field-options><option value="">No field selected</option></select>
            </label>
            <label class="portal-form-field">Growth stage<input name="growth_stage" maxlength="80" /></label>
            <label class="portal-form-field">Planting date<input name="planting_date" type="date" /></label>
            <label class="portal-form-field">Expected harvest date<input name="expected_harvest_date" type="date" /></label>
            <p class="portal-form-error" data-crop-error role="alert" hidden></p>
            <div class="portal-dialog-actions">
              <button class="portal-action" type="submit" data-crop-submit>Save Crop</button>
              <button class="portal-secondary-action" type="button" data-crop-cancel hidden>Cancel edit</button>
            </div>
          </form>
        </section>
        <div class="portal-grid portal-grid--3" data-crop-list></div>
      `,
    },
    schedule: {
      title: "Irrigation Schedule",
      subtitle: "No irrigation schedule is currently available.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Irrigation Schedule</h1><p>No verified live sensor stream or irrigation recommendation model is connected.</p></div>
          <span class="portal-demo-tag">Unavailable</span>
        </div>
        <section class="portal-card portal-card--padded"><p class="portal-empty-note">No watering times or durations are provided. Use verified field and sensor information before making irrigation decisions.</p></section>
      `,
    },
    reports: {
      title: "Reports",
      subtitle: "Field summaries from your JalSaathi account.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Reports</h1><p>Filterable field summary; only supplied readings and history are shown.</p></div>
          <span class="portal-demo-tag">Account data</span>
        </div>
        <section class="portal-card portal-table-card portal-section-gap">
          <div class="portal-card-heading"><h2>Field report</h2><span class="portal-muted">No historical readings are fabricated</span></div>
          <div class="portal-report-filters">
            <label>Field<select data-report-field><option value="all">All fields</option></select></label>
            <label>Crop<select data-report-crop><option value="all">All crops</option></select></label>
          </div>
          <div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>Field</th><th>Crop</th><th>Area</th><th>Planting date</th><th>Soil moisture</th><th>Last irrigated</th><th>Analysis</th></tr></thead><tbody data-report-rows></tbody></table></div>
          <p class="portal-report-empty" data-report-empty hidden>No fields match these filters.</p>
        </section>
        <div class="portal-grid portal-grid--2 portal-section-gap">
          <section class="portal-card portal-card--padded"><div class="portal-card-heading"><h2>History</h2><span class="portal-muted">Observed records only</span></div><p class="portal-empty-note">No soil moisture history or irrigation event log is available yet.</p></section>
          <section class="portal-card portal-card--padded"><div class="portal-card-heading"><h2>Analysis and recommendations</h2><span class="portal-muted">Verified inputs only</span></div><p class="portal-empty-note">No analysis results or recommendations are available. No analysis engine is connected.</p></section>
        </div>
      `,
    },
    alerts: {
      title: "Alerts",
      subtitle: "No verified alert source is connected.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Alerts</h1><p>No live sensor, weather-alert, or notification feed is connected.</p></div>
          <span class="portal-demo-tag">No verified alerts</span>
        </div>
        <section class="portal-card portal-card--padded"><p class="portal-empty-note">No alerts are available.</p></section>
      `,
    },
    weather: {
      title: "Weather",
      subtitle: "Current conditions and hourly forecasts from Tomorrow.io, when configured.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Weather</h1><p>Weather uses your current location when available, or the configured location. You can also choose a place manually.</p></div>
          <span class="portal-demo-tag" data-weather-status>Loading</span>
        </div>
        <section class="portal-card portal-card--padded portal-section-gap">
          <form data-weather-location-form class="portal-weather-location-form">
            <label class="portal-form-field">Manual location
              <input name="location" maxlength="100" placeholder="City or place name" autocomplete="address-level2" required />
            </label>
            <button class="portal-action" type="submit">Get weather for this location</button>
          </form>
        </section>
        <section data-weather-view>
          <section class="portal-card portal-weather-hero">
            <div><div class="portal-weather-place" data-weather-location>Finding location…</div><div class="portal-temperature" data-weather-temperature>Loading…</div><span class="portal-temperature-indicator" data-weather-temperature-indicator aria-hidden="true" hidden></span><div class="portal-weather-condition" data-weather-condition>Loading weather…</div><p class="portal-weather-condition">Feels like <strong data-weather-feels-like>Loading…</strong></p><p class="portal-weather-condition">High / low <strong data-weather-high-low>Loading…</strong></p><p class="portal-weather-condition">Updated <span data-weather-updated>Loading…</span> · <span data-weather-observation>Loading</span></p></div>
            <div class="portal-weather-icon" aria-hidden="true">
              <svg viewBox="0 0 72 72" width="78" height="78"><circle cx="27" cy="24" r="12" fill="#f4bf59"/><path d="M20 52h35a10 10 0 0 0 0-20 14 14 0 0 0-26-4 12 12 0 0 0-9 24Z" fill="#fff" stroke="#c5dfea" stroke-width="3"/><path d="M32 58v5m12-5v5" stroke="#77b9d4" stroke-width="3" stroke-linecap="round"/></svg>
            </div>
          </section>
          <div class="portal-weather-stats portal-section-gap">
            <div class="portal-card portal-weather-stat"><span>Humidity</span><strong data-weather-humidity>Loading…</strong></div>
            <div class="portal-card portal-weather-stat"><span>Wind speed</span><strong data-weather-wind>Loading…</strong></div>
            <div class="portal-card portal-weather-stat"><span>Rainfall intensity</span><strong data-weather-rainfall>Loading…</strong></div>
            <div class="portal-card portal-weather-stat"><span>Rain probability</span><strong data-weather-rain-probability>Loading…</strong></div>
          </div>
        </section>
        <section class="portal-card portal-table-card portal-section-gap">
          <div class="portal-card-heading"><h2>Hourly forecast</h2><span class="portal-muted" data-forecast-status>Loading forecast…</span></div>
          <div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>Time</th><th>Temperature</th><th>Feels like</th><th>Precipitation intensity</th><th>Rain probability</th></tr></thead><tbody data-forecast-rows></tbody></table></div>
        </section>
        <section class="portal-card portal-table-card portal-section-gap">
          <div class="portal-card-heading"><h2>Daily forecast</h2><span class="portal-muted" data-daily-forecast-status>Loading forecast…</span></div>
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
          <div class="portal-profile-head"><div class="portal-avatar" data-profile-initial aria-hidden="true">F</div><div><h2 data-profile-name>Farmer</h2><p>JalSaathi farmer account</p></div></div>
          <form class="portal-profile-name-form" data-profile-name-form>
            <label class="portal-form-field">Your name
              <input name="displayName" type="text" maxlength="80" required autocomplete="name" />
            </label>
            <button class="portal-action" type="submit">Update Name</button>
            <p class="portal-profile-message" data-profile-message role="status" aria-live="polite"></p>
          </form>
          <div class="portal-profile-body">
            <div class="portal-profile-detail"><span>Email</span><strong data-profile-email>Not provided</strong></div>
            <div class="portal-profile-detail"><span>Phone</span><strong data-profile-phone>Not provided</strong></div>
            <div class="portal-profile-detail"><span>Location</span><strong data-profile-location>Not provided</strong></div>
            <div class="portal-profile-detail"><span>Preferred language</span><strong>English</strong></div>
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

  content.innerHTML = page.render;
  document.title = `JalSaathi | ${page.title}`;
  document.querySelectorAll("[data-view-link]").forEach((link) => {
    const active = link.dataset.viewLink === view;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if (view === "fields") initializeFieldsView(content);
  if (view === "fields") initializeSensorHistory(content);
  if (view === "crops") initializeCropsView(content);
  if (view === "reports") initializeReportsView(content);
  if (view === "weather") initializeWeatherView(content);
  if (view === "profile") initializeProfileView(content);

  const renderGreeting = () => {
    const userName = window.JalSaathiProfile.getDisplayName();
    document.querySelectorAll("[data-user-name]").forEach((node) => { node.textContent = userName; });
  };
  renderGreeting();
  window.addEventListener("jalsaathi:profile-changed", renderGreeting);

  async function initializeFieldsView(fieldsRoot) {
    let fields = window.JalSaathiFieldStore.getServerFields();
    const fieldList = fieldsRoot.querySelector("[data-field-list]");
    const boundaries = fieldsRoot.querySelector("[data-map-boundaries]");
    const pins = fieldsRoot.querySelector("[data-map-pins]");
    const mapCount = fieldsRoot.querySelector("[data-map-count]");
    const emptyState = fieldsRoot.querySelector("[data-field-empty]");
    const addDialog = fieldsRoot.querySelector("[data-add-dialog]");
    const addForm = fieldsRoot.querySelector("[data-add-form]");
    const addError = fieldsRoot.querySelector("[data-add-error]");
    const deleteDialog = fieldsRoot.querySelector("[data-delete-dialog]");
    const feedback = fieldsRoot.querySelector("[data-field-feedback]");

    if (
      !(fieldList instanceof HTMLElement) ||
      !(boundaries instanceof SVGElement) ||
      !(pins instanceof HTMLElement) ||
      !(mapCount instanceof HTMLElement) ||
      !(emptyState instanceof HTMLElement) ||
      !(addDialog instanceof HTMLDialogElement) ||
      !(addForm instanceof HTMLFormElement) ||
      !(addError instanceof HTMLElement) ||
      !(deleteDialog instanceof HTMLDialogElement) ||
      !(feedback instanceof HTMLElement)
    ) {
      return;
    }

    let pendingDeleteId = null;
    let feedbackTimer = 0;
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
        `<span>${escapeHtml(field.crop || "Crop not set")}</span>`,
        `<span data-user-content>${escapeHtml(field.location)}</span>`,
        `${window.JalSaathiI18n.formatNumber(field.area)} ${escapeHtml(field.areaUnit)}`,
      ];
      return items.join(" · ");
    };

    const renderFields = () => {
      fieldList.innerHTML = fields.map((field, index) => {
        const color = palette[index % palette.length];
        const status = fieldStatus(field);
        return `<article class="portal-field-row">
          <span class="portal-color-dot portal-color-dot--${color}" aria-hidden="true"></span>
          <div class="portal-field-copy"><strong data-user-content>${escapeHtml(field.name)}</strong><small>${fieldDetails(field)}</small></div>
          <span class="portal-status ${status.className}">${status.label}</span>
          <button class="portal-edit-field" type="button" data-edit-field="${escapeHtml(field.id)}" aria-label="Edit ${escapeHtml(field.name)}" title="Edit field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5ZM13.8 6.7l3.5 3.5" /></svg>
          </button>
          <button class="portal-delete-field" type="button" data-delete-field="${escapeHtml(field.id)}" aria-label="Delete ${escapeHtml(field.name)}" title="Delete field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 4v5m4-5v5" /></svg>
          </button>
        </article>`;
      }).join("");

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

    const closeAddDialog = () => {
      addDialog.close();
      addError.hidden = true;
      addError.textContent = "";
      addForm.reset();
      delete addForm.dataset.editingId;
      fieldsRoot.querySelector("[data-add-title]")?.replaceChildren(document.createTextNode("Add Field"));
      fieldsRoot.querySelector("[data-add-submit]")?.replaceChildren(document.createTextNode("Save Field"));
    };

    fieldsRoot.querySelectorAll("[data-open-add-field]").forEach((button) => {
      button.addEventListener("click", () => {
        addForm.reset();
        delete addForm.dataset.editingId;
        fieldsRoot.querySelector("[data-add-title]")?.replaceChildren(document.createTextNode("Add Field"));
        fieldsRoot.querySelector("[data-add-submit]")?.replaceChildren(document.createTextNode("Save Field"));
        addError.hidden = true;
        addError.textContent = "";
        addDialog.showModal();
        addForm.elements.namedItem("name")?.focus();
      });
    });
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
      const existing = addForm.dataset.editingId ? fields.find((field) => field.id === addForm.dataset.editingId) : null;
      const fieldValues = {
        name: String(formData.get("name")).trim(),
        location: String(formData.get("location")).trim(),
        crop: String(formData.get("crop")),
        area: Number(formData.get("area")),
        areaUnit: String(formData.get("areaUnit")),
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

    fieldList.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const editButton = event.target.closest("[data-edit-field]");
      if (editButton instanceof HTMLButtonElement) {
        const field = fields.find((entry) => entry.id === editButton.dataset.editField);
        if (field) {
          addForm.reset();
          addForm.dataset.editingId = field.id;
          fieldsRoot.querySelector("[data-add-title]")?.replaceChildren(document.createTextNode("Edit Field"));
          fieldsRoot.querySelector("[data-add-submit]")?.replaceChildren(document.createTextNode("Save Changes"));
          for (const name of ["name", "location", "crop", "area", "areaUnit"]) {
            const input = addForm.elements.namedItem(name);
            if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) input.value = field[name] ?? "";
          }
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
    } catch (error) {
      renderFields();
      showFeedback(error instanceof Error ? error.message : "Your fields could not be loaded.");
    }
  }

  async function initializeSensorHistory(root) {
    const state = root.querySelector("[data-sensor-state]");
    const provenance = root.querySelector("[data-sensor-provenance]");
    const rows = root.querySelector("[data-sensor-rows]");
    const tableWrap = root.querySelector("[data-sensor-table-wrap]");
    const retry = root.querySelector("[data-sensor-retry]");
    if (!(state instanceof HTMLElement) || !(provenance instanceof HTMLElement) || !(rows instanceof HTMLElement) || !(tableWrap instanceof HTMLElement) || !(retry instanceof HTMLButtonElement)) return;

    const load = async () => {
      retry.hidden = true;
      state.textContent = "Loading historical records…";
      state.hidden = false;
      tableWrap.hidden = true;
      try {
        const response = await fetch("/sensor-readings?limit=100");
        if (!response.ok) throw new Error("Historical sensor records could not be loaded.");
        const payload = await response.json();
        if (!Array.isArray(payload.data)) throw new Error("Historical sensor response has an invalid shape.");
        rows.innerHTML = payload.data.map((reading) => `<tr>
          <td>${escapeText(reading.timestamp)}</td>
          <td>${escapeText(reading.field_id)}</td>
          <td>${escapeText(reading.soil_moisture ?? "Not recorded")}</td>
          <td>${escapeText(reading.temperature_c ?? reading.temperature ?? "Not recorded")}</td>
          <td>${escapeText(reading.humidity_percent ?? reading.humidity ?? "Not recorded")}</td>
        </tr>`).join("");
        const origin = payload.data_origin === "mixed_or_unavailable" ? "mixed or unavailable origin" : payload.data_origin;
        provenance.textContent = `${payload.count} historical records · ${origin}`;
        state.textContent = payload.data.length ? "Historical data; not live telemetry." : "No historical records are available.";
        state.hidden = false;
        tableWrap.hidden = payload.data.length === 0;
      } catch (error) {
        state.textContent = error instanceof Error ? error.message : "Historical sensor records could not be loaded.";
        retry.hidden = false;
      }
    };
    retry.addEventListener("click", load);
    await load();
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
    if (!(cropList instanceof HTMLElement) || !(form instanceof HTMLFormElement) || !(fieldOptions instanceof HTMLSelectElement) || !(errorNode instanceof HTMLElement)) return;
    const imageForCrop = (crop) => {
      const name = crop.toLowerCase();
      if (name.includes("sugar")) return "/static/images/field-sugarcane.jpg";
      if (name.includes("ragi")) return "/static/images/field-ragi.jpg";
      return "/static/images/field-rice.jpg";
    };
    let crops = [];
    let fields = [];
    const render = () => {
      cropList.innerHTML = crops.length ? crops.map((crop) => `<article class="portal-card portal-field-card">
        <img class="portal-field-photo" src="${imageForCrop(crop.name)}" alt="${escapeText(crop.name)} field" />
        <div class="portal-field-content"><h2>${escapeText(crop.name)}</h2>
          <p>${escapeText(crop.variety || "Variety not provided")}</p>
          <div class="portal-crop-association">
            <span>Field: ${escapeText(fields.find((field) => String(field.id) === String(crop.field_id))?.name || "Not assigned")}</span>
            <span>Planting: ${escapeText(formatDate(crop.planting_date))} · Expected harvest: ${escapeText(formatDate(crop.expected_harvest_date))}</span>
            <span>Growth stage: ${escapeText(crop.growth_stage || "Not provided")}</span>
          </div>
          <button class="portal-secondary-action" type="button" data-edit-crop="${crop.id}">Edit crop</button>
          <button class="portal-danger-action" type="button" data-delete-crop="${crop.id}">Delete crop</button>
        </div>
      </article>`).join("") : `<section class="portal-card portal-card--padded portal-empty-note">No crops are saved yet. Use the form above to add a crop.</section>`;
    };
    try {
      fields = await window.JalSaathiFieldStore.loadServerFields();
      fieldOptions.innerHTML = `<option value="">No field selected</option>${fields.map((field) => `<option value="${escapeText(field.id)}">${escapeText(field.name)}</option>`).join("")}`;
      crops = await window.JalSaathiProfile.apiRequest("/api/crops");
      render();
    } catch (error) {
      cropList.textContent = error instanceof Error ? error.message : "Crops could not be loaded.";
      return;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorNode.hidden = true;
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      const payload = Object.fromEntries(data.entries());
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
        render();
        form.reset();
        delete form.dataset.editingId;
        root.querySelector("[data-crop-submit]").textContent = "Save Crop";
        root.querySelector("[data-crop-cancel]").hidden = true;
      } catch (error) {
        errorNode.textContent = error instanceof Error ? error.message : "The crop could not be saved.";
        errorNode.hidden = false;
      }
    });

    cropList.addEventListener("click", async (event) => {
      if (!(event.target instanceof Element)) return;
      const editButton = event.target.closest("[data-edit-crop]");
      if (editButton instanceof HTMLButtonElement) {
        const crop = crops.find((entry) => String(entry.id) === editButton.dataset.editCrop);
        if (!crop) return;
        form.dataset.editingId = String(crop.id);
        for (const key of ["name", "variety", "field_id", "growth_stage", "planting_date", "expected_harvest_date"]) {
          const control = form.elements.namedItem(key);
          if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) control.value = crop[key] ?? "";
        }
        root.querySelector("[data-crop-submit]").textContent = "Update Crop";
        root.querySelector("[data-crop-cancel]").hidden = false;
        form.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      const button = event.target.closest("[data-delete-crop]");
      if (!(button instanceof HTMLButtonElement)) return;
      button.disabled = true;
      try {
        await window.JalSaathiProfile.apiRequest(`/api/crops/${encodeURIComponent(button.dataset.deleteCrop)}`, { method: "DELETE" });
        crops = crops.filter((crop) => String(crop.id) !== button.dataset.deleteCrop);
        render();
      } catch (error) {
        button.disabled = false;
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
    if (!(fieldSelect instanceof HTMLSelectElement) || !(cropSelect instanceof HTMLSelectElement) || !(rows instanceof HTMLElement) || !(empty instanceof HTMLElement)) return;

    const render = () => {
      const fields = window.JalSaathiFieldStore.getServerFields();
      const selectedField = fieldSelect.value;
      const selectedCrop = cropSelect.value;
      fieldSelect.innerHTML = `<option value="all">All fields</option>${fields.map((field) => `<option data-user-content value="${escapeText(field.id)}">${escapeText(field.name)}</option>`).join("")}`;
      const crops = [...new Map(fields.filter((field) => field.crop).map((field) => [field.crop.toLocaleLowerCase(), field.crop])).values()];
      cropSelect.innerHTML = `<option value="all">All crops</option>${crops.map((crop) => `<option value="${escapeText(crop)}">${escapeText(crop)}</option>`).join("")}`;
      if ([...fieldSelect.options].some((option) => option.value === selectedField)) fieldSelect.value = selectedField;
      if ([...cropSelect.options].some((option) => option.value.toLocaleLowerCase() === selectedCrop.toLocaleLowerCase())) cropSelect.value = selectedCrop;
      const filtered = fields.filter((field) =>
        (fieldSelect.value === "all" || field.id === fieldSelect.value) &&
        (cropSelect.value === "all" || (field.crop || "").toLocaleLowerCase() === cropSelect.value.toLocaleLowerCase())
      );
      rows.innerHTML = filtered.map((field) => `<tr>
        <td><strong data-user-content>${escapeText(field.name)}</strong><br><span class="portal-muted" data-user-content>${escapeText(field.location)}</span></td>
        <td>${escapeText(field.crop || "Not set")}</td><td>${window.JalSaathiI18n.formatNumber(field.area)} ${escapeText(field.areaUnit)}</td>
        <td>Not recorded</td><td>Not recorded</td><td>Not recorded</td><td>Not available</td>
      </tr>`).join("");
      empty.hidden = filtered.length !== 0;
    };
    fieldSelect.addEventListener("change", render);
    cropSelect.addEventListener("change", render);
    window.addEventListener("jalsaathi:fields-changed", render);
    try {
      await window.JalSaathiFieldStore.loadServerFields();
      render();
    } catch (error) {
      rows.replaceChildren();
      empty.textContent = error instanceof Error ? error.message : "Your fields could not be loaded.";
      empty.hidden = false;
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
    const input = form?.elements.namedItem("displayName");
    if (!(form instanceof HTMLFormElement) || !(profileName instanceof HTMLElement) || !(initial instanceof HTMLElement) || !(message instanceof HTMLElement) || !(input instanceof HTMLInputElement) || !(privateProfile instanceof HTMLElement) || !(loggedOut instanceof HTMLElement) || !(emailNode instanceof HTMLElement) || !(phoneNode instanceof HTMLElement) || !(locationNode instanceof HTMLElement)) return;

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
  }
})();
