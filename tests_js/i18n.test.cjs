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
const localeSources = ["en", "te", "hi", "kn", "ta", "ml"].map((code) =>
  fs.readFileSync(path.join(__dirname, "..", "static", "i18n", `${code}.js`), "utf8"));

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

function createI18nHarness(apiRequest, storage = new Map(), { remote = false } = {}) {
  let language = "en";
  let mutationHandler;
  const listeners = new Map();
  const languageSelect = new MockSelect({ "data-language-select": "" });
  const status = new MockElement({ "data-translation-status": "", "data-i18n-ignore": "" });
  status.hidden = true;
  const firstText = new MockText("Green water advice");
  const duplicateText = new MockText("Green water advice");
  const localText = new MockText("Dashboard");
  const userText = new MockText("private field name");
  const remoteTextRoot = new MockElement(
    remote ? { "data-i18n-remote": "" } : {},
    [firstText, duplicateText],
  );
  const body = new MockElement({ "data-i18n-static": "" }, [
    remoteTextRoot,
    new MockElement({}, [localText]),
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
    constructor(callback) {
      mutationHandler = callback;
    }

    observe() {}
  }
  const profileApi = {
    getLanguages: () => [
      { code: "en", locale: "en-IN", label: "English" },
      { code: "te", locale: "te-IN", label: "తెలుగు" },
      { code: "hi", locale: "hi-IN", label: "हिन्दी" },
      { code: "kn", locale: "kn-IN", label: "ಕನ್ನಡ" },
      { code: "ta", locale: "ta-IN", label: "தமிழ்" },
      { code: "ml", locale: "ml-IN", label: "മലയാളം" },
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
  localeSources.forEach((source) => vm.runInNewContext(source, context));
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
    mutateText(node, value) {
      node.nodeValue = value;
      mutationHandler([{ type: "characterData", target: node }]);
    },
  };
}

test("language catalog uses native labels and preferences are account-scoped", async () => {
  const { api, storage } = createProfileStore();
  const languageCodes = Array.from(api.getLanguages(), (language) => language.code);

  assert.deepEqual(languageCodes, [
    "en", "te", "hi", "kn", "ta", "ml",
  ]);
  assert.equal(api.getLanguages().find((language) => language.code === "te").label, "తెలుగు");
  assert.equal(api.getLanguages().find((language) => language.code === "ta").label, "தமிழ்");
  assert.equal(api.getLanguages().find((language) => language.code === "ml").label, "മലയാളം");
  assert.throws(() => api.setLanguage("bn"), /Choose a supported language/);
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

test("all six languages update dashboard text without a page reload", () => {
  const { api, nodes, documentElement } = createI18nHarness(async () => ({ translations: [] }));
  const dashboardLabels = {
    en: ["Dashboard", "en-IN"],
    te: ["డాష్‌బోర్డ్", "te-IN"],
    hi: ["डैशबोर्ड", "hi-IN"],
    kn: ["ಡ್ಯಾಶ್‌ಬೋರ್ಡ್", "kn-IN"],
    ta: ["டாஷ்போர்டு", "ta-IN"],
    ml: ["ഡാഷ്ബോർഡ്", "ml-IN"],
  };

  for (const [code, [label, locale]] of Object.entries(dashboardLabels)) {
    api.setLanguage(code);
    assert.equal(nodes[2].nodeValue, label);
    assert.equal(documentElement.lang, locale);
  }
});

test("fixed interface gaps stay local-only and are reported by the audit", async () => {
  let requests = 0;
  const harness = createI18nHarness(async () => {
    requests += 1;
    return { translations: [] };
  });

  harness.api.setLanguage("te");
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(requests, 0);
  assert.equal(harness.nodes[0].nodeValue, "Green water advice");
  assert.ok(harness.api.audit().missingKeys.includes("unkeyed: Green water advice"));
});

test("weather labels have local translations in all six languages", () => {
  const { api } = createI18nHarness(async () => ({ translations: [] }));
  assert.deepEqual(Object.keys(api.dictionaries).sort(), ["en", "hi", "kn", "ml", "ta", "te"]);
  const expected = {
    en: ["Feels like", "Rain probability"],
    te: ["అనిపించే ఉష్ణోగ్రత", "వర్షం పడే అవకాశం"],
    hi: ["महसूस होने वाला तापमान", "बारिश की संभावना"],
    kn: ["ಅನಿಸುವ ತಾಪಮಾನ", "ಮಳೆಯ ಸಾಧ್ಯತೆ"],
    ta: ["உணரப்படும் வெப்பநிலை", "மழை வாய்ப்பு"],
    ml: ["അനുഭവപ്പെടുന്ന താപനില", "മഴയ്ക്ക് സാധ്യത"],
  };

  Object.entries(expected).forEach(([code, labels]) => {
    assert.deepEqual([
      api.t("weather.feelsLike", code),
      api.t("weather.rainProbability", code),
    ], labels);
  });
});

test("translation lookup supports semantic keys and named interpolation parameters", () => {
  const { api } = createI18nHarness(async () => ({ translations: [] }));
  api.dictionaries.te["Hello {name}"] = "హలో {name}";
  api.setLanguage("te");

  assert.equal(api.t("fields.title"), "నా పొలాలు");
  assert.equal(api.t("Hello {name}", { name: "Ravi" }), "హలో Ravi");
});

test("shared header labels have local translations in all six languages", () => {
  const { api } = createI18nHarness(async () => ({ translations: [] }));
  const expected = {
    en: ["Notifications", "Account Settings", "Unread notifications", "No alerts are available.", "Field Predictions", "AI Model Predictions"],
    te: ["నోటిఫికేషన్‌లు", "ఖాతా సెట్టింగ్‌లు", "చదవని నోటిఫికేషన్‌లు", "హెచ్చరికలు అందుబాటులో లేవు.", "పొలం అంచనాలు", "AI మోడల్ అంచనాలు"],
    hi: ["सूचनाएँ", "खाता सेटिंग", "अपठित सूचनाएँ", "कोई अलर्ट उपलब्ध नहीं हैं।", "खेत पूर्वानुमान", "AI मॉडल पूर्वानुमान"],
    kn: ["ಅಧಿಸೂಚನೆಗಳು", "ಖಾತೆ ಸೆಟ್ಟಿಂಗ್‌ಗಳು", "ಓದದ ಅಧಿಸೂಚನೆಗಳು", "ಯಾವುದೇ ಎಚ್ಚರಿಕೆಗಳು ಲಭ್ಯವಿಲ್ಲ.", "ಹೊಲದ ಮುನ್ಸೂಚನೆಗಳು", "AI ಮಾದರಿ ಮುನ್ಸೂಚನೆಗಳು"],
    ta: ["அறிவிப்புகள்", "கணக்கு அமைப்புகள்", "படிக்காத அறிவிப்புகள்", "எச்சரிக்கைகள் எதுவும் இல்லை.", "வயல் கணிப்புகள்", "AI மாதிரி கணிப்புகள்"],
    ml: ["അറിയിപ്പുകൾ", "അക്കൗണ്ട് ക്രമീകരണങ്ങൾ", "വായിക്കാത്ത അറിയിപ്പുകൾ", "അലേർട്ടുകൾ ലഭ്യമല്ല.", "വയൽ പ്രവചനങ്ങൾ", "AI മോഡൽ പ്രവചനങ്ങൾ"],
  };

  Object.entries(expected).forEach(([code, labels]) => {
    assert.deepEqual([
      api.t("Notifications", code),
      api.t("Account Settings", code),
      api.t("Unread notifications", code),
      api.t("No alerts are available.", code),
      api.t("Field Predictions", code),
      api.t("AI Model Predictions", code),
    ], labels);
  });
});

test("both authenticated app shells mount the same header and keep sidebar navigation only", () => {
  const dashboardHtml = fs.readFileSync(path.join(__dirname, "..", "templates", "index.html"), "utf8");
  const sectionsHtml = fs.readFileSync(path.join(__dirname, "..", "static", "sections.html"), "utf8");
  const topbarHtml = fs.readFileSync(path.join(__dirname, "..", "static", "topbar.html"), "utf8");

  for (const html of [dashboardHtml, sectionsHtml]) {
    assert.match(html, /data-common-topbar/);
    assert.match(html, /\/static\/topbar\.js/);
    assert.match(html, /\/static\/topbar\.css/);
    const sidebar = html.match(/<aside\b[\s\S]*?<\/aside>/)?.[0];
    assert.ok(sidebar, "application shell should contain its sidebar");
    assert.doesNotMatch(sidebar, /data-language-control|data-sidebar-account|data-sidebar-profile/);
    assert.doesNotMatch(sidebar, /view=profile/);
    for (const view of ["predictions", "ai-model-predictions"]) {
      assert.match(sidebar, new RegExp(`view=${view}`));
    }
  }
  assert.match(topbarHtml, /data-language-toggle/);
  assert.match(topbarHtml, /data-notification-toggle/);
  assert.match(topbarHtml, /data-profile-toggle/);
  assert.match(topbarHtml, /Account Settings/);
  assert.match(topbarHtml, /data-topbar-logout/);
});

test("management farmer language options use the shared catalog and preserve existing values", () => {
  const { api, storage } = createProfileStore();
  const managementHtml = fs.readFileSync(
    path.join(__dirname, "..", "templates", "management.html"),
    "utf8",
  );
  const initializer = managementHtml.match(
    /const farmerLanguageSelect = document\.getElementById\('farmer-language'\);[\s\S]*?farmerLanguageSelect\.appendChild\(option\);\s*\}\);/,
  );
  assert.ok(initializer, "management form should populate its language field from the profile catalog");

  const options = [];
  const farmerLanguageSelect = { appendChild: (option) => options.push(option) };
  vm.runInNewContext(initializer[0], {
    window: { JalSaathiProfile: api },
    document: {
      getElementById: () => farmerLanguageSelect,
      createElement: () => ({ setAttribute() {} }),
    },
  });

  assert.deepEqual(options.map(({ value, textContent }) => [value, textContent]), [
    ["English", "English"],
    ["తెలుగు", "తెలుగు"],
    ["हिन्दी", "हिन्दी"],
    ["ಕನ್ನಡ", "ಕನ್ನಡ"],
    ["தமிழ்", "தமிழ்"],
    ["മലയാളം", "മലയാളം"],
  ]);
  assert.match(managementHtml, /form\.language\.value = farmer\.language \|\| 'English'/);
  assert.equal(storage.has("jalsaathi.language.v2.guest"), false);
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

test("Sarvam translates only explicitly marked dynamic text and avoids duplicate requests", async () => {
  const requests = [];
  const harness = createI18nHarness(async (_path, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return { translations: body.texts.map(() => "अनुवादित पाठ") };
  }, new Map(), { remote: true });

  harness.api.setLanguage("ml");
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(requests.length, 1);
  assert.equal(requests[0].target_language_code, "ml-IN");
  assert.deepEqual(requests[0].texts, ["Green water advice"]);
  assert.deepEqual(
    harness.languageSelect.childNodes.map((option) => option.textContent),
    ["English", "తెలుగు", "हिन्दी", "ಕನ್ನಡ", "தமிழ்", "മലയാളം"],
  );
  assert.equal(harness.nodes[0].nodeValue, "अनुवादित पाठ");
  assert.equal(harness.nodes[1].nodeValue, "अनुवादित पाठ");
  assert.equal(harness.nodes[2].nodeValue, "ഡാഷ്ബോർഡ്");
  assert.equal(harness.nodes[3].nodeValue, "private field name");
});

test("Sarvam fallback uses each supported regional language code", async () => {
  const locales = {
    te: "te-IN",
    hi: "hi-IN",
    kn: "kn-IN",
    ta: "ta-IN",
    ml: "ml-IN",
  };

  for (const [code, locale] of Object.entries(locales)) {
    const requests = [];
    const harness = createI18nHarness(async (_path, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return { translations: body.texts.map(() => "Translated") };
    }, new Map(), { remote: true });

    harness.api.setLanguage(code);
    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.equal(requests[0]?.target_language_code, locale);
  }
});

test("successful remote translations persist in the shared session cache", async () => {
  const storage = new Map();
  let requests = 0;
  const request = async (_path, options) => {
    requests += 1;
    const body = JSON.parse(options.body);
    return { translations: body.texts.map((text) => `T:${text}`) };
  };
  const first = createI18nHarness(request, storage, { remote: true });
  first.api.setLanguage("ml");
  await new Promise((resolve) => setTimeout(resolve, 120));

  const afterFirstLoad = requests;
  const restored = createI18nHarness(request, storage, { remote: true });
  restored.api.setLanguage("ml");
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
  }, new Map(), { remote: true });

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

test("dynamic UI subtrees translate locally while user content stays private", async () => {
  const requests = [];
  const harness = createI18nHarness(async (_path, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return { translations: body.texts.map((text) => `T:${text}`) };
  }, new Map(), { remote: true });
  const dynamicText = new MockText("Only fields saved to your account are shown here.");
  const privateText = new MockText("private farmer-entered content");
  const privateNode = new MockElement({ "data-user-content": "" }, [privateText]);
  const dynamicRoot = new MockElement({ "data-i18n-static": "" }, [dynamicText, privateNode]);

  harness.api.setLanguage("ml");
  harness.body.childNodes.push(dynamicRoot);
  dynamicRoot.parentElement = harness.body;
  harness.api.translate(dynamicRoot);
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].texts, ["Green water advice"]);
  assert.ok(!requests[0].texts.includes("Only fields saved to your account are shown here."));
  assert.ok(!requests[0].texts.includes("private farmer-entered content"));
  assert.equal(dynamicText.nodeValue, harness.api.t("dashboard.savedFieldsHint", "ml"));
  assert.equal(privateText.nodeValue, "private farmer-entered content");
});

test("farmer-entered crop names stay unchanged after a language switch", () => {
  const harness = createI18nHarness(async () => ({ translations: [] }));
  const privateNode = harness.nodes[3].parentElement;
  privateNode.setAttribute("data-i18n-crop", "");

  harness.api.setLanguage("te");
  harness.mutateText(harness.nodes[3], "Paddy");

  assert.equal(harness.nodes[3].nodeValue, "Paddy");
});

test("unmarked page text is not automatically approved for Sarvam", async () => {
  const requests = [];
  const harness = createI18nHarness(async (_path, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return { translations: body.texts.map((text) => `T:${text}`) };
  });
  harness.api.setLanguage("ml");
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
  const root = new MockElement({ "data-i18n-static": "", "data-i18n-remote": "" }, texts);

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
  harness.api.setLanguage("ml");
  await new Promise((resolve) => setTimeout(resolve, 120));
  requests.length = 0;
  const firstText = new MockText("Concurrent first message");
  const firstRoot = new MockElement({ "data-i18n-static": "", "data-i18n-remote": "" }, [firstText]);
  harness.body.childNodes.push(firstRoot);
  firstRoot.parentElement = harness.body;
  harness.api.translate(firstRoot);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const secondText = new MockText("Concurrent second message");
  const secondRoot = new MockElement({ "data-i18n-static": "", "data-i18n-remote": "" }, [secondText]);
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
  const root = new MockElement({ "data-i18n-static": "", "data-i18n-remote": "" }, texts);
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
  }, storage, { remote: true });
  restored.api.setLanguage("te");
  await new Promise((resolve) => setTimeout(resolve, 120));
  const afterReload = new MockText("Still in cooldown");
  const afterReloadRoot = new MockElement({ "data-i18n-static": "", "data-i18n-remote": "" }, [afterReload]);
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
  assert.ok(!report.untranslatedStaticStrings.includes(""));
  assert.ok(!report.untranslatedStaticStrings.includes("private field name"));
});
