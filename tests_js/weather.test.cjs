const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const numberFormatting = require("../static/number-format.js");

const weatherSource = readFileSync(
  path.join(__dirname, "..", "static", "weather.js"),
  "utf8",
);

const shortUnavailable = {
  en: "N/A",
  te: "లేదు",
  hi: "नहीं",
  kn: "ಇಲ್ಲ",
  ta: "இல்லை",
  ml: "ഇല്ല",
};

const messages = {
  "weather.shortUnavailable": shortUnavailable,
  "weather.locationUnavailable": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Location unavailable"]),
  ),
  "weather.currentUnavailable": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Current weather is unavailable."]),
  ),
  "weather.locationPermissionOff": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Device location access is off."]),
  ),
  "weather.savedLocationUnavailable": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Saved location unavailable."]),
  ),
  "weather.currentLocationUnavailable": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Current-location weather is unavailable."]),
  ),
  "weather.chooseCity": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Choose a city"]),
  ),
  "weather.configuredLocation": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Configured location"]),
  ),
  "weather.currentLocation": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Current location"]),
  ),
  "weather.savedWeatherRefreshing": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Showing saved weather for {location}."]),
  ),
  "weather.refreshFallback": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Unable to refresh for {location}."]),
  ),
  "weather.refreshFallbackNoLocation": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Unable to refresh weather."]),
  ),
  "legacy.not.provided.20a04182": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Not provided"]),
  ),
  "legacy.unavailable.2c9c1f79": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Unavailable"]),
  ),
  "legacy.chosen.location.7ded283f": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Chosen location"]),
  ),
  "legacy.audit.loading-weather.ff988149": Object.fromEntries(
    Object.keys(shortUnavailable).map((code) => [code, "Loading weather…"]),
  ),
};

const defaultCurrent = {
  temperature_c: 28.2,
  feels_like_c: 28,
  weather_code: 1000,
  humidity_percent: 55,
  rainfall_mm_per_hr: 0,
  precipitation_probability_percent: 0,
  wind_speed_mps: 0.8,
  observation_time: "2026-11-14T09:55:00Z",
  is_stale: false,
};

class MockElement {
  constructor() {
    this.textContent = "";
    this.hidden = false;
    this.dataset = {};
    this.attributes = new Map();
    this.classes = new Set();
    this.classList = {
      toggle: (name, force) => {
        if (force === undefined ? !this.classes.has(name) : force) this.classes.add(name);
        else this.classes.delete(name);
      },
    };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

class MockWeatherCard extends MockElement {
  constructor() {
    super();
    this.nodes = new Map([
      "[data-weather-illustration]",
      '[data-weather="location"]',
      '[data-weather="temperature"]',
      ".temperature-indicator",
      '[data-weather="condition"]',
      '[data-weather="feels_like"]',
      '[data-weather="humidity"]',
      '[data-weather="wind_speed"]',
      '[data-weather="rainfall"]',
      '[data-weather="rain_probability"]',
      "[data-weather-updated]",
      "[data-dashboard-weather-message]",
      "[data-weather-location-picker]",
      "[data-weather-high-low]",
      "[data-weather-loading]",
    ].map((selector) => [selector, new MockElement()]));
    this.nodes.get(".temperature-indicator").hidden = true;
    this.nodes.get("[data-weather-location-picker]").hidden = true;
  }

  querySelector(selector) {
    return this.nodes.get(selector) || null;
  }
}

function createWeatherHarness({
  profile = null,
  storageEntries = [],
  permission = "denied",
  geolocation = { code: 1 },
  language = "en",
  currentValues = {},
  currentStatus = () => 200,
} = {}) {
  const storage = new Map(storageEntries);
  const requests = [];
  let permissionQueries = 0;
  let geolocationCalls = 0;
  const messagesForLanguage = (key, parameters = {}) => {
    const message = messages[key]?.[language] || key;
    return message.replace(/\{([A-Za-z0-9_]+)\}/g, (_match, name) =>
      Object.hasOwn(parameters, name) ? String(parameters[name]) : `{${name}}`);
  };
  const currentWeather = { ...defaultCurrent, ...currentValues };
  const response = (payload, status = 200, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    json: async () => payload,
  });
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    const isCurrent = url.startsWith("/weather/current");
    const status = isCurrent ? currentStatus(url, options) : 200;
    if (status !== 200) {
      return response(
        { detail: "The service is temporarily unavailable." },
        status,
        status === 503 ? { "retry-after": "1" } : {},
      );
    }
    if (isCurrent) {
      const location = new URL(url, "http://localhost").searchParams.get("location");
      return response({
        ...currentWeather,
        location: location || "26.12,85.39",
      });
    }
    return response({ data: [] });
  };
  const listeners = new Map();
  class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const window = {
    isSecureContext: true,
    JalSaathiProfile: {
      getProfile: () => profile,
      apiErrorMessage: () => "Weather service is unavailable.",
    },
    JalSaathiI18n: {
      t: messagesForLanguage,
      formatNumber: (value, options) =>
        new Intl.NumberFormat("en-IN", numberFormatting.numberOptions(options)).format(value),
      formatTemperature: (value) => numberFormatting.formatTemperature(
        value,
        messagesForLanguage("legacy.unavailable.2c9c1f79"),
      ),
      formatDate: (value, options) =>
        new Intl.DateTimeFormat("en-IN", numberFormatting.dateOptions(options)).format(value),
    },
    addEventListener(name, callback) {
      listeners.set(name, [...(listeners.get(name) || []), callback]);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach((callback) => callback(event));
      return true;
    },
  };
  const navigator = {
    permissions: {
      async query() {
        permissionQueries += 1;
        return { state: permission };
      },
    },
    geolocation: {
      getCurrentPosition(success, failure) {
        geolocationCalls += 1;
        if (geolocation.coordinates) {
          success({ coords: geolocation.coordinates });
        } else {
          failure({ code: geolocation.code });
        }
      },
    },
  };
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  vm.runInNewContext(weatherSource, {
    window,
    navigator,
    localStorage,
    fetch: fetchImpl,
    CustomEvent,
    HTMLElement: MockElement,
    URLSearchParams,
    setTimeout,
    console: { warn() {}, error() {} },
  });
  return {
    api: window.JalSaathiWeather,
    requests,
    storage,
    permissionQueries: () => permissionQueries,
    geolocationCalls: () => geolocationCalls,
  };
}

