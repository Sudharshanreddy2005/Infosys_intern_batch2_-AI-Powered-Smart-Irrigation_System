const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildMonthGrid,
  collectEvents,
  statusKind,
  summarizeEvents,
  validDateKey,
} = require("../static/calendar.js");

test("calendar month grid includes complete Sunday-first weeks and leap days", () => {
  const february = buildMonthGrid(2024, 1);
  assert.equal(february.length, 35);
  assert.equal(february[0].key, "2024-01-28");
  assert.equal(february.find((cell) => cell.key === "2024-02-29").inMonth, true);
  assert.equal(february.at(-1).key, "2024-03-02");
  assert.throws(() => buildMonthGrid(2024, 12), RangeError);
});

test("calendar validates ISO dates and maps each persisted irrigation state distinctly", () => {
  assert.equal(validDateKey("2024-02-29"), true);
  assert.equal(validDateKey("2023-02-29"), false);
  assert.equal(validDateKey("2024-2-09"), false);
  assert.deepEqual(
    ["completed", "confirmed", "insufficient_water", "recommended", "cancelled"]
      .map(statusKind),
    ["completed", "pending", "unsuccessful", "unconfirmed", "cancelled"],
  );
});

test("calendar applies farmer field and crop filters to schedules and crop dates", () => {
  const events = collectEvents({
    fields: [{ id: 1, name: "North Field" }, { id: 2, name: "South Field" }],
    crops: [
      { id: 10, field_id: 1, name: "Rice", planting_date: "2026-03-01", expected_harvest_date: "2026-08-01" },
      { id: 20, field_id: 2, name: "Rice", planting_date: "2026-03-05", expected_harvest_date: null },
    ],
    schedules: [
      { id: 30, field_id: 1, field_name: "North Field", crop_name: "Rice", scheduled_date: "2026-03-10", status: "confirmed", water_liters: 120 },
      { id: 31, field_id: 2, field_name: "South Field", crop_name: "Rice", scheduled_date: "2026-03-10", status: "completed", water_liters: 90 },
      { id: 32, field_id: 1, crop_name: "Maize", scheduled_date: "2026-03-10", status: "confirmed", water_liters: 40 },
      { id: 33, field_id: 1, crop_name: "Rice", scheduled_date: "2026-02-30", status: "confirmed", water_liters: 40 },
    ],
    fieldId: "1",
    cropId: "10",
  });

  assert.deepEqual(events.map((event) => [event.type, event.date, event.id]), [
    ["crop", "2026-03-01", "10-planting"],
    ["irrigation", "2026-03-10", 30],
    ["crop", "2026-08-01", "10-harvest"],
  ]);
  assert.ok(events.every((event) => event.fieldId === 1));
});

test("calendar summaries use planned volumes and show measured use only when present", () => {
  const plannedOnly = summarizeEvents([
    { type: "irrigation", status: "confirmed", waterLiters: 50, actualWaterLiters: null },
    { type: "irrigation", status: "completed", waterLiters: 25, actualWaterLiters: null },
    { type: "irrigation", status: "cancelled", waterLiters: 100, actualWaterLiters: null },
    { type: "crop", status: "", waterLiters: 500, actualWaterLiters: 500 },
  ]);
  assert.deepEqual(plannedOnly, {
    total: 3,
    completed: 1,
    pending: 1,
    unsuccessful: 0,
    unconfirmed: 0,
    cancelled: 1,
    plannedWater: 75,
    actualWater: null,
  });

  const measured = summarizeEvents([
    { type: "irrigation", status: "completed", waterLiters: 25, actualWaterLiters: 18 },
    { type: "irrigation", status: "confirmed", waterLiters: 50, actualWaterLiters: 20 },
  ]);
  assert.equal(measured.actualWater, 38);
});
