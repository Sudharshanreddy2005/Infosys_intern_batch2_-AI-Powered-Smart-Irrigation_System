(() => {
  "use strict";

  const HISTORY_LIMIT = 12;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const i18n = () => window.JalSaathiI18n;
  const numberOptions = (options) => window.JalSaathiNumberFormat?.numberOptions(options) ??
    { ...options, numberingSystem: "latn" };
  const dateOptions = (options) => window.JalSaathiNumberFormat?.dateOptions(options) ??
    { ...options, numberingSystem: "latn" };
  let initialized = false;
  let fields = [];
  let crops = [];
  let messages = [];
  let loading = false;
  let historyKey = "";
  let reportFormat = "chart";

  const translate = (key, values) => i18n()?.t(key, values) || key;
  const todayKey = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };
  const offsetDateKey = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const localeCode = () => {
    const profileApi = window.JalSaathiProfile;
    const selected = profileApi?.getLanguage?.() || i18n()?.getLanguage?.() || "en";
    return profileApi?.getLanguages?.().find((item) => item.code === selected)?.locale ||
      i18n()?.languages?.find((item) => item.code === selected)?.locale ||
      "en-IN";
  };
  const formatNumber = (value) => i18n()?.formatNumber
    ? i18n().formatNumber(value)
    : new Intl.NumberFormat(localeCode(), numberOptions({ maximumFractionDigits: 2 })).format(value);
  const formatDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const options = { day: "numeric", month: "short" };
    return i18n()?.formatDate
      ? i18n().formatDate(date, options)
      : new Intl.DateTimeFormat(localeCode(), dateOptions(options)).format(date);
  };
  const formatRange = (range) => {
    if (!range?.start_date || !range?.end_date) return "";
    return translate("chartAssistant.rangeLabel", {
      startDate: formatDate(range.start_date),
      endDate: formatDate(range.end_date),
    });
  };
  const accountHistoryKey = () => {
    const profileId = window.JalSaathiProfile?.getProfile?.()?.id;
    return `jalsaathi.main.chart-assistant.v1.${Number.isInteger(profileId) ? profileId : "session"}`;
  };

  function restoreHistory() {
    historyKey = accountHistoryKey();
    try {
      const saved = sessionStorage.getItem(historyKey);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) throw new Error("Saved Chart Assistant history is not a list.");
      return parsed.flatMap((message) => {
        if (!message || typeof message !== "object" ||
            !["user", "assistant"].includes(message.role) ||
            typeof message.content !== "string" || !message.content.trim()) return [];
        return [{
          role: message.role,
          content: message.content,
          ...(message.role === "assistant" && message.context && typeof message.context === "object"
            ? { context: message.context }
            : {}),
        }];
      }).slice(-HISTORY_LIMIT);
    } catch (error) {
      console.error("JalSaathi Chart Assistant history could not be restored.", error);
      return [];
    }
  }

  function saveHistory() {
    try {
      const saved = messages.slice(-HISTORY_LIMIT).map(({ role, content }) => ({ role, content }));
      sessionStorage.setItem(historyKey || accountHistoryKey(), JSON.stringify(saved));
    } catch (error) {
      console.error("JalSaathi Chart Assistant history could not be saved.", error);
    }
  }

  function completedHistory() {
    const result = [];
    let pendingUser = null;
    messages.forEach((message) => {
      if (message.role === "user") {
        pendingUser = { role: "user", content: message.content };
      } else if (pendingUser) {
        result.push(pendingUser, { role: "assistant", content: message.content });
        pendingUser = null;
      }
    });
    return result.slice(-6);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svgElement(tag, attributes = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)));
    return node;
  }

  function appendLocalized(parent, tag, className, key) {
    const node = element(tag, className, translate(key));
    node.dataset.i18nKey = key;
    parent.append(node);
    return node;
  }

  function setStatus(key) {
    const status = document.querySelector("[data-chart-status]");
    if (!status) return;
    status.hidden = !key;
    status.textContent = key ? translate(key) : "";
    if (key) {
      status.dataset.i18nKey = key;
      i18n()?.translate(status);
    } else {
      delete status.dataset.i18nKey;
    }
  }

  function appendOption(select, value, label) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = label;
    if (value === "all") {
      option.dataset.i18nKey = select.matches("[data-chart-field]")
        ? "chartAssistant.allFields"
        : "chartAssistant.allCrops";
    } else {
      option.setAttribute("data-user-content", "");
    }
    select.append(option);
  }

  function updateCropOptions() {
    const fieldSelect = document.querySelector("[data-chart-field]");
    const cropSelect = document.querySelector("[data-chart-crop]");
    if (!(fieldSelect instanceof HTMLSelectElement) || !(cropSelect instanceof HTMLSelectElement)) return;
    const selectedField = fieldSelect.value === "all" ? null : Number(fieldSelect.value);
    const selectedCrop = cropSelect.value;
    cropSelect.replaceChildren();
    appendOption(cropSelect, "all", translate("chartAssistant.allCrops"));
    crops.filter((crop) => selectedField === null || crop.field_id === selectedField)
      .forEach((crop) => appendOption(cropSelect, crop.id, crop.name));
    if ([...cropSelect.options].some((option) => option.value === selectedCrop)) {
      cropSelect.value = selectedCrop;
    }
  }

  async function loadFarmOptions() {
    const api = window.JalSaathiProfile?.apiRequest;
    if (typeof api !== "function") throw new Error("The authenticated API helper is unavailable.");
    const [fieldRecords, cropRecords] = await Promise.all([
      api("/api/fields"),
      api("/api/crops"),
    ]);
    if (!Array.isArray(fieldRecords) || !Array.isArray(cropRecords)) {
      throw new Error("The farm records returned an invalid response.");
    }
    fields = fieldRecords.filter((field) => Number.isInteger(field?.id) && typeof field.name === "string");
    crops = cropRecords.filter((crop) =>
      Number.isInteger(crop?.id) && typeof crop.name === "string" &&
      (crop.field_id === null || Number.isInteger(crop.field_id)),
    );
    const fieldSelect = document.querySelector("[data-chart-field]");
    if (!(fieldSelect instanceof HTMLSelectElement)) return;
    const selectedValue = fieldSelect.value;
    fieldSelect.replaceChildren();
    appendOption(fieldSelect, "all", translate("chartAssistant.allFields"));
    fields.forEach((field) => appendOption(fieldSelect, field.id, field.name));
    if ([...fieldSelect.options].some((option) => option.value === selectedValue)) {
      fieldSelect.value = selectedValue;
    }
    updateCropOptions();
  }

  function chartDatesInvalid() {
    const period = document.querySelector("[data-chart-period]")?.value;
    if (period !== "custom") return false;
    const field = document.querySelector("[data-chart-field]")?.value;
    const start = document.querySelector("[data-chart-start]")?.value;
    const end = document.querySelector("[data-chart-end]")?.value;
    if (!field || field === "all" || !start || !end || end < start) return true;
    return Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) > 30 * 86400000;
  }

  function showPanel(open) {
    const backdrop = document.querySelector("[data-chart-backdrop]");
    const button = document.querySelector("[data-chart-assistant-open]");
    if (!(backdrop instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) return;
    backdrop.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      historyKey = accountHistoryKey();
      messages = restoreHistory();
      renderMessages();
      document.querySelector("[data-chart-question]")?.focus();
      void loadFarmOptions().catch((error) => {
        console.error("JalSaathi Chart Assistant could not load farmer records.", error);
        setStatus(error?.status === 401 ? "chartAssistant.errorExpired" : "chartAssistant.errorLoad");
      });
    } else {
      button.focus();
    }
  }

  function addDateRangeLabel(card, range) {
    if (!range) return;
    const summary = element("div", "common-chart-summary");
    summary.textContent = formatRange(range);
    card.append(summary);
  }

  function metricValues(points, key) {
    return points.flatMap((point) => {
      const value = point[key];
      return typeof value === "number" && Number.isFinite(value)
        ? [{ time: point.time, value }]
        : [];
    }).slice(0, 24);
  }

  function addLineChart(container, titleKey, unit, values, range) {
    if (values.length < 2) return false;
    const card = element("section", "common-chart-card");
    card.setAttribute("aria-label", translate("chartAssistant.chartLabel"));
    appendLocalized(card, "h3", "", titleKey);
    const width = 360;
    const height = 132;
    const padding = { left: 28, right: 12, top: 10, bottom: 24 };
    const min = Math.min(...values.map((point) => point.value));
    const max = Math.max(...values.map((point) => point.value));
    const span = max - min || 1;
    const coordinates = values.map((point, index) => ({
      ...point,
      x: values.length === 1
        ? width / 2
        : padding.left + index * (width - padding.left - padding.right) / (values.length - 1),
      y: height - padding.bottom -
        ((point.value - min) / span) * (height - padding.top - padding.bottom),
    }));
    const svg = svgElement("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": translate(titleKey),
    });
    svg.append(svgElement("line", { x1: padding.left, y1: height - padding.bottom, x2: width - padding.right, y2: height - padding.bottom, stroke: "#dce6da" }));
    svg.append(svgElement("text", { x: 2, y: padding.top + 4, class: "chart-label" }));
    svg.lastChild.textContent = `${formatNumber(max)} ${unit}`;
    svg.append(svgElement("text", { x: 2, y: height - padding.bottom, class: "chart-label" }));
    svg.lastChild.textContent = `${formatNumber(min)}`;
    svg.append(svgElement("polyline", {
      points: coordinates.map(({ x, y }) => `${x},${y}`).join(" "),
      class: "chart-line",
    }));
    coordinates.forEach((point) => {
      const circle = svgElement("circle", { cx: point.x, cy: point.y, r: 3.5, class: "chart-point" });
      const titleNode = svgElement("title");
      titleNode.textContent = `${formatDate(point.time)}: ${formatNumber(point.value)} ${unit}`;
      titleNode.setAttribute("data-user-content", "");
      circle.append(titleNode);
      svg.append(circle);
    });
    card.append(svg);
    const summary = element("div", "common-chart-summary");
    const start = element("span", "", formatDate(values[0].time));
    const bounds = element("strong", "", `${formatNumber(min)}–${formatNumber(max)} ${unit}`);
    const end = element("span", "", formatDate(values[values.length - 1].time));
    summary.append(start, bounds, end);
    card.append(summary);
    addDateRangeLabel(card, range);
    container.append(card);
    return true;
  }

  function addBarChart(container, titleKey, unit, values, range, labelKey = "") {
    if (!values.length) return false;
    const card = element("section", "common-chart-card");
    card.setAttribute("aria-label", translate("chartAssistant.chartLabel"));
    appendLocalized(card, "h3", "", titleKey);
    const width = 360;
    const height = 132;
    const max = Math.max(...values.map((point) => point.value), 0);
    const safeMax = max || 1;
    const chartTop = 12;
    const baseline = 96;
    const usableWidth = 326;
    const gap = Math.min(8, usableWidth / values.length * 0.18);
    const barWidth = Math.max(2, (usableWidth - gap * values.length) / values.length);
    const svg = svgElement("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": translate(titleKey),
    });
    svg.append(svgElement("line", { x1: 27, y1: baseline, x2: width - 7, y2: baseline, stroke: "#dce6da" }));
    values.slice(0, 24).forEach((point, index) => {
      const x = 28 + index * (barWidth + gap);
      const barHeight = Math.max(1, (point.value / safeMax) * (baseline - chartTop));
      const rect = svgElement("rect", {
        x,
        y: baseline - barHeight,
        width: barWidth,
        height: barHeight,
        rx: 3,
        class: "chart-bar",
      });
      const detail = labelKey
        ? `${point.label}: ${formatNumber(point.value)} ${unit}`
        : `${formatDate(point.time)}: ${formatNumber(point.value)} ${unit}`;
      const titleNode = svgElement("title");
      titleNode.textContent = detail;
      rect.append(titleNode);
      svg.append(rect);
    });
    svg.append(svgElement("text", { x: 2, y: chartTop + 4, class: "chart-label" }));
    svg.lastChild.textContent = `${formatNumber(max)} ${unit}`;
    card.append(svg);
    if (labelKey) {
      const legend = element("div", "common-chart-summary");
      values.slice(0, 8).forEach((point) => {
        legend.append(element("span", "", point.label));
      });
      card.append(legend);
    } else {
      const summary = element("div", "common-chart-summary");
      summary.append(
        element("span", "", formatDate(values[0].time)),
        element("strong", "", `${formatNumber(values.reduce((sum, point) => sum + point.value, 0))} ${unit}`),
        element("span", "", formatDate(values[values.length - 1].time)),
      );
      card.append(summary);
    }
    addDateRangeLabel(card, range);
    container.append(card);
    return true;
  }

  function addAreaPieChart(container, fieldsData) {
    const values = fieldsData.filter((field) =>
      typeof field.area === "number" && Number.isFinite(field.area) && field.area > 0 &&
      typeof field.name === "string" && typeof field.area_unit === "string" && field.area_unit.trim(),
    );
    if (values.length < 2) return false;
    const units = new Set(values.map((field) => field.area_unit));
    if (units.size !== 1) return false;
    const total = values.reduce((sum, field) => sum + field.area, 0);
    if (!(total > 0)) return false;

    const card = element("section", "common-chart-card");
    card.setAttribute("aria-label", translate("chartAssistant.chartLabel"));
    appendLocalized(card, "h3", "", "chartAssistant.fieldAreaDistribution");
    const svg = svgElement("svg", { viewBox: "0 0 100 100", role: "img", "aria-label": translate("chartAssistant.fieldAreaDistribution") });
    const circumference = 2 * Math.PI * 35;
    const colors = ["#218157", "#73a860", "#d0a44c", "#4c8ca0", "#a87180", "#7772a5"];
    let offset = 0;
    values.forEach((field, index) => {
      const fraction = field.area / total;
      const segment = svgElement("circle", {
        cx: 50,
        cy: 50,
        r: 35,
        fill: "none",
        stroke: colors[index % colors.length],
        "stroke-width": 20,
        "stroke-dasharray": `${fraction * circumference} ${circumference}`,
        "stroke-dashoffset": -offset,
        transform: "rotate(-90 50 50)",
      });
      const titleNode = svgElement("title");
      titleNode.textContent = `${field.name}: ${formatNumber(field.area)} ${field.area_unit}`;
      titleNode.setAttribute("data-user-content", "");
      segment.append(titleNode);
      svg.append(segment);
      offset += fraction * circumference;
    });
    card.append(svg);
    const legend = element("div", "common-chart-summary");
    values.forEach((field) => {
      const label = element("span", "", `${field.name}: ${formatNumber(field.area)} ${field.area_unit}`);
      label.setAttribute("data-user-content", "");
      legend.append(label);
    });
    card.append(legend);
    container.append(card);
    return true;
  }

  function addCurrentWeather(container, weather) {
    if (!weather || weather.status !== "available" || !weather.values) return false;
    const values = weather.values;
    const details = [
      ["temperature_c", "chartAssistant.temperature", "°C"],
      ["humidity_percent", "chartAssistant.humidity", "%"],
      ["rainfall_mm_per_hr", "chartAssistant.rainfall", "mm/h"],
    ].filter(([key]) => typeof values[key] === "number" && Number.isFinite(values[key]));
    if (!details.length) return false;
    const card = element("section", "common-chart-card");
    appendLocalized(card, "h3", "", "chartAssistant.currentWeather");
    details.forEach(([key, labelKey, unit]) => {
      const line = element("p", "common-chart-weather-value");
      const label = element("span", "", translate(labelKey));
      label.dataset.i18nKey = labelKey;
      line.append(label, element("strong", "", `${formatNumber(values[key])} ${unit}`));
      card.append(line);
    });
    container.append(card);
    return true;
  }

  function renderVisualizations(container, context) {
    const charts = element("div", "common-chart-visuals");
    let hasChart = false;
    const forecast = context?.weather_forecast;
    if (forecast?.status === "available" && Array.isArray(forecast.data)) {
      const forecastRange = forecast.range || context.range;
      [
        ["temperature_c", "chartAssistant.temperature", "°C"],
        ["humidity_percent", "chartAssistant.humidity", "%"],
        ["rainfall_mm_per_hr", "chartAssistant.rainfall", "mm/h"],
      ].forEach(([key, titleKey, unit]) => {
        hasChart = addLineChart(charts, titleKey, unit, metricValues(forecast.data, key), forecastRange) || hasChart;
      });
    }
    const renderSensorHistory = (history, metric, titleKey) => {
      if (history?.status !== "available" || !Array.isArray(history.data)) return false;
      const fieldCount = new Set(history.data.map((item) => item.field_id)).size;
      if (context.scope === "selected farmer-owned field" || fieldCount <= 1) {
        const points = history.data.flatMap((item) =>
          typeof item[metric] === "number" &&
          Number.isFinite(item[metric]) &&
          typeof item.recorded_at === "string"
            ? [{ time: item.recorded_at, value: item[metric] }]
            : [],
        ).slice(-24);
        return addLineChart(charts, titleKey, history.unit || "", points, context.range);
      }
      const byField = new Map();
      history.data.forEach((item) => {
        if (typeof item[metric] !== "number" || !Number.isFinite(item[metric]) ||
            !Number.isInteger(item.field_id) || typeof item.field_name !== "string") return;
        const current = byField.get(item.field_id) || { label: item.field_name, total: 0, count: 0 };
        current.total += item[metric];
        current.count += 1;
        byField.set(item.field_id, current);
      });
      const points = [...byField.values()].map((item) => ({
        label: item.label,
        value: item.total / item.count,
      }));
      return addBarChart(charts, titleKey, history.unit || "", points, context.range, "field");
    };
    hasChart = renderSensorHistory(
      context?.soil_moisture_history,
      "soil_moisture_percent",
      "chartAssistant.soilMoisture",
    ) || hasChart;
    hasChart = renderSensorHistory(
      context?.soil_temperature_history,
      "soil_temperature_c",
      "chartAssistant.soilTemperature",
    ) || hasChart;
    const schedule = context?.planned_irrigation;
    if (schedule?.status === "available" && Array.isArray(schedule.data)) {
      const points = schedule.data.flatMap((item) =>
        typeof item.water_liters === "number" && Number.isFinite(item.water_liters) && typeof item.scheduled_date === "string"
          ? [{ time: item.scheduled_date, value: item.water_liters }]
          : [],
      ).slice(-24);
      hasChart = addBarChart(charts, "chartAssistant.plannedIrrigation", schedule.unit || "liters", points, context.range) || hasChart;
    }
    if (Array.isArray(context?.fields) && context.fields.length > 1) {
      hasChart = addAreaPieChart(charts, context.fields) || hasChart;
    }
    const hasCurrentWeather = addCurrentWeather(charts, context?.current_weather);
    if (charts.childElementCount) container.append(charts);
    if (!hasChart && !hasCurrentWeather) {
      appendLocalized(container, "p", "common-chart-empty", "chartAssistant.noChartData");
    }

    const notes = element("div", "common-chart-notes");
    if (context?.soil_moisture_history?.status === "unavailable") {
      appendLocalized(notes, "p", "", "chartAssistant.soilUnavailable");
    }
    if (context?.actual_water_usage?.status === "unavailable") {
      appendLocalized(notes, "p", "", "chartAssistant.actualUsageUnavailable");
    }
    if (schedule?.status === "available" && schedule.data?.length) {
      appendLocalized(notes, "p", "", "chartAssistant.schedulesNotUsage");
    }
    if (notes.childElementCount) container.append(notes);
  }

  function appendInlineFormatting(parent, text) {
    const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
    let offset = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      parent.append(document.createTextNode(text.slice(offset, start)));
      if (match[1]) {
        parent.append(element("strong", "", match[1]));
      } else if (match[2]) {
        parent.append(element("em", "", match[2]));
      } else {
        parent.append(element("code", "common-chart-inline-code", match[3]));
      }
      offset = start + match[0].length;
    }
    parent.append(document.createTextNode(text.slice(offset)));
  }

  function markdownTableCells(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  }

  function isMarkdownTableRow(line) {
    return line.includes("|") && markdownTableCells(line).length > 1;
  }

  function isMarkdownTableSeparator(line) {
    const cells = markdownTableCells(line);
    return isMarkdownTableRow(line) && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function appendMarkdownTable(parent, headerLine, rows) {
    const table = element("table", "common-chart-markdown-table");
    const head = element("thead");
    const headingRow = element("tr");
    markdownTableCells(headerLine).forEach((value) => {
      const cell = element("th");
      appendInlineFormatting(cell, value);
      headingRow.append(cell);
    });
    head.append(headingRow);
    const body = element("tbody");
    rows.forEach((line) => {
      const row = element("tr");
      markdownTableCells(line).forEach((value) => {
        const cell = element("td");
        appendInlineFormatting(cell, value);
        row.append(cell);
      });
      body.append(row);
    });
    table.append(head, body);
    parent.append(table);
  }

  function renderFormattedResponse(parent, text) {
    const normalized = window.JalSaathiNumberFormat?.normalizeAssistantText?.(text) || text;
    const lines = String(normalized).split(/\r?\n/);
    let paragraphLines = [];
    let list = null;
    const flushParagraph = () => {
      if (!paragraphLines.length) return;
      const paragraph = element("p");
      appendInlineFormatting(paragraph, paragraphLines.join(" "));
      parent.append(paragraph);
      paragraphLines = [];
    };
    const flushList = () => {
      if (!list) return;
      parent.append(list);
      list = null;
    };
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (isMarkdownTableRow(line) && isMarkdownTableSeparator(lines[index + 1] || "")) {
        flushParagraph();
        flushList();
        const rows = [];
        index += 2;
        while (index < lines.length && isMarkdownTableRow(lines[index])) {
          rows.push(lines[index]);
          index += 1;
        }
        index -= 1;
        appendMarkdownTable(parent, line, rows);
        continue;
      }
      const heading = line.match(/^\s{0,3}(#{1,4})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        flushParagraph();
        flushList();
        const level = Math.min(heading[1].length + 2, 6);
        const headingNode = element(`h${level}`, "common-chart-response-heading");
        appendInlineFormatting(headingNode, heading[2]);
        parent.append(headingNode);
        continue;
      }
      const bullet = line.match(/^\s*(?:([-*•])|(\d+[.)]))\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        const listTag = bullet[2] ? "ol" : "ul";
        if (list && list.nodeName.toLowerCase() !== listTag) flushList();
        if (!list) list = element(listTag, "common-chart-response-list");
        const item = element("li");
        appendInlineFormatting(item, bullet[3]);
        list.append(item);
      } else if (!line.trim()) {
        flushParagraph();
        flushList();
      } else {
        flushList();
        paragraphLines.push(line.trim());
      }
    }
    flushParagraph();
    flushList();
  }

  function renderMessages() {
    const thread = document.querySelector("[data-chart-thread]");
    if (!(thread instanceof HTMLElement)) return;
    thread.replaceChildren();
    if (!messages.length) {
      appendLocalized(thread, "p", "common-chart-welcome", "chartAssistant.welcome");
    }
    messages.forEach((message) => {
      const article = element("article", `common-chart-message common-chart-message--${message.role}`);
      if (message.role === "assistant") {
        const content = element("div", "common-chart-response");
        content.setAttribute("data-user-content", "");
        renderFormattedResponse(content, message.content);
        article.append(content);
        if (reportFormat === "chart" && message.context) renderVisualizations(article, message.context);
        const copyButton = element("button", "common-chart-secondary common-chart-copy", translate("chartAssistant.copyResponse"));
        copyButton.type = "button";
        copyButton.dataset.i18nKey = "chartAssistant.copyResponse";
        copyButton.addEventListener("click", async () => {
          try {
            if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
            await navigator.clipboard.writeText(
              window.JalSaathiNumberFormat?.normalizeAssistantText?.(message.content) || message.content,
            );
            setStatus("chartAssistant.copySuccess");
          } catch (error) {
            console.error("JalSaathi Chart Assistant response could not be copied.", error);
            setStatus("chartAssistant.copyFailed");
          }
        });
        article.append(copyButton);
      } else {
        const content = element("p", "", message.content);
        content.setAttribute("data-user-content", "");
        article.append(content);
      }
      thread.append(article);
    });
    if (loading) appendLocalized(thread, "p", "common-chart-welcome", "chartAssistant.loading")
      .setAttribute("role", "status");
    thread.scrollTop = thread.scrollHeight;
  }

  function errorKey(error) {
    if (error?.status === 401) return "chartAssistant.errorExpired";
    if (error?.status === 429) return "chartAssistant.errorBusy";
    if (typeof error?.status === "number" && error.status >= 500) return "chartAssistant.errorUnavailable";
    if (error?.status === 0 || !navigator.onLine) return "chartAssistant.errorOffline";
    if (error?.message?.includes("invalid response")) return "chartAssistant.errorInvalid";
    return "chartAssistant.errorUnavailable";
  }

  function closeAssistant() {
    showPanel(false);
  }

  function initialize() {
    if (initialized) return;
    const panel = document.querySelector("[data-chart-backdrop]");
    if (!(panel instanceof HTMLElement)) return;
    initialized = true;
    historyKey = accountHistoryKey();
    messages = restoreHistory();
    renderMessages();

    const openButton = document.querySelector("[data-chart-assistant-open]");
    const closeButton = panel.querySelector("[data-chart-close]");
    const form = panel.querySelector("[data-chart-form]");
    const question = panel.querySelector("[data-chart-question]");
    const submit = panel.querySelector("[data-chart-submit]");
    const reset = panel.querySelector("[data-chart-reset]");
    const fieldSelect = panel.querySelector("[data-chart-field]");
    const cropSelect = panel.querySelector("[data-chart-crop]");
    const periodSelect = panel.querySelector("[data-chart-period]");
    const dateRange = panel.querySelector("[data-chart-dates]");
    const startDate = panel.querySelector("[data-chart-start]");
    const endDate = panel.querySelector("[data-chart-end]");
    const formatSelect = panel.querySelector("[data-chart-format]");
    if (!(openButton instanceof HTMLButtonElement) ||
        !(closeButton instanceof HTMLButtonElement) ||
        !(form instanceof HTMLFormElement) ||
        !(question instanceof HTMLTextAreaElement) ||
        !(submit instanceof HTMLButtonElement) ||
        !(reset instanceof HTMLButtonElement) ||
        !(fieldSelect instanceof HTMLSelectElement) ||
        !(cropSelect instanceof HTMLSelectElement) ||
        !(periodSelect instanceof HTMLSelectElement) ||
        !(dateRange instanceof HTMLElement) ||
        !(startDate instanceof HTMLInputElement) ||
        !(endDate instanceof HTMLInputElement) ||
        !(formatSelect instanceof HTMLSelectElement)) return;

    startDate.value = offsetDateKey(-6);
    endDate.value = todayKey();
    startDate.max = endDate.value;
    endDate.min = startDate.value;

    openButton.addEventListener("click", () => {
      showPanel(true);
    });
    closeButton.addEventListener("click", closeAssistant);
    panel.addEventListener("mousedown", (event) => {
      if (event.target === panel) showPanel(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) closeAssistant();
    });
    formatSelect.addEventListener("change", () => {
      reportFormat = formatSelect.value === "chart" ? "chart" : "text";
      renderMessages();
    });
    fieldSelect.addEventListener("change", updateCropOptions);
    cropSelect.addEventListener("change", () => {
      const crop = crops.find((item) => String(item.id) === cropSelect.value);
      if (crop?.field_id) {
        fieldSelect.value = String(crop.field_id);
        updateCropOptions();
        cropSelect.value = String(crop.id);
      }
    });
    periodSelect.addEventListener("change", () => {
      dateRange.hidden = periodSelect.value !== "custom";
      if (periodSelect.value === "custom" && fieldSelect.value === "all") {
        setStatus("chartAssistant.dateRangeError");
      } else {
        setStatus("");
      }
    });
    startDate.addEventListener("change", () => {
      endDate.min = startDate.value;
      if (chartDatesInvalid()) setStatus("chartAssistant.dateRangeError");
      else setStatus("");
    });
    endDate.addEventListener("change", () => {
      startDate.max = endDate.value;
      if (chartDatesInvalid()) setStatus("chartAssistant.dateRangeError");
      else setStatus("");
    });
    reset.addEventListener("click", () => {
      messages = [];
      saveHistory();
      setStatus("");
      renderMessages();
    });
    window.addEventListener("jalsaathi:language-changed", () => {
      i18n()?.translate(panel);
      renderMessages();
    });
    window.addEventListener("jalsaathi:auth-changed", () => {
      historyKey = accountHistoryKey();
      messages = restoreHistory();
      renderMessages();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const prompt = question.value.trim();
      if (!prompt || prompt.length > 1500 || loading) return;
      if (!navigator.onLine) {
        setStatus("chartAssistant.errorOffline");
        return;
      }
      if (chartDatesInvalid()) {
        setStatus("chartAssistant.dateRangeError");
        return;
      }
      if (/\b(chart|graph|plot|visuali[sz]e)\b|చార్ట్|గ్రాఫ్|चार्ट|ग्राफ|ಚಾರ್ಟ್|ಗ್ರಾಫ್|விளக்கப்படம்|வரைபடம்|ചാർട്ട്|ഗ്രാഫ്/i.test(prompt)) {
        reportFormat = "chart";
        formatSelect.value = reportFormat;
      }
      const priorHistory = completedHistory();
      const payload = {
        assistant_mode: "chart",
        question: prompt,
        language_code: localeCode(),
        field_id: fieldSelect.value === "all" ? null : Number(fieldSelect.value),
        crop_id: cropSelect.value === "all" ? null : Number(cropSelect.value),
        history: priorHistory,
        chart_period: periodSelect.value,
      };
      if (periodSelect.value === "custom") {
        payload.start_date = startDate.value;
        payload.end_date = endDate.value;
      }

      messages.push({ role: "user", content: prompt });
      messages = messages.slice(-HISTORY_LIMIT);
      question.value = "";
      loading = true;
      submit.disabled = true;
      reset.disabled = true;
      setStatus("");
      renderMessages();
      try {
        const api = window.JalSaathiProfile?.apiRequest;
        if (typeof api !== "function") throw new Error("The authenticated API helper is unavailable.");
        const result = await api("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (typeof result?.answer !== "string" || !result.answer.trim() ||
            !result.context || typeof result.context !== "object") {
          const invalid = new Error("Chart Assistant returned an invalid response.");
          invalid.status = 200;
          throw invalid;
        }
        messages.push({ role: "assistant", content: result.answer, context: result.context });
        messages = messages.slice(-HISTORY_LIMIT);
        saveHistory();
      } catch (error) {
        messages = messages.filter((message, index) =>
          !(message.role === "user" && index === messages.length - 1),
        );
        setStatus(errorKey(error));
        console.error("JalSaathi Chart Assistant request failed.", error);
      } finally {
        loading = false;
        submit.disabled = false;
        reset.disabled = messages.length === 0;
        renderMessages();
      }
    });

    reset.disabled = messages.length === 0;
    i18n()?.translate(panel);
  }

  window.JalSaathiChartAssistant = Object.freeze({
    renderFormattedResponse,
    renderVisualizations,
  });
  window.addEventListener("jalsaathi:topbar-mounted", initialize);
  if (document.querySelector("[data-chart-backdrop]")) initialize();
})();
