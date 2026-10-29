const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { setTimeout: scheduleTimeout } = require("node:timers");
const vm = require("node:vm");

const weatherSource = fs.readFileSync(
  path.join(__dirname, "..", "static", "weather.js"),
  "utf8",
);
const displayCacheKey = "jalsaathi.weather.display-cache.v1";
const manualLocationKey = "jalsaathi.weather.manual-location.v1";
const testCoordinates = "12.345678,78.901234";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

class FakeElement {
  constructor() {
    this.textContent = "";
    this.hidden = false;
    this.attributes = new Map();
    this.dataset = {};
    this.classes = new Set();
    this.classList = {
      toggle: (name, force) => {
        const enabled = force ?? !this.classes.has(name);
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
        return enabled;
      },
    };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

class FakeWeatherRoot extends FakeElement {
  constructor() {
    super();
    this.children = new Map();
    for (const selector of [
      '[data-dashboard-weather-message]',
      "[data-weather-loading]",
      "[data-weather-illustration]",
      '[data-weather="location"]',
      '[data-weather="temperature"]',
      '[data-weather="condition"]',
      '[data-weather="feels_like"]',
      '[data-weather="humidity"]',
      '[data-weather="wind_speed"]',
      '[data-weather="rainfall"]',
      '[data-weather="rain_probability"]',
      "[data-weather-updated]",
      "[data-weather-high-low]",
      ".temperature-indicator",
    ]) {
      this.children.set(selector, new FakeElement());
    }
  }

  querySelector(selector) {
    return this.children.get(selector) ?? null;
  }
}

const weatherPayload = {
  temperature_c: 21.6,
  feels_like_c: 20.8,
  weather_code: 1000,
  humidity_percent: 54,
  wind_speed_mps: 2.1,
  rainfall_mm_per_hr: 0,
  precipitation_probability_percent: 4,
  observation_time: "2026-10-16T12:00:00Z",
  location: testCoordinates,
};

const okResponse = (payload) => ({
  ok: true,
  status: 200,
  json: async () => payload,
});

const unavailableResponse = (status = 503, retryAfter) => ({
  ok: false,
  status,
  headers: { get: (name) => name.toLowerCase() === "retry-after" ? retryAfter : null },
  json: async () => ({ detail: "Mock weather provider unavailable." }),
});

const successfulFetch = async (input) => {
  const url = new URL(input, "http://localhost");
  if (url.pathname === "/weather/current") return okResponse(weatherPayload);
  if (url.pathname === "/weather/forecast") return okResponse({ data: [] });
  throw new Error(`Unexpected request path: ${url.pathname}`);
};

const createRuntime = ({
  storage = new MemoryStorage(),
  fetch = successfulFetch,
  setTimeoutImpl = scheduleTimeout,
  permissionState = "denied",
  coordinates = null,
} = {}) => {
  const window = {
    isSecureContext: true,
    addEventListener() {},
    dispatchEvent() {},
  };
  const navigator = {
    permissions: { query: async () => ({ state: permissionState }) },
    geolocation: {
      getCurrentPosition(success, failure) {
        if (coordinates) success({ coords: coordinates });
        else failure({ code: 1 });
      },
    },
  };
  const context = {
    Array,
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    },
    Date,
    Error,
    Intl,
    Map,
    Math,
    Number,
    Object,
    Promise,
    String,
    URLSearchParams,
    setTimeout: setTimeoutImpl,
    console: { warn() {}, error() {} },
    fetch,
    HTMLElement: FakeElement,
    localStorage: storage,
    navigator,
    window,
  };

  vm.runInNewContext(weatherSource, context, { filename: "static/weather.js" });
  return { api: window.JalSaathiWeather, storage };
};

const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
};

test("weather honors Retry-After without retrying rate-limited provider requests", async () => {
  const requests = [];
  const delays = [];
  const runtime = createRuntime({
    fetch: async (input) => {
      requests.push(new URL(input, "http://localhost").pathname);
      return unavailableResponse(503, "10");
    },
    setTimeoutImpl: (callback, delay) => {
      delays.push(delay);
      return scheduleTimeout(callback, 0);
    },
  });

  await assert.rejects(
    runtime.api.loadCurrent({ coordinates: { latitude: 12.5, longitude: 77.6 } }),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.retryAfterSeconds, 10);
      assert.equal(error.hasRetryAfter, true);
      return true;
    },
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(delays, []);
});

