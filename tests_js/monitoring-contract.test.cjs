const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const html = readFileSync(
  path.join(root, "static", "field-monitoring.html"),
  "utf8",
);
const script = readFileSync(
  path.join(root, "static", "monitoring.js"),
  "utf8",
);

test("monitoring cannot write generated demo readings to farmer history", () => {
  assert.doesNotMatch(html, /Automatic Demo Reading|monitoring-reading-mode|SIMULATED/);
  assert.doesNotMatch(script, /generateDemoSensorReading|Simulated demo reading/);
  assert.match(script, /Sensor reading saved successfully/);
});

test("printed field report uses the latest saved sensor values and handles missing data", () => {
  assert.match(script, /Latest Recorded Sensor Reading/);
  assert.match(script, /latestSensorReading\[metric\.key\]/);
  assert.match(script, /: "Not available"/);
  assert.doesNotMatch(script, /Verified sensor readings are not currently connected/);
  assert.match(html, /Download PDF Report/);
});

test("CSV download URL remains valid briefly after the browser starts downloading", () => {
  assert.match(
    script,
    /link\.click\(\);\s*link\.remove\(\);\s*window\.setTimeout\(\(\) => URL\.revokeObjectURL\(downloadUrl\), 1000\)/,
  );
});
