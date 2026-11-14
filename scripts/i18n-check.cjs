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
  const sourceValue = Object.hasOwn(english, value.trim()) ? english[value.trim()] : value;
  const phrase = sourceValue
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
      const keyed = /\bdata-i18n-key\s*=/i.test(attrs) || stack.some((entry) => entry.keyed);
      if (!ignored) {
        for (const match of attrs.matchAll(/\b(?:aria-label|title|placeholder|alt)\s*=\s*(["'])(.*?)\1/gi)) {
          addHtmlString(match[2], relativePath);
        }
      }
      if (!/\/\s*>$/.test(token) && !["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(tag)) {
        stack.push({ tag, ignored, keyed });
      }
      continue;
    }
    if (!stack.some((entry) => entry.ignored || entry.keyed)) addHtmlString(token, relativePath);
  }
};

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  if (file !== path.join(root, "static", "i18n.js") && /\bdata-i18n-remote\b/.test(source)) {
    errors.push(`${path.relative(root, file)} must not use remote machine translation for user-interface text.`);
  }
  if (file.endsWith(".html")) collectHtmlStrings(source, path.relative(root, file));
  for (const match of source.matchAll(/data-i18n-key=["']([^"']+)["']/g)) {
    referencedKeys.add(match[1]);
    if (!Object.hasOwn(english, match[1])) {
      errors.push(`${path.relative(root, file)} references unknown key "${match[1]}".`);
    }
  }
}

const sectionsFile = path.join(root, "static", "sections.js");
if (fs.existsSync(sectionsFile)) {
  const sectionsSource = fs.readFileSync(sectionsFile, "utf8");
  for (const match of sectionsSource.matchAll(/\brender\s*:\s*`([\s\S]*?)`/g)) {
    const markup = match[1].replace(/\$\{[\s\S]*?\}/g, "");
    collectHtmlStrings(markup, "static/sections.js");
  }
}

