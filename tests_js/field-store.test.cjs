const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(
  path.join(__dirname, "..", "static", "field-store.js"),
  "utf8",
);

function createFieldStore() {
  const storage = new Map();
  const listeners = new Map();
  const apiCalls = [];
  let savedField = null;
  const window = {
    addEventListener(name, callback) { listeners.set(name, callback); },
    dispatchEvent() {},
    JalSaathiProfile: {
      async apiRequest(url, options = {}) {
        apiCalls.push({ url, options });
        if (url === "/api/fields" && !options.method) {
          return savedField ? [savedField] : [];
        }
        if (url === "/api/fields" && options.method === "POST") {
          savedField = { id: 8, ...JSON.parse(options.body) };
          return savedField;
        }
        if (url === "/api/fields/8" && options.method === "PATCH") {
          savedField = { ...savedField, ...JSON.parse(options.body) };
          return savedField;
        }
        throw new Error(`Unexpected API request: ${url}`);
      },
    },
  };
  vm.runInNewContext(source, {
    window,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    console,
    Date,
    Math,
    Number,
    Object,
    String,
    Array,
  });
  return { store: window.JalSaathiFieldStore, apiCalls };
}

test("field coordinates are included in create and edit requests and returned fields", async () => {
  const { store, apiCalls } = createFieldStore();
  const created = await store.addServerField({
    name: "North plot",
    location: "Farm",
    crop: "Rice",
    area: 2,
    areaUnit: "acres",
    latitude: 12.5,
    longitude: 77.6,
  });

  assert.equal(created.latitude, 12.5);
  assert.equal(created.longitude, 77.6);
  assert.equal(apiCalls[0].options.method, "POST");
  assert.deepEqual(
    JSON.parse(apiCalls[0].options.body),
    {
      name: "North plot",
      location: "Farm",
      crop: "Rice",
      area: 2,
      area_unit: "acres",
      latitude: 12.5,
      longitude: 77.6,
    },
  );
  assert.equal(store.getServerFields()[0].latitude, 12.5);
  assert.equal(store.getServerFields()[0].longitude, 77.6);

  const updated = await store.updateServerField("8", {
    name: "North plot",
    location: "Farm",
    crop: "Rice",
    area: 2,
    areaUnit: "acres",
    latitude: 13.25,
    longitude: 78.75,
  });
  assert.equal(updated.latitude, 13.25);
  assert.equal(updated.longitude, 78.75);
  assert.deepEqual(
    JSON.parse(apiCalls.find((call) => call.options.method === "PATCH").options.body),
    {
      name: "North plot",
      location: "Farm",
      crop: "Rice",
      area: 2,
      area_unit: "acres",
      latitude: 13.25,
      longitude: 78.75,
    },
  );
});

test("field store rejects invalid, out-of-range, or incomplete coordinate pairs", () => {
  const { store } = createFieldStore();
  const base = {
    name: "North plot",
    location: "Farm",
    crop: "Rice",
    area: 2,
    areaUnit: "acres",
  };

  for (const coordinates of [
    { latitude: 91, longitude: 77 },
    { latitude: 12, longitude: -181 },
    { latitude: 12, longitude: null },
    { latitude: Number.NaN, longitude: 77 },
    { latitude: true, longitude: 77 },
  ]) {
    assert.throws(
      () => store.addField({ ...base, ...coordinates }),
      /invalid coordinate pair/,
    );
  }
});

test("field form exposes geolocation, manual coordinate entry, and actual-field confirmation", () => {
  const source = readFileSync(
    path.join(__dirname, "..", "static", "sections.js"),
    "utf8",
  );
  assert.match(source, /Use My Current Location/);
  assert.match(source, /name="latitude"/);
  assert.match(source, /name="longitude"/);
  assert.match(source, /confirm these saved coordinates represent this field/);
  assert.match(source, /coordinateConfirmation\.checked/);
  assert.match(source, /requestCurrentCoordinates/);
  assert.match(source, /Location permission was denied/);
  assert.match(source, /Location request timed out/);
  assert.match(source, /Your location is unavailable/);
  assert.match(source, /latitudeInput\.value = field\.latitude/);
  assert.match(source, /longitudeInput\.value = field\.longitude/);
  assert.match(source, /get\("edit_field"\)/);
  assert.match(source, /editButton\?\.click\(\)/);

  const html = readFileSync(
    path.join(__dirname, "..", "static", "sections.html"),
    "utf8",
  );
  assert.match(
    html,
    /field-store\.js\?v=20261028-field-coordinates1/,
    "the coordinate-aware field store must not be served under its old cache key",
  );
});
