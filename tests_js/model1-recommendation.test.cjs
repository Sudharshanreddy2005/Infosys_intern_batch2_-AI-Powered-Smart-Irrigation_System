const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(
  path.join(__dirname, "..", "static", "model1-recommendation.js"),
  "utf8",
);

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.className = "";
    this.textContent = "";
    const classes = new Set();
    this.classList = {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value),
    };
  }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
}

function createModel(rendererOptions) {
  const window = {};
  vm.runInNewContext(source, {
    window,
    document: { createElement: (tag) => new Element(tag) },
    AbortController,
    Date,
    Number,
    Object,
    String,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
  });
  return {
    ...window.JalSaathiModel1Recommendation,
    renderer: window.JalSaathiModel1Recommendation.createRenderer(rendererOptions),
  };
}

function prediction(predictionClass = 1, overrides = {}) {
  return {
    prediction: predictionClass,
    proxy_positive_probability: 0.75,
    target: "irrigation_needed_proxy",
    proxy_rule: "soil_moisture <= 20.0",
    warning: "Synthetic proxy demonstration only.",
    model_status: "Experimental",
    dataset_provenance: "synthetic_or_synthetic_augmented",
    selected_model: "random_forest",
    feature_sources: {
      temperature_c: "selected_field_current_weather_api",
      humidity_percent: "selected_field_current_weather_api",
    },
    observation_time: new Date().toISOString(),
    ...overrides,
  };
}

function createStatus() {
  return new Element("section");
}

function textContent(node) {
  return [node.textContent, ...node.children.map(textContent)].join(" ");
}

function findElement(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

test("reduced-model response validation requires the proxy and verified sources", () => {
  const model = createModel();
  assert.equal(model.validatePrediction(prediction()), true);
  assert.equal(model.validatePrediction(prediction(0)), true);
  assert.equal(model.validatePrediction(prediction(2)), false);
  assert.equal(
    model.validatePrediction(prediction(1, {
      feature_sources: {
        temperature_c: "selected_field_current_weather_api",
        humidity_percent: "mock_development",
      },
    })),
    false,
  );
  assert.equal(
    model.validatePrediction(prediction(1, { proxy_rule: "invented rule" })),
    false,
  );
  assert.equal(
    model.validatePrediction(prediction(1, { observation_time: "stale" })),
    false,
  );
  assert.equal(
    model.validatePrediction(prediction(1, {
      observation_time: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    })),
    false,
  );
});

test("dashboard requests only a server-side prediction for the selected field", async () => {
  const model = createModel();
  const status = createStatus();
  let requestUrl = "";
  let requestOptions;

  await model.renderer.update(
    status,
    { id: 17, latitude: 40, longitude: -75 },
    [],
    async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return prediction();
    },
  );

  assert.equal(requestUrl, "/api/ml/reduced-weather-prediction");
  assert.equal(requestOptions.method, "POST");
  assert.deepEqual(JSON.parse(requestOptions.body), { field_id: 17 });
  const text = textContent(status);
  assert.match(text, /Irrigation Needed/);
  assert.match(text, /Experimental result/);
  assert.match(text, /Probability:\s+75\.0%/);
  assert.doesNotMatch(text, /soil_moisture|synthetic dataset|temperature_c|humidity_percent|not validated irrigation/);
  assert.equal(status.dataset.fieldId, "17");
  assert.equal(status.classList.contains("recommendation-data-status--model1"), true);
});

test("both valid binary model classes render the requested labels", async () => {
  const model = createModel();
  for (const [id, result, label] of [
    [5, 1, "Irrigation Needed"],
    [6, 0, "Irrigation Not Needed"],
  ]) {
    const status = createStatus();
    await model.renderer.update(
      status,
      { id, latitude: 12.5, longitude: 77.6 },
      [],
      async () => prediction(result),
    );
    assert.match(textContent(status), new RegExp(label));
  }
});

test("reported field 7 class-0 response renders concise experimental result", async () => {
  const model = createModel();
  const status = createStatus();
  const response = {
    prediction: 0,
    proxy_positive_probability: 0.21542857142857139,
    target: "irrigation_needed_proxy",
    proxy_rule: "soil_moisture <= 20.0",
    warning: "Synthetic proxy demonstration only; not a real irrigation-need prediction or recommendation.",
    model_status: "Experimental",
    dataset_provenance: "synthetic_or_synthetic_augmented",
    selected_model: "random_forest",
    feature_sources: {
      temperature_c: "selected_field_current_weather_api",
      humidity_percent: "selected_field_current_weather_api",
    },
    observation_time: new Date().toISOString(),
  };

  await model.renderer.update(
    status,
    { id: 7, latitude: 13.038153603769699, longitude: 77.61633492659429 },
    [],
    async () => response,
  );

  const text = textContent(status);
  assert.equal(model.validatePrediction(response), true);
  assert.match(text, /Irrigation Not Needed/);
  assert.match(text, /21\.5%/);
  assert.match(text, /Experimental result/);
  assert.doesNotMatch(text, /soil_moisture|synthetic_or_synthetic_augmented|temperature_c|humidity_percent|Synthetic proxy demonstration only|real-world recommendation/);
  assert.equal(status.dataset.fieldId, "7");
});

