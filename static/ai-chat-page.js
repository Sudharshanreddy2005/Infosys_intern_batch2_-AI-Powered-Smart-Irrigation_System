(() => {
  "use strict";

  const MAX_MESSAGES = 200;
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const rootSelector = "[data-ai-chat]";
  const translate = (key, values) => window.JalSaathiI18n?.t(key, values) || key;
  const localeCode = () => {
    const profile = window.JalSaathiProfile;
    const selected = profile?.getLanguage?.() || window.JalSaathiI18n?.getLanguage?.() || "en";
    return profile?.getLanguages?.().find((item) => item.code === selected)?.locale ||
      window.JalSaathiI18n?.languages?.find((item) => item.code === selected)?.locale ||
      "en-IN";
  };
  const apiRequest = () => {
    const api = window.JalSaathiProfile?.apiRequest;
    if (typeof api !== "function") throw new Error("The authenticated API helper is unavailable.");
    return api;
  };
  const createElement = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const userMessage = (message) => ({
    role: "user",
    content: message.content,
  });
  let activeRoot = null;
  let activeConversationId = null;
  let conversations = [];
  let messages = [];
  let fields = [];
  let crops = [];
  let loading = false;
  let reportFormat = "text";
  let renameTargetId = null;
  let eventController = null;
  let selectedImage = null;
  let imagePreviewUrl = null;
  let speechRecognition = null;
  let cameraStream = null;

  function getElements() {
    if (!(activeRoot instanceof HTMLElement)) return null;
    return {
      root: activeRoot,
      sidebar: activeRoot.querySelector("[data-ai-sidebar]"),
      historyList: activeRoot.querySelector("[data-ai-history-list]"),
      historyEmpty: activeRoot.querySelector("[data-ai-history-empty]"),
      scrim: activeRoot.querySelector("[data-ai-close-sidebar].ai-chat-sidebar-scrim"),
      field: activeRoot.querySelector("[data-ai-field]"),
      crop: activeRoot.querySelector("[data-ai-crop]"),
      period: activeRoot.querySelector("[data-ai-period]"),
      format: activeRoot.querySelector("[data-ai-format]"),
      feedback: activeRoot.querySelector("[data-ai-feedback]"),
      thread: activeRoot.querySelector("[data-ai-thread]"),
      form: activeRoot.querySelector("[data-ai-form]"),
      question: activeRoot.querySelector("[data-ai-question]"),
      send: activeRoot.querySelector("[data-ai-send]"),
      imageInput: activeRoot.querySelector("[data-ai-image-input]"),
      imagePreview: activeRoot.querySelector("[data-ai-image-preview]"),
      attach: activeRoot.querySelector("[data-ai-attach]"),
      attachmentMenu: activeRoot.querySelector("[data-ai-attachment-menu]"),
      uploadPhoto: activeRoot.querySelector("[data-ai-upload]"),
      camera: activeRoot.querySelector("[data-ai-camera]"),
      cameraPanel: activeRoot.querySelector("[data-ai-camera-panel]"),
      cameraVideo: activeRoot.querySelector("[data-ai-camera-video]"),
      cameraCapture: activeRoot.querySelector("[data-ai-camera-capture]"),
      cameraClose: activeRoot.querySelector("[data-ai-camera-close]"),
      voice: activeRoot.querySelector("[data-ai-voice]"),
      clear: activeRoot.querySelector("[data-ai-clear]"),
      renamePanel: activeRoot.querySelector("[data-ai-rename-panel]"),
      renameInput: activeRoot.querySelector("[data-ai-rename-input]"),
    };
  }

  function setFeedback(key) {
    const { feedback } = getElements() || {};
    if (!(feedback instanceof HTMLElement)) return;
    feedback.hidden = !key;
    feedback.textContent = key ? translate(key) : "";
    if (key) {
      feedback.dataset.i18nKey = key;
      window.JalSaathiI18n?.translate(feedback);
    } else {
      delete feedback.dataset.i18nKey;
    }
  }

  function errorKey(error, imageRequest = false) {
    if (error?.status === 401) return "aiChat.errorExpired";
    if (error?.status === 429) return "aiChat.errorBusy";
    if (error?.status === 0 || !navigator.onLine) return "aiChat.errorOffline";
    if (imageRequest && [413, 415, 422].includes(error?.status)) return "aiChat.imageInvalid";
    if (imageRequest && [502, 504].includes(error?.status)) return "aiChat.imageUnavailable";
    if (error?.status === 504) return "aiChat.errorTimeout";
    if (error?.status === 503) return "aiChat.errorConfiguration";
    if (error?.status >= 500) return "aiChat.errorUnavailable";
    return "aiChat.errorRequest";
  }

  function appendOption(select, value, label, translationKey) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = label;
    if (translationKey) option.dataset.i18nKey = translationKey;
    else option.dataset.userContent = "";
    select.append(option);
  }

  function updateCropOptions() {
    const { field, crop } = getElements() || {};
    if (!(field instanceof HTMLSelectElement) || !(crop instanceof HTMLSelectElement)) return;
    const selectedCrop = crop.value;
    const selectedField = field.value === "all" ? null : Number(field.value);
    crop.replaceChildren();
    appendOption(crop, "all", translate("chartAssistant.allCrops"), "chartAssistant.allCrops");
    crops.filter((item) => selectedField === null || item.field_id === selectedField)
      .forEach((item) => appendOption(crop, item.id, item.name));
    if ([...crop.options].some((option) => option.value === selectedCrop)) {
      crop.value = selectedCrop;
    }
  }

  async function loadFarmOptions() {
    const api = apiRequest();
    const [fieldRecords, cropRecords] = await Promise.all([
      api("/api/fields"),
      api("/api/crops"),
    ]);
    if (!Array.isArray(fieldRecords) || !Array.isArray(cropRecords)) {
      throw new Error("The farm records returned an invalid response.");
    }
    fields = fieldRecords.filter((field) => Number.isInteger(field?.id) && typeof field.name === "string");
    crops = cropRecords.filter((crop) =>
      Number.isInteger(crop?.id) && typeof crop.name === "string" &&
      (crop.field_id === null || Number.isInteger(crop.field_id)),
    );
    const { field } = getElements() || {};
    if (!(field instanceof HTMLSelectElement)) return;
    field.replaceChildren();
    appendOption(field, "all", translate("chartAssistant.allFields"), "chartAssistant.allFields");
    fields.forEach((item) => appendOption(field, item.id, item.name));
    updateCropOptions();
  }

  function validMessages(items) {
    if (!Array.isArray(items)) return [];
    return items.flatMap((message) => {
      if (!message || !["user", "assistant"].includes(message.role) ||
          typeof message.content !== "string" || !message.content.trim()) return [];
      return [{
        role: message.role,
        content: message.content,
        ...(message.role === "user" && message.image_attached === true
          ? { image_attached: true }
          : {}),
        ...(message.role === "assistant" && message.context && typeof message.context === "object"
          ? { context: message.context }
          : {}),
      }];
    }).slice(-MAX_MESSAGES);
  }

  function renderConversationList() {
    const { historyList, historyEmpty } = getElements() || {};
    if (!(historyList instanceof HTMLElement) || !(historyEmpty instanceof HTMLElement)) return;
    historyList.replaceChildren();
    historyEmpty.hidden = conversations.length > 0;
    conversations.forEach((conversation) => {
      const row = createElement("div", "ai-chat-history-row");
      row.classList.toggle("is-active", conversation.id === activeConversationId);
      const open = createElement("button", "ai-chat-history-open");
      open.type = "button";
      open.setAttribute("aria-current", conversation.id === activeConversationId ? "true" : "false");
      const title = createElement("span", "ai-chat-history-name", conversation.title);
      title.dataset.userContent = "";
      const date = createElement("small", "", formatConversationDate(conversation.updated_at));
      open.append(title, date);
      open.addEventListener("click", () => void openConversation(conversation.id));

      const actions = createElement("div", "ai-chat-history-actions");
      const rename = createElement("button", "ai-chat-icon-button", "✎");
      rename.type = "button";
      rename.title = translate("aiChat.rename");
      rename.setAttribute("aria-label", translate("aiChat.rename"));
      rename.addEventListener("click", () => showRename(conversation.id, conversation.title));
      const remove = createElement("button", "ai-chat-icon-button", "×");
      remove.type = "button";
      remove.title = translate("aiChat.delete");
      remove.setAttribute("aria-label", translate("aiChat.delete"));
      remove.addEventListener("click", () => void deleteConversation(conversation.id));
      actions.append(rename, remove);
      row.append(open, actions);
      historyList.append(row);
    });
  }

  function formatConversationDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const selectedLanguage = window.JalSaathiProfile?.getLanguage?.() ||
      window.JalSaathiI18n?.getLanguage?.() || "en";
    return new Intl.DateTimeFormat(selectedLanguage, {
      month: "short",
      day: "numeric",
      numberingSystem: "latn",
    }).format(date);
  }

  function renderDiseaseResult(container, diseaseContext) {
    const prediction = diseaseContext?.prediction;
    if (
      diseaseContext?.status !== "available" ||
      diseaseContext?.source !== "crop_disease_model" ||
      !prediction ||
      typeof prediction.crop_name !== "string" ||
      typeof prediction.disease_name !== "string" ||
      typeof prediction.confidence !== "number" ||
      !Number.isFinite(prediction.confidence)
    ) return;
    const panel = createElement("section", "ai-chat-disease-result");
    const heading = createElement("h3", "", translate("aiChat.diseaseResult"));
    heading.dataset.i18nKey = "aiChat.diseaseResult";
    const result = createElement("p", "");
    const crop = createElement("strong", "", prediction.crop_name);
    crop.dataset.userContent = "";
    const disease = createElement("span", "", ` — ${prediction.disease_name}`);
    disease.dataset.userContent = "";
    result.append(crop, disease);
    const language = window.JalSaathiProfile?.getLanguage?.() ||
      window.JalSaathiI18n?.getLanguage?.() || "en";
    const confidence = new Intl.NumberFormat(language, {
      style: "percent",
      maximumFractionDigits: 1,
      numberingSystem: "latn",
    }).format(prediction.confidence);
    const confidenceText = createElement(
      "small",
      "",
      `${translate("aiChat.diseaseConfidence")}: ${confidence}`,
    );
    panel.append(heading, result, confidenceText);
    if (prediction.is_uncertain === true) {
      const uncertain = createElement("p", "ai-chat-disease-warning", translate("aiChat.diseaseUncertain"));
      uncertain.dataset.i18nKey = "aiChat.diseaseUncertain";
      panel.append(uncertain);
    }
    if (Array.isArray(prediction.top_three_predictions) && prediction.top_three_predictions.length > 1) {
      const label = createElement("small", "", translate("aiChat.diseaseAlternatives"));
      label.dataset.i18nKey = "aiChat.diseaseAlternatives";
      const alternatives = createElement("ul", "");
      prediction.top_three_predictions.slice(1, 3).forEach((item) => {
        if (typeof item?.disease_name !== "string" || typeof item.confidence !== "number") return;
        const confidenceValue = new Intl.NumberFormat(language, {
          style: "percent",
          maximumFractionDigits: 1,
          numberingSystem: "latn",
        }).format(item.confidence);
        const alternative = createElement("li", "", `${item.disease_name} — ${confidenceValue}`);
        alternative.dataset.userContent = "";
        alternatives.append(alternative);
      });
      if (alternatives.childElementCount) panel.append(label, alternatives);
    }
    container.append(panel);
  }

  async function loadConversations() {
    const result = await apiRequest()("/api/assistant/conversations");
    if (!Array.isArray(result)) throw new Error("Conversation history returned an invalid response.");
    conversations = result.filter((item) =>
      Number.isInteger(item?.id) && typeof item.title === "string",
    );
    renderConversationList();
  }

  function updateControls() {
    const { clear, send, attach, voice, imageInput } = getElements() || {};
    if (clear instanceof HTMLButtonElement) clear.disabled = !activeConversationId || loading;
    if (send instanceof HTMLButtonElement) send.disabled = loading;
    if (attach instanceof HTMLButtonElement) attach.disabled = loading;
    if (voice instanceof HTMLButtonElement) voice.disabled = loading;
    if (imageInput instanceof HTMLInputElement) imageInput.disabled = loading;
  }

  function renderMessages() {
    const { thread } = getElements() || {};
    if (!(thread instanceof HTMLElement)) return;
    thread.replaceChildren();
    if (!messages.length) {
      const welcome = createElement("div", "ai-chat-welcome");
      const icon = createElement("span", "ai-chat-welcome-icon", "✦");
      icon.setAttribute("aria-hidden", "true");
      const title = createElement("h2", "", translate("aiChat.welcomeTitle"));
      title.dataset.i18nKey = "aiChat.welcomeTitle";
      const description = createElement("p", "", translate("aiChat.welcome"));
      description.dataset.i18nKey = "aiChat.welcome";
      welcome.append(icon, title, description);
      thread.append(welcome);
    }
    messages.forEach((message, index) => {
      const article = createElement("article", `ai-chat-message ai-chat-message--${message.role}`);
      const bubble = createElement("div", "ai-chat-bubble");
      if (message.role === "assistant") {
        renderDiseaseResult(bubble, message.context?.crop_disease);
        const content = createElement("div", "ai-chat-response");
        content.setAttribute("data-user-content", "");
        const renderer = window.JalSaathiChartAssistant?.renderFormattedResponse;
        if (typeof renderer === "function") renderer(content, message.content);
        else content.textContent = message.content;
        bubble.append(content);
        if (reportFormat === "chart" && message.context) {
          window.JalSaathiChartAssistant?.renderVisualizations(bubble, message.context);
        }
      } else {
        const content = createElement("p", "", message.content);
        content.setAttribute("data-user-content", "");
        bubble.append(content);
        if (message.image_attached) {
          const imageNote = createElement("span", "ai-chat-image-indicator", translate("aiChat.imageSent"));
          imageNote.dataset.i18nKey = "aiChat.imageSent";
          bubble.append(imageNote);
        }
      }
      article.append(bubble);
      if (message.role === "assistant") {
        const actions = createElement("div", "ai-chat-message-actions");
        const copy = createElement("button", "ai-chat-text-button", translate("chartAssistant.copyResponse"));
        copy.type = "button";
        copy.dataset.i18nKey = "chartAssistant.copyResponse";
        copy.addEventListener("click", async () => {
          try {
            if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
            await navigator.clipboard.writeText(message.content);
            setFeedback("chartAssistant.copySuccess");
          } catch (error) {
            console.error("JalSaathi AI response could not be copied.", error);
            setFeedback("chartAssistant.copyFailed");
          }
        });
        actions.append(copy);
        if (index === messages.length - 1 && activeConversationId) {
          const regenerate = createElement("button", "ai-chat-text-button", translate("aiChat.regenerate"));
          regenerate.type = "button";
          regenerate.dataset.i18nKey = "aiChat.regenerate";
          regenerate.disabled = loading;
          regenerate.addEventListener("click", () => void submitMessage("", true));
          actions.append(regenerate);
        }
        article.append(actions);
      }
      thread.append(article);
    });
    if (loading) {
      const waiting = createElement("div", "ai-chat-loading", translate("aiChat.thinking"));
      waiting.setAttribute("role", "status");
      waiting.dataset.i18nKey = "aiChat.thinking";
      thread.append(waiting);
    }
    thread.scrollTop = thread.scrollHeight;
    updateControls();
  }

  async function openConversation(conversationId) {
    if (loading) return;
    try {
      const conversation = await apiRequest()(`/api/assistant/conversations/${conversationId}`);
      if (!Number.isInteger(conversation?.id) || !Array.isArray(conversation.messages)) {
        throw new Error("Conversation history returned an invalid response.");
      }
      activeConversationId = conversation.id;
      messages = validMessages(conversation.messages);
      const { field, crop, sidebar, root, scrim } = getElements() || {};
      if (field instanceof HTMLSelectElement) {
        field.value = conversation.field_id ? String(conversation.field_id) : "all";
      }
      updateCropOptions();
      if (crop instanceof HTMLSelectElement) {
        crop.value = conversation.crop_id ? String(conversation.crop_id) : "all";
      }
      root.classList.remove("is-sidebar-open");
      if (scrim instanceof HTMLButtonElement) scrim.hidden = true;
      sidebar?.setAttribute("aria-label", translate("aiChat.historyTitle"));
      setFeedback("");
      renderConversationList();
      renderMessages();
    } catch (error) {
      console.error("JalSaathi AI conversation could not be opened.", error);
      setFeedback(errorKey(error));
    }
  }

  function startNewConversation() {
    speechRecognition?.abort();
    speechRecognition = null;
    activeConversationId = null;
    messages = [];
    reportFormat = "text";
    const { format, field, crop, root, renamePanel, scrim } = getElements() || {};
    if (format instanceof HTMLSelectElement) format.value = reportFormat;
    if (field instanceof HTMLSelectElement) field.value = "all";
    updateCropOptions();
    if (crop instanceof HTMLSelectElement) crop.value = "all";
    if (root instanceof HTMLElement) root.classList.remove("is-sidebar-open");
    if (scrim instanceof HTMLButtonElement) scrim.hidden = true;
    if (renamePanel instanceof HTMLElement) renamePanel.hidden = true;
    clearSelectedImage();
    setFeedback("");
    renderConversationList();
    renderMessages();
    getElements()?.question?.focus();
  }

  function showRename(conversationId, title) {
    const { renamePanel, renameInput } = getElements() || {};
    if (!(renamePanel instanceof HTMLElement) || !(renameInput instanceof HTMLInputElement)) return;
    renameTargetId = conversationId;
    renameInput.value = title;
    renamePanel.hidden = false;
    renameInput.focus();
    renameInput.select();
  }

  async function saveRename() {
    const { renameInput, renamePanel } = getElements() || {};
    if (!(renameInput instanceof HTMLInputElement) || !renameTargetId) return;
    const title = renameInput.value.trim();
    if (!title || title.length > 120) {
      setFeedback("aiChat.renameInvalid");
      return;
    }
    try {
      await apiRequest()(`/api/assistant/conversations/${renameTargetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (renamePanel instanceof HTMLElement) renamePanel.hidden = true;
      renameTargetId = null;
      await loadConversations();
      setFeedback("");
    } catch (error) {
      console.error("JalSaathi AI conversation could not be renamed.", error);
      setFeedback(errorKey(error));
    }
  }

  async function deleteConversation(conversationId) {
    if (!window.confirm(translate("aiChat.confirmDelete"))) return;
    try {
      await apiRequest()(`/api/assistant/conversations/${conversationId}`, { method: "DELETE" });
      if (activeConversationId === conversationId) startNewConversation();
      await loadConversations();
      setFeedback("");
    } catch (error) {
      console.error("JalSaathi AI conversation could not be deleted.", error);
      setFeedback(errorKey(error));
    }
  }

  function chartRequested(prompt) {
    return /\b(chart|graph|plot|visuali[sz]e)\b|చార్ట్|గ్రాఫ్|चार्ट|ग्राफ|ಚಾರ್ಟ್|ಗ್ರಾಫ್|விளக்கப்படம்|வரைபடம்|ചാർട്ട്|ഗ്രാഫ்/i.test(prompt);
  }

  function clearSelectedImage() {
    const { imageInput, imagePreview } = getElements() || {};
    selectedImage = null;
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    imagePreviewUrl = null;
    if (imageInput instanceof HTMLInputElement) imageInput.value = "";
    if (imagePreview instanceof HTMLElement) {
      imagePreview.replaceChildren();
      imagePreview.hidden = true;
    }
  }

  function showSelectedImage(file, source = "upload") {
    const { imageInput, imagePreview } = getElements() || {};
    if (!(imageInput instanceof HTMLInputElement) || !(imagePreview instanceof HTMLElement)) return;
    if (!IMAGE_TYPES.has(file.type) || file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      clearSelectedImage();
      setFeedback("aiChat.imageInvalid");
      return;
    }
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    selectedImage = file;
    imagePreviewUrl = URL.createObjectURL(file);
    const preview = createElement("img");
    preview.src = imagePreviewUrl;
    preview.alt = translate("aiChat.imagePreview");
    const fileName = createElement("span", "", file.name);
    fileName.dataset.userContent = "";
    const remove = createElement("button", "ai-chat-tool-button", translate("aiChat.removePhoto"));
    remove.type = "button";
    remove.dataset.i18nKey = "aiChat.removePhoto";
    remove.addEventListener("click", clearSelectedImage);
    const controls = [remove];
    if (source === "camera") {
      const retake = createElement("button", "ai-chat-tool-button", translate("aiChat.retakePhoto"));
      retake.type = "button";
      retake.dataset.i18nKey = "aiChat.retakePhoto";
      retake.addEventListener("click", () => void startCameraCapture());
      controls.push(retake);
    }
    imagePreview.replaceChildren(preview, fileName, ...controls);
    imagePreview.hidden = false;
    setFeedback("");
  }

  function closeAttachmentMenu() {
    const { attach, attachmentMenu } = getElements() || {};
    if (attachmentMenu instanceof HTMLElement) attachmentMenu.hidden = true;
    if (attach instanceof HTMLButtonElement) attach.setAttribute("aria-expanded", "false");
  }

  function stopCamera() {
    const { cameraVideo, cameraPanel } = getElements() || {};
    cameraStream?.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    if (cameraVideo instanceof HTMLVideoElement) cameraVideo.srcObject = null;
    if (cameraPanel instanceof HTMLElement) cameraPanel.hidden = true;
  }

  async function startCameraCapture() {
    if (loading) return;
    const { cameraPanel, cameraVideo } = getElements() || {};
    if (!(cameraPanel instanceof HTMLElement) || !(cameraVideo instanceof HTMLVideoElement)) return;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
      setFeedback("aiChat.cameraUnavailable");
      return;
    }
    stopCamera();
    cameraPanel.hidden = false;
    setFeedback("");
    const cameraRoot = activeRoot;
    try {
      const stream = await mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (activeRoot !== cameraRoot || !cameraRoot?.isConnected) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraStream = stream;
      cameraVideo.srcObject = stream;
      cameraVideo.muted = true;
      await cameraVideo.play();
    } catch (error) {
      stopCamera();
      console.error("JalSaathi camera could not be opened.", error);
      setFeedback(
        ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(error?.name)
          ? "aiChat.cameraPermissionDenied"
          : "aiChat.cameraUnavailable",
      );
    }
  }

  function captureCameraPhoto() {
    const { cameraVideo } = getElements() || {};
    if (!(cameraVideo instanceof HTMLVideoElement) || cameraVideo.videoWidth <= 0 ||
        cameraVideo.videoHeight <= 0) {
      setFeedback("aiChat.cameraUnavailable");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = cameraVideo.videoWidth;
    canvas.height = cameraVideo.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setFeedback("aiChat.cameraUnavailable");
      return;
    }
    context.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setFeedback("aiChat.cameraUnavailable");
        return;
      }
      showSelectedImage(new File([blob], "captured-leaf.jpg", { type: "image/jpeg" }), "camera");
      stopCamera();
    }, "image/jpeg", 0.92);
  }

  function startVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const { question } = getElements() || {};
    if (typeof Recognition !== "function") {
      setFeedback("aiChat.voiceUnsupported");
      return;
    }
    speechRecognition?.abort();
    const recognition = new Recognition();
    speechRecognition = recognition;
    recognition.lang = localeCode();
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setFeedback("aiChat.voiceListening");
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results || [])
        .map((result) => result?.[0]?.transcript || "")
        .join(" ")
        .trim();
      if (!transcript) {
        setFeedback("aiChat.voiceNoSpeech");
        return;
      }
      if (question instanceof HTMLTextAreaElement) {
        question.value = `${question.value.trim()}${question.value.trim() ? " " : ""}${transcript}`;
      }
      setFeedback("aiChat.voiceCaptured");
    };
    recognition.onerror = (event) => {
      const key = ["not-allowed", "service-not-allowed"].includes(event.error)
        ? "aiChat.voicePermissionDenied"
        : event.error === "no-speech"
          ? "aiChat.voiceNoSpeech"
          : "aiChat.voiceError";
      setFeedback(key);
    };
    recognition.onend = () => {
      if (speechRecognition === recognition) speechRecognition = null;
    };
    try {
      recognition.start();
    } catch (error) {
      console.error("JalSaathi voice input could not start.", error);
      speechRecognition = null;
      setFeedback("aiChat.voiceError");
    }
  }

  async function submitMessage(prompt, regenerate = false) {
    const elements = getElements();
    if (!elements || loading) return;
    const image = regenerate ? null : selectedImage;
    const question = regenerate
      ? messages.at(-2)?.content
      : prompt.trim() || (image ? translate("aiChat.imageQuestion") : "");
    if (!question || question.length > 1500) return;
    if (!navigator.onLine) {
      setFeedback("aiChat.errorOffline");
      return;
    }
    const previousMessages = messages.slice();
    if (!regenerate) {
      messages.push({
        role: "user",
        content: question,
        ...(image ? { image_attached: true } : {}),
      });
    }
    if (chartRequested(question)) {
      reportFormat = "chart";
      elements.format.value = "chart";
    }
    loading = true;
    if (!regenerate) elements.question.value = "";
    if (image) clearSelectedImage();
    setFeedback("");
    renderMessages();
    const payload = {
      assistant_mode: "chart",
      question,
      language_code: localeCode(),
      field_id: elements.field.value === "all" ? null : Number(elements.field.value),
      crop_id: elements.crop.value === "all" ? null : Number(elements.crop.value),
      chart_period: elements.period.value,
      persist_conversation: true,
      regenerate,
      ...(activeConversationId ? { conversation_id: activeConversationId } : {}),
    };
    try {
      let result;
      if (image) {
        const formData = new FormData();
        formData.append("image", image, "leaf-image");
        formData.append("question", question);
        formData.append("language_code", payload.language_code);
        formData.append("chart_period", payload.chart_period);
        if (payload.field_id !== null) formData.append("field_id", String(payload.field_id));
        if (payload.crop_id !== null) formData.append("crop_id", String(payload.crop_id));
        if (payload.conversation_id) formData.append("conversation_id", String(payload.conversation_id));
        result = await apiRequest()("/api/assistant/image", {
          method: "POST",
          body: formData,
        });
      } else {
        result = await apiRequest()("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (typeof result?.answer !== "string" || !result.answer.trim() ||
          !result.context || typeof result.context !== "object" ||
          !Number.isInteger(result.conversation_id)) {
        const invalid = new Error("JalSaathi AI returned an invalid response.");
        invalid.status = 200;
        throw invalid;
      }
      activeConversationId = result.conversation_id;
      const answer = { role: "assistant", content: result.answer, context: result.context };
      if (regenerate) messages[messages.length - 1] = answer;
      else messages.push(answer);
      messages = messages.slice(-MAX_MESSAGES);
      try {
        await loadConversations();
      } catch (error) {
        console.error("JalSaathi AI history list could not be refreshed.", error);
        setFeedback("aiChat.errorHistory");
      }
    } catch (error) {
      messages = previousMessages;
      if (image && !selectedImage) showSelectedImage(image);
      console.error("JalSaathi AI request failed.", error);
      setFeedback(errorKey(error, Boolean(image)));
    } finally {
      loading = false;
      renderMessages();
    }
  }

  function bindEvents() {
    const elements = getElements();
    if (!elements || !eventController) return;
    const options = { signal: eventController.signal };
    elements.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitMessage(elements.question.value);
    }, options);
    elements.attach.addEventListener("click", () => {
      if (!(elements.attachmentMenu instanceof HTMLElement)) return;
      const open = elements.attachmentMenu.hidden;
      elements.attachmentMenu.hidden = !open;
      elements.attach.setAttribute("aria-expanded", String(open));
      if (open) elements.uploadPhoto.focus();
    }, options);
    elements.uploadPhoto.addEventListener("click", () => {
      closeAttachmentMenu();
      elements.imageInput.click();
    }, options);
    elements.camera.addEventListener("click", () => {
      closeAttachmentMenu();
      void startCameraCapture();
    }, options);
    elements.imageInput.addEventListener("change", () => {
      const file = elements.imageInput.files?.[0];
      if (file) showSelectedImage(file);
    }, options);
    elements.cameraCapture.addEventListener("click", captureCameraPhoto, options);
    elements.cameraClose.addEventListener("click", stopCamera, options);
    document.addEventListener("click", (event) => {
      if (!(event.target instanceof Node) ||
          elements.attachmentMenu?.contains(event.target) ||
          elements.attach.contains(event.target)) return;
      closeAttachmentMenu();
    }, options);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeAttachmentMenu();
        if (cameraStream) stopCamera();
      }
    }, options);
    window.addEventListener("jalsaathi:page-changed", () => {
      if (!activeRoot?.isConnected) {
        stopCamera();
        speechRecognition?.abort();
        speechRecognition = null;
      }
    }, options);
    elements.voice.addEventListener("click", startVoiceInput, options);
    elements.clear.addEventListener("click", () => {
      if (activeConversationId) void deleteConversation(activeConversationId);
    }, options);
    elements.format.addEventListener("change", () => {
      reportFormat = elements.format.value === "chart" ? "chart" : "text";
      renderMessages();
    }, options);
    elements.field.addEventListener("change", () => {
      updateCropOptions();
      elements.crop.value = "all";
    }, options);
    elements.crop.addEventListener("change", () => {
      const selectedCrop = crops.find((item) => String(item.id) === elements.crop.value);
      if (selectedCrop?.field_id) {
        elements.field.value = String(selectedCrop.field_id);
        updateCropOptions();
        elements.crop.value = String(selectedCrop.id);
      }
    }, options);
    elements.root.querySelector("[data-ai-new]")?.addEventListener("click", startNewConversation, options);
    elements.root.querySelector("[data-ai-rename-save]")?.addEventListener("click", () => void saveRename(), options);
    elements.root.querySelector("[data-ai-rename-cancel]")?.addEventListener("click", () => {
      elements.renamePanel.hidden = true;
      renameTargetId = null;
    }, options);
    elements.root.querySelector("[data-ai-open-sidebar]")?.addEventListener("click", () => {
      elements.root.classList.add("is-sidebar-open");
      elements.scrim.hidden = false;
    }, options);
    elements.root.querySelectorAll("[data-ai-close-sidebar]").forEach((button) => {
      button.addEventListener("click", () => {
        elements.root.classList.remove("is-sidebar-open");
        elements.scrim.hidden = true;
      }, options);
    });
    window.addEventListener("jalsaathi:language-changed", () => {
      window.JalSaathiI18n?.translate(elements.root);
      renderConversationList();
      renderMessages();
    }, options);
    window.addEventListener("jalsaathi:auth-changed", () => {
      stopCamera();
      closeAttachmentMenu();
      speechRecognition?.abort();
      speechRecognition = null;
      clearSelectedImage();
      activeConversationId = null;
      messages = [];
      void loadInitialData();
    }, options);
  }

  async function loadInitialData() {
    const results = await Promise.allSettled([loadFarmOptions(), loadConversations()]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") {
      console.error("JalSaathi AI data could not be loaded.", failure.reason);
      setFeedback(errorKey(failure.reason));
    }
    renderMessages();
  }

  function initialize(container) {
    const root = container?.querySelector?.(rootSelector);
    if (!(root instanceof HTMLElement)) return;
    if (activeRoot === root) return;
    stopCamera();
    speechRecognition?.abort();
    speechRecognition = null;
    clearSelectedImage();
    activeRoot = root;
    activeConversationId = null;
    conversations = [];
    messages = [];
    fields = [];
    crops = [];
    loading = false;
    reportFormat = "text";
    renameTargetId = null;
    eventController?.abort();
    eventController = new AbortController();
    window.JalSaathiI18n?.translate(root);
    bindEvents();
    void loadInitialData();
  }

  window.JalSaathiAiChat = Object.freeze({ initialize });
})();
