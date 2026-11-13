(() => {
  "use strict";

  const numericFields = new Set([
    "field_id", "zone", "current_moisture_percent", "weather_temp",
    "weather_humidity", "weather_rain", "weather_pressure",
    "weather_wind_speed", "weather_radiation", "soil_temperature_0_7cm",
    "soil_temperature_7_18cm", "month", "day", "hour", "day_period",
    "quarter", "bulk_density", "organic_matter_pct",
    "cation_exchange_capacity", "salinity_ec", "buffering_capacity",
    "soil_moisture_pct", "moisture_limit_dry", "moisture_limit_wet",
    "soil_temp_c", "air_temp_c", "light_intensity_par", "soil_ph",
    "nitrogen_ppm", "phosphorus_ppm", "potassium_ppm",
  ]);

  const formPayload = (form) => {
    const payload = {};
    for (const [name, value] of new FormData(form).entries()) {
      const text = String(value).trim();
      if (text === "") continue;
      payload[name] = numericFields.has(name) ? Number(text) : text;
    }
    return payload;
  };

  const setError = (node, error) => {
    node.textContent = error instanceof Error ? error.message : "The prediction could not be generated.";
    node.hidden = false;
  };

  const renderModel3 = (node, result) => {
    node.hidden = false;
    node.innerHTML = `
      <strong>Prediction available</strong>
      <p>Current moisture: ${result.current_moisture_percent}%</p>
      <p>Predicted moisture after ${result.prediction_horizon_hours ?? 24} hours: ${result.predicted_moisture_24h_percent}%</p>
      <p>Strategy: ${result.strategy}</p>
      ${result.warning ? `<p>${result.warning}</p>` : ""}
    `;
  };

  const renderModel4 = (node, result) => {
    node.hidden = false;
    const probability = Number.isFinite(Number(result.confidence))
      ? `<p>Model-estimated probability: ${(Number(result.confidence) * 100).toFixed(2)}%</p>`
      : "";
    node.innerHTML = `
      <strong>Prediction available</strong>
      <p>Numeric class: ${result.predicted_class}</p>
      <p>The class-to-stress-label mapping is not verified, so no stress label is shown.</p>
      ${probability}
    `;
  };

  const initialize = async (root) => {
    const model3Form = root.querySelector("[data-model3-form]");
    const model4Form = root.querySelector("[data-model4-form]");
    if (!(model3Form instanceof HTMLFormElement) || !(model4Form instanceof HTMLFormElement)) return;

    let latestModel3Result = null;
let latestModel4Result = null;

const setSummaryCard = (name, status, message, state = "success") => {
  const statusNode = root.querySelector(`[data-summary-${name}-status]`);
  const resultNode = root.querySelector(`[data-summary-${name}-result]`);

  if (statusNode) {
    statusNode.textContent = status;
    statusNode.dataset.state = state;
  }

  if (resultNode) {
    resultNode.textContent = message;
  }
};

const updateSummaryCards = () => {
  const model3 = latestModel3Result;
  const model4 = latestModel4Result;

  if (model3) {
    const horizon = model3.prediction_horizon_hours ?? 24;
    const current = Number(model3.current_moisture_percent);
    const predicted = Number(model3.predicted_moisture_24h_percent);

    setSummaryCard(
      "irrigation",
      "Model 3 result",
      `Model strategy: ${model3.strategy || "Not specified"}. ` +
      `Current moisture: ${Number.isFinite(current) ? current + "%" : "Not supplied"}. ` +
      `Predicted moisture: ${Number.isFinite(predicted) ? predicted.toFixed(2) + "%" : "Not supplied"}. ` +
      "This is model output, not a verified irrigation command."
    );

    setSummaryCard(
      "timing",
      "Prediction horizon available",
      `Model 3 provides a prediction horizon of ${horizon} hours. ` +
      "It does not return a specific irrigation clock time."
    );

    setSummaryCard(
      "rainfall",
      "Model result checked",
      "Model 3 does not return a rainfall-impact prediction. " +
      "Refer to the weather observations and forecast panel above for weather information."
    );

    setSummaryCard(
      "water",
      "Quantity not returned",
      "Model 3 does not return a required irrigation-water quantity in litres."
    );
  }

  if (model4) {
    const probability = Number(model4.confidence);
    const probabilityText = Number.isFinite(probability)
      ? ` Model-estimated probability: ${(probability * 100).toFixed(2)}%.`
      : "";

    const model4Text =
      `Model 4 returned numeric class ${model4.predicted_class}.` +
      " Its class-to-stress-label mapping is unverified; no stress label is assigned." +
      probabilityText;

    setSummaryCard(
      "water",
      "Quantity not returned",
      (model3
        ? "Neither Model 3 nor Model 4 "
        : "Model 4 ") +
      "returns a required irrigation-water quantity in litres."
    );

    setSummaryCard(
      "alert",
      "Model 4 result available",
      model4Text
    );
  }

  if (model3 && model4) {
    const warningText = model3.warning
      ? `Model 3 warning: ${model3.warning}. `
      : "Model 3 returned no warning. ";

    const probability = Number(model4.confidence);
    const probabilityText = Number.isFinite(probability)
      ? ` Model 4 estimated probability: ${(probability * 100).toFixed(2)}%.`
      : "";

    setSummaryCard(
      "alert",
      "Both model results available",
      warningText +
      `Model 4 numeric class: ${model4.predicted_class}. ` +
      "Its stress-label mapping is unverified." +
      probabilityText +
      " These results do not establish that the field is healthy or unhealthy."
    );
  } else if (model3 && !model4) {
    setSummaryCard(
      "alert",
      model3.warning ? "Model 3 warning returned" : "No Model 3 warning",
      model3.warning
        ? `Model 3 warning: ${model3.warning}. Model 4 has not been run yet.`
        : "Model 3 returned no warning. This does not confirm that the field is healthy. Model 4 has not been run yet."
    );
  }
};

    let fields;
    try {
      fields = await window.JalSaathiFieldStore.loadServerFields();
      const options = fields.map((field) =>
        `<option value="${String(field.id)}">${String(field.name).replace(/[&<>"']/g, "")}</option>`
      ).join("");

      root.querySelectorAll("[data-model-field]").forEach((select) => {
        select.innerHTML = `<option value="">Select a field</option>${options}`;
      });

      const overviewField = root.querySelector("[data-overview-field]");
      const updateOverview = (field) => {
        const setValue = (selector, value) => {
          const node = root.querySelector(selector);
          if (node) node.textContent = value || "Not recorded";
        };

        setValue("[data-overview-crop]", field?.crop);
        setValue(
          "[data-overview-area]",
          field ? `${field.area} ${field.areaUnit || ""}`.trim() : ""
        );
        setValue("[data-overview-location]", field?.location);
      };

      const sensorPanel = root.querySelector("[data-field-sensor-reading]");
      const moistureInput = model3Form.elements.namedItem("current_moisture_percent");
      let sensorRequestId = 0;
let model3InputMode = "auto";
let model4InputMode = "auto";
let selectedOverviewField = null;
let latestModel4SensorReading = null;

let latestModel3Result = null;
let latestModel4Result = null;

const setSummaryCard = (name, status, message, state = "success") => {
  const statusNode = root.querySelector(`[data-summary-${name}-status]`);
  const resultNode = root.querySelector(`[data-summary-${name}-result]`);

  if (statusNode) {
    statusNode.textContent = status;
    statusNode.dataset.state = state;
  }

  if (resultNode) {
    resultNode.textContent = message;
  }
};

const updateSummaryCards = () => {
  const model3 = latestModel3Result;
  const model4 = latestModel4Result;

  if (model3) {
    const horizon = model3.prediction_horizon_hours ?? 24;
    const current = Number(model3.current_moisture_percent);
    const predicted = Number(model3.predicted_moisture_24h_percent);

    setSummaryCard(
      "irrigation",
      "Model 3 result",
      `Model strategy: ${model3.strategy || "Not specified"}. ` +
      `Current moisture: ${Number.isFinite(current) ? current + "%" : "Not supplied"}. ` +
      `Predicted moisture: ${Number.isFinite(predicted) ? predicted.toFixed(2) + "%" : "Not supplied"}. ` +
      "This is model output, not a verified irrigation command."
    );

    setSummaryCard(
      "timing",
      "Prediction horizon available",
      `Model 3 provides a prediction horizon of ${horizon} hours. ` +
      "It does not return a specific irrigation clock time."
    );

    setSummaryCard(
      "rainfall",
      "Model result checked",
      "Model 3 does not return a rainfall-impact prediction. " +
      "Refer to the weather observations and forecast panel above for weather information."
    );

    setSummaryCard(
      "water",
      "Quantity not returned",
      "Model 3 does not return a required irrigation-water quantity in litres."
    );
  }

  if (model4) {
    const probability = Number(model4.confidence);
    const probabilityText = Number.isFinite(probability)
      ? ` Model-estimated probability: ${(probability * 100).toFixed(2)}%.`
      : "";

    const model4Text =
      `Model 4 returned numeric class ${model4.predicted_class}.` +
      " Its class-to-stress-label mapping is unverified; no stress label is assigned." +
      probabilityText;

    setSummaryCard(
      "water",
      "Quantity not returned",
      (model3
        ? "Neither Model 3 nor Model 4 "
        : "Model 4 ") +
      "returns a required irrigation-water quantity in litres."
    );

    setSummaryCard(
      "alert",
      "Model 4 result available",
      model4Text
    );
  }

  if (model3 && model4) {
    const warningText = model3.warning
      ? `Model 3 warning: ${model3.warning}. `
      : "Model 3 returned no warning. ";

    const probability = Number(model4.confidence);
    const probabilityText = Number.isFinite(probability)
      ? ` Model 4 estimated probability: ${(probability * 100).toFixed(2)}%.`
      : "";

    setSummaryCard(
      "alert",
      "Both model results available",
      warningText +
      `Model 4 numeric class: ${model4.predicted_class}. ` +
      "Its stress-label mapping is unverified." +
      probabilityText +
      " These results do not establish that the field is healthy or unhealthy."
    );
  } else if (model3 && !model4) {
    setSummaryCard(
      "alert",
      model3.warning ? "Model 3 warning returned" : "No Model 3 warning",
      model3.warning
        ? `Model 3 warning: ${model3.warning}. Model 4 has not been run yet.`
        : "Model 3 returned no warning. This does not confirm that the field is healthy. Model 4 has not been run yet."
    );
  }
};

const model3ModePanel = root.querySelector("[data-model3-mode]");
const model4ModePanel = root.querySelector("[data-model4-mode]");

const getFieldValue = (field, keys) => {
  for (const key of keys) {
    const value = field?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return "";
};

const setFormValue = (form, name, value) => {
  const input = form.elements.namedItem(name);
  if (input && "value" in input) {
    input.value = value === undefined || value === null ? "" : String(value);
  }
};


const model4ReferenceProfile = Object.freeze({
  bulk_density: 1.375,
  organic_matter_pct: 1.867,
  cation_exchange_capacity: 20.5,
  salinity_ec: 683.33,
  buffering_capacity: 20.5,
  soil_moisture_pct: 18.5,
  moisture_limit_dry: 16.33,
  moisture_limit_wet: 32.5,
  moisture_regime: "Ustic",
  thermal_regime: "Warm",
  soil_temp_c: 28,
  light_intensity_par: 496.67,
  soil_ph: 6.683,
  nitrogen_ppm: 96.67,
  phosphorus_ppm: 20.67,
  potassium_ppm: 138.33,
  nutrient_balance: "optimal"
});

const applyModel4DemoProfile = (field) => {
  if (!field || model4InputMode !== "auto") return;

  Object.entries(model4ReferenceProfile).forEach(([name, value]) => {
    const sensorKeys = {
      soil_moisture_pct: "soil_moisture_percent",
      soil_temp_c: "soil_temperature_c",
      soil_ph: "ph",
      salinity_ec: "electrical_conductivity_us_cm"
    };

    const sensorKey = sensorKeys[name];
    const actualValue = sensorKey
      ? latestModel4SensorReading?.[sensorKey]
      : null;

    setFormValue(
      model4Form,
      name,
      actualValue !== undefined && actualValue !== null
        ? actualValue
        : value
    );
  });

  const crop = String(field.crop || "").toLowerCase();

  let plantCategory = "Field crop";

  if (/rice|paddy|wheat|maize|corn|millet/.test(crop)) {
    plantCategory = "Cereal";
  } else if (/cotton|soybean|groundnut|pulses|lentil/.test(crop)) {
    plantCategory = "Legume or fibre crop";
  } else if (/tomato|potato|onion|vegetable/.test(crop)) {
    plantCategory = "Vegetable";
  }

  setFormValue(model4Form, "plant_category", plantCategory);

  if (!getFieldValue(field, ["zone", "zoneNumber", "irrigationZone"])) {
    setFormValue(model4Form, "zone", 1);
  }
};


const model4FieldMappings = [
  ["crop_type", ["crop", "cropType", "crop_type"]],
  ["zone", ["zone", "zoneNumber", "irrigationZone"]],
  ["soil_type", ["soilType", "soil_type"]],
  ["bulk_density", ["bulkDensity", "bulk_density"]],
  ["organic_matter_pct", ["organicMatterPct", "organic_matter_pct"]],
  ["cation_exchange_capacity", ["cationExchangeCapacity", "cation_exchange_capacity"]],
  ["salinity_ec", ["salinityEc", "salinity_ec"]],
  ["buffering_capacity", ["bufferingCapacity", "buffering_capacity"]],
  ["moisture_limit_dry", ["moistureLimitDry", "moisture_limit_dry"]],
  ["moisture_limit_wet", ["moistureLimitWet", "moisture_limit_wet"]],
  ["moisture_regime", ["moistureRegime", "moisture_regime"]],
  ["thermal_regime", ["thermalRegime", "thermal_regime"]],
  ["nutrient_balance", ["nutrientBalance", "nutrient_balance"]],
  ["plant_category", ["plantCategory", "plant_category"]],
  ["air_temp_c", ["airTemperatureC", "air_temp_c"]],
  ["light_intensity_par", ["lightIntensityPar", "light_intensity_par"]],
  ["nitrogen_ppm", ["nitrogenPpm", "nitrogen_ppm"]],
  ["phosphorus_ppm", ["phosphorusPpm", "phosphorus_ppm"]],
  ["potassium_ppm", ["potassiumPpm", "potassium_ppm"]]
];

const applyFieldMetadata = (field) => {
  if (model3InputMode === "auto") {
    setFormValue(
      model3Form,
      "zone",
      getFieldValue(field, ["zone", "zoneNumber", "irrigationZone"])
    );
  }

  if (model4InputMode === "auto") {
    model4FieldMappings.forEach(([name, keys]) => {
      setFormValue(model4Form, name, getFieldValue(field, keys));
    });

    applyModel4DemoProfile(field);
  }
};

const configureInputMode = (panel, modelNumber) => {
  if (!panel) return;

  const updateMode = (mode) => {
    if (modelNumber === 3) {
      model3InputMode = mode;
    } else {
      model4InputMode = mode;
    }

    panel.querySelectorAll("[data-input-mode]").forEach((button) => {
      const active = button.dataset.inputMode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    const status = panel.querySelector("[data-input-mode-status]");
    if (status) {
      status.textContent = mode === "auto"
        ? "Available saved field data will be loaded automatically. You can edit the values."
        : "Manual entry selected. Automatic updates are paused for this model.";
    }

    if (mode === "auto" && selectedOverviewField) {
      applyFieldMetadata(selectedOverviewField);
      void loadFieldSensorReading(selectedOverviewField);
      void loadFieldWeather(selectedOverviewField);
    }
  };

  panel.querySelectorAll("[data-input-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      updateMode(button.dataset.inputMode);
    });
  });
};

      const showSensorLines = (lines) => {
        if (!sensorPanel) return;
        sensorPanel.replaceChildren();

        lines.forEach((line) => {
          const paragraph = document.createElement("p");
          paragraph.textContent = line;
          sensorPanel.appendChild(paragraph);
        });
      };

      const loadFieldSensorReading = async (field) => {
        const requestId = ++sensorRequestId;
        latestModel4SensorReading = null;

        if (
  model3InputMode === "auto" &&
  moistureInput instanceof HTMLInputElement
) {
  moistureInput.value = "";
}

if (model4InputMode === "auto") {
  [
    "soil_moisture_pct",
    "soil_temp_c",
    "soil_ph",
    "salinity_ec"
  ].forEach((name) => setFormValue(model4Form, name, ""));

  applyModel4DemoProfile(field);
}

        const previousResult = root.querySelector("[data-model3-result]");
        if (previousResult) previousResult.hidden = true;

        if (!field) {
          showSensorLines(["Select a field to retrieve its latest saved sensor reading."]);
          return;
        }

        showSensorLines(["Loading the latest saved sensor reading..."]);

        try {
          const readings = await window.JalSaathiProfile.apiRequest(
            `/api/fields/${encodeURIComponent(field.id)}/sensor-readings?limit=1`
          );

          if (requestId !== sensorRequestId) return;

          if (!Array.isArray(readings) || readings.length === 0) {
            showSensorLines(["No saved sensor readings are available for this field."]);
            return;
          }

          const reading = readings[0];
          latestModel4SensorReading = reading;
          const recordedAt = new Date(reading.recorded_at);

          if (
            !Number.isFinite(Number(reading.soil_moisture_percent)) ||
            !Number.isFinite(recordedAt.getTime())
          ) {
            showSensorLines(["The latest sensor response contains invalid data."]);
            return;
          }

          const timestamp = recordedAt.toLocaleString();

          if (
  model3InputMode === "auto" &&
  moistureInput instanceof HTMLInputElement
) {
  moistureInput.value = String(reading.soil_moisture_percent);
}

if (model4InputMode === "auto") {
  setFormValue(model4Form, "soil_moisture_pct", reading.soil_moisture_percent);

  if (reading.soil_temperature_c != null) {
    setFormValue(model4Form, "soil_temp_c", reading.soil_temperature_c);
  }

  if (reading.ph != null) {
    setFormValue(model4Form, "soil_ph", reading.ph);
  }

  if (reading.electrical_conductivity_us_cm != null) {
    setFormValue(model4Form, "salinity_ec", reading.electrical_conductivity_us_cm);
  }
}

          showSensorLines([
            "Actual saved sensor reading",
            `Soil moisture: ${reading.soil_moisture_percent}%`,
            `Soil temperature: ${reading.soil_temperature_c ?? "Not recorded"} °C`,
            `Humidity: ${reading.humidity_percent ?? "Not recorded"}%`,
            `Soil pH: ${reading.ph ?? "Not recorded"}`,
            `Electrical conductivity: ${reading.electrical_conductivity_us_cm ?? "Not recorded"} µS/cm`,
            `Recorded at: ${timestamp}`,
            "Status: Latest saved sensor reading",
"The Model 3 moisture input has been filled automatically using this reading. You can still edit it."
          ]);
        } catch (error) {
          if (requestId !== sensorRequestId) return;
          showSensorLines([
            error instanceof Error
              ? `Could not retrieve sensor readings: ${error.message}`
              : "Could not retrieve sensor readings."
          ]);
        }
      };
      configureInputMode(model3ModePanel, 3);

      const weatherPanel = root.querySelector("[data-field-weather-reading]");
      let weatherRequestId = 0;
      const weatherCache = new Map();

      const showWeatherLines = (lines) => {
        if (!weatherPanel) return;
        weatherPanel.replaceChildren();

        lines.forEach((line) => {
          const paragraph = document.createElement("p");
          paragraph.textContent = line;
          weatherPanel.appendChild(paragraph);
        });
      };

      const loadFieldWeather = async (field) => {
        const requestId = ++weatherRequestId;

        if (!field) {
          showWeatherLines(["Select a field to retrieve weather data."]);
          return;
        }

        if (model3InputMode === "auto" || model4InputMode === "auto") {
          const now = new Date();

          if (model3InputMode === "auto") {
            setFormValue(model3Form, "month", now.getMonth() + 1);
            setFormValue(model3Form, "day", now.getDate());
            setFormValue(model3Form, "hour", now.getHours());
            setFormValue(model3Form, "quarter", Math.floor(now.getMonth() / 3) + 1);

            // Day period: 0 = night, 1 = morning, 2 = afternoon, 3 = evening.
            const hour = now.getHours();
            const dayPeriod = hour < 6 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3;
            setFormValue(model3Form, "day_period", dayPeriod);
          }
        }

        const cacheKey = String(field.id);
        let weatherData = weatherCache.get(cacheKey);

        if (!weatherData) {
          showWeatherLines(["Retrieving current weather and forecast..."]);

          try {
            const params = new URLSearchParams();

            if (field.latitude != null && field.longitude != null) {
              params.set("latitude", String(field.latitude));
              params.set("longitude", String(field.longitude));
            } else if (field.location) {
              params.set("location", String(field.location).slice(0, 100));
            } else {
              throw new Error("This field has no location or coordinates for weather lookup.");
            }

            const currentPromise = window.JalSaathiProfile.apiRequest(
              `/weather/current?${params.toString()}`
            );

            const forecastParams = new URLSearchParams(params);
            forecastParams.set("hours", "24");
            forecastParams.set("timestep", "1h");

            const forecastPromise = window.JalSaathiProfile.apiRequest(
              `/weather/forecast?${forecastParams.toString()}`
            );

            const [currentResult, forecastResult] = await Promise.allSettled([
              currentPromise,
              forecastPromise
            ]);

            if (requestId !== weatherRequestId) return;

            weatherData = {
              current: currentResult.status === "fulfilled" ? currentResult.value : null,
              forecast: forecastResult.status === "fulfilled" ? forecastResult.value : null,
              currentError: currentResult.status === "rejected" ? currentResult.reason : null,
              forecastError: forecastResult.status === "rejected" ? forecastResult.reason : null
            };

            if (weatherData.current || weatherData.forecast) {
              weatherCache.set(cacheKey, weatherData);
            }
          } catch (error) {
            if (requestId !== weatherRequestId) return;
            showWeatherLines([
              error instanceof Error
                ? `Weather unavailable: ${error.message}`
                : "Weather data is unavailable for this field."
            ]);
            return;
          }
        }

        if (requestId !== weatherRequestId) return;

        const current = weatherData.current;
        const forecast = weatherData.forecast;
        const latestForecast = Array.isArray(forecast?.data)
          ? forecast.data.find((item) => item && item.temperature_c != null)
          : null;

        if (model3InputMode === "auto" && current) {
          setFormValue(model3Form, "weather_temp", current.temperature_c);
          setFormValue(model3Form, "weather_humidity", current.humidity_percent);
          setFormValue(model3Form, "weather_rain", current.rainfall_mm_per_hr);
          setFormValue(model3Form, "weather_wind_speed", current.wind_speed_mps);
        }

        if (model4InputMode === "auto" && current) {
          setFormValue(model4Form, "air_temp_c", current.temperature_c);
        }

        const lines = ["Weather source: field location weather service"];

        if (current) {
          lines.push("Current weather observations:");
          lines.push(`Location: ${current.location_name || current.location || field.location || "Field location"}`);
          lines.push(`Air temperature: ${current.temperature_c ?? "Not available"} °C`);
          lines.push(`Humidity: ${current.humidity_percent ?? "Not available"}%`);
          lines.push(`Rainfall: ${current.rainfall_mm_per_hr ?? "Not available"} mm/hr`);
          lines.push(`Rain probability: ${current.precipitation_probability_percent ?? "Not available"}%`);
          lines.push(`Wind speed: ${current.wind_speed_mps ?? "Not available"} m/s`);
          lines.push(`Observation time: ${current.observation_time || "Not supplied"}`);
          lines.push(`Weather data age: ${current.data_age_minutes ?? "Not supplied"} minutes`);
          lines.push(`Weather cache stale: ${current.is_stale === true ? "Yes" : "No"}`);
        } else {
          lines.push("Current weather could not be retrieved.");
        }

        if (latestForecast) {
          lines.push("Next available hourly forecast:");
          lines.push(`Forecast time: ${latestForecast.time || "Not supplied"}`);
          lines.push(`Forecast temperature: ${latestForecast.temperature_c ?? "Not available"} °C`);
          lines.push(`Forecast rainfall: ${latestForecast.rainfall_mm_per_hr ?? "Not available"} mm/hr`);
          lines.push(`Forecast rain probability: ${latestForecast.rain_probability_percent ?? "Not available"}%`);
        } else {
          lines.push("Hourly forecast is unavailable.");
        }

        lines.push("Weather values are observations or forecasts, not soil sensor measurements.");
        lines.push("Weather pressure and solar radiation are not supplied by the current weather response.");

        if (weatherData.currentError) {
          lines.push("Current weather request failed.");
        }
        if (weatherData.forecastError) {
          lines.push("Forecast request failed.");
        }

        showWeatherLines(lines);
      };

      configureInputMode(model4ModePanel, 4);
      const soilTypeInput = model4Form.elements.namedItem("soil_type");

if (soilTypeInput) {
  soilTypeInput.addEventListener("change", () => {
    if (selectedOverviewField && model4InputMode === "auto") {
      applyModel4DemoProfile(selectedOverviewField);
    }
  });
}

      if (overviewField instanceof HTMLSelectElement) {
        overviewField.innerHTML = `<option value="">Select a field</option>${options}`;

                overviewField.addEventListener("change", () => {
          const field = fields.find(
            (item) => String(item.id) === overviewField.value
          );

          // Clear previous field's model results.
          latestModel3Result = null;
          latestModel4Result = null;

          // Reset all six summary cards.
          setSummaryCard(
            "moisture",
            "Awaiting prediction",
            "Run Model 3 with a verified current moisture reading.",
            "input"
          );

          setSummaryCard(
            "irrigation",
            "Waiting for Model 3",
            "Run Model 3 to view its irrigation-related output.",
            "input"
          );

          setSummaryCard(
            "timing",
            "Waiting for Model 3",
            "Run Model 3 to view its prediction horizon and timing information.",
            "input"
          );

          setSummaryCard(
            "rainfall",
            "Waiting for results",
            "Weather information and Model 3 results will be shown here.",
            "input"
          );

          setSummaryCard(
            "water",
            "Waiting for results",
            "Water quantity will be shown only if a model supplies it.",
            "input"
          );

          setSummaryCard(
            "alert",
            "Waiting for results",
            "Run both models to view their outputs for this field.",
            "input"
          );

          root.querySelectorAll("[data-model-field]").forEach((select) => {
            select.value = field ? String(field.id) : "";
          });

          selectedOverviewField = field;

          updateOverview(field);
          applyFieldMetadata(field);

          void loadFieldSensorReading(field);
          void loadFieldWeather(field);
        });
      }

    } catch (error) {
      root.querySelectorAll("[data-model3-error], [data-model4-error]").forEach((node) => setError(node, error));
      return;
    }

        model3Form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const error = root.querySelector("[data-model3-error]");
      const result = root.querySelector("[data-model3-result]");

      if (
        !(error instanceof HTMLElement) ||
        !(result instanceof HTMLElement) ||
        !model3Form.reportValidity()
      ) return;

      error.hidden = true;

      try {
        const response = await window.JalSaathiProfile.apiRequest(
          "/api/ml/soil-moisture-prediction",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formPayload(model3Form)),
          }
        );

        if (
          !Number.isFinite(Number(response.predicted_moisture_24h_percent))
        ) {
          throw new Error(
            "The soil moisture service returned an invalid prediction."
          );
        }

        renderModel3(result, response);

        latestModel3Result = response;

        const predictedMoisture = Number(
          response.predicted_moisture_24h_percent
        );
        const horizon = response.prediction_horizon_hours ?? 24;

        let moistureMessage =
          `Expected soil moisture after ${horizon} hours: ` +
          `${predictedMoisture.toFixed(2)}%. ` +
          `Strategy: ${response.strategy || "Not specified"}.`;

        if (response.strategy === "persistence") {
          moistureMessage +=
            " This is a persistence estimate based on the current reading, " +
            "not a dynamic weather-based forecast.";
        }

        setSummaryCard(
          "moisture",
          "Prediction available",
          moistureMessage
        );

        updateSummaryCards();

      } catch (requestError) {
        result.hidden = true;
        setError(error, requestError);
      }
    });

        model4Form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const error = root.querySelector("[data-model4-error]");
      const result = root.querySelector("[data-model4-result]");

      if (
        !(error instanceof HTMLElement) ||
        !(result instanceof HTMLElement) ||
        !model4Form.reportValidity()
      ) return;

      error.hidden = true;

      try {
        const response = await window.JalSaathiProfile.apiRequest(
          "/api/ml/crop-stress-prediction",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formPayload(model4Form)),
          }
        );

        if (
          !Number.isInteger(response.predicted_class) ||
          response.class_label_status !== "unverified"
        ) {
          throw new Error(
            "The crop stress service returned an invalid or unverifiable class."
          );
        }

        renderModel4(result, response);

        latestModel4Result = response;

        updateSummaryCards();

      } catch (requestError) {
        result.hidden = true;
        setError(error, requestError);
      }
    });
  };

  window.JalSaathiModelPredictions = Object.freeze({ initialize });
})();