test("weather request stops after the bounded transient retry limit", async () => {
  let requests = 0;
  const delays = [];
  const runtime = createRuntime({
    fetch: async () => {
      requests += 1;
      return unavailableResponse(503);
    },
    setTimeoutImpl: (callback, delay) => {
      delays.push(delay);
      return scheduleTimeout(callback, 0);
    },
  });

  await assert.rejects(
    runtime.api.loadCurrent({ coordinates: { latitude: 13.1, longitude: 78.2 } }),
    /Mock weather provider unavailable/,
  );
  assert.equal(requests, 3);
  assert.deepEqual(delays, [250, 500]);
});

test("field weather requests are deduplicated and cached by saved coordinates", async () => {
  let requests = 0;
  let resolveResponse;
  const runtime = createRuntime({
    fetch: () => {
      requests += 1;
      return new Promise((resolve) => { resolveResponse = resolve; });
    },
  });
  const selection = { coordinates: { latitude: 12.5, longitude: 77.6 } };
  const first = runtime.api.loadCurrent(selection);
  const duplicate = runtime.api.loadCurrent(selection);

  assert.equal(requests, 1);
  resolveResponse(okResponse(weatherPayload));
  const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
  const cachedResult = await runtime.api.loadCurrent(selection);

  assert.equal(firstResult.current.temperature_c, 21.6);
  assert.equal(duplicateResult.current.temperature_c, 21.6);
  assert.equal(cachedResult.current.temperature_c, 21.6);
  assert.equal(requests, 1);
});

test("a saved city failure falls back to configured weather", async () => {
  const requests = [];
  const runtime = createRuntime({
    fetch: async (input) => {
      const url = new URL(input, "http://localhost");
      requests.push(url);
      if (url.searchParams.has("location")) return unavailableResponse();
      return successfulFetch(input);
    },
  });
  runtime.storage.setItem(manualLocationKey, "Saved Town");

  const result = await runtime.api.loadAutomatic({ refresh: true });

  assert.equal(result.source, "configured");
  assert.equal(result.data.current.temperature_c, 21.6);
  assert.ok(requests.some((url) => url.pathname === "/weather/current" && !url.search));
  assert.ok(requests.some((url) => url.pathname === "/weather/current" &&
    url.searchParams.get("location") === "Saved Town"));
});

test("a rate-limited saved city does not trigger a configured-location request", async () => {
  const requests = [];
  const runtime = createRuntime({
    fetch: async (input) => {
      requests.push(new URL(input, "http://localhost"));
      return unavailableResponse(503, "20");
    },
  });
  runtime.storage.setItem(manualLocationKey, "Saved Town");

  const result = await runtime.api.loadAutomatic({ refresh: true });

  assert.equal(result.source, "unavailable");
  assert.equal(result.weatherError.retryAfterSeconds, 20);
  assert.equal(result.weatherError.hasRetryAfter, true);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((url) => url.searchParams.get("location") === "Saved Town"));
});

test("an empty successful HTTP response is rejected as unusable weather", async () => {
  const runtime = createRuntime({
    fetch: async (input) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname === "/weather/current") return okResponse({});
      return okResponse({ data: [] });
    },
  });

  await assert.rejects(
    runtime.api.load({}, { refresh: true }),
    /no usable current conditions/i,
  );
  assert.equal(runtime.storage.getItem(displayCacheKey), null);
});

test("configured coordinate weather is cached without persisting coordinates", async () => {
  const runtime = createRuntime();
  const root = new FakeWeatherRoot();

  runtime.api.initializeDashboard(root);
  await waitFor(
    () => root.querySelector('[data-weather="temperature"]').textContent === "22°C",
    "Configured weather did not render.",
  );

  const cached = JSON.parse(runtime.storage.getItem(displayCacheKey));
  assert.equal(cached.locationLabel, "Configured location");
  assert.equal(cached.locationKey, "configured");
  assert.equal(cached.current.temperature_c, 21.6);
  assert.equal(JSON.stringify(cached).includes(testCoordinates), false);
});

