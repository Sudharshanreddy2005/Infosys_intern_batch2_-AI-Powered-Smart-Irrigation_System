(() => {
  "use strict";

  const modelNames = ["model1", "model2", "model3", "model4"];
  const numericModel4Fields = new Set([
    "bulk_density", "organic_matter_pct", "cation_exchange_capacity",
    "salinity_ec", "buffering_capacity", "soil_moisture_pct",
    "moisture_limit_dry", "moisture_limit_wet", "soil_temp_c", "air_temp_c",
    "light_intensity_par", "soil_ph", "nitrogen_ppm", "phosphorus_ppm",
    "potassium_ppm",
  ]);
  const model3Zone4Fields = [
    "weather_temp", "weather_humidity", "weather_rain", "weather_pressure",
    "weather_wind_speed", "weather_radiation", "soil_temperature_0_7cm",
    "soil_temperature_7_18cm", "month", "day", "hour", "day_period", "quarter",
  ];

  const displayTime = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
  };

  const finiteNumber = (value) =>
    typeof value === "number" && Number.isFinite(value);

  const initialize = async (root) => {
    const dashboard = root.querySelector("[data-ai-dashboard-loading]");
    if (!(dashboard instanceof HTMLElement)) return;

    try {
      const response = await fetch("/static/ai-model-dashboard.html", {
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(`The AI predictions page could not be loaded (${response.status}).`);
      }
      const markup = await response.text();
      dashboard.outerHTML = markup;
      const page = root.querySelector("[data-ai-dashboard]");
      if (!(page instanceof HTMLElement)) throw new Error("The AI predictions page markup is invalid.");
      await initializeDashboard(page);
    } catch (error) {
      console.error("AI Model Predictions could not be initialized:", error);
      const visibleContent = root.querySelector("[data-ai-dashboard]") || dashboard;
      visibleContent.textContent = error instanceof Error
        ? `${error.message} Reload the page to try again.`
        : "AI Model Predictions could not be loaded. Reload the page to try again.";
    }
  };

  const initializeDashboard = async (page) => {
    const fieldSelect = page.querySelector("[data-ai-field]");
    const zoneSelect = page.querySelector("[data-ai-zone]");
    const cropPicker = page.querySelector("[data-ai-crop-picker]");
    const cropSelect = page.querySelector("[data-ai-crop-record]");
    const refreshButton = page.querySelector("[data-ai-refresh]");
    const model3Form = page.querySelector("[data-ai-model3-form]");
    const model4Form = page.querySelector("[data-ai-model4-form]");
    const zone4Inputs = page.querySelector("[data-ai-zone4-inputs]");
    if (
      !(fieldSelect instanceof HTMLSelectElement) ||
      !(zoneSelect instanceof HTMLSelectElement) ||
      !(cropPicker instanceof HTMLElement) ||
      !(cropSelect instanceof HTMLSelectElement) ||
      !(refreshButton instanceof HTMLButtonElement) ||
      !(model3Form instanceof HTMLFormElement) ||
      !(model4Form instanceof HTMLFormElement) ||
      !(zone4Inputs instanceof HTMLElement)
    ) return;

    const api = window.JalSaathiProfile;
    if (!api || typeof api.apiRequest !== "function") {
      throw new Error("The authenticated JalSaathi API helper is unavailable.");
    }
    const topbar = document.querySelector(".portal-topbar");
    const topbarContext = document.querySelector("[data-ai-topbar-context]");
    if (topbar instanceof HTMLElement && topbarContext instanceof HTMLElement) {
      topbar.classList.add("ai-dashboard-topbar");
      topbarContext.hidden = false;
      text(topbarContext, "[data-ai-topbar-farmer]", api.getDisplayName?.() || "Farmer");
    }

    let fields;
    let crops = [];
    try {
      fields = await window.JalSaathiFieldStore.loadServerFields();
    } catch (error) {
      setInitialError(page, error);
      return;
    }
    try {
      const response = await api.apiRequest("/api/crops");
      if (!Array.isArray(response)) throw new Error("The crop response has an invalid format.");
      crops = response;
    } catch (error) {
      console.error("Saved crop records are unavailable for AI predictions:", error);
    }

    text(page, "[data-ai-total-models]", String(modelNames.length));
    fieldSelect.replaceChildren();
    fields.forEach((field) => {
      const option = document.createElement("option");
      option.value = String(field.id);
      option.textContent = field.name;
      fieldSelect.append(option);
    });
    if (fields.length === 0) {
      fieldSelect.replaceChildren(new Option("No saved fields available", ""));
      setModelState(page, "model1", "input", "Add a saved field with coordinates to request a field-weather prediction.");
      setModelState(page, "model2", "input", "Add a saved field and associated crop record to check Model 2.");
      return;
    }

    const states = Object.fromEntries(modelNames.map((name) => [name, { status: "input" }]));
    let requestGeneration = 0;
    let lastSuccessfulAt = null;
    fieldSelect.value = String(fields[0].id);

    const selectedField = () => fields.find((field) => String(field.id) === fieldSelect.value) || null;
    const associatedCrops = () => crops.filter((crop) => String(crop.field_id) === fieldSelect.value);
    const selectedCrop = () => {
      const matches = associatedCrops();
      return matches.find((crop) => String(crop.id) === cropSelect.value) || matches[0] || null;
    };

    const syncCropOptions = () => {
      const matches = associatedCrops();
      cropPicker.hidden = matches.length <= 1;
      cropSelect.replaceChildren();
      matches.forEach((crop) => {
        const option = document.createElement("option");
        option.value = String(crop.id);
        option.textContent = crop.name;
        cropSelect.append(option);
      });
      if (matches.length) cropSelect.value = String(matches[0].id);
    };

    const updateFieldDetails = () => {
      const field = selectedField();
      const crop = selectedCrop();
      const cropName = crop?.name || field?.crop || "";
      text(topbarContext || page, "[data-ai-topbar-location]", field?.location ? `Field: ${field.location}` : "Location unavailable");
      text(page, "[data-ai-crop]", crop?.name || field?.crop || "Crop not recorded");
      text(page, "[data-ai-zone-value]", zoneSelect.value ? `Zone ${zoneSelect.value}` : "Select zone");
      text(page, "[data-ai-area]", field ? `${field.area} ${field.areaUnit}` : "Not selected");
      text(page, "[data-ai-model2-crop]", crop?.name || field?.crop || "Not recorded");
      text(page, "[data-ai-growth-stage]", crop?.growth_stage || "Not recorded");
      text(page, "[data-ai-model2-area]", field ? `${field.area} ${field.areaUnit}` : "—");
      text(page, "[data-ai-field-name]", field?.name || "—");
      text(page, "[data-ai-zone-meta]", zoneSelect.value ? `Zone ${zoneSelect.value}` : "—");
      text(page, "[data-ai-model3-field]", field ? `${field.name} · ${zoneSelect.value ? `Zone ${zoneSelect.value}` : "Zone not selected"}` : "—");
      text(page, "[data-ai-model4-crop]", cropName || "Not recorded");
      text(page, "[data-ai-model4-field]", field ? String(field.id) : "—");
      text(page, "[data-ai-model4-zone]", zoneSelect.value || "—");
      const cropType = model4Form.elements.namedItem("crop_type");
      const fieldId = model4Form.elements.namedItem("field_id");
      const model4Zone = model4Form.elements.namedItem("zone");
      if (cropType instanceof HTMLInputElement) cropType.value = cropName;
      if (fieldId instanceof HTMLInputElement) fieldId.value = field ? String(field.id) : "";
      if (model4Zone instanceof HTMLInputElement) model4Zone.value = zoneSelect.value;
      const model3FieldId = model3Form.elements.namedItem("field_id");
      const model3Zone = model3Form.elements.namedItem("zone");
      if (model3FieldId instanceof HTMLInputElement) model3FieldId.value = field ? String(field.id) : "";
      if (model3Zone instanceof HTMLInputElement) model3Zone.value = zoneSelect.value;
      zone4Inputs.hidden = zoneSelect.value !== "4";
    };

    const clearObservationInputs = () => {
      model3Form.querySelectorAll("input").forEach((input) => {
        if (input.name !== "field_id" && input.name !== "zone") input.value = "";
      });
      model4Form.querySelectorAll("input").forEach((input) => {
        if (!["field_id", "crop_type", "zone"].includes(input.name)) input.value = "";
      });
    };

    const updateSummary = () => {
      const successful = Object.values(states).filter((state) => state.status === "success").length;
      const unavailable = Object.values(states).filter((state) => state.status === "unavailable").length;
      text(page, "[data-ai-success-count]", String(successful));
      text(page, "[data-ai-unavailable-count]", String(unavailable));
      text(page, "[data-ai-last-updated]", `Last updated: ${displayTime(lastSuccessfulAt)}`);
      text(page, "[data-ai-last-time]", lastSuccessfulAt
        ? new Date(lastSuccessfulAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "—");
    };

    const setState = (name, status, message) => {
      states[name] = { status };
      clearModelOutput(page, name);
      setModelState(page, name, status, message);
      updateSummary();
    };

    const setSuccess = (name, responseTime) => {
      states[name] = { status: "success" };
      lastSuccessfulAt = responseTime;
      setModelState(page, name, "success", null);
      updateSummary();
    };

    const loadFieldWeather = async (field, generation) => {
      const weatherNode = page.querySelector("[data-ai-weather]");
      if (!(weatherNode instanceof HTMLElement)) return;
      weatherNode.hidden = true;
      if (field?.latitude === null || field?.latitude === undefined ||
          field?.longitude === null || field?.longitude === undefined) {
        weatherNode.hidden = true;
        return;
      }
      try {
        const weather = await api.apiRequest("/weather/current", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: field.latitude, longitude: field.longitude }),
        });
        if (generation !== requestGeneration) return;
        text(page, "[data-ai-temperature]", finiteNumber(weather.temperature_c) ? `${weather.temperature_c} °C` : "Not returned");
        text(page, "[data-ai-humidity]", finiteNumber(weather.humidity_percent) ? `${weather.humidity_percent}%` : "Not returned");
        text(page, "[data-ai-rainfall]", finiteNumber(weather.rainfall_mm_per_hr) ? `${weather.rainfall_mm_per_hr} mm/hr` : "Not returned");
        text(topbarContext || page, "[data-ai-topbar-location]", weather.locality
          ? `Village: ${weather.locality}`
          : field.location ? `Field: ${field.location}` : "Location unavailable");
        text(topbarContext || page, "[data-ai-topbar-temperature]", finiteNumber(weather.temperature_c)
          ? `${weather.temperature_c} °C`
          : "Weather unavailable");
        text(topbarContext || page, "[data-ai-topbar-condition]", finiteNumber(weather.weather_code)
          ? `Weather code ${weather.weather_code}`
          : "Current field weather");
        weatherNode.hidden = false;
      } catch (error) {
        if (generation !== requestGeneration) return;
        weatherNode.hidden = true;
        console.warn("Field weather details could not be loaded for the prediction card:", error);
      }
    };

    const runModel1 = async (field, generation) => {
      if (!field || !Number.isSafeInteger(Number(field.id)) || Number(field.id) <= 0) {
        setState("model1", "input", "Select an account field with a valid numeric ID.");
        return;
      }
      setState("model1", "loading", "Requesting the current field-weather proxy prediction…");
      void loadFieldWeather(field, generation);
      try {
        const result = await api.apiRequest("/api/ml/reduced-weather-prediction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field_id: Number(field.id) }),
        });
        if (generation !== requestGeneration) return;
        if ((result.prediction !== 0 && result.prediction !== 1) ||
            !finiteNumber(result.proxy_positive_probability) ||
            typeof result.observation_time !== "string") {
          throw new Error("Model 1 returned an invalid response.");
        }
        const output = result.prediction === 1
          ? "Proxy indicates irrigation needed"
          : "Proxy indicates irrigation not needed";
        const probability = `${(result.proxy_positive_probability * 100).toFixed(1)}% model-estimated probability`;
        setTextContent(page.querySelector('[data-ai-result="model1"]'), `${output} · ${probability}. ${result.warning || ""}`);
        text(page, '[data-ai-timestamp="model1"]', `Prediction time: ${displayTime(result.observation_time)}`);
        setSuccess("model1", new Date().toISOString());
      } catch (error) {
        if (generation !== requestGeneration) return;
        setState("model1", "unavailable", errorMessage(error, "The field-weather prediction is unavailable."));
      }
    };

    const runModel2 = async (field, crop, generation) => {
      if (!field || !crop || !Number.isSafeInteger(Number(field.id)) || !Number.isSafeInteger(Number(crop.id))) {
        setState("model2", "input", "An account field and its associated saved crop record are required.");
        return;
      }
      setState("model2", "loading", "Checking the validated production Model 2 service…");
      try {
        const result = await api.apiRequest("/api/ml/water-requirement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            field_id: Number(field.id),
            crop_id: Number(crop.id),
            prediction_period_hours: 24,
          }),
        });
        if (generation !== requestGeneration) return;
        if (!finiteNumber(result.estimated_water_liters) ||
            result.estimated_water_liters < 0 ||
            result.prediction_period_hours !== 24 ||
            typeof result.unit !== "string") {
          throw new Error("The validated water-requirement API returned an invalid estimate.");
        }
        setTextContent(
          page.querySelector('[data-ai-result="model2"]'),
          `${result.estimated_water_liters.toLocaleString()} ${result.unit}`,
        );
        setTextContent(page.querySelector('[data-ai-timestamp="model2"]'), `Last checked: ${new Date().toLocaleString()}`);
        setSuccess("model2", new Date().toISOString());
      } catch (error) {
        if (generation !== requestGeneration) return;
        setState("model2", "unavailable", errorMessage(error, "The validated water-requirement model is unavailable. No estimate was generated."));
      }
    };

    const model3Payload = () => {
      const field = selectedField();
      const zone = Number(zoneSelect.value);
      if (!field || !Number.isSafeInteger(Number(field.id)) || !Number.isInteger(zone) || zone < 1 || zone > 5) return null;
      const formData = new FormData(model3Form);
      if (!String(formData.get("current_moisture_percent") || "").trim()) return null;
      const payload = {
        field_id: Number(field.id),
        zone,
        current_moisture_percent: Number(formData.get("current_moisture_percent")),
      };
      if (zone === 4) {
        for (const name of model3Zone4Fields) {
          const value = String(formData.get(name) || "").trim();
          if (!value) return null;
          payload[name] = Number(value);
        }
      }
      return payload;
    };

    const runModel3 = async (generation) => {
      const payload = model3Payload();
      if (!payload) {
        setState("model3", "input", zoneSelect.value === "4"
          ? "Enter the current moisture and all required Zone 4 weather and soil observations."
          : "Select a field and zone, then enter an actual current soil-moisture observation.");
        return;
      }
      setState("model3", "loading", "Running the selected zone's soil-moisture strategy…");
      try {
        const result = await api.apiRequest("/api/ml/soil-moisture-prediction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (generation !== requestGeneration) return;
        if (!finiteNumber(result.current_moisture_percent) ||
            !finiteNumber(result.predicted_moisture_24h_percent) ||
            result.predicted_moisture_24h_percent < 1 ||
            result.predicted_moisture_24h_percent > 100) {
          throw new Error("Model 3 returned an invalid soil-moisture value.");
        }
        const current = result.current_moisture_percent;
        const predicted = result.predicted_moisture_24h_percent;
        text(page, "[data-ai-current-moisture]", `${current}%`);
        text(page, "[data-ai-predicted-moisture]", `${predicted}%`);
        setBar(page.querySelector("[data-ai-current-bar]"), current);
        setBar(page.querySelector("[data-ai-predicted-bar]"), predicted);
        text(page, "[data-ai-horizon]", finiteNumber(result.prediction_horizon_hours)
          ? `${result.prediction_horizon_hours} hours`
          : "Not returned");
        text(page, "[data-ai-strategy]", result.strategy || "Not returned");
        setTextContent(
          page.querySelector('[data-ai-result="model3"]'),
          `Future moisture: ${predicted}%. Strategy: ${result.strategy || "not returned"}.${result.warning ? ` ${result.warning}` : ""}`,
        );
        text(page, '[data-ai-timestamp="model3"]', `Prediction time: ${displayTime(result.prediction_timestamp)}`);
        setSuccess("model3", result.prediction_timestamp || new Date().toISOString());
      } catch (error) {
        if (generation !== requestGeneration) return;
        setState("model3", "unavailable", errorMessage(error, "The soil-moisture prediction is unavailable."));
      }
    };

    const model4Payload = () => {
      const field = selectedField();
      const crop = selectedCrop();
      const zone = Number(zoneSelect.value);
      if (!field || !(crop?.name || field.crop) || !Number.isSafeInteger(Number(field.id)) || !Number.isInteger(zone) || zone < 1 || zone > 5) return null;
      const payload = {
        field_id: Number(field.id),
        crop_type: crop?.name || field.crop,
        zone,
      };
      for (const [name, value] of new FormData(model4Form).entries()) {
        if (name === "field_id" || name === "crop_type" || name === "zone") continue;
        const textValue = String(value).trim();
        if (!textValue) return null;
        payload[name] = numericModel4Fields.has(name) ? Number(textValue) : textValue;
      }
      return payload;
    };

    const runModel4 = async (generation) => {
      const payload = model4Payload();
      if (!payload) {
        setState("model4", "input", "Select a field, saved crop and zone, then enter all required soil and crop observations.");
        return;
      }
      setState("model4", "loading", "Running the crop-stress classifier…");
      try {
        const result = await api.apiRequest("/api/ml/crop-stress-prediction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (generation !== requestGeneration) return;
        if (!Number.isInteger(result.predicted_class) ||
            result.class_label_status !== "unverified" ||
            (result.class_probabilities !== null &&
              (typeof result.class_probabilities !== "object" || Array.isArray(result.class_probabilities)))) {
          throw new Error("Model 4 returned an invalid or unverifiable class response.");
        }
        text(page, "[data-ai-predicted-class]", `Class ${result.predicted_class}`);
        const confidence = finiteNumber(result.confidence)
          ? `${(result.confidence * 100).toFixed(1)}%`
          : "Not returned";
        text(page, "[data-ai-model4-probability]", confidence);
        text(page, "[data-ai-model4-time]", displayTime(result.prediction_timestamp));
        setTextContent(page.querySelector('[data-ai-result="model4"]'), `Predicted numeric class ${result.predicted_class}. Class semantics remain unverified.`);
        text(page, '[data-ai-timestamp="model4"]', `Prediction time: ${displayTime(result.prediction_timestamp)}`);
        setSuccess("model4", result.prediction_timestamp || new Date().toISOString());
      } catch (error) {
        if (generation !== requestGeneration) return;
        setState("model4", "unavailable", errorMessage(error, "The crop-stress prediction is unavailable."));
      }
    };

    const refresh = async ({ includeObservationModels = true } = {}) => {
      const field = selectedField();
      const crop = selectedCrop();
      const generation = ++requestGeneration;
      updateFieldDetails();
      refreshButton.disabled = true;
      refreshButton.setAttribute("aria-busy", "true");
      try {
        const tasks = [runModel1(field, generation), runModel2(field, crop, generation)];
        if (includeObservationModels) {
          tasks.push(runModel3(generation), runModel4(generation));
        }
        await Promise.allSettled(tasks);
      } finally {
        if (generation === requestGeneration) {
          refreshButton.disabled = false;
          refreshButton.removeAttribute("aria-busy");
        }
      }
    };

    syncCropOptions();
    updateFieldDetails();
    fieldSelect.addEventListener("change", () => {
      syncCropOptions();
      clearObservationInputs();
      updateFieldDetails();
      void refresh();
    });
    cropSelect.addEventListener("change", () => {
      clearObservationInputs();
      updateFieldDetails();
      void refresh();
    });
    zoneSelect.addEventListener("change", () => {
      clearObservationInputs();
      updateFieldDetails();
      void refresh();
    });
    refreshButton.addEventListener("click", () => { void refresh(); });
    model3Form.addEventListener("submit", (event) => {
      event.preventDefault();
    if (!model3Form.reportValidity()) return;
    const generation = ++requestGeneration;
    void runModel3(generation);
    });
    model4Form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!model4Form.reportValidity()) return;
    const generation = ++requestGeneration;
    void runModel4(generation);
    });
    void refresh({ includeObservationModels: false });
  };

  const text = (root, selector, value) => {
    const node = root.querySelector(selector);
    if (node) node.textContent = value;
  };

  const setTextContent = (node, value) => {
    if (node) node.textContent = value;
  };

  const setBar = (node, value) => {
    if (node instanceof HTMLElement) node.style.width = `${Math.max(0, Math.min(100, value))}%`;
  };

  const setInitialError = (page, error) => {
    const dashboard = page.querySelector("[data-ai-dashboard]");
    if (!dashboard) return;
    const message = document.createElement("p");
    message.className = "portal-empty-note";
    message.setAttribute("role", "alert");
    message.textContent = errorMessage(error, "Saved fields could not be loaded.");
    dashboard.replaceChildren(message);
  };

  const errorMessage = (error, fallback) => {
    const status = Number(error?.status);
    if (status === 503) return `Unavailable (HTTP 503): ${error.message || fallback}`;
    if (status === 422) return `Input or field data rejected (HTTP 422): ${error.message || fallback}`;
    return error instanceof Error ? error.message : fallback;
  };

  const setModelState = (page, name, status, message) => {
    const statusNode = page.querySelector(`[data-ai-status="${name}"]`);
    const resultNode = page.querySelector(`[data-ai-result="${name}"]`);
    if (statusNode) {
      statusNode.textContent = ({
        success: "Available",
        unavailable: "Unavailable",
        loading: "Loading",
        input: "Input required",
      })[status] || "Waiting";
      statusNode.dataset.state = status;
    }
    if (resultNode && message) {
      resultNode.textContent = message;
      resultNode.hidden = false;
    }
    if (name === "model4" && status === "success" && resultNode) resultNode.hidden = true;
  };

  const clearModelOutput = (page, name) => {
    const clear = (selector, value = "—") => text(page, selector, value);
    if (name === "model1") clear('[data-ai-timestamp="model1"]', "Prediction time: —");
    if (name === "model2") clear('[data-ai-timestamp="model2"]', "Last checked: —");
    if (name === "model3") {
      clear("[data-ai-current-moisture]");
      clear("[data-ai-predicted-moisture]");
      clear("[data-ai-horizon]");
      clear("[data-ai-strategy]");
      clear('[data-ai-timestamp="model3"]', "Prediction time: —");
      setBar(page.querySelector("[data-ai-current-bar]"), 0);
      setBar(page.querySelector("[data-ai-predicted-bar]"), 0);
    }
    if (name === "model4") {
      clear("[data-ai-predicted-class]");
      clear("[data-ai-model4-probability]");
      clear("[data-ai-model4-time]");
      clear('[data-ai-timestamp="model4"]', "Prediction time: —");
    }
  };

  window.JalSaathiAIDashboard = Object.freeze({ initialize });
})();
