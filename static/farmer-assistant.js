(function () {
  "use strict";

  const appendMessage = (log, role, content) => {
    const message = document.createElement("p");
    message.className = `farmer-assistant-message farmer-assistant-message--${role}`;
    message.textContent = content;
    message.setAttribute("data-user-content", "");
    log.append(message);
    log.scrollTop = log.scrollHeight;
  };

  const initialize = () => {
    const form = document.querySelector("[data-assistant-form]");
    const question = document.querySelector("#farmer-assistant-question");
    const log = document.querySelector("[data-assistant-log]");
    const status = document.querySelector("[data-assistant-status]");
    const submit = document.querySelector("[data-assistant-submit]");
    const model2Button = document.querySelector("[data-model2-explain]");
    const model2Status = document.querySelector("[data-model2-explanation-result]");
    const model2Form = document.querySelector("[data-experimental-form]");
    if (
      !(form instanceof HTMLFormElement) ||
      !(question instanceof HTMLTextAreaElement) ||
      !(log instanceof HTMLElement) ||
      !(status instanceof HTMLElement) ||
      !(submit instanceof HTMLButtonElement) ||
      !(model2Button instanceof HTMLButtonElement) ||
      !(model2Status instanceof HTMLElement) ||
      !(model2Form instanceof HTMLFormElement)
    ) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = question.value.trim();
      if (!text || text.length > 1500 || submit.disabled) return;

      appendMessage(log, "user", text);
      submit.disabled = true;
      status.textContent = "The assistant is preparing a response…";
      try {
        const api = window.JalSaathiProfile?.apiRequest;
        if (typeof api !== "function") {
          throw new Error("The authenticated API helper is unavailable.");
        }
        const result = await api("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text }),
        });
        if (typeof result?.answer !== "string" || !result.answer.trim()) {
          throw new Error("The assistant returned an invalid response.");
        }
        appendMessage(log, "assistant", result.answer);
        question.value = "";
        status.textContent = "Assistant responses are educational and may be incorrect.";
      } catch (error) {
        status.textContent = error instanceof Error
          ? error.message
          : "The assistant is unavailable. Please try again later.";
      } finally {
        submit.disabled = false;
      }
    });

    model2Button.addEventListener("click", async () => {
      if (model2Button.disabled) return;
      const field = model2Form.querySelector("[data-experimental-field]");
      const crop = model2Form.querySelector("[data-experimental-crop-record]");
      if (
        !(field instanceof HTMLSelectElement) ||
        !(crop instanceof HTMLSelectElement) ||
        !field.value ||
        !crop.value
      ) {
        model2Status.textContent = "Choose an owned field and crop before requesting an explanation.";
        return;
      }

      model2Button.disabled = true;
      model2Status.textContent = "Checking for a server-validated Model 2 estimate…";
      try {
        const api = window.JalSaathiProfile?.apiRequest;
        if (typeof api !== "function") {
          throw new Error("The authenticated API helper is unavailable.");
        }
        const result = await api("/api/assistant/model2-explanation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            field_id: Number(field.value),
            crop_id: Number(crop.value),
            question: "Explain what this estimate represents and summarize its limitations. Do not recalculate or change the estimate.",
          }),
        });
        const prediction = result?.prediction;
        if (
          !Number.isFinite(prediction?.estimated_water_liters) ||
          prediction.estimated_water_liters < 0 ||
          prediction.unit !== "liters_per_field_per_24_hours" ||
          prediction.prediction_period_hours !== 24 ||
          prediction.target_basis !== "gross_irrigation_requirement" ||
          prediction.dataset_provenance !== "real_observed_with_independently_verified_labels" ||
          typeof prediction.target_definition_approval_id !== "string" ||
          typeof prediction.model_version !== "string" ||
          typeof result.explanation !== "string" ||
          !result.explanation.trim()
        ) {
          throw new Error("The server returned an invalid or unverified Model 2 explanation.");
        }
        model2Status.textContent =
          `Server-validated estimate considered by the assistant: ${prediction.estimated_water_liters} ${prediction.unit} for ${prediction.prediction_period_hours} hours. ${result.explanation}`;
        appendMessage(log, "assistant", result.explanation);
      } catch (error) {
        model2Status.textContent = error instanceof Error
          ? error.message
          : "A validated Model 2 estimate is unavailable.";
      } finally {
        model2Button.disabled = false;
      }
    });
  };

  window.JalSaathiFarmerAssistant = Object.freeze({ initialize });
})();
