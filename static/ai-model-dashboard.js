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

  const model1InputFeatures = [
    { name: "temperature_c", unit: "°C" },
    { name: "humidity_percent", unit: "%" },
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
        cache: "no-store",
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
    const model4LoadButton = page.querySelector("[data-ai-model4-load]");
    const model4DataStatus = page.querySelector("[data-ai-model4-data-status]");
    const model4DemoButton = page.querySelector("[data-ai-model4-demo]");
    const model4DemoStatus = page.querySelector("[data-ai-model4-demo-status]");
    const model4DemoOutput = page.querySelector("[data-ai-model4-demo-output]");
    if (
      !(fieldSelect instanceof HTMLSelectElement) ||
      !(zoneSelect instanceof HTMLSelectElement) ||
      !(cropPicker instanceof HTMLElement) ||
      !(cropSelect instanceof HTMLSelectElement) ||
      !(refreshButton instanceof HTMLButtonElement) ||
      !(model3Form instanceof HTMLFormElement) ||
      !(model4Form instanceof HTMLFormElement) ||
      !(model4LoadButton instanceof HTMLButtonElement) ||
      !(model4DataStatus instanceof HTMLElement)||
      !(model4DemoButton instanceof HTMLButtonElement) ||
      !(model4DemoStatus instanceof HTMLElement) ||
      !(model4DemoOutput instanceof HTMLElement)
    ) return;

    const api = window.JalSaathiProfile;
    if (!api || typeof api.apiRequest !== "function") {
      throw new Error("The authenticated JalSaathi API helper is unavailable.");
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
      option.setAttribute("data-user-content", "");
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
        option.setAttribute("data-user-content", "");
        cropSelect.append(option);
      });
      if (matches.length) cropSelect.value = String(matches[0].id);
    };

    const updateFieldDetails = () => {
      const field = selectedField();
      const crop = selectedCrop();
      const cropName = crop?.name || field?.crop || "";
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
    };

    const model4Defaults = Object.freeze({
      soil_type: "Loamy",
      bulk_density: 1.3,
      organic_matter_pct: 3.5,
      cation_exchange_capacity: 15.0,
      salinity_ec: 0.4,
      buffering_capacity: 0.7,
      soil_moisture_pct: 34.99,
      moisture_limit_dry: 16.0,
      moisture_limit_wet: 42.0,
      moisture_regime: "optimal",
      soil_temp_c: 25.0,
      air_temp_c: 28.0,
      thermal_regime: "optimal",
      light_intensity_par: 699.0,
      soil_ph: 6.5,
      nitrogen_ppm: 99.9,
      phosphorus_ppm: 50.1,
      potassium_ppm: 110.0,
      nutrient_balance: "deficient",
      plant_category: "cereal"
    });

    const applyModel4Defaults = () => {
      for (const [name, value] of Object.entries(model4Defaults)) {
        const input = model4Form.elements.namedItem(name);
        if (!(input instanceof HTMLInputElement)) continue;
        input.value = String(value);
        input.readOnly = true;
      }
    };

    const clearObservationInputs = () => {
      model3Form.querySelectorAll("input").forEach((input) => {
        if (input.name !== "field_id" && input.name !== "zone") {
          input.value = "";
        }
      });
      applyModel4Defaults();
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


const runModel1 = async (field, generation) => {
  if (!field || !Number.isSafeInteger(Number(field.id)) || Number(field.id) <= 0) {
    setState("model1", "input", "Select an account field with a valid numeric ID.");
    return;
  }

  setState("model1", "loading", "Requesting the current field-weather prediction...");
  text(page, '[data-ai-input-status="model1"]', "Collecting current field weather.");

  try {
    const result = await api.apiRequest("/api/ml/reduced-weather-prediction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field_id: Number(field.id) }),
    });

    if (generation !== requestGeneration) return;

    if (
      typeof result.irrigation_needed !== "boolean" ||
      !["irrigate", "hold"].includes(result.decision) ||
      typeof result.reason !== "string" ||
      !result.reason.trim() ||
      !finiteNumber(result.soil_moisture_percent) ||
      result.soil_moisture_percent < 0 ||
      result.soil_moisture_percent > 100 ||
      !finiteNumber(result.rainfall_mm) ||
      result.rainfall_mm < 0 ||
      !finiteNumber(result.rain_probability_percent) ||
      result.rain_probability_percent < 0 ||
      result.rain_probability_percent > 100 ||
      !finiteNumber(result.et0_mm) ||
      result.et0_mm < 0 ||
      typeof result.forecast_date !== "string" ||
      typeof result.observation_time !== "string" ||
      Number.isNaN(Date.parse(result.observation_time)) ||
      !["tomorrow_io", "open_meteo"].includes(result.weather_source)
    ) {
      throw new Error("Model 1 returned an invalid weather prediction response.");
    }

    if (
      result.decision !== (result.irrigation_needed ? "irrigate" : "hold")
    ) {
      throw new Error("Model 1 returned inconsistent irrigation decisions.");
    }

    renderModel1Inputs(page, result);

    const output = result.irrigation_needed
      ? "Irrigation Needed"
      : "Irrigation Not Needed";

    setTextContent(
      page.querySelector('[data-ai-result="model1"]'),
      `${output} - ${result.reason}`
    );

    text(
      page,
      '[data-ai-timestamp="model1"]',
      `Prediction time: ${displayTime(result.observation_time)} | Forecast date: ${result.forecast_date}`
    );

    setSuccess("model1", new Date().toISOString());

  } catch (error) {
    if (generation !== requestGeneration) return;

    setState(
      "model1",
      "unavailable",
      errorMessage(error, "The field-weather prediction is unavailable.")
    );
  }
};


    const runModel2 = async (field, crop, generation) => {
    const demoResult = page.querySelector("[data-ai-model2-demo-result]");
    const demoNote = page.querySelector("[data-ai-model2-demo-note]");
    const demoZone = page.querySelector("[data-ai-model2-demo-zone]");
    const demoSources = page.querySelector("[data-ai-model2-demo-sources]");
    const demoInputs = page.querySelector("[data-ai-model2-demo-inputs]");

    if (!field || !crop ||
        !Number.isSafeInteger(Number(field.id)) ||
        !Number.isSafeInteger(Number(crop.id))) {
      setState("model2", "input", "Select a field and its saved crop record.");
      if (demoResult) demoResult.textContent = "Input required";
      if (demoNote) demoNote.textContent = "Select a field and crop to run the experimental demonstration.";
      return;
    }

    // Keep the validated production estimate separate.
    setState(
      "model2",
      "loading",
      "Checking the validated production Model 2 service…"
    );

    try {
      const production = await api.apiRequest("/api/ml/water-requirement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field_id: Number(field.id),
          crop_id: Number(crop.id),
          prediction_period_hours: 24,
        }),
      });

      if (generation !== requestGeneration) return;

      if (finiteNumber(production.estimated_water_liters)) {
        setTextContent(
          page.querySelector('[data-ai-result="model2"]'),
          `${production.estimated_water_liters.toLocaleString()} ${production.unit}`,
        );
        setTextContent(
          page.querySelector('[data-ai-timestamp="model2"]'),
          `Last checked: ${new Date().toLocaleString()}`,
        );
        setSuccess("model2", new Date().toISOString());
      }
    } catch (error) {
      if (generation !== requestGeneration) return;

      setState(
        "model2",
        "unavailable",
        "Production estimate is not available yet. The validated real-world Model 2 service is not ready. See the experimental demonstration below.",
      );
    }

    // Run the experimental artifact using the selected field and crop.
    try {
      const result = await api.apiRequest(
        "/api/ml/water-requirement/experimental",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            field_id: Number(field.id),
            crop_id: Number(crop.id),
            zone: Number(zoneSelect.value),
          }),
        },
      );

      if (generation !== requestGeneration) return;

      if (
        result.prediction_status !== "experimental" ||
        !finiteNumber(result.estimated_water_liters) ||
        result.estimated_water_liters < 0
      ) {
        throw new Error("The experimental Model 2 response is invalid.");
      }

      if (demoResult) {
        demoResult.textContent =
          `${result.estimated_water_liters.toLocaleString()} ${result.unit}`;
      }

      if (demoZone) {
        demoZone.textContent = `Zone ${result.selected_zone}`;
      }

      if (demoSources) {
        demoSources.textContent =
          result.illustrative_inputs.length === 0
            ? "Saved sensor, crop and weather data"
            : `${result.illustrative_inputs.length} illustrative input(s)`;
      }

      if (demoInputs) {
        demoInputs.replaceChildren();

        const inputLabels = {
          crop_type: "Crop",
          growth_stage: "Growth stage code",
          soil_type: "Soil type code",
          soil_moisture_percent: "Soil moisture",
          temperature_c: "Temperature",
          humidity_percent: "Humidity",
          rainfall_mm: "Rainfall",
          forecast_rainfall_mm: "Forecast rainfall",
          field_area_acres: "Field area",
          irrigation_method: "Irrigation method",
          wind_speed: "Wind speed",
          et0_mm_day: "ET0",
          crop_coefficient_kc: "Crop coefficient",
          previous_irrigation_mm: "Previous irrigation"
        };

        Object.entries(result.inputs).forEach(([key, value]) => {
          const item = document.createElement("li");
          const label = inputLabels[key] || key;
          const source = result.input_sources?.[key] || "Source unavailable";

          const formattedValue =
            typeof value === "number"
              ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : String(value);

          item.textContent = `${label}: ${formattedValue} — Source: ${source}`;
          demoInputs.appendChild(item);
        });
      }

      if (demoNote) {
        demoNote.textContent = result.data_note;
      }

      const model2Timestamp = page.querySelector('[data-ai-timestamp="model2"]');

      if (model2Timestamp) {
        model2Timestamp.textContent =
          `Last checked: ${new Date(result.prediction_timestamp).toLocaleString()}`;
    }

    // Mark Model 2 as available when the experimental prediction succeeds.
    setSuccess("model2", result.prediction_timestamp);

    const model2Status = page.querySelector('[data-ai-status="model2"]');

    if (model2Status) {
      model2Status.textContent = "Available";
    }

    } catch (error) {
      if (generation !== requestGeneration) return;

      if (demoResult) demoResult.textContent = "Experimental result unavailable";
      if (demoNote) {
        demoNote.textContent =
          errorMessage(error, "The experimental prediction could not be generated.");
      }
      if (demoSources) demoSources.textContent = "Unavailable";
    }
  };


    const model3Payload = () => {
  const field = selectedField();
  const zone = Number(zoneSelect.value);
  const moistureInput = model3Form.elements.namedItem("current_moisture_percent");

  if (
    !field ||
    !Number.isSafeInteger(Number(field.id)) ||
    !Number.isInteger(zone) ||
    zone < 1 ||
    zone > 5 ||
    !(moistureInput instanceof HTMLInputElement)
  ) {
    return null;
  }

  const moisture = Number(moistureInput.value);

  if (!Number.isFinite(moisture) || moisture < 1 || moisture > 100) {
    return null;
  }

  return {
    field_id: Number(field.id),
    zone,
    current_moisture_percent: moisture,
  };
};

    const runModel3 = async (generation) => {
      const payload = model3Payload();
      if (!payload) {
        setState("model3", "input", "Select a field with a saved soil-moisture reading.");
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
        const loadModel4FieldData = async () => {
      applyModel4Defaults();
      const field = selectedField();

      if (!field) {
        model4DataStatus.textContent = "";
        model4DataStatus.hidden = true;
        return;
      }

      model4LoadButton.disabled = true;
      model4DataStatus.textContent =
        "Training defaults are populated. Checking saved field sensor readings...";

      try {
        const readings = await api.apiRequest(
          `/api/fields/${encodeURIComponent(field.id)}/sensor-readings?limit=1`
        );

        if (String(selectedField()?.id) !== String(field.id)) return;
        if (!Array.isArray(readings)) {
          throw new Error("The sensor API returned an unexpected response.");
        }

        const latest = readings[0] || null;
        const sensorValues = [];

        const fillSensorValue = (inputName, value, label) => {
          if (value === null || value === undefined || value === "") return;
          const input = model4Form.elements.namedItem(inputName);
          if (!(input instanceof HTMLInputElement)) return;
          const number = Number(value);
          if (!Number.isFinite(number)) return;
          input.value = String(number);
          sensorValues.push(label);
        };

        const model3Moisture = model3Form.elements.namedItem("current_moisture_percent");

        if (latest) {
          if (
            model3Moisture instanceof HTMLInputElement &&
            latest.soil_moisture_percent != null &&
            Number.isFinite(Number(latest.soil_moisture_percent))
          ) {
            model3Moisture.value = String(latest.soil_moisture_percent);
          } else if (model3Moisture instanceof HTMLInputElement) {
            model3Moisture.value = "";
          }

          fillSensorValue("soil_moisture_pct", latest.soil_moisture_percent, "soil moisture");
          fillSensorValue("soil_temp_c", latest.soil_temperature_c, "soil temperature");
          fillSensorValue("soil_ph", latest.ph, "soil pH");
        } else {
          if (model3Moisture instanceof HTMLInputElement) {
            model3Moisture.value = "";
          }
        }

        let cropDerived = false;
        const cropName = String(selectedCrop()?.name || field.crop || "")
          .trim().toLowerCase();

        if (["paddy", "rice"].includes(cropName)) {
          const plantCategory = model4Form.elements.namedItem("plant_category");
          if (plantCategory instanceof HTMLInputElement) {
            plantCategory.value = "cereal";
            cropDerived = true;
          }
        }

        const defaultsUsed = 20 - sensorValues.length - (cropDerived ? 1 : 0);
        const messages = [
          "All 20 Model 4 inputs are populated automatically.",
          `${sensorValues.length} input(s) use saved sensor readings.`,
          `${defaultsUsed} input(s) use fitted training defaults.`
        ];

        if (cropDerived) {
          messages.push("Plant category was derived from the selected rice/paddy crop.");
        } else {
          messages.push("Plant category uses the fitted most-frequent training default.");
        }

        if (latest) {
          messages.push(`Latest saved reading: ${displayTime(latest.recorded_at)}.`);
        } else {
          messages.push("No saved sensor readings were found; sensor inputs use training medians.");
        }


        model4DataStatus.textContent = "";
        model4DataStatus.hidden = true;
        } catch (error) {
          model4DataStatus.textContent = "";
          model4DataStatus.hidden = true;
        } finally {
          model4LoadButton.disabled = false;
        }
        };

const runModel4Demo = async () => {
  const field = selectedField();
  const crop = selectedCrop();
  const zone = Number(zoneSelect.value);

  if (
    !field ||
    !(crop?.name || field.crop) ||
    !Number.isSafeInteger(Number(field.id)) ||
    !Number.isInteger(zone) ||
    zone < 1 ||
    zone > 5
  ) {
    model4DemoStatus.textContent =
      "Select a field, saved crop and zone before running the demo.";
    return;
  }

  const fieldId = String(field.id);
  const cropName = crop?.name || field.crop;

  // Existing test fixture from tests/test_model4.py.
  // These values are illustrative, not live field measurements.
  const sample = {
    soil_type: "Loamy",
    bulk_density: 1.3,
    organic_matter_pct: 2.5,
    cation_exchange_capacity: 18.0,
    salinity_ec: 0.8,
    buffering_capacity: 7.0,
    soil_moisture_pct: 35.0,
    moisture_limit_dry: 20.0,
    moisture_limit_wet: 60.0,
    moisture_regime: "optimal",
    thermal_regime: "optimal",
    nutrient_balance: "optimal",
    plant_category: "cereal",
    soil_temp_c: 24.0,
    air_temp_c: 28.0,
    light_intensity_par: 500.0,
    soil_ph: 6.8,
    nitrogen_ppm: 45.0,
    phosphorus_ppm: 25.0,
    potassium_ppm: 40.0,
  };

  model4DemoButton.disabled = true;
  model4DemoOutput.hidden = true;
  model4DemoStatus.textContent =
    "Running Model 4 with the existing illustrative test data...";

  try {
    const result = await api.apiRequest(
      "/api/ml/crop-stress-prediction",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field_id: Number(field.id),
          crop_type: cropName,
          zone,
          ...sample,
        }),
      }
    );

    // Do not display an old field's result after selection changes.
    const currentField = selectedField();
    const currentCrop = selectedCrop();
    const currentCropName = currentCrop?.name || currentField?.crop;

    if (
      String(currentField?.id) !== fieldId ||
      String(currentCropName) !== String(cropName) ||
      Number(zoneSelect.value) !== zone
    ) {
      return;
    }

    if (
      !Number.isInteger(result.predicted_class) ||
      result.class_label_status !== "unverified" ||
      (result.class_probabilities !== null &&
        (
          typeof result.class_probabilities !== "object" ||
          Array.isArray(result.class_probabilities)
        ))
    ) {
      throw new Error("Model 4 returned an invalid demo result.");
    }

    text(
      page,
      "[data-ai-model4-demo-class]",
      `Class ${result.predicted_class}`
    );

    text(
      page,
      "[data-ai-model4-demo-probability]",
      finiteNumber(result.confidence)
        ? `${(result.confidence * 100).toFixed(1)}% (not calibrated)`
        : "Not returned"
    );

    text(
      page,
      "[data-ai-model4-demo-time]",
      displayTime(result.prediction_timestamp)
    );

    model4DemoOutput.hidden = false;

    model4DemoStatus.textContent =
      "Demo completed. The sample inputs were sent separately; your actual form and saved sensor readings were not changed.";
  } catch (error) {
    model4DemoStatus.textContent = errorMessage(
      error,
      "The Model 4 demonstration could not be completed."
    );
  } finally {
    model4DemoButton.disabled = false;
  }
};


    const runModel4 = async (generation) => {
      const payload = model4Payload();
      if (!payload) {
        setState("model4", "input", "Select a field, saved crop and zone. Model 4 inputs are populated automatically.");
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
        setTextContent(page.querySelector('[data-ai-result="model4"]'), `Predicted class ${result.predicted_class}.`);        text(page, '[data-ai-timestamp="model4"]', `Prediction time: ${displayTime(result.prediction_timestamp)}`);
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
        await loadModel4FieldData();
        if (generation !== requestGeneration) return;
        if (includeObservationModels) {
          tasks.push(runModel3(generation));
        }
        tasks.push(runModel4(generation));
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

    model4Form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!model4Form.reportValidity()) return;
  const generation = ++requestGeneration;
  void runModel4(generation);
});

