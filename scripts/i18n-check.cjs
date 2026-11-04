const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const localeCodes = ["en", "te", "hi", "kn", "ta", "ml"];
const localeDirectory = path.join(root, "static", "i18n");
const localeFiles = fs.readdirSync(localeDirectory)
  .filter((name) => name.endsWith(".js"))
  .sort();
const expectedLocaleFiles = localeCodes.map((code) => `${code}.js`).sort();
const errors = [];
const catalogs = new Map();

if (JSON.stringify(localeFiles) !== JSON.stringify(expectedLocaleFiles)) {
  errors.push(`Expected locale files ${expectedLocaleFiles.join(", ")}; found ${localeFiles.join(", ")}.`);
}

for (const code of localeCodes) {
  const file = path.join(localeDirectory, `${code}.js`);
  if (!fs.existsSync(file)) {
    errors.push(`Missing locale resource: static/i18n/${code}.js`);
    continue;
  }
  const source = fs.readFileSync(file, "utf8");
  const match = source.match(
    new RegExp(`window\\.JalSaathiTranslationCatalog\\["${code}"\\]\\s*=\\s*(\\{[\\s\\S]*?\\n\\});`),
  );
  if (!match) {
    errors.push(`Could not parse static/i18n/${code}.js as a locale dictionary.`);
    continue;
  }
  const seenKeys = new Set();
  for (const keyMatch of match[1].matchAll(/^\s*"((?:\\.|[^"\\])*)"\s*:/gm)) {
    const key = JSON.parse(`"${keyMatch[1]}"`);
    if (seenKeys.has(key)) errors.push(`Duplicate key "${key}" in ${code}.`);
    seenKeys.add(key);
  }
  try {
    catalogs.set(code, JSON.parse(match[1]));
  } catch (error) {
    errors.push(`Invalid JSON dictionary in ${code}: ${error.message}`);
  }
}

const english = catalogs.get("en") || {};
const englishKeys = Object.keys(english);
for (const code of localeCodes) {
  const dictionary = catalogs.get(code);
  if (!dictionary) continue;
  for (const key of englishKeys) {
    if (typeof dictionary[key] !== "string" || !dictionary[key].trim()) {
      errors.push(`${code} is missing a non-empty translation for "${key}".`);
    }
  }
  for (const key of Object.keys(dictionary)) {
    if (!Object.hasOwn(english, key)) errors.push(`${code} has unknown key "${key}".`);
  }
}

const sourceFiles = [];
const collectSourceFiles = (directory) => {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(file);
    else if (/\.(html|js)$/.test(entry.name)) sourceFiles.push(file);
  }
};
collectSourceFiles(path.join(root, "templates"));
collectSourceFiles(path.join(root, "static"));

const requiredShells = [
  "templates/index.html",
  "templates/landing.html",
  "templates/management.html",
  "static/auth.html",
  "static/sections.html",
];
for (const relativePath of requiredShells) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) {
    errors.push(`Missing application shell: ${relativePath}`);
    continue;
  }
  const source = fs.readFileSync(file, "utf8");
  const serviceIndex = source.indexOf("/static/i18n.js");
  if (serviceIndex < 0) {
    errors.push(`${relativePath} does not load the shared i18n service.`);
    continue;
  }
  for (const code of localeCodes) {
    const resourceIndex = source.indexOf(`/static/i18n/${code}.js`);
    if (resourceIndex < 0 || resourceIndex > serviceIndex) {
      errors.push(`${relativePath} must load ${code}.js before i18n.js.`);
    }
  }
}

const referencedKeys = new Set();
const untranslatedHtml = new Map();
const htmlPhrases = new Set();
const englishPhrases = new Set(Object.values(english));
const addHtmlString = (value, relativePath) => {
  const phrase = value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!phrase || /^[\d\s.,:;/%+−–—°!?()·→←✓×*#-]+$/.test(phrase) ||
      !/[A-Za-z]/.test(phrase) || /^[A-Za-z0-9]{1,3}$/.test(phrase)) return;
  htmlPhrases.add(phrase);
  if (englishPhrases.has(phrase)) return;
  const files = untranslatedHtml.get(phrase) || new Set();
  files.add(relativePath);
  untranslatedHtml.set(phrase, files);
};
const collectHtmlStrings = (source, relativePath) => {
  const stack = [];
  const tokens = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .match(/<(?:![^>]*|\?[^>]*|\/?[A-Za-z][^>]*)>|[^<]+/g) || [];
  for (const token of tokens) {
    if (token.startsWith("<!") || token.startsWith("<?")) continue;
    if (token.startsWith("</")) {
      const tag = token.match(/^<\/([A-Za-z][\w:-]*)/)?.[1]?.toLowerCase();
      while (stack.length) {
        if (stack.pop().tag === tag) break;
      }
      continue;
    }
    if (token.startsWith("<")) {
      const tag = token.match(/^<([A-Za-z][\w:-]*)/)?.[1]?.toLowerCase();
      if (!tag) continue;
      const attrs = token.slice(tag.length + 1);
      const ignored = /\b(?:data-user-content|data-user-name|data-recommendation-name|data-i18n-ignore|data-translation-status)\b/i.test(attrs) ||
        ["script", "style", "noscript", "code", "pre", "input", "textarea"].includes(tag) ||
        stack.some((entry) => entry.ignored);
      if (!ignored) {
        for (const match of attrs.matchAll(/\b(?:aria-label|title|placeholder|alt)\s*=\s*(["'])(.*?)\1/gi)) {
          addHtmlString(match[2], relativePath);
        }
      }
      if (!/\/\s*>$/.test(token) && !["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(tag)) {
        stack.push({ tag, ignored });
      }
      continue;
    }
    if (!stack.some((entry) => entry.ignored)) addHtmlString(token, relativePath);
  }
};

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  if (file.endsWith(".html")) collectHtmlStrings(source, path.relative(root, file));
  for (const match of source.matchAll(/data-i18n-key=["']([^"']+)["']/g)) {
    referencedKeys.add(match[1]);
    if (!Object.hasOwn(english, match[1])) {
      errors.push(`${path.relative(root, file)} references unknown key "${match[1]}".`);
    }
  }
}

if (errors.length) {
  console.error(`i18n validation failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log("i18n catalog structure and page-key checks passed.");
  console.log(`Locales: ${localeCodes.join(", ")}`);
  console.log(`Dictionary keys per locale: ${englishKeys.length}`);
  console.log(`Semantic UI keys referenced by source: ${referencedKeys.size}`);
  console.log("Shell loading order: all six locale resources precede the shared service.");
  console.log(`Unique literal HTML phrases: ${htmlPhrases.size}`);
  console.log(`Literal HTML phrases missing from local English-indexed coverage: ${untranslatedHtml.size}`);
  if (untranslatedHtml.size) {
    console.log("Coverage gaps (localize with reviewed resources or document as intentionally untranslated):");
    for (const [phrase, files] of [...untranslatedHtml].slice(0, 40)) {
      console.log(`- ${phrase} [${[...files].join(", ")}]`);
    }
    if (untranslatedHtml.size > 40) console.log(`- ... ${untranslatedHtml.size - 40} additional phrase(s)`);
  }
  console.log("Note: this literal-text scan excludes client-generated text and does not assess translation quality.");
}
