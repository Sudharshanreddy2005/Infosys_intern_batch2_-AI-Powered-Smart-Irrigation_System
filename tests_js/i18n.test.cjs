const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const profileStoreSource = fs.readFileSync(
  path.join(__dirname, "..", "static", "profile-store.js"),
  "utf8",
);
const i18nSource = fs.readFileSync(
  path.join(__dirname, "..", "static", "i18n.js"),
  "utf8",
);

function createProfileStore(storage = new Map(), fetchImpl = async () => ({ status: 401 })) {
  const listeners = new Map();
  const events = [];
  const window = {
    addEventListener(name, callback) {
      listeners.set(name, [...(listeners.get(name) || []), callback]);
    },
    dispatchEvent(event) {
      events.push(event);
      (listeners.get(event.type) || []).forEach((callback) => callback(event));
      return true;
    },
  };
  class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const context = {
    window,
    CustomEvent,
    document: {
      cookie: "",
      documentElement: { lang: "en-IN" },
      querySelectorAll: () => [],
      addEventListener() {},
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: fetchImpl,
    Headers,
    CustomEvent,
    console,
  };
  vm.runInNewContext(profileStoreSource, context);
  return { api: window.JalSaathiProfile, storage, events };
}

class MockText {
  constructor(value, parentElement) {
    this.nodeValue = value;
    this.parentElement = parentElement;
  }
}

class MockElement {
  constructor(attributes = {}, children = []) {
    this.attributes = new Map(Object.entries(attributes));
    this.childNodes = children;
    this.parentElement = null;
    this.hidden = false;
    this.value = "";
    children.forEach((child) => { child.parentElement = this; });
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  matches(selector) {
    return selector.split(",").some((part) => {
      const attribute = part.trim().match(/^\[([^\]]+)\]$/)?.[1];
      return attribute ? this.hasAttribute(attribute) : part.trim() === "*";
    });
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node instanceof MockElement && node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    return descendants(this).filter((node) =>
      node instanceof MockElement && node.matches(selector));
  }

  replaceChildren(...children) {
    this.childNodes = children;
    children.forEach((child) => { child.parentElement = this; });
  }

  addEventListener() {}

  set textContent(value) {
    this.text = String(value);
  }

  get textContent() {
    return this.text || this.childNodes.map((child) => child.nodeValue || "").join("");
  }
}

class MockSelect extends MockElement {}
class MockDocument {}

function descendants(root) {
  const values = [];
  const visit = (node) => {
    if (node instanceof MockElement) values.push(node);
    (node.childNodes || []).forEach(visit);
  };
  visit(root);
  return values;
}

function createI18nHarness(apiRequest, storage = new Map()) {
  let language = "en";
  const listeners = new Map();
  const languageSelect = new MockSelect({ "data-language-select": "" });
  const status = new MockElement({ "data-translation-status": "", "data-i18n-ignore": "" });
  status.hidden = true;
  const firstText = new MockText("Green water advice");
  const duplicateText = new MockText("Green water advice");
  const localText = new MockText("Dashboard");
  const userText = new MockText("private field name");
  const body = new MockElement({ "data-i18n-static": "" }, [
    new MockElement({}, [firstText, duplicateText, localText]),
    new MockElement({ "data-user-content": "" }, [userText]),
    languageSelect,
    status,
  ]);
  const documentElement = new MockElement({}, [body]);
  const document = Object.assign(new MockDocument(), {
    documentElement,
    addEventListener(name, callback) {
      if (name === "DOMContentLoaded") this.ready = callback;
    },
    createElement() {
      return new MockElement();
    },
    createTreeWalker(root) {
      const nodes = [];
      const visit = (node) => {
        (node.childNodes || []).forEach((child) => {
          if (child instanceof MockText) nodes.push(child);
          else visit(child);
        });
      };
      visit(root instanceof MockElement ? root : documentElement);
      let index = 0;
      return {
        currentNode: null,
        nextNode() {
          this.currentNode = nodes[index++] || null;
          return this.currentNode;
        },
      };
    },
    querySelectorAll(selector) {
      const elements = descendants(documentElement);
      if (selector === "*") return elements;
      const attribute = selector.match(/^\[([^\]]+)\]$/)?.[1];
      return attribute ? elements.filter((element) => element.hasAttribute(attribute)) : [];
    },
  });
  class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  class MutationObserver {
    observe() {}
  }
  const profileApi = {
    getLanguages: () => [
      { code: "en", locale: "en-IN", label: "English" },
      { code: "te", locale: "te-IN", label: "తెలుగు" },
      { code: "hi", locale: "hi-IN", label: "हिन्दी" },
      { code: "kn", locale: "kn-IN", label: "ಕನ್ನಡ" },
      { code: "as", locale: "as-IN", label: "অসমীয়া" },
    ],
    getLanguage: () => language,
    setLanguage(code) {
      language = code;
      window.dispatchEvent(new CustomEvent("jalsaathi:language-changed", { detail: { code } }));
    },
    apiRequest,
  };
  const window = {
    JalSaathiProfile: profileApi,
    addEventListener(name, callback) {
      listeners.set(name, [...(listeners.get(name) || []), callback]);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach((callback) => callback(event));
      return true;
    },
    setTimeout,
    clearTimeout,
  };
  const context = {
    window,
    document,
    location: { search: "" },
    CustomEvent,
    MutationObserver,
    Text: MockText,
    Element: MockElement,
    Document: MockDocument,
    HTMLSelectElement: MockSelect,
    NodeFilter: { SHOW_TEXT: 4 },
    URLSearchParams,
    Intl,
    console,
    Date,
    sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  };
  vm.runInNewContext(i18nSource, context);
  document.ready();
  return {
    api: window.JalSaathiI18n,
    languageSelect,
    nodes: [firstText, duplicateText, localText, userText],
    status,
    body,
    documentElement,
    storage,
  };
}

