const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(
  path.join(__dirname, "..", "static", "field-location.js"),
  "utf8",
);

function createLocationHelper(geolocation) {
  const window = {};
  vm.runInNewContext(source, {
    window,
    navigator: { geolocation },
    Number,
    Promise,
    Error,
    Object,
  });
  return window.JalSaathiFieldLocation.requestCurrentCoordinates;
}

test("geolocation resolves explicit current coordinates with fresh-position options", async () => {
  let callOptions;
  const request = createLocationHelper({
    getCurrentPosition(success, _failure, options) {
      callOptions = options;
      success({ coords: { latitude: 12.5, longitude: 77.6 } });
    },
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(await request())),
    { latitude: 12.5, longitude: 77.6 },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(callOptions)), {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000,
  });
});

test("geolocation permission denial is surfaced without substituting coordinates", async () => {
  const request = createLocationHelper({
    getCurrentPosition(_success, failure) {
      failure({ code: 1 });
    },
  });
  await assert.rejects(request(), { message: "permission-denied" });
});

test("geolocation timeout and unavailable browser are explicit failures", async () => {
  const timedOut = createLocationHelper({
    getCurrentPosition(_success, failure) {
      failure({ code: 3 });
    },
  });
  await assert.rejects(timedOut(), { message: "timeout" });

  const unavailable = createLocationHelper(undefined);
  await assert.rejects(unavailable(), { message: "unavailable" });
});

test("geolocation service failure is distinct from permission and timeout errors", async () => {
  const unavailablePosition = createLocationHelper({
    getCurrentPosition(_success, failure) {
      failure({ code: 2 });
    },
  });
  await assert.rejects(unavailablePosition(), { message: "position-unavailable" });
});

test("invalid geolocation coordinates are rejected", async () => {
  const request = createLocationHelper({
    getCurrentPosition(success) {
      success({ coords: { latitude: 91, longitude: 77 } });
    },
  });
  await assert.rejects(request(), { message: "invalid" });
});