const pwaLocaleDirectory = path.join(root, "farmer-pwa", "locales");
const pwaLocaleCodes = ["en", "hi", "te", "kn", "ta", "ml"];
const pwaDictionaries = new Map();
for (const code of pwaLocaleCodes) {
  const file = path.join(pwaLocaleDirectory, `${code}.json`);
  try {
    pwaDictionaries.set(code, JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    errors.push(`Could not load farmer-pwa/locales/${code}.json: ${error.message}`);
  }
}
const pwaEntriesFile = path.join(pwaLocaleDirectory, "pwa.json");
let pwaEntries = {};
try {
  pwaEntries = JSON.parse(fs.readFileSync(pwaEntriesFile, "utf8")).entries || {};
} catch (error) {
  errors.push(`Could not load farmer-pwa/locales/pwa.json: ${error.message}`);
}

const pwaEnglish = pwaDictionaries.get("en") || {};
const pwaEnglishKeys = Object.keys(pwaEnglish).filter((key) => key !== "_reviewNote");
for (const code of pwaLocaleCodes) {
  const dictionary = pwaDictionaries.get(code);
  if (!dictionary) continue;
  for (const key of pwaEnglishKeys) {
    if (typeof dictionary[key] !== "string" || !dictionary[key].trim()) {
      errors.push(`Farmer PWA ${code} locale is missing "${key}".`);
    }
  }
  for (const key of Object.keys(dictionary)) {
    if (key !== "_reviewNote" && !Object.hasOwn(pwaEnglish, key)) {
      errors.push(`Farmer PWA ${code} locale has unknown key "${key}".`);
    }
  }
}
for (const [source, translations] of Object.entries(pwaEntries)) {
  if (!Array.isArray(translations) || translations.length !== pwaLocaleCodes.length ||
      translations.some((value) => typeof value !== "string" || !value.trim())) {
    errors.push(`Farmer PWA supplemental translation "${source}" must have six non-empty translations in en, hi, te, kn, ta, ml order.`);
  }
}

const typescriptPath = path.join(root, "farmer-pwa", "node_modules", "typescript");
let typescript;
try {
  typescript = require(typescriptPath);
} catch {
  errors.push("The localization audit requires farmer-pwa TypeScript dev dependencies; run it after npm install in farmer-pwa.");
}
if (typescript) {
  const pwaSourceFiles = [];
  const collectPwaSources = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) collectPwaSources(file);
      else if (/\.[jt]sx?$/.test(entry.name)) pwaSourceFiles.push(file);
    }
  };
  collectPwaSources(path.join(root, "farmer-pwa", "app"));
  collectPwaSources(path.join(root, "farmer-pwa", "components"));
  const approvedBrandText = new Set(["JalSaathi", "JalSaathi ·"]);
  const hasPwaTranslation = (code, source) => {
    const languageIndex = pwaLocaleCodes.indexOf(code);
    return typeof pwaDictionaries.get(code)?.[source] === "string" ||
      (Array.isArray(pwaEntries[source]) &&
       typeof pwaEntries[source][languageIndex] === "string" &&
       Boolean(pwaEntries[source][languageIndex].trim()));
  };
  const visibleHelperNames = new Set([
    "errorMessage", "setError", "setMessage", "setModelState", "setStatus", "setText", "text",
  ]);
  const addExpressionText = (node, relativePath, asMarkup = false) => {
    if (!node) return;
    if (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node)) {
      if (asMarkup) collectHtmlStrings(node.text, relativePath);
      else addHtmlString(node.text, relativePath);
      return;
    }
    if (typescript.isTemplateExpression(node)) {
      const templateText = [
        node.head.text,
        ...node.templateSpans.map((span) => span.literal.text),
      ].join("{value}");
      if (!templateText.replace(/\{value\}/g, "").replace(/[\s\p{P}\p{S}]/gu, "")) return;
      if (asMarkup) collectHtmlStrings(templateText, relativePath);
      else addHtmlString(templateText, relativePath);
      return;
    }
    if (typescript.isConditionalExpression(node)) {
      addExpressionText(node.whenTrue, relativePath, asMarkup);
      addExpressionText(node.whenFalse, relativePath, asMarkup);
      return;
    }
    if (typescript.isBinaryExpression(node) &&
        node.operatorToken.kind === typescript.SyntaxKind.PlusToken) {
      addExpressionText(node.left, relativePath, asMarkup);
      addExpressionText(node.right, relativePath, asMarkup);
    }
  };
  for (const file of sourceFiles.filter((candidate) => candidate.endsWith(".js") &&
      candidate !== path.join(root, "static", "i18n.js"))) {
    const source = fs.readFileSync(file, "utf8");
    const sourceFile = typescript.createSourceFile(file, source, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.JS);
    const relativePath = path.relative(root, file);
    const visit = (node) => {
      if (typescript.isBinaryExpression(node) &&
          node.operatorToken.kind === typescript.SyntaxKind.EqualsToken &&
          typescript.isPropertyAccessExpression(node.left)) {
        const property = node.left.name.text;
        if (property === "textContent") addExpressionText(node.right, relativePath);
        if (property === "innerHTML") addExpressionText(node.right, relativePath, true);
      }
      if (typescript.isNewExpression(node) && node.expression.getText(sourceFile) === "Option" &&
          node.arguments?.[0]) {
        addExpressionText(node.arguments[0], relativePath);
      }
      if (typescript.isCallExpression(node)) {
        const callee = typescript.isIdentifier(node.expression)
          ? node.expression.text
          : typescript.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : "";
        if (callee === "setAttribute" && node.arguments.length >= 2 &&
            typescript.isStringLiteral(node.arguments[0]) &&
            ["aria-label", "alt", "placeholder", "title"].includes(node.arguments[0].text)) {
          addExpressionText(node.arguments[1], relativePath);
        } else if (visibleHelperNames.has(callee) && node.arguments.length) {
          addExpressionText(node.arguments[node.arguments.length - 1], relativePath);
        } else if (callee === "insertAdjacentHTML" && node.arguments.length >= 2) {
          addExpressionText(node.arguments[1], relativePath, true);
        }
      }
      typescript.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  for (const file of pwaSourceFiles) {
    const source = fs.readFileSync(file, "utf8");
    const sourceFile = typescript.createSourceFile(
      file,
      source,
      typescript.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? typescript.ScriptKind.TSX : typescript.ScriptKind.TS,
    );
    const relativePath = path.relative(root, file);
    const checkLiteral = (literal, node) => {
      for (const code of pwaLocaleCodes) {
        if (!hasPwaTranslation(code, literal)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          errors.push(`${relativePath}:${line} references "${literal}" without a ${code} translation.`);
        }
      }
    };
    const visit = (node) => {
      if (typescript.isCallExpression(node) && node.expression.getText(sourceFile) === "t") {
        const argument = node.arguments[0];
        if (argument && typescript.isStringLiteral(argument)) checkLiteral(argument.text, argument);
      }
      if (typescript.isJsxText(node)) {
        const text = node.text.replace(/\s+/g, " ").trim();
        if (/[A-Za-z]{2}/.test(text) && !approvedBrandText.has(text)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          errors.push(`${relativePath}:${line} contains hardcoded JSX text "${text}".`);
        }
      }
      if (typescript.isJsxAttribute(node) &&
          ["alt", "aria-label", "placeholder", "title"].includes(node.name.getText(sourceFile)) &&
          node.initializer && typescript.isStringLiteral(node.initializer)) {
        checkLiteral(node.initializer.text, node.initializer);
      }
      if (typescript.isJsxExpression(node) && node.expression &&
          typescript.isStringLiteral(node.expression) && node.expression.text.trim()) {
        checkLiteral(node.expression.text, node.expression);
      }
      typescript.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
}

if (untranslatedHtml.size) {
  errors.push(`${untranslatedHtml.size} visible HTML phrase(s) have no local English-indexed translation.`);
}

if (errors.length) {
  console.error(`i18n validation failed with ${errors.length} issue(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  if (untranslatedHtml.size) {
    console.error("Uncovered visible HTML phrases:");
    const uncoveredPhrases = [...untranslatedHtml];
    for (const [phrase, files] of uncoveredPhrases.slice(0, 100)) {
      console.error(`- ${phrase} [${[...files].join(", ")}]`);
    }
    if (uncoveredPhrases.length > 100) {
      console.error(`- ... ${uncoveredPhrases.length - 100} additional uncovered phrase(s)`);
    }
  }
  process.exitCode = 1;
} else {
  console.log("i18n catalog structure and page-key checks passed.");
  console.log(`Locales: ${localeCodes.join(", ")}`);
  console.log(`Dictionary keys per locale: ${englishKeys.length}`);
  console.log(`Semantic UI keys referenced by source: ${referencedKeys.size}`);
  console.log("Shell loading order: all six locale resources precede the shared service.");
  console.log(`Unique literal HTML phrases: ${htmlPhrases.size}`);
  console.log(`All ${htmlPhrases.size} literal HTML phrases have local English-indexed coverage.`);
  console.log("Note: the source audit covers HTML literals; JavaScript/TypeScript-generated UI is audited separately.");
}
