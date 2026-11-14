const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const numberFormatting = require("../static/number-format.js");

const source = readFileSync(
  path.join(__dirname, "..", "static", "farmer-assistant.js"),
  "utf8",
);

class Element {
  constructor() {
    this.listeners = {};
    this.textContent = "";
    this.disabled = false;
    this.children = [];
    this.attributes = new Map();
    this.scrollHeight = 10;
    this.scrollTop = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(name, callback) {
    this.listeners[name] = callback;
  }

  append(child) {
    this.children.push(child);
  }

  async dispatch(name) {
    return this.listeners[name]?.({ preventDefault() {} });
  }
}

class Form extends Element {
  constructor(controls = {}) {
    super();
    this.controls = controls;
  }

  querySelector(selector) {
    return this.controls[selector];
  }
}

class Textarea extends Element {
  constructor(value = "") {
    super();
    this.value = value;
  }
}

class Select extends Element {
  constructor(value) {
    super();
    this.value = value;
  }
}

function createAssistant(questionText = "Explain rainfall.") {
  const question = new Textarea(questionText);
  const field = new Select("7");
  const crop = new Select("12");
  const log = new Element();
  const status = new Element();
  const submit = new Element();
  const explainButton = new Element();
  const explainStatus = new Element();
  const form = new Form();
  const model2Form = new Form({
    "[data-experimental-field]": field,
    "[data-experimental-crop-record]": crop,
  });
  const elements = {
    "[data-assistant-form]": form,
    "#farmer-assistant-question": question,
    "[data-assistant-log]": log,
    "[data-assistant-status]": status,
    "[data-assistant-submit]": submit,
    "[data-model2-explain]": explainButton,
    "[data-model2-explanation-result]": explainStatus,
    "[data-experimental-form]": model2Form,
  };
  return {
    elements,
    field,
    crop,
    question,
    log,
    form,
    explainButton,
    explainStatus,
    model2Form,
  };
}

function createI18n() {
  const translationKeys = {
    "assistant.status.preparing": "The assistant is preparing a response…",
    "assistant.notice.educational": "Assistant responses are educational and may be incorrect.",
    "assistant.error.busy": "The assistant is busy. Please try again later.",
    "assistant.error.unavailable": "The assistant is unavailable. Please try again later.",
    "assistant.model2.selectFieldCrop": "Choose an owned field and crop before requesting an explanation.",
    "assistant.model2.checking": "Checking for a server-validated Model 2 estimate…",
    "assistant.model2.invalidExplanation": "The server returned an invalid or unverified Model 2 explanation.",
    "assistant.model2.unavailable": "A validated Model 2 estimate is unavailable.",
    "assistant.model2.unit": "liters per field per 24 hours",
    "assistant.model2.estimatePrefix": "Server-validated estimate: {amount} {unit} for {hours} hours.",
    "common.translationMissing": "Translation unavailable",
  };
  return {
    languages: [{ code: "en", locale: "en-IN" }],
    getLanguage: () => "en",
    translationKeys,
    translate() {},
    t(key, parameters = {}) {
      return (translationKeys[key] || key).replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name) =>
        Object.hasOwn(parameters, name) ? String(parameters[name]) : placeholder);
    },
  };
}

test("assistant chat renders provider text as text and uses authenticated API helper", async () => {
  const unsafeLookingText = "<img src=x onerror=alert(1)>";
  let request;
  const assistant = createAssistant();
  const context = {
    window: {
      JalSaathiProfile: { apiRequest: async (url, options) => {
        request = { url, options };
        return { answer: unsafeLookingText };
      } },
      JalSaathiI18n: createI18n(),
      JalSaathiNumberFormat: numberFormatting,
    },
    document: {
      querySelector: (selector) => assistant.elements[selector],
      createElement: () => new Element(),
    },
    HTMLElement: Element,
    HTMLFormElement: Form,
    HTMLTextAreaElement: Textarea,
    HTMLButtonElement: Element,
    HTMLSelectElement: Select,
    Error,
  };
  vm.runInNewContext(source, context);
  context.window.JalSaathiFarmerAssistant.initialize();
  await assistant.form.dispatch("submit");

  assert.equal(request.url, "/api/assistant/chat");
  assert.deepEqual(JSON.parse(request.options.body), {
    question: "Explain rainfall.",
    language_code: "en-IN",
  });
  assert.equal(assistant.log.children.length, 2);
  assert.equal(assistant.log.children[1].textContent, unsafeLookingText);
  assert.equal(assistant.log.children[1].innerHTML, undefined);
  assert.equal(assistant.log.children[1].attributes.has("data-user-content"), true);
  assert.equal(assistant.question.value, "");
});

test("Model 2 explanation uses owned IDs and normalizes generated numeric text", async () => {
  let request;
  const prediction = {
    estimated_water_liters: 123.5,
    unit: "liters_per_field_per_24_hours",
    prediction_period_hours: 24,
    target_basis: "gross_irrigation_requirement",
    target_definition_approval_id: "approval-id",
    model_version: "model2-v1",
    dataset_provenance: "real_observed_with_independently_verified_labels",
  };
  const assistant = createAssistant("");
  const context = {
    window: {
      JalSaathiProfile: { apiRequest: async (url, options) => {
        request = { url, options };
        return { prediction, explanation: "<strong>Limitations ೨೦.೮°C</strong>" };
      } },
      JalSaathiI18n: createI18n(),
      JalSaathiNumberFormat: numberFormatting,
    },
    document: {
      querySelector: (selector) => assistant.elements[selector],
      createElement: () => new Element(),
    },
    HTMLElement: Element,
    HTMLFormElement: Form,
    HTMLTextAreaElement: Textarea,
    HTMLButtonElement: Element,
    HTMLSelectElement: Select,
    Error,
  };
  vm.runInNewContext(source, context);
  context.window.JalSaathiFarmerAssistant.initialize();
  await assistant.explainButton.dispatch("click");

  assert.equal(request.url, "/api/assistant/model2-explanation");
  const payload = JSON.parse(request.options.body);
  assert.deepEqual(Object.keys(payload).sort(), ["crop_id", "field_id", "language_code", "question"]);
  assert.equal(payload.field_id, 7);
  assert.equal(payload.crop_id, 12);
  assert.equal(payload.language_code, "en-IN");
  assert.match(assistant.explainStatus.textContent, /123\.5 liters per field per 24 hours/);
  assert.equal(assistant.explainStatus.textContent.includes("<strong>"), true);
  assert.equal(assistant.log.children[0].textContent, "<strong>Limitations 21°C</strong>");
  assert.equal(assistant.log.children[0].innerHTML, undefined);
});

test("assistant reports unavailable errors without fabricating a response", async () => {
  const assistant = createAssistant();
  const context = {
    window: {
      JalSaathiProfile: { apiRequest: async () => {
        const error = new Error("The farmer assistant is unavailable.");
        error.status = 503;
        throw error;
      } },
      JalSaathiI18n: createI18n(),
      JalSaathiNumberFormat: numberFormatting,
    },
    document: {
      querySelector: (selector) => assistant.elements[selector],
      createElement: () => new Element(),
    },
    HTMLElement: Element,
    HTMLFormElement: Form,
    HTMLTextAreaElement: Textarea,
    HTMLButtonElement: Element,
    HTMLSelectElement: Select,
    Error,
  };
  vm.runInNewContext(source, context);
  context.window.JalSaathiFarmerAssistant.initialize();
  await assistant.form.dispatch("submit");

  assert.equal(assistant.log.children.length, 1);
  assert.match(assistant.elements["[data-assistant-status]"].textContent, /unavailable/);
});
