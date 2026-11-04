const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = readFileSync(
  path.join(__dirname, "..", "static", "sections.js"),
  "utf8",
);
const landing = readFileSync(
  path.join(__dirname, "..", "templates", "landing.html"),
  "utf8",
);
const scheduleStart = source.indexOf("    schedule: {");
const scheduleEnd = source.indexOf("    reports: {", scheduleStart);
const schedule = source.slice(scheduleStart, scheduleEnd);

test("Irrigation Schedule provides account-backed field, water, plan, and schedule controls", () => {
  for (const requiredControl of [
    "data-irrigation-field",
    "data-irrigation-reservoir",
    "data-irrigation-reservoir-form",
    "data-irrigation-water-form",
    "data-irrigation-plan-form",
    "Generate Irrigation Plan",
    "data-irrigation-summary-reserved",
  ]) {
    assert.ok(schedule.includes(requiredControl), `missing schedule control: ${requiredControl}`);
  }
  assert.match(source, /apiRequest\("\/api\/irrigation\/plan"/);
  assert.match(source, /apiRequest\("\/api\/irrigation\/reservoirs"/);
  assert.match(source, /\/api\/irrigation\/schedules\?/);
  assert.match(source, /data-irrigation-confirm/);
  assert.match(source, /data-irrigation-cancel/);
  assert.match(source, /data-irrigation-complete/);
  assert.match(source, /session has expired/);
  assert.match(source, /Weather or optimizer service is temporarily unavailable/);
  assert.match(landing, /recommendations use measured inputs/);
  assert.match(landing, /does not invent live sensor readings/);
});
