const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const weatherSource = readFileSync(
  path.join(__dirname, "..", "static", "weather.js"),
  "utf8",
);

const source = readFileSync(
  path.join(__dirname, "..", "static", "experimental-model.js"),
  "utf8",
);
const window = {};
vm.runInNewContext(source, {
  window,
  document: {
    readyState: "loading",
    addEventListener() {},
  },
});

test("partial fresh responses preserve missing weather features as unavailable", () => {
  const now = Date.now();
  const mapped = model.mapCurrentWeather({
    temperature_c: 19,
    humidity_percent: null,
    precipitation_probability_percent: 0,
    is_stale: false,
    data_age_minutes: 0,
    observation_time: new Date(now - 10_000).toISOString(),
  }, now);

  assert.equal(mapped.fresh, true);
  assert.equal(mapped.values.temperature_c, 19);
  assert.equal(mapped.values.humidity_percent, null);
  assert.equal(mapped.values.rain_probability_percent, 0);
});

const model = window.JalSaathiExperimentalModel;
const supportedCrops = [
  "apple", "banana", "blackgram", "chickpea", "coconut", "coffee",
  "cotton", "grapes", "jute", "kidneybeans", "lentil", "maize",
  "mango", "mothbeans", "mungbean", "muskmelon", "orange", "papaya",
  "pigeonpeas", "pomegranate", "rice", "watermelon",
];

test("unverified Model 1 features stay unavailable until trusted sources exist", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(model.featuresWithoutVerifiedSources)), [
    "N", "P", "K", "ph", "organic_matter", "crop_density",
    "sunlight_exposure", "wind_speed", "frost_risk", "soil_type", "growth_stage",
  ]);
});

test("weather mapper uses only fresh current fields without unit conversion", () => {
  const now = Date.now();
  const mapped = model.mapCurrentWeather({
    temperature_c: 21.5,
    humidity_percent: 70,
    precipitation_probability_percent: 35,
    rainfall_mm_per_hr: 2.4,
    wind_speed_mps: 4.2,
    observation_time: new Date(now - 30_000).toISOString(),
    is_stale: false,
    data_age_minutes: 0.5,
  }, now);

  assert.deepEqual(Object.keys(mapped.values), [
    "temperature_c",
    "humidity_percent",
    "rain_probability_percent",
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(mapped.values)), {
    temperature_c: 21.5,
    humidity_percent: 70,
    rain_probability_percent: 35,
  });
  assert.equal(mapped.wind_speed_mps, 4.2);
  assert.equal(mapped.freshness, "fresh");
  assert.equal(mapped.observation_time, new Date(now - 30_000).toISOString());
});

test("missing values remain unavailable and stale or unknown weather is not mapped", () => {
  const missing = model.mapCurrentWeather({
    temperature_c: null,
    humidity_percent: 40,
    precipitation_probability_percent: "20",
    is_stale: false,
    data_age_minutes: 0,
    observation_time: new Date().toISOString(),
  });
  assert.equal(missing.values.temperature_c, null);
  assert.equal(missing.values.humidity_percent, 40);
  assert.equal(missing.values.rain_probability_percent, null);

  const stale = model.mapCurrentWeather({
    temperature_c: 20,
    humidity_percent: 40,
    precipitation_probability_percent: 20,
    is_stale: true,
  });
  assert.equal(stale.fresh, false);
  assert.deepEqual(JSON.parse(JSON.stringify(stale.values)), {
    temperature_c: null,
    humidity_percent: null,
    rain_probability_percent: null,
  });
  assert.equal(model.mapCurrentWeather({ temperature_c: 20 }).fresh, false);
  assert.equal(model.mapCurrentWeather({
    is_stale: false,
    data_age_minutes: 0,
    observation_time: "not-a-timestamp",
  }).freshness, "unknown");
  assert.equal(model.mapCurrentWeather({
    is_stale: false,
    data_age_minutes: Number.NaN,
    observation_time: new Date().toISOString(),
  }).freshness, "unknown");
  assert.equal(model.mapCurrentWeather({
    is_stale: false,
    data_age_minutes: 0,
    observation_time: new Date(Date.now() - 16 * 60_000).toISOString(),
  }).freshness, "stale");
  assert.equal(model.mapCurrentWeather({
    is_stale: false,
    data_age_minutes: 16,
    observation_time: new Date().toISOString(),
  }).freshness, "stale");
});

test("weather request generation prevents an earlier field response from applying", () => {
  assert.equal(model.isCurrentWeatherRequest(2, 2, 32, 32), true);
  assert.equal(model.isCurrentWeatherRequest(1, 2, 31, 32), false);
  assert.equal(model.isCurrentWeatherRequest(2, 2, 31, 32), false);
});