test("saved farmer location is used before browser geolocation or configured location", async () => {
  const harness = createWeatherHarness({
    profile: { id: 12, village: "Mysuru", district: "Mysuru", state: "Karnataka" },
  });
  const result = await harness.api.loadAutomatic({ refresh: true, includeHourly: false });

  assert.equal(result.source, "profile");
  assert.equal(result.data.selection.location, "Mysuru, Mysuru, Karnataka");
  assert.equal(harness.permissionQueries(), 0);
  assert.equal(harness.geolocationCalls(), 0);
  assert.ok(harness.requests.some(({ url }) =>
    url.startsWith("/weather/current?location=Mysuru")));
  assert.equal(harness.requests.some(({ url }) => url.startsWith("/weather/forecast?") &&
    new URL(url, "http://localhost").searchParams.get("timestep") === "1h"), false);
});

test("previously selected cities are account-scoped and override the profile default", async () => {
  const harness = createWeatherHarness({
    profile: { id: 12, village: "Mysuru", district: "Mysuru", state: "Karnataka" },
    storageEntries: [["jalsaathi.weather.manual-location.v1.12", "Tumakuru"]],
  });
  const result = await harness.api.loadAutomatic({ refresh: true, includeHourly: false });

  assert.equal(result.source, "manual");
  assert.equal(result.data.selection.location, "Tumakuru");
  assert.ok(harness.requests.some(({ url }) => url.startsWith("/weather/current?location=Tumakuru")));

  const otherAccount = createWeatherHarness({
    profile: { id: 13 },
    storageEntries: [["jalsaathi.weather.manual-location.v1.12", "Tumakuru"]],
  });
  const otherResult = await otherAccount.api.loadAutomatic({ refresh: true, includeHourly: false });
  assert.equal(otherResult.source, "configured");
  assert.equal(otherAccount.api.getManualLocation(), "");
  assert.equal(otherAccount.requests.some(({ url }) => url.includes("Tumakuru")), false);
});

test("denied location permission uses configured weather without prompting again", async () => {
  const harness = createWeatherHarness({ permission: "denied" });
  const result = await harness.api.loadAutomatic({ refresh: true, includeHourly: false });

  assert.equal(result.source, "configured");
  assert.equal(result.locationIssue, "permission-denied");
  assert.equal(harness.permissionQueries(), 1);
  assert.equal(harness.geolocationCalls(), 0);
  assert.ok(harness.requests.some(({ url }) => url === "/weather/current"));
});

test("granted device location is sent to the coordinate weather endpoint", async () => {
  const harness = createWeatherHarness({
    permission: "granted",
    geolocation: { coordinates: { latitude: 12.9716, longitude: 77.5946 } },
  });
  const result = await harness.api.loadAutomatic({ refresh: true, includeHourly: false });
  const request = harness.requests.find(({ url }) => url === "/weather/current");

  assert.equal(result.source, "current-location");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(JSON.parse(request.options.body), { latitude: 12.9716, longitude: 77.5946 });
  assert.equal(harness.geolocationCalls(), 1);
});