test("weather dashboard initialization loads the automatic location only once", async () => {
  const requests = [];
  const runtime = createRuntime({
    permissionState: "granted",
    coordinates: { latitude: 12.5, longitude: 77.6 },
    fetch: async (input, options) => {
      requests.push({ input, options });
      return successfulFetch(input);
    },
  });
  const root = new FakeWeatherRoot();

  runtime.api.initializeDashboard(root);
  await waitFor(
    () => root.querySelector('[data-weather="temperature"]').textContent === "22°C",
    "Automatic-location weather did not render.",
  );

  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ options }) => options?.method === "POST"));
});

test("cached weather renders before refresh and survives failed refresh after reload", async () => {
  const storage = new MemoryStorage();
  const first = createRuntime({ storage });
  const firstRoot = new FakeWeatherRoot();
  first.api.initializeDashboard(firstRoot);
  await waitFor(
    () => storage.getItem(displayCacheKey) !== null,
    "Initial successful response was not saved.",
  );

  const reload = createRuntime({ storage, fetch: async () => unavailableResponse() });
  const reloadedRoot = new FakeWeatherRoot();
  reload.api.initializeDashboard(reloadedRoot);
  assert.equal(reloadedRoot.querySelector('[data-weather="temperature"]').textContent, "22°C");
  assert.match(
    reloadedRoot.querySelector("[data-dashboard-weather-message]").textContent,
    /Showing saved weather/,
  );

  await waitFor(
    () => /Unable to refresh/.test(
      reloadedRoot.querySelector("[data-dashboard-weather-message]").textContent,
    ),
    "Failed refresh status was not shown.",
  );
  assert.equal(reloadedRoot.querySelector('[data-weather="humidity"]').textContent, "54%");
  assert.equal(reloadedRoot.querySelector('[data-weather="temperature"]').textContent, "22°C");
});

test("expired cache is ignored and an empty weather record is not displayed", async () => {
  const storage = new MemoryStorage();
  storage.setItem(displayCacheKey, JSON.stringify({
    version: 1,
    locationKey: "configured",
    locationLabel: "Configured location",
    savedAt: Date.now() - 25 * 60 * 60 * 1000,
    current: weatherPayload,
    daily: [],
  }));
  const runtime = createRuntime({ storage, fetch: async () => unavailableResponse() });
  const expiredRoot = new FakeWeatherRoot();
  runtime.api.initializeDashboard(expiredRoot);
  assert.equal(expiredRoot.querySelector('[data-weather="temperature"]').textContent, "Loading…");
  await waitFor(
    () => expiredRoot.querySelector('[data-weather="temperature"]').textContent === "Unavailable",
    "Expired cache was used after refresh failed.",
  );

  storage.setItem(displayCacheKey, JSON.stringify({
    version: 1,
    locationKey: "configured",
    locationLabel: "Configured location",
    savedAt: Date.now(),
    current: {},
    daily: [],
  }));
  const emptyRuntime = createRuntime({ storage, fetch: async () => unavailableResponse() });
  const emptyRoot = new FakeWeatherRoot();
  emptyRuntime.api.initializeDashboard(emptyRoot);
  assert.equal(emptyRoot.querySelector('[data-weather="temperature"]').textContent, "Loading…");
  await waitFor(
    () => /unavailable/i.test(emptyRoot.querySelector('[data-weather="temperature"]').textContent),
    "Empty cache record was rendered as weather.",
  );
});

test("weather from a different saved city is not shown as the selected location", async () => {
  const storage = new MemoryStorage();
  storage.setItem(manualLocationKey, "New Town");
  storage.setItem(displayCacheKey, JSON.stringify({
    version: 1,
    locationKey: "location:old town",
    locationLabel: "Old Town",
    savedAt: Date.now(),
    current: weatherPayload,
    daily: [],
  }));
  const runtime = createRuntime({ storage, fetch: async () => unavailableResponse() });
  const root = new FakeWeatherRoot();

  runtime.api.initializeDashboard(root);
  assert.equal(root.querySelector('[data-weather="location"]').textContent, "New Town");
  assert.equal(root.querySelector('[data-weather="temperature"]').textContent, "Loading…");
  await waitFor(
    () => root.querySelector('[data-weather="temperature"]').textContent === "Unavailable",
    "Weather for the unselected city was displayed.",
  );
});
