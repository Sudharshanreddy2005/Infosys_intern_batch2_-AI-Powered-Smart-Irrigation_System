const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const authSource = fs.readFileSync(
  path.join(__dirname, "..", "static", "auth.js"),
  "utf8",
);

function createInput(value = "", checked = false) {
  return {
    value,
    checked,
    attributes: new Map(),
    setAttribute(name, attributeValue) {
      this.attributes.set(name, attributeValue);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    focus() {},
  };
}

function createAuthHarness(formName, values, responseProfile) {
  const inputs = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      createInput(value, name === "terms" && value === true),
    ]),
  );
  const fieldErrors = new Map();
  let submitHandler;
  const buttonLabel = {
    textContent: formName === "login" ? "Sign In" : "Create Account",
  };
  const message = {
    textContent: "",
    classList: { toggle() {}, remove() {} },
  };
  const button = {
    disabled: false,
    classList: { toggle() {} },
    setAttribute() {},
    querySelector(selector) {
      return selector === ".button-label" ? buttonLabel : null;
    },
  };
  const form = {
    dataset: { authForm: formName },
    elements: {
      namedItem(name) {
        return inputs[name] || null;
      },
    },
    addEventListener(name, callback) {
      if (name === "submit") submitHandler = callback;
    },
    querySelector(selector) {
      if (selector === ".primary-button") return button;
      if (selector === "[data-form-message]") return message;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const profileCalls = [];
  const profileApi = {
    setCurrentProfile(profile) {
      profileCalls.push(["setCurrentProfile", profile]);
    },
    setLanguage(language) {
      profileCalls.push(["setLanguage", language]);
    },
    getLanguages() {
      return ["en", "te", "hi", "kn", "ta", "ml"].map((code) => ({ code }));
    },
  };
  const fetchCalls = [];
  const locationAssignments = [];
  class MockFormData {
    constructor(formElement) {
      this.formElement = formElement;
    }

    get(name) {
      return this.formElement.elements.namedItem(name)?.value ?? null;
    }
  }
  const document = {
    title: "",
    querySelector(selector) {
      const activeView = selector.match(/^\[data-auth-view="([^"]+)"\]$/)?.[1];
      if (activeView) return activeView === formName ? { hidden: true } : null;
      const errorName = selector.match(/^\[data-error-for="([^"]+)"\]$/)?.[1];
      if (errorName) {
        if (!fieldErrors.has(errorName)) fieldErrors.set(errorName, { textContent: "" });
        return fieldErrors.get(errorName);
      }
      return null;
    },
    querySelectorAll(selector) {
      return selector === "[data-auth-form]" ? [form] : [];
    },
    getElementById() {
      return null;
    },
  };
  const window = {
    location: {
      search: `?view=${formName}`,
      assign(pathname) {
        locationAssignments.push(pathname);
      },
    },
    JalSaathiProfile: profileApi,
  };
  const context = {
    document,
    window,
    URLSearchParams,
    FormData: MockFormData,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: formName === "register" ? 201 : 200,
        async json() {
          return responseProfile;
        },
      };
    },
  };

  vm.runInNewContext(authSource, context);

  return {
    button,
    fetchCalls,
    inputs,
    locationAssignments,
    profileCalls,
    submit: () => submitHandler({ preventDefault() {} }),
  };
}

test("registration applies the selected language to the new account before redirecting", async () => {
  const profile = { id: 21, name: "Asha Rao" };
  const harness = createAuthHarness("register", {
    name: "Asha Rao",
    email: "asha@example.com",
    password: "StrongPassword123!",
    confirmPassword: "StrongPassword123!",
    countryCode: "+91",
    phone: "9876543210",
    state: "Telangana",
    district: "Warangal",
    village: "Test Village",
    language: "te",
    terms: true,
  }, profile);

  await harness.submit();

  assert.equal(harness.fetchCalls[0].url, "/api/auth/register");
  assert.deepEqual(JSON.parse(harness.fetchCalls[0].options.body), {
    name: "Asha Rao",
    email: "asha@example.com",
    password: "StrongPassword123!",
    phone: "+91 9876543210",
    state: "Telangana",
    district: "Warangal",
    village: "Test Village",
  });
  assert.deepEqual(harness.profileCalls, [
    ["setCurrentProfile", profile],
    ["setLanguage", "te"],
  ]);
  assert.deepEqual(harness.locationAssignments, ["/dashboard"]);
});

test("login continues to use its existing endpoint without changing account language", async () => {
  const harness = createAuthHarness("login", {
    contact: "asha@example.com",
    password: "StrongPassword123!",
  }, { id: 21, name: "Asha Rao" });

  await harness.submit();

  assert.equal(harness.fetchCalls[0].url, "/api/auth/login");
  assert.deepEqual(JSON.parse(harness.fetchCalls[0].options.body), {
    email: "asha@example.com",
    password: "StrongPassword123!",
  });
  assert.deepEqual(harness.profileCalls, []);
  assert.deepEqual(harness.locationAssignments, ["/dashboard"]);
});
