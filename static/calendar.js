(() => {
  "use strict";

  const STATUS_KEYS = Object.freeze({
    completed: "completed",
    confirmed: "pending",
    recommended: "unconfirmed",
    insufficient_water: "unsuccessful",
    cancelled: "cancelled",
  });
  const STATUS_LABEL_KEYS = Object.freeze({
    completed: "calendar.completed",
    pending: "calendar.pending",
    unsuccessful: "calendar.unsuccessful",
    unconfirmed: "calendar.notConfirmed",
    cancelled: "calendar.cancelled",
  });
  const global = typeof window !== "undefined" ? window : globalThis;

  function toDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function validDateKey(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day, 12);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function buildMonthGrid(year, month) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
      throw new RangeError("A calendar month requires an integer year and a month from 0 to 11.");
    }
    const firstWeekday = new Date(year, month, 1, 12).getDay();
    const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
    const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    return Array.from({ length: cellCount }, (_, index) => {
      const date = new Date(year, month, index - firstWeekday + 1, 12);
      return {
        date,
        key: toDateKey(date),
        day: date.getDate(),
        inMonth: date.getMonth() === month,
      };
    });
  }

  function statusKind(status) {
    return STATUS_KEYS[status] || "unknown";
  }

  function normalizedName(value) {
    return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  }

  function collectEvents({ schedules = [], crops = [], fields = [], fieldId = "all", cropId = "all" } = {}) {
    const fieldById = new Map(fields.map((field) => [String(field.id), field]));
    const selectedCrop = cropId === "all"
      ? null
      : crops.find((crop) => String(crop.id) === String(cropId));
    const selectedFieldId = fieldId === "all" ? null : String(fieldId);
    const matchesField = (recordFieldId) =>
      selectedFieldId === null || String(recordFieldId ?? "") === selectedFieldId;
    const matchesCrop = (schedule) => {
      if (!selectedCrop) return true;
      if (selectedCrop.field_id !== null && selectedCrop.field_id !== undefined &&
          String(schedule.field_id) !== String(selectedCrop.field_id)) return false;
      return normalizedName(schedule.crop_name) === normalizedName(selectedCrop.name);
    };

    const irrigationEvents = schedules.flatMap((schedule) => {
      if (!schedule || !validDateKey(schedule.scheduled_date) ||
          !matchesField(schedule.field_id) || !matchesCrop(schedule)) return [];
      const numericWater = Number(schedule.water_liters);
      const actualWater = schedule.actual_water_liters;
      const field = fieldById.get(String(schedule.field_id));
      return [{
        type: "irrigation",
        date: schedule.scheduled_date,
        id: schedule.id,
        fieldId: schedule.field_id,
        fieldName: field?.name || schedule.field_name || "",
        cropName: schedule.crop_name || "",
        time: schedule.start_time || "",
        status: typeof schedule.status === "string" ? schedule.status : "",
        statusKind: statusKind(schedule.status),
        waterLiters: Number.isFinite(numericWater) && numericWater >= 0 ? numericWater : 0,
        actualWaterLiters: typeof actualWater === "number" && Number.isFinite(actualWater) && actualWater >= 0
          ? actualWater
          : null,
      }];
    });

    const cropEvents = crops.flatMap((crop) => {
      if (!crop || !Number.isInteger(crop.id) ||
          !matchesField(crop.field_id) ||
          (selectedCrop && String(crop.id) !== String(selectedCrop.id))) return [];
      const field = fieldById.get(String(crop.field_id));
      return [
        ["planting_date", "planting"],
        ["expected_harvest_date", "harvest"],
      ].flatMap(([dateKey, kind]) => {
        const date = crop[dateKey];
        if (!validDateKey(date)) return [];
        return [{
          type: "crop",
          date,
          id: `${crop.id}-${kind}`,
          cropId: crop.id,
          fieldId: crop.field_id,
          fieldName: field?.name || "",
          cropName: crop.name || "",
          kind,
          statusKind: "crop",
        }];
      });
    });

    return [...irrigationEvents, ...cropEvents].sort((a, b) =>
      a.date.localeCompare(b.date) ||
      (a.type === b.type ? String(a.time || "").localeCompare(String(b.time || "")) : a.type === "irrigation" ? -1 : 1),
    );
  }

  function summarizeEvents(events) {
    const irrigation = events.filter((event) => event.type === "irrigation");
    const activeSchedules = irrigation.filter((event) => event.status !== "cancelled");
    const actualValues = activeSchedules
      .map((event) => event.actualWaterLiters)
      .filter((value) => Number.isFinite(value));
    return {
      total: irrigation.length,
      completed: irrigation.filter((event) => event.status === "completed").length,
      pending: irrigation.filter((event) => event.status === "confirmed").length,
      unsuccessful: irrigation.filter((event) => event.status === "insufficient_water").length,
      unconfirmed: irrigation.filter((event) => event.status === "recommended").length,
      cancelled: irrigation.filter((event) => event.status === "cancelled").length,
      plannedWater: activeSchedules.reduce((total, event) => total + event.waterLiters, 0),
      actualWater: actualValues.length ? actualValues.reduce((total, value) => total + value, 0) : null,
    };
  }

  const model = Object.freeze({ buildMonthGrid, collectEvents, statusKind, summarizeEvents, toDateKey, validDateKey });
  global.JalSaathiCalendarModel = model;
  if (typeof module !== "undefined" && module.exports) module.exports = model;

  function initialize(root) {
    const page = root.querySelector("[data-calendar-root]");
    if (!(page instanceof HTMLElement) || page.dataset.calendarInitialized) return;
    page.dataset.calendarInitialized = "true";

    const grid = page.querySelector("[data-calendar-grid]");
    const monthLabel = page.querySelector("[data-calendar-month]");
    const selectedDateLabel = page.querySelector("[data-calendar-selected-date]");
    const eventList = page.querySelector("[data-calendar-events]");
    const emptyNote = page.querySelector("[data-calendar-empty]");
    const feedback = page.querySelector("[data-calendar-feedback]");
    const fieldSelect = page.querySelector("[data-calendar-field]");
    const cropSelect = page.querySelector("[data-calendar-crop]");
    const api = window.JalSaathiProfile?.apiRequest;
    if (!(grid instanceof HTMLElement) || !(monthLabel instanceof HTMLElement) ||
        !(selectedDateLabel instanceof HTMLElement) || !(eventList instanceof HTMLElement) ||
        !(emptyNote instanceof HTMLElement) || !(feedback instanceof HTMLElement) ||
        !(fieldSelect instanceof HTMLSelectElement) || !(cropSelect instanceof HTMLSelectElement)) return;

    const find = (selector) => page.querySelector(selector);
    const today = new Date();
    let viewYear = today.getFullYear();
    let viewMonth = today.getMonth();
    let selectedDate = toDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12));
    let fields = [];
    let crops = [];
    let schedules = [];

    const translate = (key, values) => window.JalSaathiI18n?.t(key, values) || key;
    const localeCode = () => {
      const language = window.JalSaathiProfile?.getLanguage?.() || window.JalSaathiI18n?.getLanguage?.() || "en";
      return window.JalSaathiProfile?.getLanguages?.().find((item) => item.code === language)?.locale ||
        window.JalSaathiI18n?.languages?.find((item) => item.code === language)?.locale || "en-IN";
    };
    const formatDate = (key, options = { day: "numeric", month: "long", year: "numeric" }) => {
      const [year, month, day] = key.split("-").map(Number);
      const date = new Date(year, month - 1, day, 12);
      return window.JalSaathiI18n?.formatDate?.(date, options) ||
        new Intl.DateTimeFormat(localeCode(), { ...options, numberingSystem: "latn" }).format(date);
    };
    const formatNumber = (value) => window.JalSaathiI18n?.formatNumber?.(value) ||
      new Intl.NumberFormat(localeCode(), {
        maximumFractionDigits: 1,
        numberingSystem: "latn",
      }).format(value);
    const formatLiters = (value) => `${formatNumber(value)} ${translate("calendar.litersUnit")}`;
    const setFeedback = (key, visible = true) => {
      feedback.hidden = !visible;
      feedback.textContent = visible ? translate(key) : "";
      if (visible) feedback.dataset.i18nKey = key;
      else delete feedback.dataset.i18nKey;
    };
    if (typeof api !== "function") {
      console.error("JalSaathi Calendar requires the authenticated API helper.");
      setFeedback("calendar.errorLoad");
      return;
    }
    const statusItems = Object.entries(STATUS_LABEL_KEYS);
    const appendOption = (select, value, label) => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = label;
      if (value !== "all") option.setAttribute("data-user-content", "");
      select.append(option);
    };

    function updateCropOptions() {
      const selected = cropSelect.value;
      const currentField = fieldSelect.value;
      cropSelect.replaceChildren();
      appendOption(cropSelect, "all", translate("calendar.allCrops"));
      crops.filter((crop) => currentField === "all" || String(crop.field_id) === currentField)
        .forEach((crop) => appendOption(cropSelect, crop.id, crop.name));
      if ([...cropSelect.options].some((option) => option.value === selected)) cropSelect.value = selected;
      else cropSelect.value = "all";
    }

    function currentEvents() {
      return model.collectEvents({
        schedules,
        crops,
        fields,
        fieldId: fieldSelect.value,
        cropId: cropSelect.value,
      });
    }

    function renderStatusCounts(events) {
      const target = find("[data-calendar-status-counts]");
      if (!(target instanceof HTMLElement)) return;
      const summary = summarizeEvents(events);
      target.replaceChildren();
      statusItems.forEach(([kind, key]) => {
        const item = document.createElement("div");
        item.className = `calendar-status-count calendar-status-count--${kind}`;
        const label = document.createElement("span");
        label.textContent = translate(key);
        label.dataset.i18nKey = key;
        const count = document.createElement("strong");
        count.textContent = formatNumber(summary[kind]);
        item.append(label, count);
        target.append(item);
      });
    }

    function renderEvent(event) {
      const card = document.createElement("article");
      const title = document.createElement("strong");
      const detail = document.createElement("span");
      const status = document.createElement("span");
      card.className = `calendar-event calendar-event--${event.type === "crop" ? event.kind : event.statusKind}`;
      if (event.type === "crop") {
        const key = event.kind === "planting" ? "calendar.plantingDate" : "calendar.harvestDate";
        title.textContent = translate(key);
        title.dataset.i18nKey = key;
      } else {
        title.textContent = event.cropName || translate("calendar.irrigation");
        if (!event.cropName) title.dataset.i18nKey = "calendar.irrigation";
      }
      const parts = [];
      if (event.type === "irrigation") {
        if (event.time) parts.push(`${translate("calendar.time")}: ${event.time}`);
        if (event.fieldName) parts.push(`${translate("calendar.field")}: ${event.fieldName}`);
        if (event.cropName) parts.push(`${translate("calendar.crop")}: ${event.cropName}`);
        parts.push(`${translate("calendar.plannedWater")}: ${formatLiters(event.waterLiters)}`);
        const statusKey = STATUS_LABEL_KEYS[event.statusKind] || "calendar.unknownStatus";
        status.textContent = translate(statusKey);
        status.dataset.i18nKey = statusKey;
      } else {
        if (event.fieldName) parts.push(`${translate("calendar.field")}: ${event.fieldName}`);
        if (event.cropName) parts.push(`${translate("calendar.crop")}: ${event.cropName}`);
        status.textContent = event.cropName;
        status.setAttribute("data-user-content", "");
      }
      detail.textContent = parts.join(" · ");
      status.className = "calendar-event-status";
      card.append(title, detail, status);
      return card;
    }

    function renderDetails(events) {
      const dailyEvents = events.filter((event) => event.date === selectedDate);
      const irrigation = dailyEvents.filter((event) => event.type === "irrigation");
      const summary = summarizeEvents(irrigation);
      selectedDateLabel.textContent = formatDate(selectedDate);
      const planned = find("[data-calendar-planned-water]");
      const actual = find("[data-calendar-actual-water]");
      if (planned instanceof HTMLElement) planned.textContent = formatLiters(summary.plannedWater);
      if (actual instanceof HTMLElement) {
        actual.textContent = summary.actualWater === null
          ? translate("calendar.actualWaterUnavailable")
          : formatLiters(summary.actualWater);
        actual.removeAttribute("data-i18n-key");
        if (summary.actualWater === null) actual.dataset.i18nKey = "calendar.actualWaterUnavailable";
      }
      renderStatusCounts(irrigation);
      const monthlyIrrigation = events.filter((event) =>
        event.type === "irrigation" && event.date.startsWith(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-`));
      const monthHasIrrigation = monthlyIrrigation.length > 0;
      emptyNote.hidden = dailyEvents.length > 0 && monthHasIrrigation;
      if (!monthHasIrrigation) {
        emptyNote.textContent = translate("calendar.noIrrigationThisMonth");
        emptyNote.dataset.i18nKey = "calendar.noIrrigationThisMonth";
      } else if (dailyEvents.length === 0) {
        emptyNote.textContent = translate("calendar.noEventsOnDate");
        emptyNote.dataset.i18nKey = "calendar.noEventsOnDate";
      } else {
        emptyNote.textContent = "";
      }
      eventList.replaceChildren(...dailyEvents.map(renderEvent));
    }

    function renderSummary(events) {
      const monthEvents = events.filter((event) =>
        event.date.startsWith(`${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-`));
      const summary = summarizeEvents(monthEvents);
      monthLabel.textContent = new Intl.DateTimeFormat(localeCode(), {
        month: "long",
        year: "numeric",
        numberingSystem: "latn",
      }).format(new Date(viewYear, viewMonth, 1, 12));
      const values = {
        "[data-calendar-total]": summary.total,
        "[data-calendar-completed]": summary.completed,
        "[data-calendar-pending]": summary.pending,
        "[data-calendar-monthly-water]": formatLiters(summary.plannedWater),
      };
      Object.entries(values).forEach(([selector, value]) => {
        const node = find(selector);
        if (node instanceof HTMLElement) node.textContent = typeof value === "number" ? formatNumber(value) : value;
      });
    }

    function renderGrid(events) {
      grid.replaceChildren();
      model.buildMonthGrid(viewYear, viewMonth).forEach((cell) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "calendar-day";
        if (!cell.inMonth) button.classList.add("calendar-day--outside");
        if (cell.key === selectedDate) button.classList.add("calendar-day--selected");
        const todayKey = toDateKey(new Date());
        if (cell.key === todayKey) button.classList.add("calendar-day--today");
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-selected", String(cell.key === selectedDate));
        if (cell.key === todayKey) button.setAttribute("aria-current", "date");
        const dateText = document.createElement("span");
        dateText.className = "calendar-day-number";
        dateText.textContent = formatNumber(cell.day);
        const dayEvents = events.filter((event) => event.date === cell.key);
        const marks = document.createElement("span");
        marks.className = "calendar-day-markers";
        const uniqueKinds = [...new Set(dayEvents.map((event) => event.statusKind))];
        uniqueKinds.slice(0, 4).forEach((kind) => {
          const dot = document.createElement("i");
          dot.className = `calendar-dot calendar-dot--${kind}`;
          dot.setAttribute("aria-hidden", "true");
          marks.append(dot);
        });
        if (dayEvents.length > 1) {
          const count = document.createElement("span");
          count.className = "calendar-day-count";
          count.textContent = formatNumber(dayEvents.length);
          marks.append(count);
        }
        const eventCountKey = dayEvents.length === 1
          ? "calendar.eventCountSingular"
          : "calendar.eventCountPlural";
        button.setAttribute("aria-label", dayEvents.length
          ? `${formatDate(cell.key)} · ${translate(eventCountKey, { count: formatNumber(dayEvents.length) })}`
          : formatDate(cell.key));
        button.append(dateText, marks);
        button.addEventListener("click", () => {
          if (!cell.inMonth) {
            viewYear = cell.date.getFullYear();
            viewMonth = cell.date.getMonth();
          }
          selectedDate = cell.key;
          render();
        });
        grid.append(button);
      });
    }

    function render() {
      const events = currentEvents();
      renderGrid(events);
      renderDetails(events);
      renderSummary(events);
      window.JalSaathiI18n?.translate(page);
    }

    function changeMonth(delta) {
      const current = new Date(viewYear, viewMonth + delta, 1, 12);
      viewYear = current.getFullYear();
      viewMonth = current.getMonth();
      const lastDay = new Date(viewYear, viewMonth + 1, 0, 12).getDate();
      const selectedDay = Math.min(Number(selectedDate.slice(-2)), lastDay);
      selectedDate = toDateKey(new Date(viewYear, viewMonth, selectedDay, 12));
      render();
    }

    page.querySelector("[data-calendar-prev]")?.addEventListener("click", () => changeMonth(-1));
    page.querySelector("[data-calendar-next]")?.addEventListener("click", () => changeMonth(1));
    page.querySelector("[data-calendar-today]")?.addEventListener("click", () => {
      const currentToday = new Date();
      viewYear = currentToday.getFullYear();
      viewMonth = currentToday.getMonth();
      selectedDate = toDateKey(new Date(currentToday.getFullYear(), currentToday.getMonth(), currentToday.getDate(), 12));
      render();
    });
    fieldSelect.addEventListener("change", () => {
      updateCropOptions();
      render();
    });
    cropSelect.addEventListener("change", render);
    page.querySelector("[data-calendar-retry]")?.addEventListener("click", () => void load());
    window.addEventListener("jalsaathi:language-changed", render);

    async function load() {
      setFeedback("calendar.loading");
      const retry = page.querySelector("[data-calendar-retry]");
      if (retry instanceof HTMLButtonElement) retry.hidden = true;
      try {
        const [fieldRecords, cropRecords, scheduleResponse] = await Promise.all([
          api("/api/fields"),
          api("/api/crops"),
          api("/api/irrigation/schedules"),
        ]);
        if (!Array.isArray(fieldRecords) || !Array.isArray(cropRecords) ||
            !scheduleResponse || !Array.isArray(scheduleResponse.schedules)) {
          throw new Error("The calendar records returned an invalid response.");
        }
        fields = fieldRecords.filter((field) => Number.isInteger(field?.id) && typeof field.name === "string");
        crops = cropRecords.filter((crop) =>
          Number.isInteger(crop?.id) && typeof crop.name === "string" &&
          (crop.field_id === null || Number.isInteger(crop.field_id)),
        );
        schedules = scheduleResponse.schedules.filter((schedule) =>
          schedule && typeof schedule === "object" && Number.isInteger(schedule.field_id),
        );
        const selectedField = fieldSelect.value;
        fieldSelect.replaceChildren();
        appendOption(fieldSelect, "all", translate("calendar.allFields"));
        fields.forEach((field) => appendOption(fieldSelect, field.id, field.name));
        if ([...fieldSelect.options].some((option) => option.value === selectedField)) {
          fieldSelect.value = selectedField;
        }
        updateCropOptions();
        setFeedback("", false);
        render();
      } catch (error) {
        console.error("JalSaathi Calendar could not load farmer records.", error);
        setFeedback("calendar.errorLoad");
        if (retry instanceof HTMLButtonElement) retry.hidden = false;
      }
    }

    void load();
  }

  if (typeof window !== "undefined") window.JalSaathiCalendar = Object.freeze({ initialize });
})();
