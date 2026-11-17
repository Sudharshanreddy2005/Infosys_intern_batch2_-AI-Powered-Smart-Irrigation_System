const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");

test("main-app installation uses browser events and runtime installation detection", () => {
  const installer = read("static/pwa-install.js");

  assert.match(installer, /beforeinstallprompt/);
  assert.match(installer, /deferredPrompt = event/);
  assert.match(installer, /await prompt\.prompt\(\)/);
  assert.match(installer, /choice\?\.outcome === "accepted"/);
  assert.match(installer, /navigator\.getInstalledRelatedApps/);
  assert.match(installer, /window\.addEventListener\("appinstalled"/);
  assert.match(installer, /display-mode: standalone/);
  assert.match(installer, /manualOptions = true;\s*showInstallDialog\("install\.statusAccepted"/);
  assert.doesNotMatch(installer, /localStorage\.(?:getItem|setItem)\(["'][^"']*install/i);
  assert.doesNotMatch(installer, /farmer-pwa/i);
});

test("main app pages request the versioned installer asset", () => {
  for (const file of [
    "templates/landing.html",
    "templates/index.html",
    "templates/todo-list.html",
    "static/auth.html",
    "static/sections.html",
  ]) {
    assert.match(read(file), /pwa-install\.js\?v=20261116-main-pwa3/);
  }
});

test("all supported locales provide the main-app install state and browser guidance", () => {
  const keys = [
    "install.installing",
    "install.options",
    "install.chrome",
    "install.edge",
    "install.firefox",
    "install.embedded",
    "install.statusManual",
    "install.statusAccepted",
    "install.statusCancelled",
  ];

  for (const language of ["en", "te", "hi", "kn", "ta", "ml"]) {
    const locale = read(`static/i18n/${language}.js`);
    keys.forEach((key) => assert.match(locale, new RegExp(`"${key}":\\s*"[^"]+"`)));
  }
});
