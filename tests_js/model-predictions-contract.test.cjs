const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = readFileSync(
  path.join(__dirname, "..", "static", "model-predictions.js"),
  "utf8",
);

test("Model 4 frontend uses the authenticated endpoint and unverified class contract", () => {
  assert.match(source, /\/api\/ml\/crop-stress-prediction/);
  assert.match(source, /class_label_status !== "unverified"/);
  assert.match(source, /Model-estimated probability/);
  assert.match(source, /predicted_class/);
});

test("Model 4 frontend does not contain guessed stress labels", () => {
  assert.doesNotMatch(source, /Low Stress|Moderate Stress|High Stress/);
});