test("an invalid selected field or unavailable API cannot show a prediction", async () => {
  const model = createModel();
  const status = createStatus();
  await model.renderer.update(status, null, [], async () => prediction());
  assert.match(textContent(status), /No valid selected field/);
  assert.doesNotMatch(textContent(status), /Irrigation Needed/);

  await model.renderer.update(status, { id: 2, latitude: 12, longitude: 77 }, [], undefined);
  assert.match(textContent(status), /authenticated prediction service is unavailable/);
});

test("malformed prediction responses are never rendered as binary results", async () => {
  const model = createModel();
  const status = createStatus();
  await model.renderer.update(
    status,
    { id: 3, latitude: 12, longitude: 77 },
    [],
    async () => prediction(3),
  );
  assert.match(textContent(status), /experimental response was invalid/);
  assert.doesNotMatch(textContent(status), /Irrigation Needed/);
});

test("a delayed response for a previous field cannot replace the selected field result", async () => {
  const renderer = createModel().renderer;
  const status = createStatus();
  let resolveFirst;
  const firstRequest = renderer.update(
    status,
    { id: 10, latitude: 12, longitude: 77 },
    [],
    () => new Promise((resolve) => { resolveFirst = resolve; }),
  );
  await renderer.update(
    status,
    { id: 11, latitude: 13, longitude: 78 },
    [],
    async () => prediction(0),
  );
  resolveFirst(prediction(1));
  await firstRequest;

  assert.equal(status.dataset.fieldId, "11");
  assert.match(textContent(status), /Irrigation Not Needed/);
  assert.doesNotMatch(textContent(status), /Irrigation Needed/);
});

test("multiple saved fields request predictions with their own field IDs", async () => {
  const renderer = createModel().renderer;
  const fields = [
    { id: 31, latitude: 12.5, longitude: 77.6, updated_at: "north-v1" },
    { id: 47, latitude: 13.1, longitude: 78.2, updated_at: "east-v1" },
  ];
  const statuses = fields.map(() => createStatus());
  const requestBodies = [];
  const apiRequest = async (_url, options) => {
    const body = JSON.parse(options.body);
    requestBodies.push(body);
    return prediction(body.field_id === 31 ? 1 : 0, {
      proxy_positive_probability: body.field_id === 31 ? 0.8 : 0.2,
    });
  };

  await Promise.all(fields.map((field, index) =>
    renderer.update(statuses[index], field, [], apiRequest)));

  assert.deepEqual(requestBodies, [{ field_id: 31 }, { field_id: 47 }]);
  assert.match(textContent(statuses[0]), /Irrigation Needed/);
  assert.match(textContent(statuses[0]), /80\.0%/);
  assert.match(textContent(statuses[1]), /Irrigation Not Needed/);
  assert.match(textContent(statuses[1]), /20\.0%/);
  renderer.reconcile(fields);
  await renderer.update(statuses[1], fields[1], [], apiRequest);
  assert.equal(requestBodies.length, 2);
});

test("repeated carousel renders share one in-flight request for the same stable field ID", async () => {
  const renderer = createModel().renderer;
  const field = { id: 58, latitude: 12.5, longitude: 77.6, updated_at: "v1" };
  const status = createStatus();
  let resolvePrediction;
  let requests = 0;
  const apiRequest = () => {
    requests += 1;
    return new Promise((resolve) => { resolvePrediction = resolve; });
  };

  const first = renderer.update(status, field, [], apiRequest);
  const second = renderer.update(status, field, [], apiRequest);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
  resolvePrediction(prediction(1));
  await Promise.all([first, second]);

  assert.match(textContent(status), /Irrigation Needed/);
  assert.equal(status.dataset.fieldId, "58");
});

