const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");

test("Chart Assistant and Calendar stay on existing pages without sidebar entries", () => {
  const sections = read("static/sections.html");
  const dashboard = read("templates/index.html");
  const profileMenu = read("static/topbar.html");
  const topbarScript = read("static/topbar.js");
  const sectionViews = read("static/sections.js");

  for (const source of [sections, dashboard]) {
    assert.doesNotMatch(source, /data-view-link="(?:chart-assistant|calendar)"|href="\/static\/sections\.html\?view=(?:chart-assistant|calendar)"/);
  }
  assert.match(profileMenu, /href="\/static\/sections\.html\?view=chart-assistant"[^>]*data-chart-assistant-open/);
  assert.match(profileMenu, /href="\/static\/sections\.html\?view=calendar"[^>]*data-i18n-key="nav\.calendar"/);
  assert.doesNotMatch(profileMenu, /data-chart-backdrop|data-chart-form|id="chart-assistant-backdrop"/);
  assert.match(topbarScript, /profileMenu\.addEventListener\("click"[\s\S]*?closest\("a\[role='menuitem'\]"\)[\s\S]*?closeMenus\(\)/);
  assert.match(sectionViews, /"chart-assistant":\s*\{/);
  assert.match(sectionViews, /calendar:\s*\{/);
  assert.match(sectionViews, /JalSaathiCalendar\?\.initialize\(content\)/);
  assert.match(sectionViews, /JalSaathiAiChat\?\.initialize\(content\)/);
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
  assert.match(source, /signal:\s*controller\.signal/);
  assert.match(source, /requestAbortController\?\.abort\(\)/);
  assert.match(source, /elements\.question\.addEventListener\("keydown"/);
  assert.match(source, /event\.key !== "Enter" \|\| event\.shiftKey/);
  assert.match(source, /elements\.form\.requestSubmit\(\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test("the assistant composer keeps attachment, message, voice, and send controls available", () => {
  const source = read("static/ai-chat-page.js");
  const sections = read("static/sections.js");

  assert.match(sections, /<div class="ai-chat-composer-row">/);
  assert.match(sections, /<button class="ai-chat-composer-icon"[^>]+data-ai-attach/);
  assert.match(sections, /<textarea[^>]+data-ai-question/);
  assert.match(sections, /data-ai-voice/);
  assert.match(sections, /data-ai-send disabled/);
  assert.match(sections, /data-ai-stop hidden/);
  assert.match(sections, /<option value="auto" selected data-i18n-key="aiChat\.chartAuto">/);
  assert.match(source, /chart_mode:\s*elements\.format\.value/);
  assert.match(source, /formData\.append\("chart_mode",\s*payload\.chart_mode\)/);
  assert.match(source, /send\.disabled = loading \|\| !hasComposerContent/);
  assert.match(source, /send\.hidden = loading/);
  assert.match(source, /voice\.hidden = false/);
  assert.match(source, /question\.readOnly = loading/);
  assert.doesNotMatch(source, /function chartRequested/);
});

test("the assistant renders only validated server charts in automatic mode", () => {
  const page = read("static/ai-chat-page.js");
  const renderer = read("static/chart-assistant.js");
  const backend = read("main.py");

  assert.match(page, /Array\.isArray\(message\.context\?\.charts\)/);
  assert.match(page, /reportFormat === "auto" && hasServerCharts/);
  assert.match(renderer, /if \(Array\.isArray\(context\?\.charts\)\)/);
  assert.match(renderer, /allowedTitles\.has\(chart\.title_key\)/);
  assert.match(renderer, /Number\.isFinite\(value\)/);
  assert.match(backend, /chart_id=f"\{metric\}-latest-by-field"/);
  assert.match(backend, /"source":\s*"farmer_sensor_readings"/);
  assert.match(backend, /_assistant_gemini_context\(field_data\)/);
});

test("automatic mode requests a per-field chart for metric questions", () => {
  const backend = read("main.py");

  assert.match(backend, /fieldwise_comparison and bool\(metrics\)/);
  assert.match(backend, /intent\["fieldwise_comparison"\]/);
});

test("the Chart Assistant opens as a dedicated page without mounting a popup", () => {
  const template = read("static/topbar.html");
  const pageScript = read("static/sections.html");
  const topbarScript = read("static/topbar.js");
  const dashboard = read("templates/index.html");
  const todoPage = read("templates/todo-list.html");

  assert.match(pageScript, /ai-chat-page\.js/);
  assert.match(pageScript, /chart-assistant\.js/);
  assert.match(read("static/sections.css"), /@media \(max-width: 860px\)[\s\S]*ai-chat-sidebar/);
  assert.match(template, /href="\/static\/sections\.html\?view=chart-assistant"/);
  assert.doesNotMatch(template, /data-chart-backdrop|data-chart-form|role="dialog"[^>]+chart-assistant/);
  assert.match(topbarScript, /chartAssistantLink\.hidden/);
  assert.doesNotMatch(dashboard, /chart-assistant\.js/);
  assert.doesNotMatch(todoPage, /chart-assistant\.js/);
});

test("the dedicated AI page supports stopping requests and cancelling voice input without duplicates", () => {
  const source = read("static/ai-chat-page.js");
  const sections = read("static/sections.js");
  const styles = read("static/sections.css");

  assert.match(sections, /data-ai-stop hidden>[\s\S]*?data-i18n-key="aiChat\.stop"/);
  assert.match(source, /stop\.hidden = !canAbortRequest/);
  assert.match(source, /requestAbortController === controller/);
  assert.match(source, /error\?\.name === "AbortError"/);
  assert.match(source, /if \(speechRecognition\) \{\s*cancelVoiceInput\(\);/);
  assert.match(source, /results\.slice\(firstChangedResult\)/);
  assert.match(source, /\.filter\(\(result\) => result\?\.isFinal !== false\)/);
  assert.match(source, /forceScroll = false/);
  assert.match(source, /priorScrollBottom <= 80/);
  assert.match(styles, /\.ai-chat-thread\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/);
  assert.match(styles, /\.ai-chat-form\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?bottom:\s*0;/);
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
    "aiChat.stopVoice",
    "aiChat.voiceCancelled",
    "aiChat.stop",
    "aiChat.requestCancelled",
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
