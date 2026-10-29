document.addEventListener("DOMContentLoaded", async () => {
  let profileResponse;
  try {
    profileResponse = await fetch("/api/auth/me", { credentials: "same-origin" });
  } catch (error) {
    console.error("JalSaathi account could not be verified:", error);
    document.querySelectorAll("[data-user-name]").forEach((node) => { node.textContent = "Unavailable"; });
    return;
  }
  if (profileResponse.status === 401) {
    window.location.replace("/static/auth.html?view=login");
    return;
  }
  if (!profileResponse.ok) {
    document.querySelectorAll("[data-user-name]").forEach((node) => { node.textContent = "Unavailable"; });
    return;
  }

  const profile = await profileResponse.json();
  window.JalSaathiProfile.setCurrentProfile(profile);

  const fieldsNode = document.querySelector("[data-dashboard-fields]");
  const countNode = document.querySelector("[data-dashboard-field-count]");
  const mapPlots = document.querySelector("[data-field-map-plots]");
  const mapEmpty = document.querySelector("[data-field-map-empty]");
  let dashboardFields = [];
  let dashboardCrops = [];
  let recordLoadError = "";
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
  const renderFieldMap = (fields) => {
    if (!(mapPlots instanceof HTMLElement) || !(mapEmpty instanceof HTMLElement)) return;
    const colors = ["green", "yellow", "red"];
    mapPlots.innerHTML = fields.slice(0, 3).map((field, index) => `<div class="field-shape field-shape--${colors[index]}">
      <span class="field-name" data-user-content>${escapeHtml(field.name)}</span>
      <span class="field-crop" data-user-content data-i18n-crop>${escapeHtml(field.crop || "Crop not set")}</span>
    </div>`).join("");
    mapEmpty.hidden = fields.length !== 0;
    if (fields.length > 3) {
      mapPlots.insertAdjacentHTML("beforeend", `<span class="field-map-overflow">+${fields.length - 3} more saved fields</span>`);
    }
  };
  const renderDashboardFields = (fields) => {
    dashboardFields = window.JalSaathiFieldNumbering.withDisplayNumbers(fields);
    countNode.textContent = `${dashboardFields.length} saved ${dashboardFields.length === 1 ? "field" : "fields"}`;
    renderFieldMap(dashboardFields);
    fieldsNode.classList.toggle("is-empty", dashboardFields.length === 0);
    fieldsNode.innerHTML = dashboardFields.length ? dashboardFields.map((field) => `<div class="field-item">
      <button class="field-select-button" type="button" data-field-select="${escapeHtml(field.id)}" aria-pressed="false" aria-label="Select Field ${field.displayNumber}, ${escapeHtml(field.name)} in irrigation recommendation">
        <span class="field-thumb field-thumb--green" aria-hidden="true"></span>
        <span class="field-meta">
          <span class="field-row"><span class="field-label">Field ${field.displayNumber}: <span data-user-content>${escapeHtml(field.name)}</span></span><span class="status-pill">No sensor data</span></span>
          <span class="field-details">
            <span class="detail"><span class="detail-label">Crop</span><strong data-user-content data-i18n-crop>${escapeHtml(field.crop || "Not set")}</strong></span>
            <span class="detail"><span class="detail-label">Area</span><strong data-user-content>${escapeHtml(field.area)} ${escapeHtml(field.area_unit)}</strong></span>
          </span>
        </span>
      </button>
      <a class="arrow-btn" href="/static/sections.html?view=fields" aria-label="Open ${escapeHtml(field.name)}">→</a>
    </div>`).join("") : '<p>No fields saved yet. <a href="/static/sections.html?view=fields">Add your first field</a>.</p>';
  };

  const mapScene = document.querySelector("[data-field-map-scene]");
  const map = document.querySelector("[data-field-map]");
  if (mapScene instanceof HTMLElement && map instanceof HTMLElement) {
    let zoom = 1;
    const renderMapTransform = () => {
      mapScene.style.setProperty("--map-zoom", String(zoom));
      map.classList.toggle("is-3d", map.dataset.view === "3d");
    };
    map.querySelectorAll("[data-map-zoom]").forEach((control) => {
      control.addEventListener("click", () => {
        zoom = Math.min(1.35, Math.max(0.85, zoom + (control.dataset.mapZoom === "in" ? 0.1 : -0.1)));
        renderMapTransform();
      });
    });
    map.querySelectorAll("[data-map-view]").forEach((control) => {
      control.addEventListener("click", () => {
        map.dataset.view = control.dataset.mapView;
        map.querySelectorAll("[data-map-view]").forEach((button) => {
          const selected = button === control;
          button.classList.toggle("selected", selected);
          button.setAttribute("aria-pressed", String(selected));
        });
        renderMapTransform();
      });
    });
  }
  if (fieldsNode instanceof HTMLElement && countNode instanceof HTMLElement) {
    try {
      const [fieldsResponse, cropsResponse] = await Promise.all([
        fetch("/api/fields", { credentials: "same-origin" }),
        fetch("/api/crops", { credentials: "same-origin" }),
      ]);
      if (!fieldsResponse.ok || !cropsResponse.ok) throw new Error("Your field and crop records could not be loaded.");
      const [fields, crops] = await Promise.all([fieldsResponse.json(), cropsResponse.json()]);
      if (!Array.isArray(fields) || !Array.isArray(crops)) throw new Error("The field or crop response has an invalid format.");
      dashboardCrops = crops;
      renderDashboardFields(fields);
    } catch (error) {
      fieldsNode.textContent = error instanceof Error ? error.message : "Your fields could not be loaded.";
      fieldsNode.classList.remove("is-empty");
      countNode.textContent = "Account fields unavailable";
      recordLoadError = fieldsNode.textContent;
      renderFieldMap([]);
    }
  }
  const fieldCarouselCleanups = new WeakMap();
  initializeFieldCarousel(dashboardFields, dashboardCrops, recordLoadError);
  initializeSeasonTracking(dashboardCrops, recordLoadError);

  const weatherCard = document.querySelector(".weather-card");
  if (weatherCard instanceof HTMLElement) window.JalSaathiWeather?.initializeDashboard(weatherCard);

  function initializeFieldCarousel(fields, crops, unavailableMessage = "") {
    const root = document.querySelector("[data-field-carousel]");
    const card = root?.closest(".recommendation-card");
    const track = root?.querySelector("[data-field-track]");
    const controls = card?.querySelector("[data-field-carousel-controls]");
    const pagination = root?.querySelector("[data-field-pagination]");
    const indicator = card?.querySelector("[data-field-indicator]");
    const dots = root?.querySelector("[data-field-dots]");
    const initialSlide = track?.querySelector("[data-field-slide]");
    const previous = card?.querySelector("[data-field-previous]");
    const next = card?.querySelector("[data-field-next]");
    if (!(root instanceof HTMLElement) || !(track instanceof HTMLElement) ||
        !(card instanceof HTMLElement) ||
        !(initialSlide instanceof HTMLElement) || !(controls instanceof HTMLElement) ||
        !(pagination instanceof HTMLElement) ||
        !(indicator instanceof HTMLElement) || !(dots instanceof HTMLElement)) return;

    fieldCarouselCleanups.get(root)?.();
    const abortController = new AbortController();
    const { signal } = abortController;
    let index = 0;
    let timer = 0;
    let paused = false;
    let disposed = false;
    let fieldsUnavailable = Boolean(unavailableMessage);
    let currentFields = Array.isArray(fields) ? fields : [];
    let currentCrops = Array.isArray(crops) ? crops : [];
    let slides = [];
    let dotButtons = [];
    const fieldWeather = new Map();
    const model1Recommendation = window.JalSaathiModel1Recommendation?.createRenderer();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const slideTemplate = initialSlide.cloneNode(true);
    const fieldCoordinateKey = (field) => {
      const { latitude, longitude } = field || {};
      if (typeof latitude !== "number" || !Number.isFinite(latitude) ||
          latitude < -90 || latitude > 90 ||
          typeof longitude !== "number" || !Number.isFinite(longitude) ||
          longitude < -180 || longitude > 180) return null;
      return `${latitude},${longitude}`;
    };
    const loadFieldWeather = (field) => {
      const coordinatesKey = fieldCoordinateKey(field);
      if (!coordinatesKey) return;
      const id = String(field.id);
      const existing = fieldWeather.get(id);
      if (existing?.coordinatesKey === coordinatesKey &&
          (existing.status === "pending" ||
            (existing.status === "loaded" && Date.now() < existing.expiresAt) ||
            (existing.status === "unavailable" && Date.now() < existing.retryAt))) return;

      const state = {
        coordinatesKey,
        status: "pending",
        expiresAt: 0,
        failures: existing?.coordinatesKey === coordinatesKey ? existing.failures : 0,
      };
      fieldWeather.set(id, state);
      const request = window.JalSaathiWeather?.loadCurrent({
        coordinates: {
          latitude: field.latitude,
          longitude: field.longitude,
        },
      });
      if (!request) {
        state.status = "unavailable";
        state.retryAt = Date.now() + 30_000;
        return;
      }
      const markUnavailable = () => {
        state.status = "unavailable";
        state.failures += 1;
        state.retryAt = Date.now() + Math.min(60_000, 5_000 * (2 ** (state.failures - 1)));
      };
      void request.then(({ current }) => {
        if (fieldWeather.get(id) !== state) return;
        const observedAt = Date.parse(current?.observation_time);
        const age = Date.now() - observedAt;
        const temperature = Number(current?.temperature_c);
        if (current?.is_stale !== false || !Number.isFinite(observedAt) ||
            age < -60 * 1000 || age >= 15 * 60 * 1000 ||
            !Number.isFinite(temperature)) {
          markUnavailable();
        } else {
          state.status = "loaded";
          state.condition = window.JalSaathiWeather.formatCurrentCondition(current.weather_code);
          state.temperature = window.JalSaathiWeather.formatCurrentTemperature(temperature);
          state.expiresAt = Date.now() + Math.min(
            10 * 60 * 1000,
            Math.max(0, 15 * 60 * 1000 - age),
          );
        }
        if (String(currentFields[index]?.id) === id &&
            fieldCoordinateKey(currentFields[index]) === coordinatesKey) {
          const weather = slides[index]?.querySelector("[data-recommendation-weather]");
          if (weather instanceof HTMLElement) {
            weather.textContent = state.status === "loaded"
              ? `${state.condition} · ${state.temperature}`
              : "Unavailable";
          }
        }
      }).catch((error) => {
        if (fieldWeather.get(id) !== state) return;
        markUnavailable();
        console.warn("Field-specific dashboard weather is unavailable.", error);
        if (String(currentFields[index]?.id) === id) {
          const weather = slides[index]?.querySelector("[data-recommendation-weather]");
          if (weather instanceof HTMLElement) weather.textContent = "Unavailable";
        }
      });
    };

    const renderSlide = (slide, field) => {
      const name = slide.querySelector("[data-recommendation-name]");
      const crop = slide.querySelector("[data-recommendation-crop]");
      const cropDetails = slide.querySelector("[data-recommendation-crop-details]");
      const thumbnail = slide.querySelector("[data-recommendation-thumbnail]");
      const area = slide.querySelector("[data-recommendation-area]");
      const moisture = slide.querySelector("[data-recommendation-moisture]");
      const weather = slide.querySelector("[data-recommendation-weather]");
      const status = slide.querySelector("[data-recommendation-status]");
      if (!(name instanceof HTMLElement) || !(crop instanceof HTMLElement) ||
          !(cropDetails instanceof HTMLElement) ||
          !(thumbnail instanceof HTMLElement) || !(area instanceof HTMLElement) ||
          !(moisture instanceof HTMLElement) || !(weather instanceof HTMLElement) ||
          !(status instanceof HTMLElement)) return;

      if (!field) {
        name.textContent = fieldsUnavailable ? "Field records unavailable" : "No saved fields";
        crop.textContent = "";
        cropDetails.textContent = "";
        cropDetails.hidden = true;
        area.textContent = "Unavailable";
        moisture.textContent = "Not connected";
        weather.textContent = "Unavailable";
        thumbnail.style.backgroundImage = "";
        status.replaceChildren();
        const message = document.createElement("p");
        message.textContent = fieldsUnavailable
          ? unavailableMessage || "Your saved fields could not be loaded."
          : "Add a field to see its details and irrigation status.";
        status.append(message);
        if (!fieldsUnavailable) {
          const addLink = document.createElement("a");
          addLink.href = "/static/sections.html?view=fields";
          addLink.textContent = "Add Field";
          status.append(addLink);
        }
        return;
      }

      const fieldName = typeof field.name === "string" && field.name.trim()
        ? field.name.trim()
        : "Unnamed field";
      name.textContent = `Field ${field.displayNumber}: ${fieldName}`;
      const fieldCrops = currentCrops.filter((entry) => String(entry.field_id) === String(field.id));
      const cropLabels = fieldCrops.map((entry) => [entry.name, entry.variety].filter(Boolean).join(" · "));
      const cropName = cropLabels.join(", ") || field.crop || "Not recorded";
      const location = typeof field.location === "string" && field.location.trim()
        ? ` · ${field.location.trim()}`
        : "";
      crop.replaceChildren();
      const cropLabel = document.createElement("span");
      cropLabel.textContent = "Crop: ";
      cropLabel.setAttribute("data-i18n-key", "fields.cropLabel");
      const cropValue = document.createElement("span");
      cropValue.textContent = cropName;
      cropValue.setAttribute("data-user-content", "");
      cropValue.setAttribute("data-i18n-crop", "");
      crop.append(cropLabel, cropValue);
      if (location) {
        const locationValue = document.createElement("span");
        locationValue.textContent = location;
        locationValue.setAttribute("data-user-content", "");
        crop.append(locationValue);
      }
      const cropRecords = fieldCrops.map((entry) => {
        const details = [];
        if (typeof entry.planting_date === "string" && entry.planting_date.trim()) {
          details.push(`Planting: ${entry.planting_date.trim()}`);
        }
        if (typeof entry.expected_harvest_date === "string" && entry.expected_harvest_date.trim()) {
          details.push(`Expected harvest: ${entry.expected_harvest_date.trim()}`);
        }
        if (typeof entry.growth_stage === "string" && entry.growth_stage.trim()) {
          details.push(`Growth stage: ${entry.growth_stage.trim()}`);
        }
        return details.length ? `${entry.name || "Crop"} · ${details.join(" · ")}` : "";
      }).filter(Boolean);
      cropDetails.textContent = cropRecords.join(" | ");
      cropDetails.hidden = cropRecords.length === 0;
      area.textContent = field.area !== null && field.area !== undefined && field.area !== ""
        ? `${Number.isFinite(Number(field.area)) ? Number(field.area).toLocaleString(undefined, { maximumFractionDigits: 2 }) : field.area}${field.area_unit ? ` ${field.area_unit}` : ""}`
        : "Unavailable";
      moisture.textContent = "Not connected";
      const weatherState = fieldWeather.get(String(field.id));
      weather.textContent = weatherState?.coordinatesKey === fieldCoordinateKey(field)
        ? weatherState.status === "pending"
          ? "Loading…"
          : weatherState.status === "loaded"
            ? `${weatherState.condition} · ${weatherState.temperature}`
            : "Unavailable"
        : "Unavailable";
      const normalizedCrop = typeof cropName === "string" ? cropName.toLowerCase() : "";
      const image = normalizedCrop.includes("rice") || normalizedCrop.includes("paddy")
        ? "field-rice.jpg"
        : normalizedCrop.includes("ragi") || normalizedCrop.includes("finger millet")
          ? "field-ragi.jpg"
          : normalizedCrop.includes("sugarcane")
            ? "field-sugarcane.jpg"
            : "";
      thumbnail.style.backgroundImage = image ? `url("/static/images/${image}")` : "";
      status.replaceChildren();
      const infoIcon = document.createElement("span");
      infoIcon.className = "recommendation-info-icon";
      infoIcon.setAttribute("aria-hidden", "true");
      infoIcon.textContent = "i";
      const message = document.createElement("div");
      const heading = document.createElement("strong");
      heading.textContent = "Checking Model 1 availability";
      const explanation = document.createElement("p");
      explanation.textContent = "Checking for recent, field-specific inputs from the Experimental Model Lab.";
      message.append(heading, explanation);
      status.append(infoIcon, message);
    };

    const render = () => {
      slides = currentFields.length
        ? currentFields.map(() => slideTemplate.cloneNode(true))
        : [slideTemplate.cloneNode(true)];
      track.replaceChildren(...slides);
      slides.forEach((slide, slideIndex) => {
        slide.style.flexBasis = `${100 / slides.length}%`;
        renderSlide(slide, currentFields[slideIndex]);
      });
      track.style.width = `${slides.length * 100}%`;
      controls.hidden = currentFields.length < 2;
      pagination.hidden = currentFields.length < 2;
      dots.replaceChildren();
      dotButtons = currentFields.map((field, dotIndex) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "carousel-dot";
        dot.setAttribute("aria-label", `Show Field ${field.displayNumber}: ${field.name || "unnamed"}`);
        dot.addEventListener("click", () => show(dotIndex, true), { signal });
        dots.append(dot);
        return dot;
      });
      index = currentFields.length ? index % currentFields.length : 0;
      track.style.transform = `translateX(-${index * 100 / slides.length}%)`;
      slides.forEach((slide, slideIndex) => {
        const active = slideIndex === index;
        slide.setAttribute("aria-hidden", String(!active));
        slide.inert = !active;
      });
      dotButtons.forEach((dot, dotIndex) => {
        const active = dotIndex === index;
        dot.classList.toggle("active", active);
        dot.setAttribute("aria-pressed", String(active));
      });
      fieldsNode?.querySelectorAll("[data-field-select]").forEach((button) => {
        const selected = String(button.dataset.fieldSelect) === String(currentFields[index]?.id);
        button.setAttribute("aria-pressed", String(selected));
        button.closest(".field-item")?.classList.toggle("is-selected", selected);
      });
      indicator.textContent = currentFields.length ? `${index + 1} / ${currentFields.length}` : "";
      if (model1Recommendation) {
        const activeStatus = slides[index]?.querySelector("[data-recommendation-status]");
        if (activeStatus instanceof HTMLElement && currentFields[index]) {
          void model1Recommendation.update(
            activeStatus,
            currentFields[index],
            currentCrops,
            window.JalSaathiProfile?.apiRequest,
          );
        } else {
          model1Recommendation.cancel();
        }
      }
      if (currentFields[index]) loadFieldWeather(currentFields[index]);
    };

    const clearTimer = () => {
      if (timer) window.clearInterval(timer);
      timer = 0;
    };
    const startTimer = () => {
      clearTimer();
      if (!disposed && !paused && !reducedMotion.matches &&
          document.visibilityState === "visible" && currentFields.length > 1) {
        timer = window.setInterval(() => show(index + 1), 5000);
      }
    };
    const show = (nextIndex, manual = false) => {
      if (!currentFields.length) return;
      index = (nextIndex + currentFields.length) % currentFields.length;
      render();
      if (manual) startTimer();
    };
    const pause = () => {
      paused = true;
      clearTimer();
    };
    const resume = () => {
      paused = card.matches(":hover") || card.matches(":focus-within") ||
        document.visibilityState !== "visible";
      if (paused) clearTimer();
      else startTimer();
    };
    previous?.addEventListener("click", () => show(index - 1, true), { signal });
    next?.addEventListener("click", () => show(index + 1, true), { signal });
    fieldsNode?.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("[data-field-select]");
      if (!(button instanceof HTMLButtonElement)) return;
      const selectedIndex = currentFields.findIndex(
        (field) => String(field.id) === button.dataset.fieldSelect,
      );
      if (selectedIndex >= 0) show(selectedIndex, true);
    }, { signal });
    root.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        show(index - 1, true);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        show(index + 1, true);
      }
    }, { signal });
    card.addEventListener("mouseenter", pause, { signal });
    card.addEventListener("mouseleave", resume, { signal });
    card.addEventListener("focusin", pause, { signal });
    card.addEventListener("focusout", (event) => {
      if (!card.contains(event.relatedTarget)) resume();
    }, { signal });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") pause();
      else resume();
    }, { signal });
    reducedMotion.addEventListener("change", startTimer, { signal });
    let refreshSequence = 0;
    const refreshSavedFields = async () => {
      const sequence = ++refreshSequence;
      try {
        const [fieldResponse, cropResponse] = await Promise.all([
          fetch("/api/fields", { credentials: "same-origin" }),
          fetch("/api/crops", { credentials: "same-origin" }),
        ]);
        if (!fieldResponse.ok || !cropResponse.ok) {
          throw new Error("Saved fields could not be refreshed.");
        }
        const [nextFields, nextCrops] = await Promise.all([fieldResponse.json(), cropResponse.json()]);
        if (sequence !== refreshSequence || disposed) return;
        if (!Array.isArray(nextFields) || !Array.isArray(nextCrops)) {
          throw new Error("The refreshed field or crop response has an invalid format.");
        }
        const selectedId = currentFields[index]?.id;
        renderDashboardFields(nextFields);
        currentFields = dashboardFields;
        currentCrops = nextCrops;
        model1Recommendation?.reconcile(currentFields);
        const currentFieldStates = new Map(
          currentFields.map((field) => [String(field.id), fieldCoordinateKey(field)]),
        );
        for (const [id, state] of fieldWeather) {
          if (currentFieldStates.get(id) !== state.coordinatesKey) fieldWeather.delete(id);
        }
        fieldsUnavailable = false;
        const selectedIndex = currentFields.findIndex((field) => String(field.id) === String(selectedId));
        index = selectedIndex >= 0 ? selectedIndex : 0;
        render();
        startTimer();
      } catch (error) {
        console.error("JalSaathi saved field carousel could not refresh:", error);
      }
    };
    window.addEventListener("jalsaathi:fields-changed", refreshSavedFields, { signal });
    window.addEventListener("focus", refreshSavedFields, { signal });
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      clearTimer();
      model1Recommendation?.cancel();
      abortController.abort();
      removalObserver.disconnect();
      fieldCarouselCleanups.delete(root);
    };
    const removalObserver = new MutationObserver(() => {
      if (!root.isConnected) cleanup();
    });
    removalObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("pagehide", cleanup, { once: true, signal });
    fieldCarouselCleanups.set(root, cleanup);
    render();
    startTimer();
  }

  function initializeSeasonTracking(crops, unavailableMessage = "") {
    const root = document.querySelector("[data-season-tracking]");
    if (!(root instanceof HTMLElement)) return;
    root.replaceChildren();
    if (!crops.length) {
      const empty = document.createElement("p");
      empty.className = "season-empty";
      empty.textContent = unavailableMessage || "Season information unavailable";
      if (!unavailableMessage) empty.setAttribute("data-i18n-key", "season.unavailable");
      root.append(empty);
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const parseDate = (value) => {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const date = new Date(`${value}T00:00:00`);
      return Number.isNaN(date.getTime())
        || date.getFullYear() !== Number(value.slice(0, 4))
        || date.getMonth() !== Number(value.slice(5, 7)) - 1
        || date.getDate() !== Number(value.slice(8, 10))
        ? null
        : date;
    };
    const cropsByName = new Map();
    const estimates = [];
    const recordedRanges = [];
    crops.forEach((entry) => {
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      if (name && !cropsByName.has(name.toLocaleLowerCase())) {
        cropsByName.set(name.toLocaleLowerCase(), name);
      }
      const planting = parseDate(entry.planting_date);
      const harvest = parseDate(entry.expected_harvest_date);
      if (!planting || !harvest || harvest <= planting) return;
      recordedRanges.push({ planting, harvest });
      if (today < planting) return;
      const elapsedDays = Math.floor((today - planting) / 86_400_000);
      const plannedDays = Math.floor((harvest - planting) / 86_400_000);
      estimates.push(Math.max(0, Math.min(100, Math.round((elapsedDays / plannedDays) * 100))));
    });

    const overview = document.createElement("div");
    overview.className = "season-overview";
    const seasonInfo = document.createElement("div");
    seasonInfo.className = "season-overview-info";
    const seasonName = document.createElement("strong");
    seasonName.className = "season-name";
    seasonName.textContent = "Season information unavailable";
    seasonName.setAttribute("data-i18n-key", "season.unavailable");
    const seasonNote = document.createElement("span");
    seasonNote.className = "season-range";
    seasonNote.textContent = "No regional crop calendar is configured.";
    seasonNote.setAttribute("data-i18n-key", "season.noRegionalCalendar");
    const dateRange = document.createElement("span");
    dateRange.className = "season-recorded-range";
    if (recordedRanges.length) {
      const earliest = new Date(Math.min(...recordedRanges.map(({ planting }) => planting.getTime())));
      const latest = new Date(Math.max(...recordedRanges.map(({ harvest }) => harvest.getTime())));
      const formatDate = (date) => new Intl.DateTimeFormat(undefined, {
        month: "short",
        year: "numeric",
      }).format(date);
      const dateLabel = document.createElement("span");
      dateLabel.textContent = "Recorded crop dates";
      dateLabel.setAttribute("data-i18n-key", "season.recordedCropDates");
      const dateValues = document.createElement("span");
      dateValues.textContent = ` · ${formatDate(earliest)} – ${formatDate(latest)}`;
      dateValues.setAttribute("data-i18n-ignore", "");
      dateRange.append(dateLabel, dateValues);
    } else {
      dateRange.textContent = "No crop date range recorded";
    }
    seasonInfo.append(seasonName, seasonNote, dateRange);

    const cropSummary = document.createElement("div");
    cropSummary.className = "season-overview-crops";
    const cropsLabel = document.createElement("span");
    cropsLabel.className = "season-summary-label";
    cropsLabel.textContent = "Primary crops";
    cropsLabel.setAttribute("data-i18n-key", "season.primaryCrops");
    const cropNames = document.createElement("p");
    cropNames.className = "season-primary-crops";
    const allCropNames = [...cropsByName.values()];
    const visibleCropNames = allCropNames.slice(0, 3);
    if (allCropNames.length > visibleCropNames.length) {
      visibleCropNames.push(`+${allCropNames.length - visibleCropNames.length} more`);
    }
    if (visibleCropNames.length) {
      visibleCropNames.forEach((name, index) => {
        if (index) cropNames.append(document.createTextNode(", "));
        const cropName = document.createElement("span");
        cropName.textContent = name;
        cropName.setAttribute("data-user-content", "");
        cropName.setAttribute("data-i18n-crop", "");
        cropNames.append(cropName);
      });
    } else {
      cropNames.textContent = "Crop names unavailable";
    }
    cropSummary.append(cropsLabel, cropNames);

    const progressSummary = document.createElement("div");
    progressSummary.className = "season-overview-progress";
    const progressHeading = document.createElement("div");
    progressHeading.className = "season-progress-heading";
    const progressLabel = document.createElement("span");
    progressLabel.className = "season-summary-label";
    progressLabel.textContent = estimates.length ? "Estimated date progress" : "Progress unavailable";
    if (estimates.length) {
      progressLabel.setAttribute("data-i18n-key", "season.estimatedDateProgress");
    }
    const progressValue = document.createElement("strong");
    progressHeading.append(progressLabel, progressValue);
    progressSummary.append(progressHeading);
    if (estimates.length) {
      const averageProgress = Math.round(estimates.reduce((total, value) => total + value, 0) / estimates.length);
      progressValue.textContent = `${averageProgress}%`;
      const track = document.createElement("div");
      track.className = "season-progress-track";
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-label", "Average recorded crop date progress estimate");
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", String(averageProgress));
      const fill = document.createElement("span");
      fill.style.width = `${averageProgress}%`;
      track.append(fill);
      progressSummary.append(track);
    } else {
      const note = document.createElement("span");
      note.className = "season-progress-note";
      note.textContent = "Add valid planting and harvest dates.";
      progressSummary.append(note);
    }

    const seasonDetails = document.createElement("div");
    seasonDetails.className = "season-overview-details";
    seasonDetails.append(cropSummary, progressSummary);
    overview.append(seasonInfo, seasonDetails);
    root.append(overview);
  }
});