test("language catalog uses native labels and preferences are account-scoped", async () => {
  const { api, storage } = createProfileStore();
  const languageCodes = Array.from(api.getLanguages(), (language) => language.code);

  assert.deepEqual(languageCodes, [
    "en", "bn", "gu", "hi", "kn", "ml", "mr", "od", "pa", "ta", "te",
    "as", "brx", "doi", "kok", "ks", "mai", "mni", "ne", "sa", "sat", "sd", "ur",
  ]);
  assert.equal(api.getLanguages().find((language) => language.code === "te").label, "తెలుగు");
  api.setLanguage("te");
  api.setCurrentProfile({ id: 41, name: "Farmer One" });
  assert.equal(api.getLanguage(), "te");
  assert.equal(storage.get("jalsaathi.language.v2.41"), "te");
  const restored = createProfileStore(storage).api;
  restored.setCurrentProfile({ id: 41, name: "Farmer One" });
  assert.equal(restored.getLanguage(), "te");
  api.setLanguage("hi");
  api.setCurrentProfile({ id: 42, name: "Farmer Two" });
  assert.equal(api.getLanguage(), "en");
  assert.equal(storage.get("jalsaathi.language.v2.42"), undefined);
});

test("profile API errors preserve the server Retry-After value", async () => {
  const { api } = createProfileStore(new Map(), async (path) => {
    if (path === "/api/auth/me") return { status: 401, ok: false };
    return {
      status: 429,
      ok: false,
      headers: {
        get: (name) => name === "content-type" ? "application/json" :
          name === "retry-after" ? "47" : null,
      },
      json: async () => ({ detail: "Please wait." }),
    };
  });

  await assert.rejects(api.apiRequest("/api/translate"), (error) => {
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSeconds, 47);
    return true;
  });
});

test("Sarvam fallback batches approved static text and avoids duplicate requests", async () => {
  const requests = [];
  const harness = createI18nHarness(async (_path, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return { translations: body.texts.map(() => "अनुवादित पाठ") };
  });

  harness.api.setLanguage("as");
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].target_language_code, "as-IN");
  assert.deepEqual(requests[0].texts, ["Green water advice", "Dashboard"]);
  assert.deepEqual(
    harness.languageSelect.childNodes.map((option) => option.textContent),
    ["English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ", "অসমীয়া"],
  );
  assert.equal(harness.nodes[0].nodeValue, "अनुवादित पाठ");
  assert.equal(harness.nodes[1].nodeValue, "अनुवादित पाठ");
  assert.equal(harness.nodes[3].nodeValue, "private field name");
});

test("successful remote translations persist in the shared session cache", async () => {
  const storage = new Map();
  let requests = 0;
  const request = async (_path, options) => {
    requests += 1;
    const body = JSON.parse(options.body);
    return { translations: body.texts.map((text) => `T:${text}`) };
  };
  const first = createI18nHarness(request, storage);
  first.api.setLanguage("as");
  await new Promise((resolve) => setTimeout(resolve, 120));

  const afterFirstLoad = requests;
  const restored = createI18nHarness(request, storage);
  restored.api.setLanguage("as");
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.ok(afterFirstLoad > 0);
  assert.equal(requests, afterFirstLoad);
  assert.equal(restored.nodes[0].nodeValue, "T:Green water advice");
});

