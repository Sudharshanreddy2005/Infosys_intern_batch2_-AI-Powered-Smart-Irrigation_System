const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

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

test("assistant chat renders provider text as text and uses authenticated API helper", async () => {
  const unsafeLookingText = "<img src=x onerror=alert(1)>";
  let request;
  const assistant = createAssistant();
  const context = {
    window: { JalSaathiProfile: { apiRequest: async (url, options) => {
      request = { url, options };
      return { answer: unsafeLookingText };
    } } },
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
  assert.deepEqual(JSON.parse(request.options.body), { question: "Explain rainfall." });
  assert.equal(assistant.log.children.length, 2);
  assert.equal(assistant.log.children[1].textContent, unsafeLookingText);
  assert.equal(assistant.log.children[1].innerHTML, undefined);
  assert.equal(assistant.log.children[1].attributes.has("data-user-content"), true);
  assert.equal(assistant.question.value, "");
});

test("Model 2 explanation sends only owned IDs and displays the server value unchanged", async () => {
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
    window: { JalSaathiProfile: { apiRequest: async (url, options) => {
      request = { url, options };
      return { prediction, explanation: "<strong>Limitations</strong>" };
    } } },
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
  assert.deepEqual(Object.keys(payload).sort(), ["crop_id", "field_id", "question"]);
  assert.equal(payload.field_id, 7);
  assert.equal(payload.crop_id, 12);
  assert.match(assistant.explainStatus.textContent, /123\.5 liters_per_field_per_24_hours/);
  assert.equal(assistant.explainStatus.textContent.includes("<strong>"), true);
  assert.equal(assistant.log.children[0].textContent, "<strong>Limitations</strong>");
  assert.equal(assistant.log.children[0].innerHTML, undefined);
});

test("assistant reports unavailable errors without fabricating a response", async () => {
  const assistant = createAssistant();
  const context = {
    window: { JalSaathiProfile: { apiRequest: async () => {
      const error = new Error("The farmer assistant is unavailable.");
      error.status = 503;
      throw error;
    } } },
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
