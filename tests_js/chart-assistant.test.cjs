const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");

test("dedicated Chart Assistant and Calendar routes are connected to both legacy sidebars", () => {
  const sections = read("static/sections.html");
  const dashboard = read("templates/index.html");
  const profileMenu = read("static/topbar.html");
  const sectionViews = read("static/sections.js");

  for (const source of [sections, dashboard]) {
    assert.match(source, /view=chart-assistant/);
    assert.match(source, /view=calendar/);
  }
  assert.match(profileMenu, /href="\/static\/sections\.html\?view=calendar"[^>]*data-i18n-key="nav\.calendar"/);
  assert.match(sectionViews, /"chart-assistant":\s*\{/);
  assert.match(sectionViews, /calendar:\s*\{/);
  assert.match(sectionViews, /JalSaathiCalendar\?\.initialize\(content\)/);
});

test("the dedicated JalSaathi AI page uses authenticated APIs and server-owned history", () => {
  const source = read("static/ai-chat-page.js");
  const sections = read("static/sections.js");

  assert.match(sections, /JalSaathiAiChat\?\.initialize\(content\)/);
  assert.doesNotMatch(sections, /JalSaathiChartAssistant\?\.(?:openPage|leavePage)\(/);
  assert.match(source, /api\("\/api\/fields"\)/);
  assert.match(source, /api\("\/api\/crops"\)/);
  assert.match(source, /apiRequest\(\)\("\/api\/assistant\/conversations"\)/);
  assert.match(source, /apiRequest\(\)\("\/api\/assistant\/chat"/);
  assert.match(source, /apiRequest\(\)\("\/api\/assistant\/image"/);
  assert.match(source, /FormData\(\)/);
  assert.match(source, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(source, /renderDiseaseResult/);
  assert.match(source, /image_attached:\s*true/);
  assert.match(source, /URL\.revokeObjectURL/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.match(source, /persist_conversation:\s*true/);
  assert.match(source, /conversation_id:\s*activeConversationId/);
  assert.match(source, /regenerate/);
  assert.match(source, /navigator\.clipboard\?\.writeText/);
  assert.match(source, /renderFormattedResponse/);
  assert.match(source, /renderVisualizations/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test("the standalone page has responsive chat controls while the shared assistant remains a modal", () => {
  const source = read("static/chart-assistant.js");
  const template = read("static/topbar.html");
  const pageScript = read("static/sections.html");
  const sectionViews = read("static/sections.js");

  assert.match(sectionViews, /data-ai-chat/);
  assert.match(sectionViews, /data-ai-history-list/);
  assert.match(sectionViews, /data-ai-field/);
  assert.match(sectionViews, /data-ai-crop/);
  assert.match(sectionViews, /data-ai-format/);
  assert.match(sectionViews, /data-ai-clear/);
  assert.match(pageScript, /ai-chat-page\.js/);
  assert.match(read("static/sections.css"), /@media \(max-width: 860px\)[\s\S]*ai-chat-sidebar/);
  assert.match(source, /openButton\.addEventListener\("click", \(\) => \{\s*showPanel\(true\);/);
  assert.doesNotMatch(source, /enterPageMode|leavePageMode|common-chart-page-mode/);
  assert.match(template, /data-chart-assistant-open/);
  assert.match(template, /data-chart-backdrop/);
});

test("the dedicated page localizes all six-language UI and failure states", () => {
  const locales = ["en", "te", "hi", "kn", "ta", "ml"].map((code) =>
    read(`static/i18n/${code}.js`));
  const keys = [
    "aiChat.brand",
    "aiChat.newChat",
    "aiChat.welcome",
    "aiChat.errorConfiguration",
    "aiChat.errorTimeout",
    "aiChat.errorRequest",
    "aiChat.confirmDelete",
    "aiChat.attachPhoto",
    "aiChat.uploadPhoto",
    "aiChat.takePhoto",
    "aiChat.capturePhoto",
    "aiChat.retakePhoto",
    "aiChat.closeCamera",
    "aiChat.cameraPermissionDenied",
    "aiChat.cameraUnavailable",
    "aiChat.imageInvalid",
    "aiChat.diseaseResult",
    "aiChat.voiceInput",
    "aiChat.voicePermissionDenied",
  ];
  keys.forEach((key) => {
    locales.forEach((source) => assert.match(source, new RegExp(`"${key}":`)));
  });
});

test("JalSaathi AI and Calendar format dates, years, and percentages with Latin digits", () => {
  const aiChat = read("static/ai-chat-page.js");
  const calendar = read("static/calendar.js");

  assert.match(aiChat, /new Intl\.DateTimeFormat\(selectedLanguage,\s*\{[\s\S]*?numberingSystem:\s*"latn"/);
  assert.equal((aiChat.match(/new Intl\.NumberFormat/g) || []).length, 2);
  assert.equal((aiChat.match(/numberingSystem:\s*"latn"/g) || []).length, 3);
  assert.match(calendar, /new Intl\.DateTimeFormat\(localeCode\(\), \{ \.\.\.options, numberingSystem: "latn" \}\)/);
  assert.match(calendar, /new Intl\.NumberFormat\(localeCode\(\), \{[\s\S]*?numberingSystem:\s*"latn"/);
  assert.match(calendar, /month:\s*"long",\s*year:\s*"numeric",\s*numberingSystem:\s*"latn"/);
});

test("calendar unconfirmed irrigation uses a localized label in every supported language", () => {
  const calendar = read("static/calendar.js");
  assert.match(calendar, /unconfirmed:\s*"calendar\.notConfirmed"/);
  assert.doesNotMatch(calendar, /calendar\.unconfirmed/);

  ["en", "te", "hi", "kn", "ta", "ml"].forEach((code) => {
    const locale = read(`static/i18n/${code}.js`);
    assert.match(locale, /"calendar\.notConfirmed":\s*"[^"]+"/);
    assert.doesNotMatch(locale, /"calendar\.unconfirmed":/);
  });
});

test("camera capture is user-initiated and sends the captured image through the disease API", () => {
  const source = read("static/ai-chat-page.js");
  const sections = read("static/sections.js");

  assert.match(sections, /data-ai-attachment-menu/);
  assert.match(sections, /data-ai-camera/);
  assert.match(sections, /data-ai-camera-capture/);
  assert.match(source, /elements\.camera\.addEventListener\("click", \(\) => \{\s*closeAttachmentMenu\(\);\s*void startCameraCapture\(\);/);
  assert.match(source, /mediaDevices\.getUserMedia\(/);
  assert.match(source, /canvas\.toBlob\(/);
  assert.match(source, /track\.stop\(\)/);
  assert.match(source, /apiRequest\(\)\("\/api\/assistant\/image"/);
  assert.match(source, /aiChat\.cameraPermissionDenied/);
});