test("weather input updates clear prior-field values and leave missing readings blank", () => {
  const inputs = {
    temperature_c: { value: "old-temperature" },
    humidity_percent: { value: "old-humidity" },
    rain_probability_percent: { value: "old-rain" },
  };
  const getInput = (name) => inputs[name];

  model.clearWeatherInputValues(getInput);
  assert.deepEqual(Object.values(inputs).map((input) => input.value), ["", "", ""]);

  model.applyWeatherInputValues(getInput, {
    temperature_c: 23,
    humidity_percent: null,
    rain_probability_percent: 0,
  });
  assert.deepEqual(Object.values(inputs).map((input) => input.value), ["23", "", "0"]);
});

test("crop mapping accepts exact supported names only", () => {
  assert.equal(model.mapSupportedCrop("  Rice ", supportedCrops), "rice");
  assert.equal(model.mapSupportedCrop("Paddy", supportedCrops), "");
  assert.equal(model.mapSupportedCrop("unlisted crop", supportedCrops), "");
});

test("prediction payload contains exactly the model's 15 validated features", () => {
  const values = {
    temperature_c: "25",
    humidity_percent: "60",
    rain_probability_percent: "30",
    N: "20",
    P: "30",
    K: "40",
    ph: "6.5",
    organic_matter: "3",
    crop_density: "10",
    sunlight_exposure: "8",
    wind_speed: "4",
    frost_risk: "10",
    crop_name: "maize",
    soil_type: "1",
    growth_stage: "2",
    field_id: "99",
    crop_record_id: "12",
  };
  const payload = model.buildPredictionPayload(values, supportedCrops);

  assert.equal(Object.keys(payload).length, 15);
  assert.deepEqual(Object.keys(payload), Array.from(model.modelFeatures));
  assert.equal(payload.temperature_c, 25);
  assert.equal(payload.soil_type, 1);
  assert.equal(Object.hasOwn(payload, "field_id"), false);
  assert.equal(Object.hasOwn(payload, "crop_record_id"), false);
});

test("invalid or unsupported model features cannot be serialized", () => {
  const values = Object.fromEntries(model.modelFeatures.map((name) => [
    name,
    name === "crop_name" ? "maize" :
      name === "soil_type" || name === "growth_stage" ? "1" : "2",
  ]));
  assert.throws(
    () => model.buildPredictionPayload({ ...values, temperature_c: "" }, supportedCrops),
    /temperature_c feature is unavailable/,
  );
  assert.throws(
    () => model.buildPredictionPayload({ ...values, humidity_percent: "Infinity" }, supportedCrops),
    /humidity_percent feature must be a finite number/,
  );
  assert.throws(
    () => model.buildPredictionPayload({ ...values, crop_name: "Paddy" }, supportedCrops),
    /supported crop/,
  );
  assert.throws(
    () => model.buildPredictionPayload({ ...values, growth_stage: "4" }, supportedCrops),
    /growth stage category code/,
  );
});

test("field weather helper fetches only current weather for the selected coordinates", async () => {
  const calls = [];
  const weatherWindow = {};
  vm.runInNewContext(weatherSource, {
    window: weatherWindow,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          temperature_c: 22,
          humidity_percent: 65,
          precipitation_probability_percent: 10,
          is_stale: false,
          data_age_minutes: 0,
          observation_time: new Date().toISOString(),
        }),
      };
    },
    URLSearchParams,
    console,
  });

  const data = await weatherWindow.JalSaathiWeather.loadCurrent(
    { coordinates: { latitude: 12.5, longitude: 77.6 } },
    { refresh: true },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/weather/current");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    latitude: 12.5,
    longitude: 77.6,
  });
  assert.deepEqual(Array.from(data.hourly), []);
  assert.deepEqual(Array.from(data.daily), []);
  assert.equal(data.current.temperature_c, 22);
});

test("field weather helper propagates API errors without fallback values", async () => {
  const weatherWindow = {};
  vm.runInNewContext(weatherSource, {
    window: weatherWindow,
    fetch: async () => ({
      ok: false,
      json: async () => ({ detail: "Weather data is unavailable." }),
    }),
    URLSearchParams,
    console,
  });

  await assert.rejects(
    weatherWindow.JalSaathiWeather.loadCurrent({ location: "Mysuru" }, { refresh: true }),
    /Weather data is unavailable/,
  );
});

test("current-only cache does not replace the dashboard weather bundle", async () => {
  const calls = [];
  const weatherWindow = {};
  vm.runInNewContext(weatherSource, {
    window: weatherWindow,
    fetch: async (url) => {
      calls.push(url);
      const current = url.startsWith("/weather/current");
      return {
        ok: true,
        json: async () => current
          ? { temperature_c: 22, humidity_percent: 65, is_stale: false }
          : { data: [{ time: "2026-10-26T11:00:00Z" }] },
      };
    },
    URLSearchParams,
    console,
  });

  await weatherWindow.JalSaathiWeather.loadCurrent({ location: "Mysuru" });
  const fullWeather = await weatherWindow.JalSaathiWeather.load({ location: "Mysuru" });

  assert.equal(calls.length, 4);
  assert.equal(calls.filter((url) => url.startsWith("/weather/current")).length, 2);
  assert.equal(fullWeather.hourly.length, 1);
  assert.equal(fullWeather.daily.length, 1);
});
