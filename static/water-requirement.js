(function () {
  "use strict";

  const initialize = () => {
    const form = document.querySelector("[data-experimental-form]");
    const fieldSelect = form?.querySelector("[data-experimental-field]");
    const cropSelect = form?.querySelector("[data-experimental-crop-record]");
    const fieldOutput = document.querySelector("[data-water-field]");
    const cropOutput = document.querySelector("[data-water-crop]");
    const estimateOutput = document.querySelector("[data-water-estimate]");
    const statusOutput = document.querySelector("[data-water-status]");
    const message = document.querySelector("[data-water-requirement-message]");
    const refresh = document.querySelector("[data-water-requirement-refresh]");
    const explain = document.querySelector("[data-model2-explain]");
    const explainStatus = document.querySelector("[data-model2-explanation-result]");
    if (
      !(form instanceof HTMLFormElement) ||
      !(fieldSelect instanceof HTMLSelectElement) ||
      !(cropSelect instanceof HTMLSelectElement) ||
      !(fieldOutput instanceof HTMLElement) ||
      !(cropOutput instanceof HTMLElement) ||
      !(estimateOutput instanceof HTMLElement) ||
      !(statusOutput instanceof HTMLElement) ||
      !(message instanceof HTMLElement) ||
      !(refresh instanceof HTMLButtonElement)
    ) return;

    let requestInFlight = false;
    const updateSelection = () => {
      const fieldOption = fieldSelect.selectedOptions[0];
      const cropOption = cropSelect.selectedOptions[0];
      fieldOutput.textContent = fieldSelect.value ? fieldOption?.textContent || "Selected field" : "Choose a field below";
      cropOutput.textContent = cropSelect.value ? cropOption?.textContent || "Selected crop" : "Choose an associated crop";
      estimateOutput.textContent = "Unavailable";
      statusOutput.textContent = "No validated real-world water-requirement model is available.";
      message.textContent = "No estimate has been generated.";
      if (explain instanceof HTMLButtonElement) explain.disabled = true;
      if (explainStatus instanceof HTMLElement) {
        explainStatus.textContent = "Explanation is unavailable until a validated Model 2 estimate exists.";
      }
      refresh.disabled = requestInFlight || !fieldSelect.value || !cropSelect.value;
    };

    form.addEventListener("change", updateSelection);
    updateSelection();
    refresh.addEventListener("click", async () => {
      if (refresh.disabled || requestInFlight) return;
      requestInFlight = true;
      refresh.disabled = true;
      estimateOutput.textContent = "Unavailable";
      statusOutput.textContent = "Checking whether a validated model is available…";
      message.textContent = "Requesting an estimate for the selected field and crop.";
      try {
        const api = window.JalSaathiProfile;
        if (!api || typeof api.apiRequest !== "function") {
          throw new Error("The authenticated API helper is not initialized.");
        }
        const result = await api.apiRequest("/api/ml/water-requirement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            field_id: Number(fieldSelect.value),
            crop_id: Number(cropSelect.value),
            prediction_period_hours: 24,
          }),
        });
        if (
          !result || !Number.isFinite(result.estimated_water_liters) ||
          result.estimated_water_liters < 0 ||
          result.prediction_period_hours !== 24 ||
          typeof result.unit !== "string"
        ) {
          throw new Error("The water-requirement service returned an invalid estimate.");
        }
        estimateOutput.textContent = `${result.estimated_water_liters} ${result.unit}`;
        statusOutput.textContent = `Model ${result.model_version || "unknown"} · ${result.dataset_provenance || "provenance unavailable"}`;
        message.textContent = Array.isArray(result.limitations)
          ? result.limitations.join(" ")
          : "Estimate loaded. Review its limitations before use.";
        const verifiedResult =
          result.unit === "liters_per_field_per_24_hours" &&
          result.prediction_period_hours === 24 &&
          result.target_basis === "gross_irrigation_requirement" &&
          result.dataset_provenance === "real_observed_with_independently_verified_labels" &&
          typeof result.target_definition_approval_id === "string" &&
          result.target_definition_approval_id.length > 0;
        if (explain instanceof HTMLButtonElement) explain.disabled = !verifiedResult;
        if (explainStatus instanceof HTMLElement) {
          explainStatus.textContent = verifiedResult
            ? "A server-validated estimate is available for explanation."
            : "Explanation is unavailable because this result is not independently verified.";
        }
      } catch (error) {
        estimateOutput.textContent = "Unavailable";
        statusOutput.textContent = "No validated real-world water-requirement model is available.";
        message.textContent = error instanceof Error
          ? error.message
          : "A water-requirement estimate could not be produced.";
        if (explain instanceof HTMLButtonElement) explain.disabled = true;
        if (explainStatus instanceof HTMLElement) {
          explainStatus.textContent = "Explanation is unavailable until a validated Model 2 estimate exists.";
        }
      } finally {
        requestInFlight = false;
        refresh.disabled = !fieldSelect.value || !cropSelect.value;
      }
    });
  };

  window.JalSaathiWaterRequirement = Object.freeze({ initialize });
})();
