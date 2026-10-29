const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(
  path.join(__dirname, "..", "static", "water-requirement.js"),
  "utf8",
);

class Element {
  constructor() {
    this.listeners = {};
    this.textContent = "";
    this.disabled = false;
  }

  addEventListener(name, callback) {
    this.listeners[name] = callback;
  }

  async dispatch(name) {
    return this.listeners[name]?.();
  }
}

class Select extends Element {
  constructor(value, label) {
    super();
    this.value = value;
    this.selectedOptions = [{ textContent: label }];
  }
}

class Form extends Element {
  constructor(field, crop) {
    super();
    this.controls = {
      "[data-experimental-field]": field,
      "[data-experimental-crop-record]": crop,
    };
  }

  querySelector(selector) {
    return this.controls[selector];
  }
}

function createDashboard(apiRequest) {
  const field = new Select("7", "North field");
  const crop = new Select("12", "Maize");
  const form = new Form(field, crop);
  const explain = new Element();
  explain.disabled = true;
  const elements = {
    "[data-experimental-form]": form,
    "[data-water-field]": new Element(),
    "[data-water-crop]": new Element(),
    "[data-water-estimate]": new Element(),
    "[data-water-status]": new Element(),
    "[data-water-requirement-message]": new Element(),
    "[data-water-requirement-refresh]": new Element(),
    "[data-model2-explain]": explain,
    "[data-model2-explanation-result]": new Element(),
  };
  const window = { JalSaathiProfile: { apiRequest } };
  vm.runInNewContext(source, {
    window,
    document: { querySelector: (selector) => elements[selector] },
    Error,
    HTMLElement: Element,
    HTMLFormElement: Form,
    HTMLSelectElement: Select,
    HTMLButtonElement: Element,
  });
  window.JalSaathiWaterRequirement.initialize();
  return { elements, field, crop };
}

test("Model 2 panel shows the validated estimate and selected field/crop", async () => {
  const { elements } = createDashboard(async (url, options) => {
    assert.equal(url, "/api/ml/water-requirement");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), {
      field_id: 7,
      crop_id: 12,
      prediction_period_hours: 24,
    });
    return {
      estimated_water_liters: 125,
      unit: "liters_per_field_per_24_hours",
      prediction_period_hours: 24,
      model_version: "model2-test-v1",
      dataset_provenance: "verified-test-fixture",
      limitations: ["Test-only output."],
    };
  });

  assert.equal(elements["[data-water-field]"].textContent, "North field");
  assert.equal(elements["[data-water-crop]"].textContent, "Maize");
  assert.equal(elements["[data-water-estimate]"].textContent, "Unavailable");
  await elements["[data-water-requirement-refresh]"].dispatch("click");

  assert.equal(
    elements["[data-water-estimate]"].textContent,
    "125 liters_per_field_per_24_hours",
  );
  assert.match(elements["[data-water-status]"].textContent, /model2-test-v1/);
  assert.equal(
    elements["[data-water-requirement-message]"].textContent,
    "Test-only output.",
  );
  assert.equal(elements["[data-model2-explain]"].disabled, true);
});

test("Model 2 panel exposes loading and unavailable API error states", async () => {
  let rejectRequest;
  const { elements } = createDashboard(
    () => new Promise((resolve, reject) => {
      rejectRequest = reject;
    }),
  );
  const refresh = elements["[data-water-requirement-refresh]"];
  const pending = refresh.dispatch("click");

  assert.equal(refresh.disabled, true);
  assert.match(elements["[data-water-status]"].textContent, /Checking/);
  assert.match(elements["[data-water-requirement-message]"].textContent, /Requesting/);
  rejectRequest(new Error("Water estimate service returned 503."));
  await pending;

  assert.equal(elements["[data-water-estimate]"].textContent, "Unavailable");
  assert.equal(elements["[data-model2-explain]"].disabled, true);
  assert.match(elements["[data-water-status]"].textContent, /No validated/);
  assert.equal(
    elements["[data-water-requirement-message]"].textContent,
    "Water estimate service returned 503.",
  );
  assert.equal(refresh.disabled, false);
});

test("Model 2 explanation is enabled only for approved real-world provenance", async () => {
  const { elements } = createDashboard(async () => ({
    estimated_water_liters: 125,
    unit: "liters_per_field_per_24_hours",
    prediction_period_hours: 24,
    target_basis: "gross_irrigation_requirement",
    target_definition_approval_id: "approved-target-1",
    model_version: "model2-real-candidate",
    dataset_provenance: "real_observed_with_independently_verified_labels",
    limitations: [],
  }));
  await elements["[data-water-requirement-refresh]"].dispatch("click");

  assert.equal(elements["[data-model2-explain]"].disabled, false);
  assert.match(
    elements["[data-model2-explanation-result]"].textContent,
    /server-validated estimate is available/,
  );
});