test("provider 429/Retry-After allows one configured-location fallback", async () => {
  const harness = createWeatherHarness({
    permission: "granted",
    geolocation: { coordinates: { latitude: 12.9716, longitude: 77.5946 } },
    currentStatus: (url, options) => options.method === "POST" ? 503 : 200,
  });
  const result = await harness.api.loadAutomatic({ refresh: true, includeHourly: false });

  assert.equal(result.source, "configured");
  assert.equal(result.locationIssue, "current-location-unavailable");
  assert.equal(result.data.current.temperature_c, 28.2);
  assert.ok(harness.requests.some(({ url, options }) =>
    url === "/weather/current" && options.method !== "POST"));
});

test("unavailable geolocation is distinct from provider failure and still tries configured weather", async () => {
  const harness = createWeatherHarness({
    permission: "granted",
    geolocation: { code: 2 },
  });
  const result = await harness.api.loadAutomatic({ refresh: true, includeHourly: false });

  assert.equal(result.source, "configured");
  assert.equal(result.locationIssue, "location-unavailable");
  assert.equal(harness.geolocationCalls(), 1);
});

test("zero readings remain valid and missing temperature uses a compact localized placeholder", async () => {
  const harness = createWeatherHarness({
    profile: { id: 14, village: "Mysuru" },
    currentValues: {
      temperature_c: null,
      feels_like_c: null,
      humidity_percent: 0,
      rainfall_mm_per_hr: 0,
      precipitation_probability_percent: 0,
      wind_speed_mps: 0,
    },
  });
  const card = new MockWeatherCard();
  harness.api.initializeDashboard(card);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(card.nodes.get('[data-weather="location"]').textContent, "Mysuru");
  assert.equal(card.nodes.get('[data-weather="temperature"]').textContent, "N/A");
  assert.equal(card.nodes.get('[data-weather="temperature"]').classes.has("is-unavailable"), true);
  assert.equal(card.nodes.get('[data-weather="feels_like"]').textContent, "N/A");
  assert.equal(card.nodes.get('[data-weather="humidity"]').textContent, "0%");
  assert.equal(card.nodes.get('[data-weather="wind_speed"]').textContent, "0 m/s");
  assert.equal(card.nodes.get('[data-weather="rainfall"]').textContent, "0 mm/h");
  assert.equal(card.nodes.get('[data-weather="rain_probability"]').textContent, "0%");
  assert.equal(card.nodes.get("[data-weather-location-picker]").hidden, true);
});

test("weather card exposes a manual city action when no valid weather response is available", async () => {
  const harness = createWeatherHarness({
    currentStatus: () => 503,
  });
  const card = new MockWeatherCard();
  harness.api.initializeDashboard(card);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(card.nodes.get('[data-weather="location"]').textContent, "Location unavailable");
  assert.equal(card.nodes.get('[data-weather="temperature"]').textContent, "N/A");
  assert.equal(card.nodes.get('[data-weather="temperature"]').classes.has("is-unavailable"), true);
  assert.equal(card.nodes.get('[data-weather="humidity"]').textContent, "Not provided");
  assert.equal(card.nodes.get("[data-dashboard-weather-message]").textContent,
    "Current weather is unavailable.");
  assert.equal(card.nodes.get("[data-weather-location-picker]").hidden, false);
});

test("failed refresh keeps the last successful weather visible", async () => {
  const savedCurrent = { ...defaultCurrent, location: "Mysuru" };
  const harness = createWeatherHarness({
    profile: { id: 15 },
    storageEntries: [
      ["jalsaathi.weather.manual-location.v1.15", "Mysuru"],
      ["jalsaathi.weather.display-cache.v1", JSON.stringify({
        version: 1,
        locationKey: "location:mysuru",
        locationLabel: "Mysuru",
        savedAt: Date.now() - 1_000,
        current: savedCurrent,
        daily: [],
      })],
    ],
    currentStatus: () => 503,
  });
  const card = new MockWeatherCard();
  harness.api.initializeDashboard(card);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(card.nodes.get('[data-weather="location"]').textContent, "Mysuru");
  assert.equal(card.nodes.get('[data-weather="temperature"]').textContent, "28°C");
  assert.equal(savedCurrent.temperature_c, 28.2);
  assert.match(card.nodes.get("[data-dashboard-weather-message]").textContent,
    /Unable to refresh for Mysuru\./);
});

test("weather temperatures retain Latin digits in every supported language", () => {
  const expected = new Map([
    [20.3, "20°C"],
    [20.8, "21°C"],
    [28.25, "28°C"],
    [28.6, "29°C"],
    [27.5, "28°C"],
    [0, "0°C"],
    [0.4, "0°C"],
    [-2.6, "-3°C"],
  ]);
  for (const [language, placeholder] of Object.entries(shortUnavailable)) {
    const harness = createWeatherHarness({ language });
    for (const [value, display] of expected) {
      assert.equal(harness.api.formatCurrentTemperature(value), display);
    }
    assert.equal(harness.api.formatCurrentTemperature(null), placeholder);
  }
});