// Load existing sensor readings into Model 4 inputs.
model4LoadButton.addEventListener("click", () => {
  void loadModel4FieldData();
});

model4DemoButton.addEventListener("click", () => {
  void runModel4Demo();
});

void refresh();
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
    if (name === "model1") {
      clear('[data-ai-timestamp="model1"]', "Prediction time: —");
      page.querySelector('[data-ai-input-list="model1"]')?.replaceChildren();
      text(page, '[data-ai-input-status="model1"]', "No current-field model inputs have been submitted.");
    }
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


const renderModel1Inputs = (page, result) => {
  const list = page.querySelector('[data-ai-input-list="model1"]');
  const status = page.querySelector('[data-ai-input-status="model1"]');

  if (!(list instanceof HTMLElement) || !(status instanceof HTMLElement)) return;

  const measurements = [
    { name: "Soil Moisture", value: `${result.soil_moisture_percent}%` },
    { name: "Rainfall", value: `${result.rainfall_mm} mm` },
    { name: "Rain Probability", value: `${result.rain_probability_percent}%` },
    { name: "Reference Evapotranspiration (ET0)", value: `${result.et0_mm} mm` }
  ];

  const fragment = document.createDocumentFragment();

  measurements.forEach(({ name, value }) => {
    const row = document.createElement("section");
    row.className = "ai-input-row";

    const feature = document.createElement("span");
    feature.className = "ai-input-feature";
    feature.textContent = name;

    const measurement = document.createElement("strong");
    measurement.className = "ai-input-value";
    measurement.textContent = value;

    row.append(feature, measurement);
    fragment.append(row);
  });

  list.replaceChildren(fragment);

  status.textContent =
    `Weather source: ${result.weather_source} | Forecast date: ${result.forecast_date}`;
};
   window.JalSaathiAIDashboard = Object.freeze({ initialize });
})();
