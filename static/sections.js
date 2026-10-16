(() => {
  const views = {
    fields: {
      title: "My Fields",
      subtitle: "A quick look at your fields and their current moisture conditions.",
      render: `
        <div class="portal-page-heading">
          <div><h1>My Fields</h1><p>Field locations and soil moisture at a glance.</p></div>
          <div class="portal-fields-heading-actions">
            <span class="portal-demo-tag">Frontend demonstration persistence</span>
            <button class="portal-action portal-add-field" type="button" data-open-add-field>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              Add Field
            </button>
          </div>
        </div>
        <div class="portal-grid portal-grid--2">
          <section class="portal-card portal-card--padded" aria-label="Satellite field map">
            <div class="portal-card-heading"><h2>Field map</h2><span class="portal-muted">Mandya, Karnataka</span></div>
            <div class="portal-field-map" data-field-map role="img" aria-label="Aerial map showing sample fields">
              <div class="portal-map-overlay"></div>
              <svg class="portal-map-boundaries" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" data-map-boundaries></svg>
              <div data-map-pins></div>
              <div class="portal-map-caption"><strong data-map-count></strong><span>Satellite view</span></div>
            </div>
          </section>
          <section class="portal-card portal-card--padded">
            <div class="portal-card-heading"><h2>Field overview</h2><span class="portal-muted">Soil moisture</span></div>
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
            <p class="portal-dialog-description">Fields are saved in this browser for demonstration only; they are not stored on a server.</p>
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
              <label class="portal-form-field">Soil Moisture Percentage <span class="portal-form-optional">(optional)</span>
                <input name="moisture" type="number" min="0" max="100" step="1" inputmode="numeric" />
              </label>
              <label class="portal-form-field">Planting Date <span class="portal-form-optional">(optional)</span>
                <input name="plantingDate" type="date" />
              </label>
              <label class="portal-form-field">Last Irrigated Date <span class="portal-form-optional">(optional)</span>
                <input name="lastIrrigated" type="date" />
              </label>
              <label class="portal-form-field portal-form-field--wide">Field Boundary on Map <span class="portal-form-optional">(optional)</span>
                <input name="boundary" type="text" placeholder="12,20; 38,18; 44,60" autocomplete="off" />
                <small>Enter 3 or more map points as X,Y percentages (0-100), separated by semicolons.</small>
              </label>
            </div>
            <p class="portal-form-error" data-add-error role="alert" hidden></p>
            <div class="portal-dialog-actions">
              <button class="portal-secondary-action" type="button" data-cancel-add>Cancel</button>
              <button class="portal-action" type="submit" data-add-submit>Save Field</button>
            </div>
          </form>
        </dialog>
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
      subtitle: "Crop information derived from your saved field records.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Crops</h1><p>Crop information for the fields in your dashboard.</p></div>
          <span class="portal-demo-tag">Frontend demonstration data</span>
        </div>
        <div class="portal-grid portal-grid--3" data-crop-list></div>
      `,
    },
    schedule: {
      title: "Irrigation Schedule",
      subtitle: "Suggested irrigation times and durations from the sample dashboard.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Irrigation Schedule</h1><p>Review the current suggested watering plan.</p></div>
          <span class="portal-demo-tag">Recommendations · Demo</span>
        </div>
        <div class="portal-grid portal-grid--3">
          <article class="portal-card portal-irrigation-card"><img src="/static/images/field-sugarcane.jpg" alt="Sugarcane field" /><div><span class="portal-status portal-status--warning">Needs Water</span><h3>Field 2 - East Plot</h3><p>Sugarcane · Today, 5:00 PM · 2 hours</p></div></article>
          <article class="portal-card portal-irrigation-card"><img src="/static/images/field-ragi.jpg" alt="Ragi field" /><div><span class="portal-status portal-status--critical">Low Moisture</span><h3>Field 3 - South Field</h3><p>Ragi · Today, 4:00 PM · 1.5 hours</p></div></article>
          <article class="portal-card portal-irrigation-card"><img src="/static/images/field-rice.jpg" alt="Paddy field" /><div><span class="portal-status">Optimal</span><h3>Field 1 - North Plot</h3><p>Paddy · Tomorrow, 6:00 AM · 1 hour</p></div></article>
        </div>
        <section class="portal-card portal-table-card portal-section-gap">
          <div class="portal-card-heading"><h2>Upcoming plan</h2><span class="portal-muted">Based on current field recommendations</span></div>
          <div class="portal-table-wrap"><table class="portal-table"><thead><tr><th>Field</th><th>Crop</th><th>Suggested time</th><th>Duration</th><th>Status</th></tr></thead><tbody>
            <tr><td><strong>Field 3 - South Field</strong></td><td>Ragi</td><td>Today, 4:00 PM</td><td>1.5 hours</td><td><span class="portal-status portal-status--critical">Low Moisture</span></td></tr>
            <tr><td><strong>Field 2 - East Plot</strong></td><td>Sugarcane</td><td>Today, 5:00 PM</td><td>2 hours</td><td><span class="portal-status portal-status--warning">Needs Water</span></td></tr>
            <tr><td><strong>Field 1 - North Plot</strong></td><td>Paddy</td><td>Tomorrow, 6:00 AM</td><td>1 hour</td><td><span class="portal-status">Optimal</span></td></tr>
          </tbody></table></div>
        </section>
      `,
    },
    reports: {
      title: "Reports",
      subtitle: "Field and crop summaries from the shared demonstration records.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Reports</h1><p>Filterable field summary; only supplied readings and history are shown.</p></div>
          <span class="portal-demo-tag">Frontend demonstration data</span>
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
      subtitle: "Items from the sample dashboard that may need your attention.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Alerts</h1><p>Field status notes and local weather information.</p></div>
          <span class="portal-demo-tag">3 sample notifications</span>
        </div>
        <div class="portal-grid">
          <article class="portal-card portal-alert-card"><span class="portal-alert-icon portal-alert-icon--red">!</span><div><h3>Low soil moisture · Field 3</h3><p>South Field is showing 12% soil moisture. The dashboard suggests irrigation today at 4:00 PM for 1.5 hours.</p></div><span class="portal-alert-time">Field status</span></article>
          <article class="portal-card portal-alert-card"><span class="portal-alert-icon">!</span><div><h3>Irrigation recommended · Field 2</h3><p>East Plot is showing 18% soil moisture. The dashboard suggests irrigation today at 5:00 PM for 2 hours.</p></div><span class="portal-alert-time">Field status</span></article>
          <article class="portal-card portal-alert-card"><span class="portal-alert-icon portal-alert-icon--green">i</span><div><h3>Weather update · Mandya</h3><p>Partly cloudy, 28°C, with a 20% chance of rainfall in the current dashboard forecast.</p></div><span class="portal-alert-time">Weather</span></article>
        </div>
      `,
    },
    weather: {
      title: "Weather",
      subtitle: "Local conditions for Mandya, Karnataka.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Weather</h1><p>Local conditions and forecast details shown on your dashboard.</p></div>
          <span class="portal-demo-tag">Sample dashboard data</span>
        </div>
        <section class="portal-card portal-weather-hero">
          <div><div class="portal-weather-place">Mandya, Karnataka</div><div class="portal-temperature">28°C</div><div class="portal-weather-condition">Partly Cloudy</div></div>
          <div class="portal-weather-icon" aria-hidden="true">
            <svg viewBox="0 0 72 72" width="78" height="78"><circle cx="27" cy="24" r="12" fill="#f4bf59"/><path d="M20 52h35a10 10 0 0 0 0-20 14 14 0 0 0-26-4 12 12 0 0 0-9 24Z" fill="#fff" stroke="#c5dfea" stroke-width="3"/><path d="M32 58v5m12-5v5" stroke="#77b9d4" stroke-width="3" stroke-linecap="round"/></svg>
          </div>
        </section>
        <div class="portal-weather-stats portal-section-gap">
          <div class="portal-card portal-weather-stat"><span>Humidity</span><strong>68%</strong></div>
          <div class="portal-card portal-weather-stat"><span>Wind speed</span><strong>12 km/h</strong></div>
          <div class="portal-card portal-weather-stat"><span>Rainfall forecast</span><strong>20% chance</strong></div>
        </div>
        <section class="portal-card portal-card--padded portal-section-gap"><div class="portal-card-heading"><h2>Local conditions</h2><span class="portal-muted">Mandya area</span></div><p class="portal-muted">Use the latest local forecast alongside field readings when reviewing irrigation recommendations. Weather values on this page are sample dashboard data.</p></section>
      `,
    },
    profile: {
      title: "Profile",
      subtitle: "Your JalSaathi profile preview and account access.",
      render: `
        <div class="portal-page-heading">
          <div><h1>Profile</h1><p>Farmer profile information shown in this dashboard preview.</p></div>
          <span class="portal-demo-tag">Demo profile</span>
        </div>
        <section class="portal-card portal-profile-card" data-profile-private hidden>
          <div class="portal-profile-cover"></div>
          <div class="portal-profile-head"><div class="portal-avatar" data-profile-initial aria-hidden="true">R</div><div><h2 data-profile-name>Ramesh</h2><p>JalSaathi farmer dashboard · Mandya, Karnataka</p></div></div>
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
            <div class="portal-profile-detail"><span>Location</span><strong>Mandya, Karnataka</strong></div>
            <div class="portal-profile-detail"><span>Preferred language</span><strong>English</strong></div>
            <div class="portal-profile-detail"><span>Managed fields</span><strong>3 sample fields</strong></div>
            <div class="portal-profile-detail"><span>Account status</span><strong>Temporary frontend demo session</strong></div>
          </div>
        </section>
        <section class="portal-card portal-card--padded portal-profile-logged-out" data-profile-logged-out hidden>
          <h2>Sign in to view your profile</h2>
          <p class="portal-muted">Profile details are only shown while your temporary demo session is active.</p>
          <a class="portal-action" href="/static/auth.html?view=login">Open Login</a>
        </section>
        <section class="portal-card portal-profile-access portal-section-gap">
          <div><h2>Account access</h2><p class="portal-muted">Frontend demo session only. No real account is authenticated.</p></div>
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

  content.innerHTML = page.render;
  document.title = `JalSaathi | ${page.title}`;
  document.querySelectorAll("[data-view-link]").forEach((link) => {
    const active = link.dataset.viewLink === view;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if (view === "fields") initializeFieldsView(content);
  if (view === "crops") initializeCropsView(content);
  if (view === "reports") initializeReportsView(content);
  if (view === "profile") initializeProfileView(content);

  const renderGreeting = () => {
    const userName = window.JalSaathiProfile.getDisplayName();
    document.querySelectorAll("[data-user-name]").forEach((node) => { node.textContent = userName; });
  };
  renderGreeting();
  window.addEventListener("jalsaathi:profile-changed", renderGreeting);

  function initializeFieldsView(fieldsRoot) {
    let fields = window.JalSaathiFieldStore.getFields();
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
    const fieldStatus = (moisture) => {
      if (moisture === null || moisture === undefined) return { label: "Not set", className: "portal-status--neutral" };
      if (moisture >= 28) return { label: "Optimal", className: "" };
      if (moisture >= 18) return { label: "Needs Water", className: "portal-status--warning" };
      return { label: "Low Moisture", className: "portal-status--critical" };
    };
    const fieldDetails = (field) => {
      const items = [
        `<span>${escapeHtml(field.crop)}</span>`,
        `<span data-user-content>${escapeHtml(field.location)}</span>`,
        `${window.JalSaathiI18n.formatNumber(field.area)} ${escapeHtml(field.areaUnit)}`,
        field.lastIrrigated ? `Last irrigated ${escapeHtml(formatDate(field.lastIrrigated))}` : "Last irrigated date not set",
        field.plantingDate ? `Planted ${escapeHtml(formatDate(field.plantingDate))}` : "Planting date not set",
        field.moisture === null || field.moisture === undefined
          ? "Moisture not set"
          : `${window.JalSaathiI18n.formatNumber(field.moisture)}% ${field.moistureSource === "demonstration" ? "sample moisture" : "user-provided moisture"}`,
      ];
      return items.join(" · ");
    };

    const renderFields = () => {
      fieldList.innerHTML = fields.map((field, index) => {
        const color = palette[index % palette.length];
        const status = fieldStatus(field.moisture);
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

    addForm.addEventListener("submit", (event) => {
      event.preventDefault();
      addError.hidden = true;
      addError.textContent = "";

      const boundaryInput = addForm.elements.namedItem("boundary");
      let parsedBoundary = null;
      if (boundaryInput instanceof HTMLInputElement && boundaryInput.value.trim()) {
        const pairs = boundaryInput.value.trim().split(";").map((pair) => pair.trim());
        parsedBoundary = pairs.map((pair) => {
          const match = pair.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
          return match ? [Number(match[1]), Number(match[2])] : null;
        });
        if (parsedBoundary.length < 3 || parsedBoundary.some((point) => !point || point.some((coordinate) => coordinate < 0 || coordinate > 100))) {
          addError.textContent = "Enter at least three valid map points in X,Y format, each between 0 and 100.";
          addError.hidden = false;
          boundaryInput.focus();
          return;
        }
      }

      if (!addForm.checkValidity()) {
        const invalidInput = addForm.querySelector(":invalid");
        addError.textContent = "Check the required fields and make sure area and moisture values are valid.";
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
        moisture: formData.get("moisture") === "" ? null : Number(formData.get("moisture")),
        moistureSource: "user-provided",
        plantingDate: String(formData.get("plantingDate") || ""),
        lastIrrigated: String(formData.get("lastIrrigated") || ""),
        boundary: boundaryInput instanceof HTMLInputElement && boundaryInput.value.trim() ? parsedBoundary : existing?.boundary || null,
      };
      const field = existing
        ? window.JalSaathiFieldStore.updateField(existing.id, fieldValues)
        : window.JalSaathiFieldStore.addField(fieldValues);
      fields = window.JalSaathiFieldStore.getFields();
      renderFields();
      closeAddDialog();
      const persistenceWarning = window.JalSaathiFieldStore.getPersistenceWarning();
      showFeedback(persistenceWarning
        ? `${field.name} changed in this page only. ${persistenceWarning}`
        : existing ? `${field.name} was updated in this demonstration.` : `${field.name} was added to this demonstration.`);
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
          for (const name of ["name", "location", "crop", "area", "areaUnit", "plantingDate", "lastIrrigated"]) {
            const input = addForm.elements.namedItem(name);
            if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) input.value = field[name] ?? "";
          }
          const moistureInput = addForm.elements.namedItem("moisture");
          if (moistureInput instanceof HTMLInputElement) moistureInput.value = field.moisture ?? "";
          const boundaryInput = addForm.elements.namedItem("boundary");
          if (boundaryInput instanceof HTMLInputElement) boundaryInput.value = field.boundary ? field.boundary.map(([x, y]) => `${x},${y}`).join("; ") : "";
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
    fieldsRoot.querySelector("[data-confirm-delete]")?.addEventListener("click", () => {
      const field = window.JalSaathiFieldStore.deleteField(pendingDeleteId);
      if (!field) {
        closeDeleteDialog();
        return;
      }
      const deletedName = field.name;
      fields = window.JalSaathiFieldStore.getFields();
      pendingDeleteId = null;
      deleteDialog.close();
      renderFields();
      const persistenceWarning = window.JalSaathiFieldStore.getPersistenceWarning();
      showFeedback(persistenceWarning ? `${deletedName} was removed in this page only. ${persistenceWarning}` : `${deletedName} was removed from this demonstration.`);
    });

    renderFields();
    window.addEventListener("jalsaathi:fields-changed", () => {
      fields = window.JalSaathiFieldStore.getFields();
      renderFields();
    });
    window.addEventListener("jalsaathi:language-changed", renderFields);
    const warning = window.JalSaathiFieldStore.getPersistenceWarning();
    if (warning) showFeedback(warning);
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

  function initializeCropsView(root) {
    const cropList = root.querySelector("[data-crop-list]");
    if (!(cropList instanceof HTMLElement)) return;
    const imageForCrop = (crop) => {
      const name = crop.toLowerCase();
      if (name.includes("sugar")) return "/static/images/field-sugarcane.jpg";
      if (name.includes("ragi")) return "/static/images/field-ragi.jpg";
      return "/static/images/field-rice.jpg";
    };
    const render = () => {
      const fields = window.JalSaathiFieldStore.getFields();
      const crops = new Map();
      fields.forEach((field) => {
        const key = field.crop.trim().toLocaleLowerCase();
        if (!crops.has(key)) crops.set(key, { name: field.crop, fields: [] });
        crops.get(key).fields.push(field);
      });
      cropList.innerHTML = crops.size ? [...crops.values()].map((crop) => {
        const associations = crop.fields.map((field) => {
          const moisture = field.moisture === null || field.moisture === undefined
            ? "Moisture not provided"
            : `${field.moisture}% · ${field.moistureSource === "demonstration" ? "sample" : "user-provided (not sensor)"}`;
          const unit = field.areaUnit === "hectares" ? "Hectares" : field.areaUnit === "acres" ? "Acres" : field.areaUnit;
          return `<div class="portal-crop-association"><strong data-user-content>${escapeText(field.name)}</strong><span><span data-user-content>${escapeText(field.location)}</span> · ${window.JalSaathiI18n.formatNumber(field.area)} ${escapeText(unit)}</span><span>Planted: ${escapeText(formatDate(field.plantingDate))} · Moisture: ${escapeText(moisture)}</span><span>Growth stage: Not provided</span></div>`;
        }).join("");
        return `<article class="portal-card portal-field-card"><img class="portal-field-photo" src="${imageForCrop(crop.name)}" alt="${escapeText(crop.name)} field" /><div class="portal-field-content"><h2>${escapeText(crop.name)}</h2><p>${crop.fields.length} associated ${crop.fields.length === 1 ? "field" : "fields"}</p>${associations}<div class="portal-field-info"><span class="portal-info-chip">Status: No crop analysis</span></div></div></article>`;
      }).join("") : `<section class="portal-card portal-card--padded portal-empty-note">No crops are associated with fields yet. Add a field and select its crop to see crop details here.</section>`;
    };
    render();
    window.addEventListener("jalsaathi:fields-changed", render);
  }

  function initializeReportsView(root) {
    const fieldSelect = root.querySelector("[data-report-field]");
    const cropSelect = root.querySelector("[data-report-crop]");
    const rows = root.querySelector("[data-report-rows]");
    const empty = root.querySelector("[data-report-empty]");
    if (!(fieldSelect instanceof HTMLSelectElement) || !(cropSelect instanceof HTMLSelectElement) || !(rows instanceof HTMLElement) || !(empty instanceof HTMLElement)) return;

    const render = () => {
      const fields = window.JalSaathiFieldStore.getFields();
      const selectedField = fieldSelect.value;
      const selectedCrop = cropSelect.value;
      fieldSelect.innerHTML = `<option value="all">All fields</option>${fields.map((field) => `<option data-user-content value="${escapeText(field.id)}">${escapeText(field.name)}</option>`).join("")}`;
      const crops = [...new Map(fields.map((field) => [field.crop.toLocaleLowerCase(), field.crop])).values()];
      cropSelect.innerHTML = `<option value="all">All crops</option>${crops.map((crop) => `<option value="${escapeText(crop)}">${escapeText(crop)}</option>`).join("")}`;
      if ([...fieldSelect.options].some((option) => option.value === selectedField)) fieldSelect.value = selectedField;
      if ([...cropSelect.options].some((option) => option.value.toLocaleLowerCase() === selectedCrop.toLocaleLowerCase())) cropSelect.value = selectedCrop;
      const filtered = fields.filter((field) =>
        (fieldSelect.value === "all" || field.id === fieldSelect.value) &&
        (cropSelect.value === "all" || field.crop.toLocaleLowerCase() === cropSelect.value.toLocaleLowerCase())
      );
      rows.innerHTML = filtered.map((field) => `<tr>
        <td><strong data-user-content>${escapeText(field.name)}</strong><br><span class="portal-muted" data-user-content>${escapeText(field.location)}</span></td>
        <td>${escapeText(field.crop)}</td><td>${window.JalSaathiI18n.formatNumber(field.area)} ${escapeText(field.areaUnit)}</td>
        <td>${escapeText(formatDate(field.plantingDate))}</td>
        <td>${field.moisture === null || field.moisture === undefined ? "Not provided" : `${field.moisture}% · ${field.moistureSource === "demonstration" ? "sample" : "user-provided"}`}</td>
        <td>${escapeText(formatDate(field.lastIrrigated))}</td><td>Not available</td>
      </tr>`).join("");
      empty.hidden = filtered.length !== 0;
    };
    fieldSelect.addEventListener("change", render);
    cropSelect.addEventListener("change", render);
    window.addEventListener("jalsaathi:fields-changed", render);
    render();
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
    const input = form?.elements.namedItem("displayName");
    if (!(form instanceof HTMLFormElement) || !(profileName instanceof HTMLElement) || !(initial instanceof HTMLElement) || !(message instanceof HTMLElement) || !(input instanceof HTMLInputElement) || !(privateProfile instanceof HTMLElement) || !(loggedOut instanceof HTMLElement) || !(emailNode instanceof HTMLElement) || !(phoneNode instanceof HTMLElement)) return;

    const syncProfile = () => {
      const session = window.JalSaathiProfile.getDemoSession();
      privateProfile.hidden = !session;
      loggedOut.hidden = Boolean(session);
      if (!session) return;
      const name = session.displayName;
      profileName.textContent = name;
      initial.textContent = name.trim().charAt(0).toLocaleUpperCase() || "?";
      input.value = name;
      emailNode.textContent = session.email || "Not provided";
      phoneNode.textContent = session.phone || "Not provided";
    };
    syncProfile();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      try {
        const updatedName = window.JalSaathiProfile.setDisplayName(input.value);
        window.JalSaathiProfile.updateDemoSession({ displayName: updatedName });
        message.textContent = window.JalSaathiProfile.getPersistenceWarning()
          || `Your display name is now ${updatedName}. This is saved as frontend demonstration data in this browser.`;
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : "Could not update the display name.";
      }
    });
    window.addEventListener("jalsaathi:profile-changed", syncProfile);
  }
})();