test("local dictionary remains available and HTTP 502 keeps fallback text without retry", async () => {
  let requests = 0;
  const harness = createI18nHarness(async () => {
    requests += 1;
    const error = new Error("provider details must not be shown");
    error.status = 502;
    throw error;
  });

  harness.api.setLanguage("hi");
  await new Promise((resolve) => setTimeout(resolve, 120));

  const laterText = new MockText("Another approved UI string");
  const laterRoot = new MockElement({ "data-i18n-static": "" }, [laterText]);
  harness.body.childNodes.push(laterRoot);
  laterRoot.parentElement = harness.body;
  harness.api.translate(laterRoot);
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(requests, 1);
  assert.equal(harness.nodes[2].nodeValue, "डैशबोर्ड");
  assert.equal(harness.nodes[0].nodeValue, "Green water advice");
  assert.equal(laterText.nodeValue, "Another approved UI string");
  assert.equal(harness.api.t("Current conditions and crop records", "en"), "Current conditions and crop records");
  assert.equal(
    harness.api.t("Experimental result: 73% probability", "hi"),
    "Experimental result: 73% probability",
  );
  assert.equal(harness.status.hidden, true);
  assert.equal(harness.status.textContent, "");
});

test("stable UI keys have verified Telugu, Hindi, and Kannada local translations", () => {
  const { api } = createI18nHarness(async () => ({ translations: [] }));
  const translations = {
    te: ["ప్రయోగాత్మక ఫలితం", "సంభావ్యత:", "సీజన్ సమాచారం అందుబాటులో లేదు"],
    hi: ["प्रायोगिक परिणाम", "संभाव्यता:", "मौसम की जानकारी उपलब्ध नहीं है"],
    kn: ["ಪ್ರಾಯೋಗಿಕ ಫಲಿತಾಂಶ", "ಸಂಭಾವ್ಯತೆ:", "ಋತುವಿನ ಮಾಹಿತಿ ಲಭ್ಯವಿಲ್ಲ"],
  };
  for (const [language, expected] of Object.entries(translations)) {
    assert.equal(api.t("model.experimentalResult", language), expected[0]);
    assert.equal(api.t("model.probabilityLabel", language), expected[1]);
    assert.equal(api.t("season.unavailable", language), expected[2]);
    assert.equal(api.t("recommendations.todayTitle", language).includes("Today's"), false);
  }
  assert.equal(api.t("model.experimentalResult", "en"), "Experimental result");
});

test("dynamic approved UI subtrees are batched while user content stays private", async () => {
  const requests = [];
  const harness = createI18nHarness(async (_path, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return { translations: body.texts.map((text) => `T:${text}`) };
  });
  const dynamicText = new MockText("Only fields saved to your account are shown here.");
  const privateText = new MockText("private farmer-entered content");
  const privateNode = new MockElement({ "data-user-content": "" }, [privateText]);
  const dynamicRoot = new MockElement({ "data-i18n-static": "" }, [dynamicText, privateNode]);

  harness.api.setLanguage("as");
  harness.body.childNodes.push(dynamicRoot);
  dynamicRoot.parentElement = harness.body;
  harness.api.translate(dynamicRoot);
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].target_language_code, "as-IN");
  assert.ok(requests[0].texts.includes("Only fields saved to your account are shown here."));
  assert.ok(!requests[0].texts.includes("private farmer-entered content"));
  assert.equal(dynamicText.nodeValue, "T:Only fields saved to your account are shown here.");
  assert.equal(privateText.nodeValue, "private farmer-entered content");
});

test("unmarked page text is not automatically approved for Sarvam", async () => {
  const requests = [];
  const harness = createI18nHarness(async (_path, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return { translations: body.texts.map((text) => `T:${text}`) };
  });
  harness.api.setLanguage("as");
  await new Promise((resolve) => setTimeout(resolve, 120));
  const requestCount = requests.length;
  const unapprovedText = new MockText("This page text is not approved.");
  const unapprovedRoot = new MockElement({}, [unapprovedText]);
  harness.documentElement.childNodes.push(unapprovedRoot);
  unapprovedRoot.parentElement = harness.documentElement;
  harness.api.translate(unapprovedRoot);
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(requests.length, requestCount);
  assert.equal(unapprovedText.nodeValue, "This page text is not approved.");
});

test("translation batches contain up to sixteen missing strings", async () => {
  const requests = [];
  const harness = createI18nHarness(async (_path, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return { translations: body.texts.map((text) => `T:${text}`) };
  });
  harness.api.setLanguage("te");
  await new Promise((resolve) => setTimeout(resolve, 120));
  requests.length = 0;
  const suffixes = [
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  ];
  const texts = suffixes.map((suffix) => new MockText(`Batch message ${suffix}`));
  const root = new MockElement({ "data-i18n-static": "" }, texts);

  harness.body.childNodes.push(root);
  root.parentElement = harness.body;
  harness.api.translate(root);
  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.deepEqual(requests.map((request) => request.texts.length), [16, 1]);
  assert.equal(texts[0].nodeValue, "T:Batch message one");
  assert.equal(texts[16].nodeValue, "T:Batch message seventeen");
});

