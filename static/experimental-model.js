(function () {
  "use strict";

  const MODEL_FEATURES = [
    "temperature_c",
    "humidity_percent",
    "rain_probability_percent",
    "N",
    "P",
    "K",
    "ph",
    "organic_matter",
    "crop_density",
    "sunlight_exposure",
    "wind_speed",
    "frost_risk",
    "crop_name",
    "soil_type",
    "growth_stage",
  ];
  const WEATHER_FEATURES = [
    "temperature_c",
    "humidity_percent",
    "rain_probability_percent",
  ];
  const WEATHER_LABELS = {
    temperature_c: "Temperature (°C)",
    humidity_percent: "Humidity (%)",
    rain_probability_percent: "Rain probability (%)",
  };
  const NUMERIC_FEATURES = MODEL_FEATURES.filter((name) =>
    !["crop_name", "soil_type", "growth_stage"].includes(name));
  const CATEGORY_CODES = [1, 2, 3];
  const MAX_WEATHER_AGE_MS = 15 * 60 * 1000;
  const FEATURES_WITHOUT_VERIFIED_SOURCES = [
    "N", "P", "K", "ph", "organic_matter", "crop_density",
    "sunlight_exposure", "wind_speed", "frost_risk", "soil_type", "growth_stage",
  ];
  const SUPPORTED_CROPS = [
    "apple", "banana", "blackgram", "chickpea", "coconut", "coffee",
    "cotton", "grapes", "jute", "kidneybeans", "lentil", "maize",
    "mango", "mothbeans", "mungbean", "muskmelon", "orange", "papaya",
    "pigeonpeas", "pomegranate", "rice", "watermelon",
  ];

  const finiteWeatherValue = (value) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const isCurrentWeatherRequest = (
    requestGeneration,
    currentGeneration,
    requestFieldId,
    currentFieldId,
  ) => requestGeneration === currentGeneration &&
    String(requestFieldId) === String(currentFieldId);

  const mapCurrentWeather = (current, now = Date.now()) => {
    let freshness = "unknown";
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      freshness = "unavailable";
    } else if (current.is_stale === true) {
      freshness = "stale";
    } else if (current.is_stale === false) {
      const cacheAge = current.data_age_minutes;
      const observedAt = typeof current.observation_time === "string"
        ? Date.parse(current.observation_time)
        : Number.NaN;
      const observationAge = now - observedAt;
      if (
        typeof cacheAge !== "number" || !Number.isFinite(cacheAge) ||
        cacheAge < 0 || !Number.isFinite(observedAt) || observationAge < 0
      ) {
        freshness = "unknown";
      } else if (
        cacheAge >= MAX_WEATHER_AGE_MS / 60_000 ||
        observationAge >= MAX_WEATHER_AGE_MS
      ) {
        freshness = "stale";
      } else {
        freshness = "fresh";
      }
    }
    const fresh = freshness === "fresh";
    const source = fresh ? current : {};
    return {
      fresh,
      freshness,
      values: {
        temperature_c: finiteWeatherValue(source.temperature_c),
        humidity_percent: finiteWeatherValue(source.humidity_percent),
        rain_probability_percent:
          finiteWeatherValue(source.precipitation_probability_percent),
      },
      observation_time: fresh && typeof source.observation_time === "string"
        ? source.observation_time
        : "",
      wind_speed_mps: fresh ? finiteWeatherValue(source.wind_speed_mps) : null,
    };
  };

  const mapSupportedCrop = (cropName, supportedCategories) => {
    if (typeof cropName !== "string") return "";
    const normalized = cropName.trim().toLocaleLowerCase();
    return supportedCategories.find((category) =>
      category.toLocaleLowerCase() === normalized) || "";
  };

  const clearWeatherInputValues = (getInput) => {
    for (const name of WEATHER_FEATURES) {
      const input = getInput(name);
      if (input && typeof input === "object" && "value" in input) input.value = "";
    }
  };

  const applyWeatherInputValues = (getInput, values) => {
    clearWeatherInputValues(getInput);
    for (const name of WEATHER_FEATURES) {
      const value = values[name];
      const input = getInput(name);
      if (
        input && typeof input === "object" && "value" in input &&
        typeof value === "number" && Number.isFinite(value)
      ) {
        input.value = String(value);
      }
    }
  };

  const buildPredictionPayload = (values, supportedCategories) => {
    const payload = {};
    for (const name of MODEL_FEATURES) {
      const value = values[name];
      if (name === "crop_name") {
        if (!supportedCategories.includes(value)) {
          throw new Error("Choose a supported crop associated with the selected field.");
        }
        payload[name] = value;
        continue;
      }
      if (name === "soil_type" || name === "growth_stage") {
        if (typeof value !== "string" || !CATEGORY_CODES.includes(Number(value))) {
          throw new Error(`A valid ${name.replace("_", " ")} category code is required.`);
        }
        payload[name] = Number(value);
        continue;
      }
      if (
        (typeof value !== "string" && typeof value !== "number") ||
        (typeof value === "string" && !value.trim())
      ) {
        throw new Error(`The ${name} feature is unavailable.`);
      }
      const number = Number(value);
      if (!Number.isFinite(number)) {
        throw new Error(`The ${name} feature must be a finite number.`);
      }
      payload[name] = number;
    }
    return payload;
  };

  window.JalSaathiExperimentalModel = Object.freeze({
    modelFeatures: MODEL_FEATURES.slice(),
    supportedCropCategories: SUPPORTED_CROPS.slice(),
    featuresWithoutVerifiedSources: FEATURES_WITHOUT_VERIFIED_SOURCES.slice(),
    mapCurrentWeather,
    mapSupportedCrop,
    clearWeatherInputValues,
    applyWeatherInputValues,
    buildPredictionPayload,
    isCurrentWeatherRequest,
    initialize: () => initializeExperimentalModel(),
  });

  let initializedForm = null;
  const initializeExperimentalModel = () => {
    const form = document.querySelector("[data-experimental-form]");
    const message = document.querySelector("[data-experimental-message]");
    const result = document.querySelector("[data-experimental-result]");
    const submit = document.querySelector("[data-experimental-submit]");
    const refreshWeatherButton = document.querySelector("[data-experimental-weather-refresh]");
    const fieldSelect = document.querySelector("[data-experimental-field]");
    const cropRecordSelect = document.querySelector("[data-experimental-crop-record]");
    const cropCategorySelect = form?.querySelector('[name="crop_name"]');
    const weatherStatus = document.querySelector("[data-experimental-weather-status]");
    const readiness = document.querySelector("[data-experimental-readiness]");
    const loginLink = document.querySelector("[data-experimental-login]");
    if (!(form instanceof HTMLFormElement) ||
        !(message instanceof HTMLElement) ||
        !(result instanceof HTMLElement) ||
        !(submit instanceof HTMLButtonElement) ||
        !(refreshWeatherButton instanceof HTMLButtonElement) ||
        !(fieldSelect instanceof HTMLSelectElement) ||
        !(cropRecordSelect instanceof HTMLSelectElement) ||
        !(cropCategorySelect instanceof HTMLSelectElement) ||
        !(weatherStatus instanceof HTMLElement) ||
        !(readiness instanceof HTMLElement) ||
        !(loginLink instanceof HTMLAnchorElement) ||
        form === initializedForm) return;
    initializedForm = form;

    const supportedCategories = SUPPORTED_CROPS;
    const fieldById = new Map();
    const cropById = new Map();
    let selectedField = null;
    let selectedCrop = null;
    let weatherIsFresh = false;
    let weatherObservedAt = null;
    let weatherLoading = false;
    let predictionInFlight = false;
    let selectionGeneration = 0;

    const clearResult = () => {
      result.hidden = true;
    };

    const inputFor = (name) => form.querySelector(`[name="${name}"]`);

    const clearModelInputs = ({ clearWeather = true } = {}) => {
      for (const name of NUMERIC_FEATURES) {
        if (!clearWeather && WEATHER_FEATURES.includes(name)) continue;
        const input = inputFor(name);
        if (input instanceof HTMLInputElement) input.value = "";
      }
      for (const name of ["soil_type", "growth_stage"]) {
        const input = inputFor(name);
        if (input instanceof HTMLSelectElement) input.value = "";
      }
      cropCategorySelect.value = "";
      clearResult();
    };

    const clearWeatherInputs = () => {
      clearWeatherInputValues(inputFor);
    };

    const formValues = () => Object.fromEntries(MODEL_FEATURES.map((name) => {
      const input = inputFor(name);
      return [name, input instanceof HTMLInputElement || input instanceof HTMLSelectElement
        ? input.value
        : ""];
    }));

    const updateReadiness = () => {
      const observationAge = weatherObservedAt === null
        ? Number.POSITIVE_INFINITY
        : Date.now() - weatherObservedAt;
      const currentWeatherIsFresh = weatherIsFresh &&
        observationAge >= 0 && observationAge < MAX_WEATHER_AGE_MS;
      let payload;
      try {
        payload = buildPredictionPayload(formValues(), supportedCategories);
      } catch {
        payload = null;
      }
      const missing = [];
      if (!selectedField) missing.push("a saved field");
      if (!selectedCrop) missing.push("an associated crop record");
      if (!currentWeatherIsFresh) missing.push("fresh current weather for the selected field");
      missing.push(...FEATURES_WITHOUT_VERIFIED_SOURCES.map((name) =>
        `a verified source for ${name}`));
      if (!payload) {
        for (const name of MODEL_FEATURES) {
          const input = inputFor(name);
          const value = input instanceof HTMLInputElement || input instanceof HTMLSelectElement
            ? input.value
            : "";
          if (value === "") missing.push(name);
        }
      }
      readiness.textContent = missing.length
        ? `Prediction unavailable. Complete or verify: ${[...new Set(missing)].join(", ")}.`
        : "All required model inputs are present. Review them before submitting.";
      submit.disabled = Boolean(
        weatherLoading || predictionInFlight || !selectedField || !selectedCrop ||
        !currentWeatherIsFresh || !payload ||
        FEATURES_WITHOUT_VERIFIED_SOURCES.length > 0,
      );
      refreshWeatherButton.disabled = !selectedField || weatherLoading || predictionInFlight;
    };

    const setLoginRequired = (error) => {
      if (error && error.status === 401) {
        loginLink.hidden = false;
        message.textContent = "Your authenticated session has expired. Sign in again to load your own field and crop records.";
      } else {
        message.textContent = error instanceof Error
          ? error.message
          : "Your field and crop records could not be loaded.";
      }
    };

    const setOptions = (select, placeholder, records, getId, getLabel) => {
      select.replaceChildren();
      const initial = document.createElement("option");
      initial.value = "";
      initial.textContent = placeholder;
      select.append(initial);
      for (const record of records) {
        const option = document.createElement("option");
        option.value = String(getId(record));
        option.textContent = getLabel(record);
        select.append(option);
      }
      select.disabled = records.length === 0;
    };

    const loadWeatherForField = async (field, generation) => {
      const coordinatesAreValid =
        Number.isFinite(field.latitude) && field.latitude >= -90 && field.latitude <= 90 &&
        Number.isFinite(field.longitude) && field.longitude >= -180 && field.longitude <= 180;
      const selection = coordinatesAreValid
        ? { coordinates: { latitude: field.latitude, longitude: field.longitude } }
        : null;
      if (!selection) {
        weatherStatus.textContent = "Weather unavailable: this field has no saved coordinates. Add verified coordinates to the field record; device and named-location weather are not substituted.";
        weatherIsFresh = false;
        weatherLoading = false;
        updateReadiness();
        return;
      }
      const weatherApi = window.JalSaathiWeather;
      if (!weatherApi || typeof weatherApi.loadCurrent !== "function") {
        weatherStatus.textContent = "Weather unavailable: the current-weather service is not initialized.";
        weatherIsFresh = false;
        weatherLoading = false;
        updateReadiness();
        return;
      }

      weatherLoading = true;
      weatherIsFresh = false;
      clearWeatherInputs();
      clearResult();
      weatherStatus.textContent = `Loading current weather for ${field.name}…`;
      updateReadiness();
      try {
        const data = await weatherApi.loadCurrent(selection, { refresh: true });
        if (!isCurrentWeatherRequest(
          generation,
          selectionGeneration,
          field.id,
          selectedField?.id,
        )) return;
        const mapped = mapCurrentWeather(data?.current);
        if (!mapped.fresh) {
          const messages = {
            stale: "The current observation is stale. No weather values were used; refresh weather before prediction.",
            unknown: "Weather freshness could not be verified from its status, age, and observation time. No values were used; refresh weather before prediction.",
            unavailable: "The current weather response is unavailable. No values were used; refresh weather before prediction.",
          };
          weatherStatus.textContent = messages[mapped.freshness];
          clearWeatherInputs();
          weatherIsFresh = false;
          weatherObservedAt = null;
          return;
        }

        applyWeatherInputValues(inputFor, mapped.values);
        weatherIsFresh = true;
        weatherObservedAt = Date.parse(mapped.observation_time);
        const missingWeather = WEATHER_FEATURES.filter((name) => mapped.values[name] === null);
        const observedAt = mapped.observation_time
          ? ` Observation time: ${mapped.observation_time}.`
          : " Provider observation time was not supplied.";
        const wind = mapped.wind_speed_mps === null
          ? " Wind speed is unavailable."
          : " Wind speed is available from the provider in m/s, but is not mapped because the model feature unit is undocumented.";
        weatherStatus.textContent = `Fresh current weather loaded for ${field.name}.${observedAt}${wind}`;
        if (missingWeather.length) {
          const labels = missingWeather.map((name) => WEATHER_LABELS[name]);
          weatherStatus.textContent += ` Missing weather reading(s): ${labels.join(", ")}.`;
        }
      } catch (error) {
        if (!isCurrentWeatherRequest(
          generation,
          selectionGeneration,
          field.id,
          selectedField?.id,
        )) return;
        clearWeatherInputs();
        weatherIsFresh = false;
        weatherObservedAt = null;
        if (error && error.status === 401) {
          loginLink.hidden = false;
          weatherStatus.textContent = "Your authenticated session expired while loading field weather. Sign in again before continuing.";
        } else {
          weatherStatus.textContent = error instanceof Error
            ? `Current weather unavailable for ${field.name}: ${error.message}`
            : `Current weather unavailable for ${field.name}.`;
        }
      } finally {
        if (generation === selectionGeneration) {
          weatherLoading = false;
          updateReadiness();
        }
      }
    };

    const refreshSelectedFieldWeather = () => {
      if (!selectedField || weatherLoading || predictionInFlight) return;
      void loadWeatherForField(selectedField, ++selectionGeneration);
    };

    const applySelectedCrop = () => {
      const selectedId = cropRecordSelect.value;
      selectedCrop = cropById.get(selectedId) || null;
      clearResult();
      for (const name of [
        "N", "P", "K", "ph", "organic_matter", "crop_density",
        "sunlight_exposure", "wind_speed", "frost_risk", "soil_type", "growth_stage",
      ]) {
        const input = inputFor(name);
        if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) input.value = "";
      }
      const category = mapSupportedCrop(selectedCrop?.name, supportedCategories);
      cropCategorySelect.value = category;
      cropCategorySelect.disabled = true;
      if (!selectedCrop) {
        message.textContent = "Select a crop record associated with this field.";
      } else if (!category) {
        message.textContent = `“${selectedCrop.name}” is not an exact supported model crop category. No alias or substitution was applied.`;
      } else {
        message.textContent = `Crop record “${selectedCrop.name}” maps exactly to model category “${category}”.`;
      }
      updateReadiness();
    };

    fieldSelect.addEventListener("change", () => {
      const generation = ++selectionGeneration;
      selectedField = fieldById.get(fieldSelect.value) || null;
      selectedCrop = null;
      weatherIsFresh = false;
      weatherObservedAt = null;
      weatherLoading = false;
      clearModelInputs();
      setOptions(cropRecordSelect, selectedField
        ? "Choose a crop record for this field"
        : "Choose a field first", [], (crop) => crop.id, (crop) => crop.name);
      cropCategorySelect.value = "";
      cropCategorySelect.disabled = true;
      weatherStatus.textContent = selectedField
        ? "Waiting for field-specific current weather."
        : "Choose one of your saved fields to load its current weather.";
      const associatedCrops = selectedField
        ? Array.from(cropById.values()).filter((crop) =>
          String(crop.field_id) === String(selectedField.id))
        : [];
      if (selectedField && associatedCrops.length) {
        setOptions(
          cropRecordSelect,
          "Choose a crop record for this field",
          associatedCrops,
          (crop) => crop.id,
          (crop) => crop.variety ? `${crop.name} · ${crop.variety}` : crop.name,
        );
      } else if (selectedField) {
        setOptions(
          cropRecordSelect,
          "No crop records are associated with this field",
          [],
          (crop) => crop.id,
          (crop) => crop.name,
        );
      }
      updateReadiness();
      if (selectedField) void loadWeatherForField(selectedField, generation);
    });
    refreshWeatherButton.addEventListener("click", refreshSelectedFieldWeather);

    cropRecordSelect.addEventListener("change", applySelectedCrop);
    form.addEventListener("input", (event) => {
      if (event.target instanceof HTMLInputElement ||
          (event.target instanceof HTMLSelectElement &&
           event.target !== fieldSelect && event.target !== cropRecordSelect)) {
        clearResult();
        updateReadiness();
      }
    });
    form.addEventListener("change", (event) => {
      if (event.target !== fieldSelect && event.target !== cropRecordSelect) {
        clearResult();
        updateReadiness();
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submit.disabled || predictionInFlight) return;
      clearResult();
      const observationAge = weatherObservedAt === null
        ? Number.POSITIVE_INFINITY
        : Date.now() - weatherObservedAt;
      if (
        !weatherIsFresh ||
        observationAge < 0 ||
        observationAge >= MAX_WEATHER_AGE_MS
      ) {
        weatherIsFresh = false;
        updateReadiness();
        weatherStatus.textContent = "Current weather is stale or unavailable. Refresh field-specific weather before submitting Model 1 inputs.";
        message.textContent = "No prediction was generated because the field's current weather was not fresh at submission time.";
        return;
      }
      if (FEATURES_WITHOUT_VERIFIED_SOURCES.length) {
        message.textContent = `No prediction was generated. Verified field-specific sources are unavailable for: ${FEATURES_WITHOUT_VERIFIED_SOURCES.join(", ")}.`;
        updateReadiness();
        return;
      }
      if (!form.reportValidity()) {
        message.textContent = "Complete all required inputs before submitting.";
        return;
      }

      let payload;
      try {
        payload = buildPredictionPayload(formValues(), supportedCategories);
        if (Object.keys(payload).length !== MODEL_FEATURES.length ||
            MODEL_FEATURES.some((name) => !Object.hasOwn(payload, name))) {
          throw new Error("The request does not match the required model feature schema.");
        }
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : "Model inputs are invalid.";
        updateReadiness();
        return;
      }

      const generation = selectionGeneration;
      predictionInFlight = true;
      submit.setAttribute("aria-busy", "true");
      message.textContent = "Running experimental prediction…";
      updateReadiness();
      try {
        const api = window.JalSaathiProfile?.apiRequest;
        if (typeof api !== "function") {
          throw new Error("The authenticated API helper is unavailable.");
        }
        const prediction = await api("/api/ml/experimental-prediction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (generation !== selectionGeneration) return;
        if (
          ![0, 1].includes(prediction?.prediction) ||
          !Number.isFinite(prediction?.proxy_positive_probability) ||
          typeof prediction?.warning !== "string" ||
          prediction?.model_status !== "Experimental" ||
          prediction?.dataset_provenance !== "synthetic_or_synthetic_augmented" ||
          prediction?.target !== "irrigation_needed_proxy"
        ) {
          throw new Error("The experimental prediction response was invalid.");
        }

        const output = {
          "[data-result-class]": prediction.prediction === 1
            ? "Proxy class 1 predicted"
            : "Proxy class 0 predicted",
          "[data-result-probability]":
            `${(prediction.proxy_positive_probability * 100).toFixed(1)}%`,
          "[data-result-target]": prediction.target,
          "[data-result-status]": prediction.model_status,
          "[data-result-provenance]": prediction.dataset_provenance,
          "[data-result-warning]": prediction.warning,
        };
        for (const [selector, value] of Object.entries(output)) {
          const node = result.querySelector(selector);
          if (!(node instanceof HTMLElement)) {
            throw new Error("The experimental result panel is unavailable.");
          }
          node.textContent = value;
        }
        result.hidden = false;
        message.textContent = "Experimental proxy result received. The dashboard does not reuse manually entered values as verified field measurements.";
      } catch (error) {
        if (generation !== selectionGeneration) return;
        if (error && error.status === 401) {
          loginLink.hidden = false;
          message.textContent = "Your session expired. Sign in again before requesting an experimental prediction.";
        } else {
          message.textContent = error instanceof Error
            ? error.message
            : "The experimental prediction is unavailable. Please try again later.";
        }
      } finally {
        predictionInFlight = false;
        submit.removeAttribute("aria-busy");
        updateReadiness();
      }
    });

    const loadOwnedRecords = async () => {
      try {
        const [fields, crops] = await Promise.all([
          window.JalSaathiProfile.apiRequest("/api/fields"),
          window.JalSaathiProfile.apiRequest("/api/crops"),
        ]);
        if (!Array.isArray(fields) || !Array.isArray(crops)) {
          throw new Error("The field or crop response has an invalid format.");
        }
        const validFields = fields.filter((field) =>
          field && Number.isInteger(field.id) && typeof field.name === "string");
        const validCrops = crops.filter((crop) =>
          crop && Number.isInteger(crop.id) && typeof crop.name === "string");
        validFields.forEach((field) => fieldById.set(String(field.id), field));
        validCrops.forEach((crop) => cropById.set(String(crop.id), crop));
        setOptions(
          fieldSelect,
          validFields.length ? "Choose one of your saved fields" : "No saved fields available",
          validFields,
          (field) => field.id,
          (field) => field.name,
        );
        weatherStatus.textContent = validFields.length
          ? "Choose a field to retrieve field-specific current weather."
          : "No saved fields are available. Add a field before using the lab.";
        message.textContent = "Choose a field and its associated crop record to begin.";
      } catch (error) {
        fieldSelect.disabled = true;
        cropRecordSelect.disabled = true;
        setLoginRequired(error);
      }
      updateReadiness();
    };

    clearModelInputs();
    loginLink.hidden = true;
    updateReadiness();
    void loadOwnedRecords();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeExperimentalModel, { once: true });
  } else {
    initializeExperimentalModel();
  }
})();
