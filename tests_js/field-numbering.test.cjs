const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = readFileSync(
  path.join(__dirname, "..", "static", "field-numbering.js"),
  "utf8",
);

function createNumbering() {
  const window = {};
  vm.runInNewContext(source, { window, Array, TypeError });
  return window.JalSaathiFieldNumbering;
}

test("field display numbers are consecutive and stable IDs are preserved", () => {
  const { withDisplayNumbers } = createNumbering();
  const fields = [
    { id: 21, name: "North", latitude: 12.5, longitude: 77.6 },
    { id: 48, name: "East", latitude: 13.1, longitude: 78.2 },
    { id: 93, name: "South", latitude: 14.2, longitude: 79.3 },
  ];

  assert.deepEqual(
    withDisplayNumbers(fields).map(({ id, displayNumber }) => [id, displayNumber]),
    [[21, 1], [48, 2], [93, 3]],
  );
  assert.deepEqual(
    withDisplayNumbers([fields[1], fields[2]]).map(({ id, displayNumber }) => [id, displayNumber]),
    [[48, 1], [93, 2]],
  );
  assert.deepEqual(
    withDisplayNumbers([fields[0], fields[2]]).map(({ id, displayNumber }) => [id, displayNumber]),
    [[21, 1], [93, 2]],
  );
  assert.deepEqual(
    withDisplayNumbers([fields[0], fields[1]]).map(({ id, displayNumber }) => [id, displayNumber]),
    [[21, 1], [48, 2]],
  );
  assert.deepEqual(
    withDisplayNumbers([fields[1], fields[2], { id: 120, name: "New" }])
      .map(({ id, displayNumber }) => [id, displayNumber]),
    [[48, 1], [93, 2], [120, 3]],
  );
  assert.deepEqual(fields.map((field) => field.displayNumber), [undefined, undefined, undefined]);
});

test("field display numbering is independent for each farmer's field list", () => {
  const { withDisplayNumbers } = createNumbering();
  const farmerOne = withDisplayNumbers([{ id: 21 }, { id: 48 }]);
  const farmerTwo = withDisplayNumbers([{ id: 901 }]);

  assert.deepEqual(farmerOne.map((field) => field.displayNumber), [1, 2]);
  assert.deepEqual(farmerTwo.map((field) => field.displayNumber), [1]);
});

test("dashboard and field management load sequential display numbering helper", () => {
  const dashboard = readFileSync(
    path.join(__dirname, "..", "templates", "index.html"),
    "utf8",
  );
  const fieldsPage = readFileSync(
    path.join(__dirname, "..", "static", "sections.html"),
    "utf8",
  );
  assert.match(dashboard, /field-numbering\.js\?v=/);
  assert.match(fieldsPage, /field-numbering\.js\?v=/);
});
