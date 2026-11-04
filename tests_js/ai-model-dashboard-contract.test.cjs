const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const dashboard = readFileSync(path.join(root, "static", "ai-model-dashboard.html"), "utf8");
const script = readFileSync(path.join(root, "static", "ai-model-dashboard.js"), "utf8");
const sections = readFileSync(path.join(root, "static", "sections.js"), "utf8");
const navigation = readFileSync(path.join(root, "static", "sections.html"), "utf8");
const styles = readFileSync(path.join(root, "static", "sections.css"), "utf8");

test("AI predictions page is reachable through the existing dashboard sidebar", () => {
  assert.match(navigation, /data-view-link="ai-model-predictions"/);
  assert.match(navigation, /AI Model Predictions/);
  assert.match(sections, /"ai-model-predictions"/);
  assert.match(sections, /JalSaathiAIDashboard\?\.initialize/);
});

test("all four cards call their existing backend prediction APIs", () => {
  assert.match(script, /\/api\/ml\/reduced-weather-prediction/);
  assert.match(script, /\/api\/ml\/water-requirement/);
  assert.match(script, /\/api\/ml\/soil-moisture-prediction/);
  assert.match(script, /\/api\/ml\/crop-stress-prediction/);
  assert.doesNotMatch(script, /\/api\/models\/model2\/predict/);
});

test("dashboard requires observed inputs and does not invent Model 4 class labels", () => {
  assert.match(dashboard, /name="current_moisture_percent"[^>]*required/);
  assert.match(dashboard, /data-ai-zone4-inputs/);
  assert.match(dashboard, /Enter actual soil and crop observations/);
  assert.match(script, /class_label_status !== "unverified"/);
  assert.doesNotMatch(dashboard, /Low Stress|Moderate Stress|High Stress/);
  assert.match(dashboard, /Class mapping requires verification/);
});

test("Model 4 form exposes the artifact's full 20-feature input contract", () => {
  const features = [
    "soil_type", "bulk_density", "organic_matter_pct", "cation_exchange_capacity",
    "salinity_ec", "buffering_capacity", "soil_moisture_pct",
    "moisture_limit_dry", "moisture_limit_wet", "moisture_regime",
    "soil_temp_c", "air_temp_c", "thermal_regime", "light_intensity_par",
    "soil_ph", "nitrogen_ppm", "phosphorus_ppm", "potassium_ppm",
    "nutrient_balance", "plant_category",
  ];
  for (const feature of features) {
    assert.match(dashboard, new RegExp(`name="${feature}"`), `Missing Model 4 feature: ${feature}`);
  }
});

test("summary and responsive card layout are driven by model states", () => {
  assert.match(script, /data-ai-success-count/);
  assert.match(script, /data-ai-unavailable-count/);
  assert.match(styles, /\.ai-model-grid \{[^}]*grid-template-columns: repeat\(3/);
  assert.match(styles, /@media \(max-width: 1000px\)[\s\S]*?\.ai-model-grid \{[^}]*grid-template-columns: repeat\(2/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*?\.ai-model-grid \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
});
