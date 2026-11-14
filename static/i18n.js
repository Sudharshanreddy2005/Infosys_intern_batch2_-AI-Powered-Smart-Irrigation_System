(() => {
  "use strict";

  const profileApi = window.JalSaathiProfile;
  const numberFormatting = window.JalSaathiNumberFormat;
  if (!numberFormatting) {
    throw new Error("The shared JalSaathi number formatter must load before i18n.js.");
  }
  const languageCatalog = profileApi?.getLanguages?.() || [{ code: "en", locale: "en-IN", label: "English" }];
  const languages = languageCatalog.map((language) => language.code);
  const localeFor = Object.fromEntries(languageCatalog.map(({ code, locale }) => [code, locale]));
  const nativeNames = Object.fromEntries(languageCatalog.map(({ code, label }) => [code, label]));
  const localLanguages = ["en", "te", "hi", "kn", "ta", "ml"];
  const MAX_TRANSLATIONS_PER_BATCH = 16;
  const MAX_BATCH_CHARACTERS = 1800;
  const DEFAULT_FAILURE_COOLDOWN_MS = 30_000;
  const RATE_LIMIT_FALLBACK_COOLDOWN_MS = 60_000;
  const REMOTE_CACHE_KEY = "jalsaathi.i18n.remote-cache.v1";
  const REMOTE_CACHE_MAX_ENTRIES = 512;
  const REMOTE_COOLDOWN_KEY = "jalsaathi.i18n.remote-cooldown.v1";

  const catalog = window.JalSaathiTranslationCatalog;
  const missingCatalogLanguages = localLanguages.filter((code) =>
    !catalog || !catalog[code] || typeof catalog[code] !== "object",
  );
  if (missingCatalogLanguages.length) {
    throw new Error(`JalSaathi locale resources are missing: ${missingCatalogLanguages.join(", ")}`);
  }
  const translationKeys = Object.freeze({ ...catalog.en });
  const keyedDictionaries = Object.fromEntries(localLanguages.map((code) => {
    const dictionary = catalog[code];
    const missingKeys = Object.keys(translationKeys).filter((key) =>
      typeof dictionary[key] !== "string" || !dictionary[key].trim(),
    );
    if (missingKeys.length) {
      throw new Error(`JalSaathi ${code} locale is missing ${missingKeys.length} translations.`);
    }
    return [code, dictionary];
  }));
  const keysBySource = new Map(
    Object.entries(translationKeys).map(([key, source]) => [source, key]),
  );
  const dictionaries = Object.fromEntries(localLanguages.map((code) => [
    code,
    Object.fromEntries(Object.entries(translationKeys).map(([key, source]) => [
      source, keyedDictionaries[code][key],
    ])),
  ]));
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dynamicTemplates = Object.entries(translationKeys)
    .filter(([, source]) =>
      /\{[A-Za-z0-9_]+\}/.test(source) &&
      source.replace(/\{[A-Za-z0-9_]+\}/g, "").trim().length > 0,
    )
    .map(([key, source]) => {
      const placeholders = [...source.matchAll(/\{([A-Za-z0-9_]+)\}/g)];
      let offset = 0;
      let pattern = "^";
      placeholders.forEach((match) => {
        pattern += escapeRegExp(source.slice(offset, match.index)) + "([\\s\\S]*?)";
        offset = match.index + match[0].length;
      });
      pattern += `${escapeRegExp(source.slice(offset))}$`;
      return {
        key,
        pattern: new RegExp(pattern),
        placeholders,
      };
    })
    .sort((left, right) => right.pattern.source.length - left.pattern.source.length);
  const hasLocalTranslation = (source, code) =>
    Object.hasOwn(dictionaries[code] || {}, source) ||
    dynamicTemplates.some((template) => template.pattern.test(source));
  const getLanguage = () => profileApi?.getLanguage?.() || "en";
  const sourceValues = new WeakMap();
  const translatedValues = new WeakMap();
  const ignoredMutations = new WeakSet();
  const missing = new Set();
  const remoteCache = new Map();
  const queuedTranslations = new Map();
  const translationCallbacks = new Map();
  const translationsInFlight = new Set();
  const remotelyTranslatable = new Set();
  const remoteFailureUntil = new Map();
  const CRITICAL_TEXT = /\b(irrigation needed|irrigation not needed|water requirement|prediction|not a validated|not a real-world|coordinates|sensor reading)\b/i;
  let translationTimer = 0;
  let isFlushingTranslations = false;
  let isWriting = false;
  let observerReady = false;

  const restoreRemoteCache = () => {
    try {
      const serialized = sessionStorage.getItem(REMOTE_CACHE_KEY);
      if (!serialized) return;
      const cached = JSON.parse(serialized);
      if (!cached || typeof cached !== "object" || Array.isArray(cached)) return;
      Object.entries(cached).slice(-REMOTE_CACHE_MAX_ENTRIES).forEach(([key, value]) => {
        if (typeof value === "string" && value.trim()) remoteCache.set(key, value);
      });
    } catch (error) {
      console.warn("JalSaathi translation cache could not be restored:", error);
    }
  };

  const restoreRemoteCooldowns = () => {
    try {
      const serialized = sessionStorage.getItem(REMOTE_COOLDOWN_KEY);
      if (!serialized) return;
      const cooldowns = JSON.parse(serialized);
      if (!cooldowns || typeof cooldowns !== "object" || Array.isArray(cooldowns)) return;
      Object.entries(cooldowns).forEach(([code, until]) => {
        if (languages.includes(code) && Number.isFinite(until) && until > Date.now()) {
          remoteFailureUntil.set(code, until);
        }
      });
    } catch (error) {
      console.warn("JalSaathi translation cooldown could not be restored:", error);
    }
  };

  const persistRemoteCooldowns = () => {
    try {
      sessionStorage.setItem(REMOTE_COOLDOWN_KEY, JSON.stringify(Object.fromEntries(remoteFailureUntil)));
    } catch (error) {
      console.warn("JalSaathi translation cooldown could not be saved:", error);
    }
  };

  const rememberRemoteTranslation = (key, translation) => {
    remoteCache.delete(key);
    remoteCache.set(key, translation);
    while (remoteCache.size > REMOTE_CACHE_MAX_ENTRIES) {
      remoteCache.delete(remoteCache.keys().next().value);
    }
    try {
      sessionStorage.setItem(REMOTE_CACHE_KEY, JSON.stringify(Object.fromEntries(remoteCache)));
    } catch (error) {
      console.warn("JalSaathi translation cache could not be saved:", error);
    }
  };

  restoreRemoteCache();
  restoreRemoteCooldowns();

  const lookup = (source, code = getLanguage()) => {
    if (code === "en") return source;
    if (!/[A-Za-z]/.test(source) || /^[A-Za-z0-9]{1,3}$/.test(source)) return source;
    const dictionary = dictionaries[code];
    if (dictionary && Object.hasOwn(dictionary, source)) return dictionary[source];
    for (const template of dynamicTemplates) {
      const match = template.pattern.exec(source);
      if (!match) continue;
      const translated = keyedDictionaries[code]?.[template.key];
      if (typeof translated !== "string") continue;
      let placeholderIndex = 0;
      return translated.replace(/\{[A-Za-z0-9_]+\}/g, () => match[++placeholderIndex] || "");
    }
    missing.add(source);
    return keyedDictionaries[code]?.["common.translationMissing"] || source;
  };

  const applyRemoteTranslation = (source, code, translated) => {
    const key = `${code}\u0000${source}`;
    const callbacks = translationCallbacks.get(key) || [];
    translationCallbacks.delete(key);
    translationsInFlight.delete(key);
    callbacks.forEach((callback) => callback(translated));
  };

  const hideTranslationStatus = () => {
    document.querySelectorAll("[data-translation-status]").forEach((node) => {
      node.textContent = "";
      node.hidden = true;
    });
  };

  const flushTranslations = async () => {
    if (isFlushingTranslations) return;
    isFlushingTranslations = true;
    translationTimer = 0;
    try {
      while (queuedTranslations.size) {
        const code = getLanguage();
        const unavailableFor = (remoteFailureUntil.get(code) || 0) - Date.now();
        if (unavailableFor > 0) {
          queuedTranslations.forEach((item, key) => {
            queuedTranslations.delete(key);
            applyRemoteTranslation(item.source, item.code, lookup(item.source, item.code));
          });
          break;
        }

        const batch = [];
        let characters = 0;
        for (const [key, item] of queuedTranslations) {
          if (item.code !== code) {
            queuedTranslations.delete(key);
            applyRemoteTranslation(item.source, item.code, lookup(item.source, item.code));
            continue;
          }
          const cost = item.source.length + 40;
          if (batch.length && (
            batch.length >= MAX_TRANSLATIONS_PER_BATCH ||
            characters + cost > MAX_BATCH_CHARACTERS
          )) continue;
          if (cost > MAX_BATCH_CHARACTERS) {
            queuedTranslations.delete(key);
            applyRemoteTranslation(item.source, item.code, lookup(item.source, item.code));
            continue;
          }
          batch.push([key, item]);
          characters += cost;
        }
        batch.forEach(([key]) => queuedTranslations.delete(key));
        if (!batch.length) break;
        try {
          const result = await profileApi.apiRequest("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              texts: batch.map(([, item]) => item.source),
              source_language_code: "en-IN",
              target_language_code: localeFor[code],
            }),
          });
          if (!Array.isArray(result?.translations) ||
              result.translations.length !== batch.length ||
              result.translations.some((value) => typeof value !== "string" || !value.trim())) {
            throw new Error("The translation service returned an invalid response.");
          }
          batch.forEach(([key, item], index) => {
            const translated = result.translations[index].trim();
            rememberRemoteTranslation(key, translated);
            applyRemoteTranslation(item.source, item.code, translated);
          });
          hideTranslationStatus();
        } catch (error) {
          const providerRetryAfter = Number(error.retryAfterSeconds);
          const retryAfterMs = error.status === 429
            ? Math.max(
              1_000,
              (Number.isFinite(providerRetryAfter) ? providerRetryAfter : 60) * 1_000,
            )
            : DEFAULT_FAILURE_COOLDOWN_MS;
          remoteFailureUntil.set(code, Date.now() + retryAfterMs);
          persistRemoteCooldowns();
          batch.forEach(([, item]) => applyRemoteTranslation(item.source, item.code, lookup(item.source, item.code)));
          queuedTranslations.forEach((item, key) => {
            queuedTranslations.delete(key);
            applyRemoteTranslation(item.source, item.code, lookup(item.source, item.code));
          });
          hideTranslationStatus();
          break;
        }
      }
    } finally {
      isFlushingTranslations = false;
      if (queuedTranslations.size && !translationTimer) {
        translationTimer = window.setTimeout(() => {
          translationTimer = 0;
          void flushTranslations();
        }, 80);
      }
    }
  };

  const scheduleTranslationFlush = () => {
    if (translationTimer || isFlushingTranslations) return;
    translationTimer = window.setTimeout(() => {
      translationTimer = 0;
      void flushTranslations();
    }, 80);
  };

  const queueTranslation = (source, code, callback) => {
    if (code === "en" || !remotelyTranslatable.has(source) || source.length > 240 ||
        /[\r\n\d]/.test(source) ||
        /[\/@]/.test(source) || (CRITICAL_TEXT.test(source) && !keysBySource.has(source)) ||
        (remoteFailureUntil.get(code) || 0) > Date.now()) return;
    const key = `${code}\u0000${source}`;
    if (remoteCache.has(key)) {
      callback(remoteCache.get(key));
      return;
    }
    const callbacks = translationCallbacks.get(key) || [];
    callbacks.push(callback);
    translationCallbacks.set(key, callbacks);
    if (translationsInFlight.has(key)) return;
    translationsInFlight.add(key);
    queuedTranslations.set(key, { source, code });
    scheduleTranslationFlush();
  };

  const setNodeText = (node, source) => {
    sourceValues.set(node, source);
    const leading = source.match(/^\s*/)?.[0] || "";
    const trailing = source.match(/\s*$/)?.[0] || "";
    const content = source.slice(leading.length, source.length - trailing.length);
    const code = getLanguage();
    const value = `${leading}${lookup(content, code)}${trailing}`;
    if (node.nodeValue !== value) {
      if (observerReady) ignoredMutations.add(node);
      node.nodeValue = value;
    }
    if (hasLocalTranslation(content, code)) return;
    queueTranslation(content, code, (translated) => {
      if (sourceValues.get(node) !== source || getLanguage() !== code) return;
      const updated = `${leading}${translated}${trailing}`;
      if (node.nodeValue !== updated) {
        ignoredMutations.add(node);
        node.nodeValue = updated;
      }
    });
  };

  const translatedAttributes = ["aria-label", "title", "placeholder", "alt"];
  const translateAttributes = (element) => {
    if (element.closest("[data-user-content], [data-i18n-ignore]") ||
        element.matches("[data-field-select], [data-edit-field], [data-delete-field]")) return;
    translatedAttributes.forEach((name) => {
      if (!element.hasAttribute(name)) return;
      const current = element.getAttribute(name);
      const originals = translatedValues.get(element) || {};
      if (!(name in originals)) originals[name] = current;
      const source = originals[name];
      const code = getLanguage();
      const value = lookup(source, code);
      if (current !== value) element.setAttribute(name, value);
      translatedValues.set(element, originals);
      if (element.closest("[data-i18n-remote]") &&
          !element.closest("[data-user-content], [data-i18n-ignore]")) {
        remotelyTranslatable.add(source);
      }
      if (!hasLocalTranslation(source, code)) {
        queueTranslation(source, code, (translated) => {
          if (translatedValues.get(element)?.[name] !== source || getLanguage() !== code) return;
          element.setAttribute(name, translated);
        });
      }
    });
  };

  const excluded = (node) => node.parentElement?.closest(
    "script, style, noscript, code, pre, input, textarea, [contenteditable='true'], [data-user-content], [data-user-name], [data-recommendation-name], [data-i18n-ignore], [data-i18n-number], [data-i18n-date]",
  );
  const isUserContent = (node) => node.parentElement?.closest(
    "[data-user-content], [data-user-name], [data-recommendation-name]",
  );

  const translateTree = (root) => {
    if (root instanceof Text) {
      const cropOnly = Boolean(root.parentElement?.closest("[data-i18n-crop]"));
      if ((!excluded(root) || (cropOnly && !isUserContent(root))) && root.nodeValue.trim()) {
        const key = root.parentElement?.closest("[data-i18n-key]")?.getAttribute("data-i18n-key");
        const keyedSource = key ? translationKeys[key] : undefined;
        const source = sourceValues.has(root) ? sourceValues.get(root) : keyedSource || root.nodeValue;
        if (root.parentElement?.closest("[data-i18n-remote]") && !cropOnly) {
          remotelyTranslatable.add(source.trim());
        }
        setNodeText(root, source);
      }
      return;
    }
    if (!(root instanceof Element || root instanceof Document)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const cropOnly = Boolean(node.parentElement?.closest("[data-i18n-crop]"));
      if ((excluded(node) && (!cropOnly || isUserContent(node))) || !node.nodeValue.trim()) return;
      const key = node.parentElement?.closest("[data-i18n-key]")?.getAttribute("data-i18n-key");
      const keyedSource = key ? translationKeys[key] : undefined;
      const source = sourceValues.has(node) ? sourceValues.get(node) : keyedSource || node.nodeValue;
      if (node.parentElement?.closest("[data-i18n-remote]") && !cropOnly) {
        remotelyTranslatable.add(source.trim());
      }
      setNodeText(node, source);
    });
    const elements = root instanceof Document ? [root.documentElement, ...root.documentElement.querySelectorAll("*")] : [root, ...root.querySelectorAll("*")];
    elements.forEach((element) => {
      translateAttributes(element);
    });
    document.documentElement.lang = localeFor[getLanguage()] || "en-IN";
    formatLocalizedElements(root);
  };

  const observer = new MutationObserver((records) => {
    if (isWriting) return;
    records.forEach((record) => {
      if (record.type === "characterData") {
        if (ignoredMutations.has(record.target)) {
          ignoredMutations.delete(record.target);
          return;
        }
        const cropOnly = Boolean(record.target.parentElement?.closest("[data-i18n-crop]"));
        if (excluded(record.target) && (!cropOnly || isUserContent(record.target))) return;
        const source = record.target.nodeValue;
        if (!cropOnly && record.target.parentElement?.closest("[data-i18n-remote]")) {
          remotelyTranslatable.add(source.trim());
        }
        sourceValues.set(record.target, source);
        setNodeText(record.target, source);
      } else {
        record.addedNodes.forEach((node) => translateTree(node));
      }
    });
  });

  const apply = () => {
    isWriting = true;
    translateTree(document);
    isWriting = false;
  };

  const setLanguage = (code) => {
    if (!languages.includes(code)) throw new Error(`Unsupported JalSaathi locale: ${code}`);
    if (profileApi?.setLanguage) profileApi.setLanguage(code);
    else window.dispatchEvent(new CustomEvent("jalsaathi:language-changed", { detail: { code } }));
  };

  const onLanguageChange = (event) => {
    const code = event.detail?.code || getLanguage();
    if (!languages.includes(code)) throw new Error(`Unsupported JalSaathi locale: ${code}`);
    hideTranslationStatus();
    document.querySelectorAll("[data-language-select]").forEach((select) => {
      if (select instanceof HTMLSelectElement) select.value = code;
    });
    apply();
  };

  const initializeLanguageSelects = () => {
    document.querySelectorAll("[data-language-select]").forEach((select) => {
      if (!(select instanceof HTMLSelectElement)) return;
      select.replaceChildren(...languages.map((code) => {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = nativeNames[code];
        option.setAttribute("data-i18n-ignore", "");
        return option;
      }));
      select.value = getLanguage();
      select.addEventListener("change", () => setLanguage(select.value));
    });
  };

  const normalizeDate = (value) => {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "string") {
      const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateOnly) {
        const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
        return date.getFullYear() === Number(dateOnly[1]) &&
          date.getMonth() === Number(dateOnly[2]) - 1 &&
          date.getDate() === Number(dateOnly[3]) ? date : null;
      }
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const formatDate = (value, options = {}) => {
    const date = normalizeDate(value);
    return date
      ? new Intl.DateTimeFormat(
        localeFor[getLanguage()],
        numberFormatting.dateOptions(options),
      ).format(date)
      : "—";
  };
  const normalizeNumber = (value) => {
    if (value === null || value === undefined || value === "" ||
        (typeof value === "string" && !value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const formatNumber = (value, options = {}) => {
    const number = normalizeNumber(value);
    return number === null
      ? "—"
      : new Intl.NumberFormat("en-IN", numberFormatting.numberOptions(options)).format(number);
  };
  const escapeAttribute = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
  const numberOptionsFromElement = (element) => {
    const options = {};
    for (const [key, attribute] of [
      ["minimumFractionDigits", "data-i18n-number-minimum-fraction-digits"],
      ["maximumFractionDigits", "data-i18n-number-maximum-fraction-digits"],
    ]) {
      const value = element.getAttribute(attribute);
      if (value !== null && Number.isInteger(Number(value))) options[key] = Number(value);
    }
    const useGrouping = element.getAttribute("data-i18n-number-use-grouping");
    if (useGrouping === "true" || useGrouping === "false") options.useGrouping = useGrouping === "true";
    return options;
  };
  const dateOptionsByStyle = {
    date: { dateStyle: "medium" },
    "date-time": { dateStyle: "medium", timeStyle: "short" },
    time: { timeStyle: "short" },
    "month-year": { month: "short", year: "numeric" },
  };
  const formatLocalizedElements = (root) => {
    const elements = root instanceof Element
      ? [root, ...root.querySelectorAll("[data-i18n-number], [data-i18n-date]")]
      : root instanceof Document
        ? [root.documentElement, ...root.documentElement.querySelectorAll("[data-i18n-number], [data-i18n-date]")]
        : [];
    elements.forEach((element) => {
      if (element.hasAttribute("data-i18n-number")) {
        const value = element.getAttribute("data-i18n-number");
        const suffix = element.getAttribute("data-i18n-number-suffix") || "";
        element.textContent = `${formatNumber(value, numberOptionsFromElement(element))}${suffix}`;
      } else if (element.hasAttribute("data-i18n-date")) {
        const value = element.getAttribute("data-i18n-date");
        const style = element.getAttribute("data-i18n-date-style") || "date";
        element.textContent = formatDate(value, dateOptionsByStyle[style] || {});
      }
    });
  };
  const numberOptionAttributes = (options) => [
    ["minimumFractionDigits", "data-i18n-number-minimum-fraction-digits"],
    ["maximumFractionDigits", "data-i18n-number-maximum-fraction-digits"],
  ].filter(([key]) => Number.isInteger(options[key]))
    .map(([key, attribute]) => ` ${attribute}="${options[key]}"`)
    .join("") + (typeof options.useGrouping === "boolean"
    ? ` data-i18n-number-use-grouping="${options.useGrouping}"` : "");
  const numberMarkup = (value, options = {}, suffix = "") => {
    const number = normalizeNumber(value);
    if (number === null) return "—";
    const attributes = `data-i18n-number="${escapeAttribute(number)}"${numberOptionAttributes(options)} data-i18n-number-suffix="${escapeAttribute(suffix)}"`;
    return `<span ${attributes}>${escapeAttribute(`${formatNumber(number, options)}${suffix}`)}</span>`;
  };
  const dateMarkup = (value, style = "date") => {
    const date = normalizeDate(value);
    if (!date) return "—";
    const safeStyle = Object.hasOwn(dateOptionsByStyle, style) ? style : "date";
    const normalized = value instanceof Date
      ? safeStyle === "date" || safeStyle === "month-year"
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
        : date.toISOString()
      : String(value);
    return `<span data-i18n-date="${escapeAttribute(normalized)}" data-i18n-date-style="${safeStyle}">${escapeAttribute(formatDate(date, dateOptionsByStyle[safeStyle]))}</span>`;
  };
  const setNumber = (element, value, options = {}, suffix = "") => {
    if (!(element instanceof Element)) throw new TypeError("A numeric display element is required.");
    const number = normalizeNumber(value);
    if (number === null) {
      element.removeAttribute("data-i18n-number-suffix");
      element.textContent = "—";
      element.removeAttribute("data-i18n-number");
      element.removeAttribute("data-i18n-number-minimum-fraction-digits");
      element.removeAttribute("data-i18n-number-maximum-fraction-digits");
      element.removeAttribute("data-i18n-number-use-grouping");
      element.removeAttribute("data-i18n-date");
      element.removeAttribute("data-i18n-date-style");
      return;
    }
    element.removeAttribute("data-i18n-date");
    element.removeAttribute("data-i18n-date-style");
    element.setAttribute("data-i18n-number", String(number));
    element.setAttribute("data-i18n-number-suffix", suffix);
    for (const [key, attribute] of [
      ["minimumFractionDigits", "data-i18n-number-minimum-fraction-digits"],
      ["maximumFractionDigits", "data-i18n-number-maximum-fraction-digits"],
    ]) {
      if (Number.isInteger(options[key])) element.setAttribute(attribute, String(options[key]));
      else element.removeAttribute(attribute);
    }
    if (typeof options.useGrouping === "boolean") {
      element.setAttribute("data-i18n-number-use-grouping", String(options.useGrouping));
    } else {
      element.removeAttribute("data-i18n-number-use-grouping");
    }
    formatLocalizedElements(element);
  };
  const translateKey = (keyOrText, codeOrParameters = getLanguage(), maybeParameters = {}) => {
    const code = typeof codeOrParameters === "string" ? codeOrParameters : getLanguage();
    const parameters = typeof codeOrParameters === "string" ? maybeParameters : codeOrParameters;
    const source = Object.hasOwn(translationKeys, keyOrText) ? translationKeys[keyOrText] : keyOrText;
    const translated = lookup(source, code);
    if (!parameters || typeof parameters !== "object") return translated;
    return translated.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name) =>
      Object.hasOwn(parameters, name) ? String(parameters[name]) : placeholder,
    );
  };
  const formatTemperature = (value) => {
    return numberFormatting.formatTemperature(value, translateKey("legacy.unavailable.2c9c1f79"));
  };
  const audit = () => {
    missing.clear();
    translateTree(document);
    const missingKeys = [...missing]
      .filter((source) => !/^[\s\d.,:;/%+−–—°!?()·→←✓×*#-]+$/.test(source))
      .map((source) => keysBySource.get(source) || `unkeyed: ${source}`);
    const untranslatedStaticStrings = [];
    if (getLanguage() !== "en") {
      const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (excluded(node)) continue;
        const source = sourceValues.get(node) || node.nodeValue;
        const trimmedSource = source.trim();
        if (!trimmedSource) continue;
        if (
          node.parentElement?.closest("[data-i18n-static]") &&
          node.nodeValue.trim() === trimmedSource &&
          !Object.hasOwn(dictionaries[getLanguage()] || {}, trimmedSource)
        ) {
          untranslatedStaticStrings.push(trimmedSource);
        }
      }
    }
    const report = { missingKeys, untranslatedStaticStrings };
    if (missingKeys.length || untranslatedStaticStrings.length) {
      console.warn(`JalSaathi i18n audit for ${getLanguage()}:`, report);
    } else {
      console.info(`JalSaathi i18n audit passed for ${getLanguage()}.`);
    }
    return report;
  };

  window.JalSaathiI18n = {
    languages: languageCatalog.map((language) => ({ ...language })),
    getLanguage,
    t: translateKey,
    translationKeys,
    setLanguage,
    formatDate,
    formatNumber,
    formatTemperature,
    numberMarkup,
    dateMarkup,
    setNumber,
    translate: (root = document) => translateTree(root),
    audit,
    dictionaries,
  };

  window.addEventListener("jalsaathi:language-changed", onLanguageChange);
  document.addEventListener("DOMContentLoaded", () => {
    hideTranslationStatus();
    initializeLanguageSelects();
    apply();
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    observerReady = true;
    if (new URLSearchParams(location.search).has("i18nCheck")) audit();
  }, { once: true });
})();
