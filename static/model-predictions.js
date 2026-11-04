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

    let fields;
    try {
      fields = await window.JalSaathiFieldStore.loadServerFields();
      const options = fields.map((field) =>
        `<option value="${String(field.id)}">${String(field.name).replace(/[&<>"']/g, "")}</option>`
      ).join("");
      root.querySelectorAll("[data-model-field]").forEach((select) => {
        select.innerHTML = `<option value="">Select a field</option>${options}`;
      });
    } catch (error) {
      root.querySelectorAll("[data-model3-error], [data-model4-error]").forEach((node) => setError(node, error));
      return;
    }

    model3Form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = root.querySelector("[data-model3-error]");
      const result = root.querySelector("[data-model3-result]");
      if (!(error instanceof HTMLElement) || !(result instanceof HTMLElement) || !model3Form.reportValidity()) return;
      error.hidden = true;
      try {
        const response = await window.JalSaathiProfile.apiRequest("/api/ml/soil-moisture-prediction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formPayload(model3Form)),
        });
        if (!Number.isFinite(Number(response.predicted_moisture_24h_percent))) {
          throw new Error("The soil moisture service returned an invalid prediction.");
        }
        renderModel3(result, response);
      } catch (requestError) {
        result.hidden = true;
        setError(error, requestError);
      }
    });

    model4Form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = root.querySelector("[data-model4-error]");
      const result = root.querySelector("[data-model4-result]");
      if (!(error instanceof HTMLElement) || !(result instanceof HTMLElement) || !model4Form.reportValidity()) return;
      error.hidden = true;
      try {
        const response = await window.JalSaathiProfile.apiRequest("/api/ml/crop-stress-prediction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formPayload(model4Form)),
        });
        if (!Number.isInteger(response.predicted_class) || response.class_label_status !== "unverified") {
          throw new Error("The crop stress service returned an invalid or unverifiable class.");
        }
        renderModel4(result, response);
      } catch (requestError) {
        result.hidden = true;
        setError(error, requestError);
      }
    });
  };

  window.JalSaathiModelPredictions = Object.freeze({ initialize });
})();
