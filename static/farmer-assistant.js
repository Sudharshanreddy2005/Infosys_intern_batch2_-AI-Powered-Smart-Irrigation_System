(function () {
  "use strict";

  const appendMessage = (log, role, content) => {
    const message = document.createElement("p");
    message.className = `farmer-assistant-message farmer-assistant-message--${role}`;
    message.textContent = role === "assistant"
      ? window.JalSaathiNumberFormat.normalizeAssistantText(content)
      : content;
    message.setAttribute("data-user-content", "");
    log.append(message);
    log.scrollTop = log.scrollHeight;
  };

  const getLanguageCode = () => {
    const profile = window.JalSaathiProfile;
    const i18n = window.JalSaathiI18n;
    const language = profile?.getLanguage?.() || i18n?.getLanguage?.() || "en";
    return profile?.getLanguages?.().find((item) => item.code === language)?.locale ||
      i18n?.languages?.find((item) => item.code === language)?.locale ||
      "en-IN";
  };

  const setLocalizedStatus = (element, key) => {
    const i18n = window.JalSaathiI18n;
    const source = i18n?.translationKeys?.[key] ||
      i18n?.translationKeys?.["common.translationMissing"];
    if (!source || typeof i18n?.translate !== "function") {
      throw new Error("The shared localization service is unavailable.");
    }
    element.removeAttribute("data-user-content");
    element.setAttribute("data-i18n-key", key);
    element.textContent = source;
    i18n.translate(element);
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
      setLocalizedStatus(status, "assistant.status.preparing");
      try {
        const api = window.JalSaathiProfile?.apiRequest;
        if (typeof api !== "function") {
          throw new Error("The authenticated API helper is unavailable.");
        }
        const result = await api("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: text,
            language_code: getLanguageCode(),
          }),
        });
        if (typeof result?.answer !== "string" || !result.answer.trim()) {
          throw new Error("The assistant returned an invalid response.");
        }
        appendMessage(log, "assistant", result.answer);
        question.value = "";
        setLocalizedStatus(status, "assistant.notice.educational");
      } catch (error) {
        setLocalizedStatus(
          status,
          error?.status === 429 ? "assistant.error.busy" : "assistant.error.unavailable",
        );
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
        setLocalizedStatus(model2Status, "assistant.model2.selectFieldCrop");
        return;
      }

      model2Button.disabled = true;
      setLocalizedStatus(model2Status, "assistant.model2.checking");
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
            language_code: getLanguageCode(),
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
          setLocalizedStatus(model2Status, "assistant.model2.invalidExplanation");
          return;
        }
        model2Status.setAttribute("data-user-content", "");
        model2Status.removeAttribute("data-i18n-key");
        const amount = window.JalSaathiI18n?.formatNumber
          ? window.JalSaathiI18n.formatNumber(prediction.estimated_water_liters)
          : String(prediction.estimated_water_liters);
        const i18n = window.JalSaathiI18n;
        const unit = i18n?.t("assistant.model2.unit") ||
          i18n?.t("common.translationMissing");
        const estimatePrefix = i18n?.t("assistant.model2.estimatePrefix", {
          amount,
          unit,
          hours: prediction.prediction_period_hours,
        }) || i18n?.t("common.translationMissing");
        if (!unit || !estimatePrefix) {
          setLocalizedStatus(model2Status, "assistant.model2.unavailable");
          return;
        }
        const explanation = window.JalSaathiNumberFormat.normalizeAssistantText(result.explanation);
        model2Status.textContent = `${estimatePrefix} ${explanation}`;
        appendMessage(log, "assistant", explanation);
      } catch (error) {
        setLocalizedStatus(
          model2Status,
          error?.status === 429 ? "assistant.error.busy" : "assistant.model2.unavailable",
        );
      } finally {
        model2Button.disabled = false;
      }
    });
  };

  window.JalSaathiFarmerAssistant = Object.freeze({ initialize });
})();
