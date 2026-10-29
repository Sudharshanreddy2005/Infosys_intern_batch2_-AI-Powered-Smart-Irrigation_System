(function () {
  "use strict";

  const PROXY_RULE = "soil_moisture <= 20.0";
  const FEATURE_SOURCES = {
    temperature_c: "selected_field_current_weather_api",
    humidity_percent: "selected_field_current_weather_api",
  };
  const RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 15 * 1000;

  const validatePrediction = (prediction) => {
    if (!(
      prediction && typeof prediction === "object" &&
      (prediction.prediction === 0 || prediction.prediction === 1) &&
      typeof prediction.proxy_positive_probability === "number" &&
      Number.isFinite(prediction.proxy_positive_probability) &&
      prediction.proxy_positive_probability >= 0 &&
      prediction.proxy_positive_probability <= 1 &&
      prediction.target === "irrigation_needed_proxy" &&
      prediction.proxy_rule === PROXY_RULE &&
      typeof prediction.warning === "string" &&
      Boolean(prediction.warning.trim()) &&
      prediction.model_status === "Experimental" &&
      prediction.dataset_provenance === "synthetic_or_synthetic_augmented" &&
      ["logistic_regression", "random_forest"].includes(prediction.selected_model) &&
      prediction.feature_sources &&
      Object.keys(prediction.feature_sources).length === 2 &&
      Object.entries(FEATURE_SOURCES).every(([feature, source]) =>
        prediction.feature_sources[feature] === source) &&
      typeof prediction.observation_time === "string"
    )) return false;

    const observationAge = Date.now() - Date.parse(prediction.observation_time);
    return Number.isFinite(observationAge) &&
      observationAge >= -60 * 1000 &&
      observationAge < 15 * 60 * 1000;
  };

  const appendText = (parent, tag, className, text, translationKey = "") => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    if (translationKey) node.setAttribute("data-i18n-key", translationKey);
    parent.append(node);
    return node;
  };

  const coordinateKey = (field) => {
    const { latitude, longitude } = field;
    const latitudeMissing = latitude === null || latitude === undefined;
    const longitudeMissing = longitude === null || longitude === undefined;
    if (latitudeMissing && longitudeMissing) return null;
    if (latitudeMissing !== longitudeMissing) return false;
    if (typeof latitude !== "number" || !Number.isFinite(latitude) ||
        latitude < -90 || latitude > 90 ||
        typeof longitude !== "number" || !Number.isFinite(longitude) ||
        longitude < -180 || longitude > 180) return false;
    return `${latitude},${longitude}`;
  };

  const createRenderer = ({
    resultCacheTtlMs = RESULT_CACHE_TTL_MS,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
  } = {}) => {
    const fieldStates = new Map();

    const renderUnavailable = (status, fieldId, detail, onRetry) => {
      status.classList.remove("recommendation-data-status--model1");
      status.dataset.fieldId = String(fieldId ?? "");
      status.replaceChildren();
      const icon = appendText(status, "span", "recommendation-info-icon", "i");
      icon.setAttribute("aria-hidden", "true");
      const content = document.createElement("div");
      appendText(content, "strong", "", "Experimental result unavailable", "model.experimentalUnavailable");
      appendText(content, "p", "", detail);
      if (onRetry) {
        const retry = appendText(content, "button", "recommendation-model-retry", "Retry");
        retry.type = "button";
        retry.addEventListener("click", onRetry);
      }
      status.append(icon, content);
    };

    const renderCoordinatesMissing = (status, field) => {
      status.classList.remove("recommendation-data-status--model1");
      status.dataset.fieldId = String(field.id);
      status.replaceChildren();
      const content = document.createElement("div");
      appendText(content, "strong", "", "Experimental result unavailable", "model.experimentalUnavailable");
      appendText(
        content,
        "p",
        "",
        "Add this field's location coordinates to view its experimental result.",
      );
      const editLink = appendText(content, "a", "", "Add field coordinates");
      editLink.href = `/static/sections.html?view=fields&edit_field=${encodeURIComponent(field.id)}`;
      status.append(content);
    };

    const renderLoading = (status, fieldId) => {
      status.classList.remove("recommendation-data-status--model1");
      status.dataset.fieldId = String(fieldId);
      status.replaceChildren();
      const content = document.createElement("div");
      appendText(content, "strong", "", "Experimental result loading", "model.experimentalLoading");
      appendText(
        content,
        "p",
        "",
        "Retrieving fresh current weather for this field.",
      );
      status.append(content);
    };

    const renderPrediction = (status, fieldId, prediction) => {
      status.classList.add("recommendation-data-status--model1");
      status.dataset.fieldId = String(fieldId);
      status.replaceChildren();
      const content = document.createElement("div");
      content.className = "recommendation-model-content";
      const positive = prediction.prediction === 1;
      appendText(
        content,
        "strong",
        "recommendation-model-class",
        positive ? "Irrigation Needed" : "Irrigation Not Needed",
        positive ? "model.irrigationNeeded" : "model.irrigationNotNeeded",
      );
      appendText(
        content,
        "p",
        "recommendation-model-label",
        "Experimental result",
        "model.experimentalResult",
      );
      const probability = document.createElement("p");
      probability.className = "recommendation-model-probability";
      appendText(
        probability,
        "span",
        "",
        "Probability:",
        "model.probabilityLabel",
      );
      appendText(
        probability,
        "span",
        "",
        ` ${(prediction.proxy_positive_probability * 100).toFixed(1)}%`,
      );
      content.append(probability);
      status.append(content);
    };

    const displayFailure = (status, field, state) => {
      if (String(status.dataset.fieldId) !== String(field.id)) return;
      renderUnavailable(
        status,
        field.id,
        state.error === "timeout"
          ? "The field-specific prediction timed out. Check your connection and retry."
          : state.error === "invalid"
            ? "The experimental response was invalid. No result was displayed. Retry when the service is available."
            : "Fresh field-specific weather or the experimental result is unavailable. Try again.",
        () => { void update(status, field, [], state.apiRequest, true); },
      );
    };

    const update = async (status, field, _crops, apiRequest, force = false) => {
      const fieldId = Number(field?.id);
      if (!Number.isSafeInteger(fieldId) || fieldId <= 0) {
        renderUnavailable(status, "", "No valid selected field is available.");
        return;
      }
      const fieldCoordinates = coordinateKey(field);
      if (fieldCoordinates === null) {
        const existing = fieldStates.get(String(fieldId));
        existing?.controller?.abort();
        fieldStates.delete(String(fieldId));
        renderCoordinatesMissing(status, field);
        return;
      }
      if (fieldCoordinates === false) {
        fieldStates.get(String(fieldId))?.controller?.abort();
        fieldStates.delete(String(fieldId));
        renderUnavailable(status, fieldId, "This field's saved coordinates are invalid. Update them before retrying.");
        return;
      }
      if (typeof apiRequest !== "function") {
        renderUnavailable(status, fieldId, "The authenticated prediction service is unavailable.");
        return;
      }

      const key = String(fieldId);
      const updatedAt = field.updated_at || "";
      let state = fieldStates.get(key);
      if (state && (state.coordinates !== fieldCoordinates || state.updatedAt !== updatedAt)) {
        state.controller?.abort();
        fieldStates.delete(key);
        state = null;
      }
      if (state?.status === "result" &&
          Date.now() < state.expiresAt && !force) {
        renderPrediction(status, fieldId, state.prediction);
        return;
      }
      if (state?.status === "pending") {
        state.statusElement = status;
        state.field = field;
        renderLoading(status, fieldId);
        await state.promise;
        return;
      }
      if (state?.status === "error" && !force) {
        state.statusElement = status;
        state.field = field;
        displayFailure(status, field, state);
        return;
      }

      state?.controller?.abort();
      const controller = new AbortController();
      state = {
        coordinates: fieldCoordinates,
        updatedAt,
        status: "pending",
        statusElement: status,
        field,
        apiRequest,
        controller,
      };
      fieldStates.set(key, state);
      renderLoading(status, fieldId);
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, requestTimeoutMs);
      });
      state.promise = Promise.race([
        Promise.resolve().then(() => apiRequest("/api/ml/reduced-weather-prediction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field_id: fieldId }),
          signal: controller.signal,
        })),
        timeout,
      ]);
      try {
        const prediction = await state.promise;
        if (fieldStates.get(key) !== state) return;
        if (!validatePrediction(prediction)) {
          state.status = "error";
          state.error = "invalid";
          displayFailure(state.statusElement, state.field, state);
          return;
        }
        state.status = "result";
        state.prediction = prediction;
        state.receivedAt = Date.now();
        const observationAge = Math.max(
          0,
          state.receivedAt - Date.parse(prediction.observation_time),
        );
        state.expiresAt = state.receivedAt + Math.min(
          resultCacheTtlMs,
          Math.max(0, 15 * 60 * 1000 - observationAge),
        );
        const target = state.statusElement;
        if (String(target?.dataset?.fieldId) === key) {
          renderPrediction(target, fieldId, prediction);
        }
      } catch (error) {
        if (fieldStates.get(key) !== state) return;
        state.status = "error";
        state.error = error instanceof Error && error.message === "timeout" ? "timeout" : "unavailable";
        if (state.statusElement) displayFailure(state.statusElement, state.field, state);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    };

    const reconcile = (fields) => {
      const current = new Map(
        fields.map((field) => [String(field.id), {
          coordinates: coordinateKey(field),
          updatedAt: field.updated_at || "",
        }]),
      );
      for (const [id, state] of fieldStates) {
        const field = current.get(id);
        if (!field || field.coordinates !== state.coordinates || field.updatedAt !== state.updatedAt) {
          state.controller?.abort();
          fieldStates.delete(id);
        }
      }
    };

    const cancel = () => {
      for (const state of fieldStates.values()) state.controller?.abort();
      fieldStates.clear();
    };

    return Object.freeze({ update, reconcile, cancel });
  };

  window.JalSaathiModel1Recommendation = Object.freeze({
    validatePrediction,
    createRenderer,
  });
})();