test("fields without coordinates get field-specific edit guidance and no prediction request", async () => {
  const renderer = createModel().renderer;
  const status = createStatus();
  let requests = 0;

  await renderer.update(
    status,
    { id: 52, name: "Unlocated field", latitude: null, longitude: null },
    [],
    async () => { requests += 1; return prediction(); },
  );

  assert.match(textContent(status), /Add this field's location coordinates to view its experimental result/);
  const editLink = findElement(status, (node) => node.tagName === "a");
  assert.equal(editLink.href, "/static/sections.html?view=fields&edit_field=52");
  assert.equal(requests, 0);
});

test("coordinate edits and field deletion invalidate only the matching field result", async () => {
  const renderer = createModel().renderer;
  const status = createStatus();
  const firstVersion = { id: 61, latitude: 12, longitude: 77, updated_at: "v1" };
  const editedVersion = { id: 61, latitude: 13, longitude: 78, updated_at: "v2" };
  let requests = 0;
  const apiRequest = async () => {
    requests += 1;
    return prediction(requests === 1 ? 1 : 0);
  };

  await renderer.update(status, firstVersion, [], apiRequest);
  await renderer.update(status, editedVersion, [], apiRequest);
  assert.equal(requests, 2);
  assert.match(textContent(status), /Irrigation Not Needed/);

  renderer.reconcile([]);
  await renderer.update(status, editedVersion, [], apiRequest);
  assert.equal(requests, 3);
});

test("a newly added field becomes eligible without any field-specific configuration", async () => {
  const renderer = createModel().renderer;
  const initialFields = [{ id: 101, latitude: 12, longitude: 77, updated_at: "first" }];
  const addedField = { id: 245, latitude: 14, longitude: 79, updated_at: "new" };
  const status = createStatus();
  const requests = [];
  renderer.reconcile(initialFields);
  renderer.reconcile([...initialFields, addedField]);

  await renderer.update(status, addedField, [], async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return prediction(1);
  });

  assert.deepEqual(requests, [{ field_id: 245 }]);
  assert.match(textContent(status), /Irrigation Needed/);
});

test("one field failure does not block another field and exposes retry", async () => {
  const renderer = createModel().renderer;
  const failedStatus = createStatus();
  const validStatus = createStatus();
  let failedAttempts = 0;

  await renderer.update(
    failedStatus,
    { id: 70, latitude: 12, longitude: 77 },
    [],
    async () => {
      failedAttempts += 1;
      if (failedAttempts === 1) throw new Error("weather unavailable");
      return prediction(1);
    },
  );
  await renderer.update(
    validStatus,
    { id: 71, latitude: 13, longitude: 78 },
    [],
    async () => prediction(0),
  );

  assert.match(textContent(failedStatus), /Experimental result unavailable/);
  assert.match(textContent(validStatus), /Irrigation Not Needed/);
  const retry = findElement(failedStatus, (node) => node.tagName === "button");
  assert.equal(retry.textContent, "Retry");
  retry.listeners.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(textContent(failedStatus), /Irrigation Needed/);
  assert.equal(failedAttempts, 2);
});

test("provider, stale-weather, and API errors stay unavailable without fabricated results", async () => {
  const renderer = createModel().renderer;
  for (const [fieldId, statusCode] of [[301, 503], [302, 422], [303, 500]]) {
    const status = createStatus();
    await renderer.update(
      status,
      { id: fieldId, latitude: 12, longitude: 77 },
      [],
      async () => {
        const error = new Error("unavailable");
        error.status = statusCode;
        throw error;
      },
    );
    assert.match(textContent(status), /Experimental result unavailable/);
    assert.doesNotMatch(textContent(status), /Irrigation Needed|Irrigation Not Needed|Probability:/);
  }
});

test("prediction timeout is unavailable and never creates a result", async () => {
  const renderer = createModel({ requestTimeoutMs: 5 }).renderer;
  const status = createStatus();

  await renderer.update(
    status,
    { id: 81, latitude: 12, longitude: 77 },
    [],
    () => new Promise(() => {}),
  );

  assert.match(textContent(status), /timed out/);
  assert.doesNotMatch(textContent(status), /Irrigation Needed|Irrigation Not Needed/);
});

test("rapid field switches keep late responses attached to their own field", async () => {
  const renderer = createModel().renderer;
  const status = createStatus();
  let resolveFirst;
  const firstField = { id: 91, latitude: 12, longitude: 77 };
  const secondField = { id: 92, latitude: 13, longitude: 78 };
  const firstRequest = renderer.update(
    status,
    firstField,
    [],
    () => new Promise((resolve) => { resolveFirst = resolve; }),
  );
  await renderer.update(status, secondField, [], async () => prediction(0));
  resolveFirst(prediction(1));
  await firstRequest;

  assert.equal(status.dataset.fieldId, "92");
  assert.match(textContent(status), /Irrigation Not Needed/);
  assert.doesNotMatch(textContent(status), /Irrigation Needed/);
});
