const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");

test("the topbar loads five saved alerts and an all-record unread count", () => {
  const header = read("static/topbar.html");
  const topbar = read("static/topbar.js");

  assert.match(header, /data-notification-toggle/);
  assert.match(header, /data-notification-count hidden/);
  assert.match(header, /data-notification-loading/);
  assert.match(header, /data-notification-empty hidden/);
  assert.match(header, /data-notification-feedback/);
  assert.match(header, /view=notifications/);
  assert.match(topbar, /\/api\/alerts\?limit=5/);
  assert.match(topbar, /\/api\/alerts\/counts/);
  assert.match(topbar, /counts\.unread/);
  assert.match(topbar, /unreadCount > 99 \? "99\+"/);
  assert.match(topbar, /notificationPanel\.hidden === false/);
  assert.match(topbar, /setInterval\([\s\S]*?60_000/);
  assert.match(topbar, /document\.addEventListener\("click"[\s\S]*?closeMenus\(\)/);
});

test("the existing Alerts page is reused as paginated Notifications with read/category filters", () => {
  const sections = read("static/sections.js");
  const backend = read("main.py");

  assert.match(sections, /title:\s*"Notifications"/);
  assert.match(sections, /data-alert-filter="all"/);
  for (const filter of ["unread", "read", "weather", "irrigation", "sensors", "crops", "system"]) {
    assert.match(sections, new RegExp(`data-alert-filter="${filter}"`));
  }
  assert.match(sections, /data-alert-read-all/);
  assert.match(sections, /data-alert-previous/);
  assert.match(sections, /data-alert-next/);
  assert.match(sections, /pageSize = 50/);
  assert.match(sections, /\/api\/alerts\/read-all/);
  assert.match(sections, /\/api\/alerts\/\$\{alert\.id\}\/\$\{alert\.is_read \? "unread" : "read"\}/);
  assert.match(sections, /requestedView === "notifications"[\s\S]*?\"alerts\"/);
  assert.match(backend, /@app\.get\("\/api\/alerts\/counts"\)/);
  assert.match(backend, /@app\.patch\("\/api\/alerts\/read-all"\)/);
  assert.match(backend, /@app\.patch\("\/api\/alerts\/\{alert_id\}\/unread"\)/);
  assert.match(backend, /@app\.post\("\/api\/alerts\/refresh"\)/);
});

test("weather and sensor alert refreshes use real field data and persist deduplicated records", () => {
  const backend = read("main.py");
  const rules = read("alerts/rules.py");
  const sensor = read("sensor-ingestion/app/main.py");

  assert.match(backend, /get_forecast\([\s\S]*?field\.latitude[\s\S]*?field\.longitude/);
  assert.match(backend, /process_weather_forecast/);
  assert.match(backend, /process_drought_risk/);
  assert.match(backend, /process_sensor_failure/);
  assert.match(backend, /create_alert\(db, values\)/);
  assert.match(rules, /"type": "heavy_rain"/);
  assert.match(rules, /"type": "high_temperature"/);
  assert.match(rules, /"type": "heatwave"/);
  assert.match(rules, /"type": "strong_wind"/);
  assert.match(rules, /"type": "storm"/);
  assert.match(sensor, /process_soil_moisture/);
  assert.match(sensor, /create_alert\(db, alert_data\)/);
});