test("overlapping UI mutations share one serial translation flush", async () => {
  const requests = [];
  let activeRequests = 0;
  let maximumConcurrentRequests = 0;
  const harness = createI18nHarness(async (_path, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    activeRequests += 1;
    maximumConcurrentRequests = Math.max(maximumConcurrentRequests, activeRequests);
    if (body.texts.some((text) => text.startsWith("Concurrent"))) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    activeRequests -= 1;
    return { translations: body.texts.map((text) => `T:${text}`) };
  });
  harness.api.setLanguage("as");
  await new Promise((resolve) => setTimeout(resolve, 120));
  requests.length = 0;
  const firstText = new MockText("Concurrent first message");
  const firstRoot = new MockElement({ "data-i18n-static": "" }, [firstText]);
  harness.body.childNodes.push(firstRoot);
  firstRoot.parentElement = harness.body;
  harness.api.translate(firstRoot);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const secondText = new MockText("Concurrent second message");
  const secondRoot = new MockElement({ "data-i18n-static": "" }, [secondText]);
  harness.body.childNodes.push(secondRoot);
  secondRoot.parentElement = harness.body;
  harness.api.translate(secondRoot);
  await new Promise((resolve) => setTimeout(resolve, 700));

  assert.deepEqual(requests.map((request) => request.texts), [
    ["Concurrent first message"],
    ["Concurrent second message"],
  ]);
  assert.equal(maximumConcurrentRequests, 1);
  assert.equal(firstText.nodeValue, "T:Concurrent first message");
  assert.equal(secondText.nodeValue, "T:Concurrent second message");
});

test("429 fallback honors Retry-After and does not send later batches", async () => {
  const requests = [];
  const storage = new Map();
  let shouldFail = false;
  const harness = createI18nHarness(async (_path, options) => {
    requests.push(JSON.parse(options.body));
    if (!shouldFail) {
      return { translations: requests.at(-1).texts.map((text) => `T:${text}`) };
    }
    const error = new Error("translation rate limited");
    error.status = 429;
    error.retryAfterSeconds = 45;
    throw error;
  }, storage);
  harness.api.setLanguage("te");
  await new Promise((resolve) => setTimeout(resolve, 120));
  requests.length = 0;
  shouldFail = true;
  const suffixes = [
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  ];
  const texts = suffixes.map((suffix) => new MockText(`Rate limited ${suffix}`));
  const root = new MockElement({ "data-i18n-static": "" }, texts);
  harness.body.childNodes.push(root);
  root.parentElement = harness.body;
  harness.api.translate(root);
  await new Promise((resolve) => setTimeout(resolve, 150));

  assert.equal(requests.length, 1);
  assert.equal(texts[0].nodeValue, "Rate limited one");
  assert.equal(texts[16].nodeValue, "Rate limited seventeen");

  const laterText = new MockText("No immediate retry");
  const laterRoot = new MockElement({ "data-i18n-static": "" }, [laterText]);
  harness.body.childNodes.push(laterRoot);
  laterRoot.parentElement = harness.body;
  harness.api.translate(laterRoot);
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(requests.length, 1);
  assert.equal(laterText.nodeValue, "No immediate retry");

  const restored = createI18nHarness(async (_path, options) => {
    requests.push(JSON.parse(options.body));
    return { translations: JSON.parse(options.body).texts.map((text) => `T:${text}`) };
  }, storage);
  restored.api.setLanguage("te");
  await new Promise((resolve) => setTimeout(resolve, 120));
  const afterReload = new MockText("Still in cooldown");
  const afterReloadRoot = new MockElement({ "data-i18n-static": "" }, [afterReload]);
  restored.body.childNodes.push(afterReloadRoot);
  afterReloadRoot.parentElement = restored.body;
  restored.api.translate(afterReloadRoot);
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(requests.length, 1);
  assert.equal(afterReload.nodeValue, "Still in cooldown");
  assert.equal(harness.status.hidden, true);
  assert.equal(harness.status.textContent, "");
});

test("translation audit reports missing keys and static text still untranslated", () => {
  const harness = createI18nHarness(async () => {
    const error = new Error("offline");
    error.status = 503;
    throw error;
  });

  harness.api.setLanguage("hi");
  const report = harness.api.audit();

  assert.ok(report.missingKeys.includes("unkeyed: Green water advice"));
  assert.ok(report.untranslatedStaticStrings.includes("Green water advice"));
  assert.ok(!report.untranslatedStaticStrings.includes("private field name"));
});
