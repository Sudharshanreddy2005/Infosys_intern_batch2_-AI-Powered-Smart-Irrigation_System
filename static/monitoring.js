(() => {
  const initialize = () => {
  const fieldSelect = document.getElementById("monitoring-field-select");
  const completedCount = document.getElementById("monitoring-completed-count");
  const waterTotal = document.getElementById("monitoring-water-total");
  const fieldName = document.getElementById("monitoring-field-name");
  const dailyChart = document.getElementById("monitoring-irrigation-chart");
  const statusChart = document.getElementById("monitoring-status-chart");
  const reservoirChart = document.getElementById("monitoring-reservoir-chart");
  const weeklyChart = document.getElementById("monitoring-weekly-chart");
  const weeklyHistory = document.getElementById("monitoring-weekly-history");
  const message = document.getElementById("monitoring-message");
  const exportButton = document.getElementById("monitoring-export-csv");
  const pdfButton = document.getElementById("monitoring-export-pdf");
  const fieldOverview = document.getElementById("monitoring-field-overview");
  const printDetails = document.getElementById("monitoring-print-details");
  const sensorSummary = document.getElementById("monitoring-sensor-summary");
  const sensorCharts = document.getElementById("monitoring-sensor-charts");
  const sensorDeviceStatus = document.getElementById(
    "monitoring-sensor-device-status"
  );
    const sensorReadingForm = document.getElementById(
    "monitoring-sensor-reading-form"
  );
  const sensorReadingStatus = document.getElementById(
    "monitoring-sensor-reading-status"
  );
  const sensorReadingSubmit = document.getElementById(
    "monitoring-sensor-reading-submit"
  );
  const sensorRecordedAt = document.getElementById(
    "monitoring-sensor-recorded-at"
  );
    const sensorReadingMode = document.getElementById(
    "monitoring-reading-mode"
  );
  const sensorManualFields = document.getElementById(
    "monitoring-manual-fields"
  );
  const sensorDemoNotice = document.getElementById(
    "monitoring-demo-notice"
  );

  if (
    !sensorSummary ||
    !sensorCharts ||
    !sensorDeviceStatus ||
    !fieldSelect ||
    !completedCount ||
    !waterTotal ||
    !fieldName ||
    !dailyChart ||
    !statusChart ||
    !reservoirChart ||
    !weeklyChart ||
    !weeklyHistory ||
    !message
  ) {
    return;
  }
  let sensorRange = "7d";
  let sensorRefreshTimer = null;
  let selectedRange = "7d";
  let schedules = [];
  let reservoirs = [];
  let registeredFields = [];

  const COLORS = {
    forest: "#355E3B",
    sage: "#8FAF7A",
    terracotta: "#D97745",
    gold: "#D9A441",
    brown: "#8B6245",
    charcoal: "#344238",
    cream: "#F7F5EC",
  };

  const STATUS_COLORS = {
    completed: COLORS.forest,
    confirmed: COLORS.sage,
    recommended: COLORS.gold,
    cancelled: COLORS.brown,
    insufficient_water: COLORS.terracotta,
  };

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);

  const numberValue = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  const formatLiters = (value) =>
    `${numberValue(value).toLocaleString(undefined, {
      maximumFractionDigits: 1,
    })} L`;

  const parseScheduleDate = (value) => {
    if (typeof value !== "string") return null;

    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return null;

    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3])
    );

    return Number.isNaN(date.getTime()) ? null : date;
  };

  const dateKey = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  };

  const getToday = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };

  const getRangeStart = (range) => {
    const start = getToday();

    if (range === "24h") return start;
    if (range === "30d") start.setDate(start.getDate() - 29);
    else start.setDate(start.getDate() - 6);

    return start;
  };

  const getCompletedInRange = (range) => {
    const start = getRangeStart(range);
    const today = getToday();

    return schedules.filter((item) => {
      if (item.status !== "completed") return false;

      const date = parseScheduleDate(item.scheduled_date);

      return date && date >= start && date <= today;
    });
  };

  const getSelectedFieldName = () => {
    const option = fieldSelect.selectedOptions[0];

    return option && option.value
      ? option.textContent
      : "All fields";
  };
  const exportCsvReport = () => {
  const fieldId = fieldSelect.value;
  const selectedFieldName = getSelectedFieldName();

  if (!fieldId) {
    message.textContent = "Please select a field before exporting.";
    return;
  }

  if (!schedules.length && !reservoirs.length) {
    message.textContent =
      "No irrigation or reservoir records are available to export.";
    return;
  }

  const headers = [
    "Record Type",
    "Field ID",
    "Field Name",
    "Scheduled Date",
    "Start Time",
    "End Time",
    "Scheduled Water (L)",
    "Scheduled Duration (minutes)",
    "Schedule Status",
    "Reservoir Name",
    "Reservoir Capacity (L)",
    "Reservoir Available (L)",
    "Reservoir Reserved (L)",
    "Reservoir Remaining (L)",
  ];

  const rows = [headers];

  schedules.forEach((item) => {
    rows.push([
      "Irrigation Schedule",
      item.field_id ?? fieldId,
      selectedFieldName,
      item.scheduled_date ?? "",
      item.start_time ?? "",
      item.end_time ?? "",
      item.water_liters ?? "",
      item.duration_minutes ?? "",
      item.status ?? "",
      "",
      "",
      "",
      "",
      "",
    ]);
  });

  reservoirs.forEach((item) => {
    rows.push([
      "Reservoir",
      item.field_id ?? fieldId,
      selectedFieldName,
      "",
      "",
      "",
      "",
      "",
      "",
      item.name ?? "",
      item.capacity_liters ?? "",
      item.available_liters ?? "",
      item.reserved_liters ?? "",
      item.remaining_liters ?? "",
    ]);
  });

  const escapeCsvCell = (value) => {
    let text = String(value ?? "");

    // Prevent spreadsheet formula execution from text fields.
    if (/^[\t\r ]*[=+\-@]/.test(text)) {
      text = `'${text}`;
    }

    return `"${text.replace(/"/g, '""')}"`;
  };

  const csvContent =
    "\uFEFF" +
    rows
      .map((row) => row.map(escapeCsvCell).join(","))
      .join("\r\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  const safeFieldName = selectedFieldName
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "");

  link.href = downloadUrl;
  link.download = `field_${safeFieldName || fieldId}_monitoring_report.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(downloadUrl);

  message.textContent =
    `CSV report downloaded for ${selectedFieldName}. ` +
    "Scheduled water quantities are not actual measured consumption.";
};
  const renderSummary = () => {
    const completed = getCompletedInRange(selectedRange);

    const totalLiters = completed.reduce(
      (total, item) => total + numberValue(item.water_liters),
      0
    );

    completedCount.textContent = String(completed.length);
    waterTotal.textContent = formatLiters(totalLiters);
    fieldName.textContent = getSelectedFieldName();
  };
      const renderFieldOverview = () => {
    if (!fieldOverview) return;

    const selectedField = registeredFields.find(
      (field) => String(field.id) === String(fieldSelect.value)
    );

    if (!selectedField) {
      fieldOverview.innerHTML =
        '<p class="monitoring-empty">No field details are available.</p>';
      return;
    }

    const displayValue = (value) => {
      if (value === null || value === undefined || value === "") {
        return "Not available";
      }

      return escapeHtml(value);
    };

    const area =
      selectedField.area === null ||
      selectedField.area === undefined ||
      selectedField.area === ""
        ? "Not available"
        : `${escapeHtml(selectedField.area)} ${escapeHtml(
            selectedField.area_unit || ""
          )}`.trim();

    fieldOverview.innerHTML = `
      <div class="monitoring-field-detail">
        <span class="monitoring-field-label">Field name</span>
        <strong>${displayValue(selectedField.name)}</strong>
      </div>

      <div class="monitoring-field-detail">
        <span class="monitoring-field-label">Crop</span>
        <strong>${displayValue(selectedField.crop)}</strong>
      </div>

      <div class="monitoring-field-detail">
        <span class="monitoring-field-label">Area</span>
        <strong>${area}</strong>
      </div>

      <div class="monitoring-field-detail">
        <span class="monitoring-field-label">Location</span>
        <strong>${displayValue(selectedField.location)}</strong>
      </div>
    `;
  };
    const renderPrintDetails = () => {
    const fieldId = fieldSelect.value;
    const selectedFieldName = getSelectedFieldName();
    const generatedAt = new Date().toLocaleString();
        const selectedField = registeredFields.find(
      (field) => String(field.id) === String(fieldId)
    );

    const fieldArea =
      selectedField &&
      selectedField.area !== null &&
      selectedField.area !== undefined &&
      selectedField.area !== ""
        ? `${selectedField.area} ${selectedField.area_unit || ""}`.trim()
        : null;

    const completed = getCompletedInRange(selectedRange);
    const completedWater = completed.reduce(
      (total, item) => total + numberValue(item.water_liters),
      0
    );

    const displayValue = (value) => {
      if (value === null || value === undefined || value === "") {
        return "Not available";
      }

      return escapeHtml(value);
    };

    const scheduleRows = schedules.length
      ? schedules.map((item) => `
          <tr>
            <td>${displayValue(item.scheduled_date)}</td>
            <td>${displayValue(item.start_time)}</td>
            <td>${displayValue(item.end_time)}</td>
            <td>${displayValue(item.water_liters)}</td>
            <td>${displayValue(item.duration_minutes)}</td>
            <td>${displayValue(item.status)}</td>
          </tr>
        `).join("")
      : `
          <tr>
            <td colspan="6">No irrigation schedule records are available.</td>
          </tr>
        `;

    const reservoirRows = reservoirs.length
      ? reservoirs.map((item) => `
          <tr>
            <td>${displayValue(item.name)}</td>
            <td>${displayValue(item.capacity_liters)}</td>
            <td>${displayValue(item.available_liters)}</td>
            <td>${displayValue(item.reserved_liters)}</td>
            <td>${displayValue(item.remaining_liters)}</td>
          </tr>
        `).join("")
      : `
          <tr>
            <td colspan="5">No reservoir records are available.</td>
          </tr>
        `;

    printDetails.innerHTML = `
      <div class="monitoring-report-heading">
        <h2>Field Monitoring Report</h2>
        <p><strong>Field:</strong> ${escapeHtml(selectedFieldName)}</p>
        <p><strong>Field ID:</strong> ${displayValue(fieldId)}</p>
        <p><strong>Crop:</strong> ${displayValue(selectedField?.crop)}</p>
        <p><strong>Area:</strong> ${displayValue(fieldArea)}</p>
        <p><strong>Location:</strong> ${displayValue(selectedField?.location)}</p>
        <p><strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
        <p><strong>Summary period:</strong> ${escapeHtml(selectedRange)}</p>
      </div>

      <h3>Monitoring Summary</h3>
      <p>Completed irrigation schedules in the selected period:
        <strong>${completed.length}</strong>
      </p>
      <p>Scheduled water quantity associated with those completed schedules:
        <strong>${formatLiters(completedWater)}</strong>
      </p>

      <h3>Irrigation Schedule History</h3>
      <p>Water quantities below are scheduled quantities, not independently measured water consumption.</p>
      <table class="monitoring-report-table">
        <thead>
          <tr>
            <th>Scheduled date</th>
            <th>Start</th>
            <th>End</th>
            <th>Scheduled water (L)</th>
            <th>Duration (minutes)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${scheduleRows}</tbody>
      </table>

      <h3>Reservoir Information</h3>
      <table class="monitoring-report-table">
        <thead>
          <tr>
            <th>Reservoir</th>
            <th>Capacity (L)</th>
            <th>Available (L)</th>
            <th>Reserved (L)</th>
            <th>Remaining (L)</th>
          </tr>
        </thead>
        <tbody>${reservoirRows}</tbody>
      </table>

      <h3>Sensor Data Availability</h3>
      <p>Verified sensor readings are not currently connected to registered fields.
      Soil moisture, temperature and humidity measurements are therefore not included
      as field readings in this report.</p>

      <p class="monitoring-report-disclaimer">
        This report uses the field, irrigation schedule and reservoir records
        available through the current application. Scheduled water is not proof
        of actual water consumption. Crop, area and location are taken from
        the registered field record when available.
      </p>
    `;
  };
  const renderColumnChart = (container, items, valueKey, suffix) => {
    if (!items.length) {
      container.innerHTML =
        '<p class="monitoring-empty">No records are available for this period.</p>';
      return;
    }

    const maxValue = Math.max(
      1,
      ...items.map((item) => numberValue(item[valueKey]))
    );

    container.innerHTML = `
      <div class="monitoring-column-scroll">
        <div class="monitoring-column-chart">
          ${items.map((item) => {
            const value = numberValue(item[valueKey]);
            const height = value > 0
              ? Math.max(3, (value / maxValue) * 100)
              : 0;

            return `
              <div class="monitoring-column">
                <span class="monitoring-column-value">
                  ${escapeHtml(value.toLocaleString())}${escapeHtml(suffix)}
                </span>

                <div class="monitoring-column-track"
                     role="img"
                     aria-label="${escapeHtml(item.label)}: ${escapeHtml(value)}${escapeHtml(suffix)}">
                  <div class="monitoring-column-bar"
                       style="height: ${height}%">
                  </div>
                </div>

                <span class="monitoring-column-label">
                  ${escapeHtml(item.label)}
                </span>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  };

  const renderDailyWaterChart = () => {
    const completed = getCompletedInRange(selectedRange);
    const start = getRangeStart(selectedRange);
    const today = getToday();

    const totals = new Map();

    completed.forEach((item) => {
      const date = parseScheduleDate(item.scheduled_date);
      if (!date) return;

      const key = dateKey(date);
      totals.set(
        key,
        (totals.get(key) || 0) + numberValue(item.water_liters)
      );
    });

    const days = [];
    const cursor = new Date(start);

    while (cursor <= today) {
      const key = dateKey(cursor);

      days.push({
        key,
        label: cursor.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        }),
        liters: totals.get(key) || 0,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    if (!completed.length) {
      dailyChart.innerHTML =
        '<p class="monitoring-empty">No completed irrigation schedules were found in this period.</p>';
      return;
    }

    renderColumnChart(dailyChart, days, "liters", " L");
  };

  const renderDonutChart = (container, items) => {
    const total = items.reduce((sum, item) => sum + item.value, 0);

    if (total <= 0) {
      container.innerHTML =
        '<p class="monitoring-empty">No records are available for this chart.</p>';
      return;
    }

    let currentPercentage = 0;

    const gradient = items
      .filter((item) => item.value > 0)
      .map((item) => {
        const start = currentPercentage;
        currentPercentage += (item.value / total) * 100;

        return `${item.color} ${start}% ${currentPercentage}%`;
      })
      .join(", ");

    const legend = items
      .filter((item) => item.value > 0)
      .map((item) => `
        <div class="monitoring-legend-item">
          <span class="monitoring-legend-dot"
                style="background: ${item.color}">
          </span>

          <span>${escapeHtml(item.label)}</span>

          <strong class="monitoring-legend-value">
            ${escapeHtml(item.display)}
          </strong>
        </div>
      `)
      .join("");

    container.innerHTML = `
      <div class="monitoring-donut-layout">
        <div class="monitoring-donut"
             role="img"
             aria-label="${items.map((item) =>
               `${item.label}: ${item.display}`
             ).join(", ")}"
             style="background: conic-gradient(${gradient})">
          <div class="monitoring-donut-center">
            <strong>${total.toLocaleString()}</strong>
            <span>Total</span>
          </div>
        </div>

        <div class="monitoring-legend">
          ${legend}
        </div>
      </div>
    `;
  };

  const renderStatusChart = () => {
    const statusLabels = {
      completed: "Completed",
      confirmed: "Confirmed",
      recommended: "Recommended",
      cancelled: "Cancelled",
      insufficient_water: "Insufficient water",
    };

    const counts = {};

    schedules.forEach((item) => {
      const status = String(item.status || "unknown").toLowerCase();
      counts[status] = (counts[status] || 0) + 1;
    });

    const items = Object.entries(counts).map(([status, count]) => ({
      label: statusLabels[status] || status.replaceAll("_", " "),
      value: count,
      display: String(count),
      color: STATUS_COLORS[status] || COLORS.charcoal,
    }));

    if (!items.length) {
      statusChart.innerHTML =
        '<p class="monitoring-empty">No irrigation schedules found for this field.</p>';
      return;
    }

    renderDonutChart(statusChart, items);
  };

  const renderReservoirChart = () => {
    if (!reservoirs.length) {
      reservoirChart.innerHTML =
        '<p class="monitoring-empty">No reservoir records are available for this field.</p>';
      return;
    }

    let totalCapacity = 0;
    let totalFree = 0;
    let totalReserved = 0;
    let totalUnused = 0;

    reservoirs.forEach((reservoir) => {
      const capacity = numberValue(reservoir.capacity_liters);
      const available = numberValue(reservoir.available_liters);
      const reserved = Math.min(
        numberValue(reservoir.reserved_liters),
        available,
        capacity
      );

      const free = Math.min(
        Math.max(available - reserved, 0),
        Math.max(capacity - reserved, 0)
      );

      const unused = Math.max(capacity - reserved - free, 0);

      totalCapacity += capacity;
      totalFree += free;
      totalReserved += reserved;
      totalUnused += unused;
    });

    const items = [
      {
        label: "Free water",
        value: totalFree,
        display: formatLiters(totalFree),
        color: COLORS.forest,
      },
      {
        label: "Reserved water",
        value: totalReserved,
        display: formatLiters(totalReserved),
        color: COLORS.terracotta,
      },
      {
        label: "Unused capacity",
        value: totalUnused,
        display: formatLiters(totalUnused),
        color: COLORS.gold,
      },
    ];

    if (totalCapacity <= 0) {
      reservoirChart.innerHTML =
        '<p class="monitoring-empty">Reservoir capacity information is unavailable or zero.</p>';
      return;
    }

    renderDonutChart(reservoirChart, items);

    const reservoirNames = reservoirs.map((reservoir) => `
      <div class="monitoring-reservoir-item">
        <strong class="monitoring-reservoir-name">
          ${escapeHtml(reservoir.name || `Reservoir ${reservoir.id}`)}
        </strong>

        <span class="monitoring-reservoir-meta">
          Capacity: ${escapeHtml(formatLiters(reservoir.capacity_liters))}
          · Available: ${escapeHtml(formatLiters(reservoir.available_liters))}
        </span>
      </div>
    `).join("");

    reservoirChart.insertAdjacentHTML(
      "beforeend",
      `<div class="monitoring-reservoir-list">${reservoirNames}</div>`
    );
  };

  const renderWeeklyChart = () => {
  const completed = getCompletedInRange("7d");
  const start = getRangeStart("7d");
  const today = getToday();

  const counts = new Map();

  completed.forEach((item) => {
    const date = parseScheduleDate(item.scheduled_date);
    if (!date) return;

    const key = dateKey(date);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const days = [];
  const cursor = new Date(start);

  while (cursor <= today) {
    const key = dateKey(cursor);

    days.push({
      key,
      label: cursor.toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
      }),
      count: counts.get(key) || 0,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  if (!completed.length) {
    weeklyChart.innerHTML =
      '<p class="monitoring-empty">No completed irrigation activity was found in the last 7 days.</p>';
    return;
  }

  const width = 640;
  const height = 260;

  const left = 48;
  const right = 20;
  const top = 25;
  const bottom = 205;

  const maxValue = Math.max(1, ...days.map((day) => day.count));
  const chartMax = Math.max(4, Math.ceil(maxValue / 4) * 4);

  const plotWidth = width - left - right;
  const plotHeight = bottom - top;

  const points = days.map((day, index) => {
    const x =
      left +
      (days.length === 1
        ? plotWidth / 2
        : (index / (days.length - 1)) * plotWidth);

    const y = bottom - (day.count / chartMax) * plotHeight;

    return { ...day, x, y };
  });

  const linePath = points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
    )
    .join(" ");

  const areaPath =
    `${linePath} L ${points[points.length - 1].x} ${bottom} ` +
    `L ${points[0].x} ${bottom} Z`;

  const gridLines = [0, 1, 2, 3, 4]
    .map((step) => {
      const y = bottom - (step / 4) * plotHeight;
      const value = Math.round((step / 4) * chartMax);

      return `
        <line
          x1="${left}"
          y1="${y}"
          x2="${width - right}"
          y2="${y}"
          stroke="#E5EBDD"
          stroke-width="1"
        />
        <text
          x="${left - 12}"
          y="${y + 4}"
          text-anchor="end"
          font-size="11"
          fill="#718071"
        >${value}</text>
      `;
    })
    .join("");

  const circles = points
    .map(
      (point) => `
        <circle
          cx="${point.x}"
          cy="${point.y}"
          r="5"
          fill="#FFFFFF"
          stroke="#355E3B"
          stroke-width="3"
        >
          <title>${point.label}: ${point.count} completed schedules</title>
        </circle>
      `
    )
    .join("");

  const labels = points
    .map(
      (point) => `
        <text
          x="${point.x}"
          y="${bottom + 25}"
          text-anchor="middle"
          font-size="11"
          fill="#667466"
        >${point.label}</text>
      `
    )
    .join("");

  weeklyChart.innerHTML = `
    <div class="monitoring-line-chart">
      <svg
        viewBox="0 0 ${width} ${height}"
        role="img"
        aria-label="Completed irrigation schedules over the last seven days"
      >
        <defs>
          <linearGradient
            id="weekly-area-gradient"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stop-color="#8FAF7A" stop-opacity="0.45" />
            <stop offset="100%" stop-color="#8FAF7A" stop-opacity="0.04" />
          </linearGradient>
        </defs>

        ${gridLines}

        <path
          d="${areaPath}"
          fill="url(#weekly-area-gradient)"
        />

        <path
          d="${linePath}"
          fill="none"
          stroke="#355E3B"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />

        ${circles}
        ${labels}
      </svg>
    </div>
    <p class="monitoring-footnote">
      Daily count of completed irrigation schedules, grouped by scheduled date.
    </p>
  `;
};
    const renderWeeklyHistory = () => {
    const start = getRangeStart("7d");
    const today = getToday();

    const weeklySchedules = schedules
      .filter((item) => {
        const date = parseScheduleDate(item.scheduled_date);
        return date && date >= start && date <= today;
      })
      .sort((a, b) => {
        const dateOrder = String(a.scheduled_date || "").localeCompare(
          String(b.scheduled_date || "")
        );

        return dateOrder ||
          String(a.start_time || "").localeCompare(String(b.start_time || ""));
      });

    const completedSchedules = weeklySchedules.filter(
      (item) => String(item.status || "").toLowerCase() === "completed"
    );

    const completedScheduledLiters = completedSchedules.reduce(
      (total, item) => total + numberValue(item.water_liters),
      0
    );

    const averageScheduledLiters = completedSchedules.length
      ? completedScheduledLiters / completedSchedules.length
      : 0;

    const dailyTotals = new Map();

    completedSchedules.forEach((item) => {
      const date = parseScheduleDate(item.scheduled_date);
      if (!date) return;

      const key = dateKey(date);

      dailyTotals.set(
        key,
        (dailyTotals.get(key) || 0) + numberValue(item.water_liters)
      );
    });

    const days = [];
    const cursor = new Date(start);

    while (cursor <= today) {
      const key = dateKey(cursor);

      days.push({
        key,
        label: cursor.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        }),
        liters: dailyTotals.get(key) || 0,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    const formatScheduleDate = (value) => {
      const date = parseScheduleDate(value);

      return date
        ? escapeHtml(
            date.toLocaleDateString(undefined, {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
          )
        : "Not available";
    };

    const displayValue = (value) => {
      if (value === null || value === undefined || value === "") {
        return "Not available";
      }

      return escapeHtml(value);
    };

    const scheduleRows = weeklySchedules.length
      ? weeklySchedules.map((item) => {
          const status = String(item.status || "unknown").replaceAll("_", " ");

          return `
            <tr>
              <td>${formatScheduleDate(item.scheduled_date)}</td>
              <td>${displayValue(item.start_time)}</td>
              <td>${displayValue(item.end_time)}</td>
              <td>${displayValue(item.duration_minutes)}</td>
              <td>${formatLiters(item.water_liters)}</td>
              <td>${escapeHtml(status)}</td>
            </tr>
          `;
        }).join("")
      : `
          <tr>
            <td colspan="6">
              No irrigation schedules were found in the last seven days.
            </td>
          </tr>
        `;

    weeklyHistory.innerHTML = `
      <div class="monitoring-weekly-summary">
        <div class="monitoring-weekly-stat">
          <span class="monitoring-field-label">Total schedules</span>
          <strong>${weeklySchedules.length}</strong>
        </div>

        <div class="monitoring-weekly-stat">
          <span class="monitoring-field-label">Completed schedules</span>
          <strong>${completedSchedules.length}</strong>
        </div>

        <div class="monitoring-weekly-stat">
          <span class="monitoring-field-label">Completed scheduled water</span>
          <strong>${formatLiters(completedScheduledLiters)}</strong>
        </div>

        <div class="monitoring-weekly-stat">
          <span class="monitoring-field-label">Average per completed schedule</span>
          <strong>${formatLiters(averageScheduledLiters)}</strong>
        </div>
      </div>

      <h4>Daily scheduled water for completed schedules</h4>

      <div
        id="monitoring-weekly-water-chart"
        class="monitoring-chart"
        aria-live="polite"
      ></div>

      <p class="monitoring-footnote">
        Water quantities represent scheduled amounts associated with completed
        schedules. They are not independently measured water consumption.
      </p>

      <h4>Schedule history</h4>

      <div class="monitoring-history-table-wrap">
        <table class="monitoring-history-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Start</th>
              <th>End</th>
              <th>Duration (min)</th>
              <th>Scheduled water (L)</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${scheduleRows}</tbody>
        </table>
      </div>
    `;

    const weeklyWaterChart = weeklyHistory.querySelector(
      "#monitoring-weekly-water-chart"
    );

    if (completedSchedules.length) {
      renderColumnChart(weeklyWaterChart, days, "liters", " L");
    } else {
      weeklyWaterChart.innerHTML =
        '<p class="monitoring-empty">No completed scheduled water quantities were found in the last seven days.</p>';
    }
  };

  const renderAllCharts = () => {
    renderSummary();
    renderDailyWaterChart();
    renderStatusChart();
    renderReservoirChart();
    renderWeeklyChart();
    renderWeeklyHistory();
  };

  const requestJson = async (url) => {
    const response = await fetch(url, {
      credentials: "same-origin",
    });



    if (response.status === 401) {
      window.location.replace("/static/auth.html?view=login");
      throw new Error("Your session has expired. Please log in again.");
    }

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}.`);
    }

    return response.json();
  };


  const sensorMetrics = [
    {
      label: "Soil moisture",
      key: "soil_moisture_percent",
      unit: "%",
      decimals: 1,
      color: "#355E3B",
    },
    {
      label: "Soil temperature",
      key: "soil_temperature_c",
      unit: "°C",
      decimals: 1,
      color: "#D97745",
    },
    {
      label: "Humidity",
      key: "humidity_percent",
      unit: "%",
      decimals: 1,
      color: "#5687A8",
    },
    {
      label: "Soil pH",
      key: "ph",
      unit: "pH",
      decimals: 2,
      color: "#8B6245",
    },
    {
      label: "Electrical conductivity",
      key: "electrical_conductivity_us_cm",
      unit: "µS/cm",
      decimals: 1,
      color: "#A17B32",
    },
  ];

  const formatSensorValue = (value, unit, decimals = 1) => {
    if (value === null || value === undefined || value === "") {
      return "Not available";
    }

    const number = Number(value);

    return Number.isFinite(number)
      ? `${number.toFixed(decimals)} ${unit}`
      : "Not available";
  };

  const formatSensorTime = (value) => {
    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? "Time unavailable"
      : date.toLocaleString();
  };

  const renderSensorLineChart = (readings, metric) => {
    const valid = readings
      .map((reading) => ({
        timestamp: reading.recorded_at,
        value: Number(reading[metric.key]),
      }))
      .filter((point) =>
        Number.isFinite(point.value) &&
        !Number.isNaN(new Date(point.timestamp).getTime())
      );

    if (!valid.length) return "";

    const maximumPoints = 80;
    const sampled = valid.length <= maximumPoints
      ? valid
      : Array.from({ length: maximumPoints }, (_, index) =>
          valid[
            Math.round(
              index * (valid.length - 1) / (maximumPoints - 1)
            )
          ]
        );

    const minValue = Math.min(...valid.map((point) => point.value));
    const maxValue = Math.max(...valid.map((point) => point.value));
    const spread =
      maxValue - minValue || Math.max(1, Math.abs(maxValue) * 0.1);

    const lower = minValue - spread * 0.08;
    const upper = maxValue + spread * 0.08;

    const xPosition = (index) =>
      48 + index * (640 / Math.max(sampled.length - 1, 1));

    const yPosition = (value) =>
      20 + ((upper - value) / (upper - lower)) * 112;

    const coordinates = sampled
      .map(
        (point, index) =>
          `${xPosition(index)},${yPosition(point.value)}`
      )
      .join(" ");

    const circles = sampled
      .map(
        (point, index) =>
          `<circle cx="${xPosition(index)}"
            cy="${yPosition(point.value)}"
            r="3" fill="${metric.color}" />`
      )
      .join("");

    const firstTime = formatSensorTime(sampled[0].timestamp);
    const lastTime = formatSensorTime(
      sampled[sampled.length - 1].timestamp
    );

    return `
      <article class="monitoring-sensor-chart-card">
        <h4>${escapeHtml(metric.label)}</h4>
        <svg viewBox="0 0 720 180" role="img"
          aria-label="${escapeHtml(metric.label)} timeline chart">
          <line x1="44" y1="132" x2="696" y2="132"
            stroke="#d9e1d5" stroke-width="1" />
          <polyline points="${coordinates}"
            fill="none" stroke="${metric.color}"
            stroke-width="3" stroke-linejoin="round"
            stroke-linecap="round" />
          ${circles}
          <text x="44" y="14" class="monitoring-sensor-axis-label">
            ${maxValue.toFixed(metric.decimals)} ${metric.unit}
          </text>
          <text x="44" y="148" class="monitoring-sensor-axis-label">
            ${minValue.toFixed(metric.decimals)} ${metric.unit}
          </text>
          <text x="44" y="169" class="monitoring-sensor-axis-label">
            ${escapeHtml(firstTime)}
          </text>
          <text x="696" y="169" text-anchor="end"
            class="monitoring-sensor-axis-label">
            ${escapeHtml(lastTime)}
          </text>
        </svg>
        <p class="monitoring-muted">${valid.length} recorded values</p>
      </article>
    `;
  };

  const loadSensorDeviceStatus = async (fieldId) => {
    if (!fieldId) {
      sensorDeviceStatus.innerHTML =
        '<p class="monitoring-empty">Select a field to check its sensor device.</p>';
      return;
    }

    try {
      const devices = await requestJson(
        `/api/fields/${encodeURIComponent(fieldId)}/sensor-devices`
      );

      if (!Array.isArray(devices)) {
        throw new Error("Unexpected device API response.");
      }

      const device =
        devices.find((item) => item.is_active) || devices[0];

      if (!device) {
        sensorDeviceStatus.innerHTML = `
          <div class="monitoring-device-card">
            <strong>Sensor not registered</strong>
            <span>No sensor device is registered for this field.</span>
          </div>
        `;
        return;
      }

      if (!device.is_active) {
        sensorDeviceStatus.innerHTML = `
          <div class="monitoring-device-card">
            <strong>Device revoked</strong>
            <span>${escapeHtml(device.name)}</span>
          </div>
        `;
        return;
      }

      if (!device.last_seen_at) {
        sensorDeviceStatus.innerHTML = `
          <div class="monitoring-device-card">
            <strong>Registered · Awaiting first reading</strong>
            <span>${escapeHtml(device.name)}</span>
          </div>
        `;
        return;
      }

      const lastSeen = new Date(device.last_seen_at);

      if (Number.isNaN(lastSeen.getTime())) {
        throw new Error("Invalid device communication timestamp.");
      }

      const age = Date.now() - lastSeen.getTime();
      const recentlyReporting = age <= 5 * 60 * 1000;

      const status = recentlyReporting
        ? "Recently reporting"
        : "No recent readings";

      sensorDeviceStatus.innerHTML = `
        <div class="monitoring-device-card">
          <strong>${status}</strong>
          <span>Device: ${escapeHtml(device.name)}</span>
          <span>Device ID: ${escapeHtml(device.device_id)}</span>
          <span>Last communication: ${escapeHtml(formatSensorTime(device.last_seen_at))}</span>
        </div>
      `;
    } catch (error) {
      sensorDeviceStatus.innerHTML =
        '<p class="monitoring-empty monitoring-error">Device status unavailable.</p>';
    }
  };

  const loadSensorReadings = async () => {
    const fieldId = fieldSelect.value;
    await loadSensorDeviceStatus(fieldId);

    if (!fieldId) {
      sensorSummary.innerHTML =
        '<p class="monitoring-empty">Select a field to view sensor readings.</p>';
      sensorCharts.innerHTML = "";
      return;
    }

    sensorSummary.innerHTML =
      '<p class="monitoring-empty">Loading sensor readings...</p>';
    sensorCharts.innerHTML = "";

    const duration = sensorRange === "24h"
      ? 24 * 60 * 60 * 1000
      : sensorRange === "30d"
        ? 30 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;

    const end = new Date();
    const start = new Date(end.getTime() - duration);

    const query =
      `?start_at=${encodeURIComponent(start.toISOString())}` +
      `&end_at=${encodeURIComponent(end.toISOString())}` +
      "&limit=5000";

    const readings = await requestJson(
      `/api/fields/${encodeURIComponent(fieldId)}/sensor-readings${query}`
    );

    if (fieldSelect.value !== fieldId) return;

    if (!Array.isArray(readings)) {
      throw new Error("Unexpected sensor API response.");
    }

    const chronological = [...readings].reverse();

    if (!readings.length) {
      sensorSummary.innerHTML = `
        <p class="monitoring-empty">
          No sensor readings are available for this field
          in the selected ${sensorRange} period.
        </p>
      `;
      sensorCharts.innerHTML = "";
      return;
    }

    const latest = readings[0];

    const summaryCards = [
      {
        label: "Most recent recorded reading",
        value: formatSensorTime(latest.recorded_at),
      },
      ...sensorMetrics.map((metric) => ({
        label: metric.label,
        value: formatSensorValue(
          latest[metric.key],
          metric.unit,
          metric.decimals
        ),
      })),
    ];

    sensorSummary.innerHTML = summaryCards
      .map(
        (item) => `
          <div class="monitoring-sensor-metric">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
          </div>
        `
      )
      .join("");

    const charts = sensorMetrics
      .map((metric) => renderSensorLineChart(chronological, metric))
      .filter(Boolean);

    sensorCharts.innerHTML = charts.length
      ? charts.join("")
      : '<p class="monitoring-empty">No usable measurement values are available for charts.</p>';
  };

      const setSensorRecordedAtDefault = () => {
    if (!sensorRecordedAt) return;

    const now = new Date();
    const localDateTime = new Date(
      now.getTime() - now.getTimezoneOffset() * 60000
    ).toISOString().slice(0, 16);

    sensorRecordedAt.value = localDateTime;
  };

  const optionalSensorNumber = (formData, name) => {
    const value = String(formData.get(name) ?? "").trim();

    if (!value) return null;

    const number = Number(value);

    if (!Number.isFinite(number)) {
      throw new Error(`Please enter a valid value for ${name}.`);
    }

    return number;
  };

    const updateSensorReadingMode = () => {
    if (
      !sensorReadingMode ||
      !sensorManualFields ||
      !sensorDemoNotice
    ) return;

    const automatic = sensorReadingMode.value === "automatic";

    sensorManualFields.hidden = automatic;
    sensorDemoNotice.hidden = !automatic;

    sensorManualFields
      .querySelectorAll("input")
      .forEach((input) => {
        input.required =
          !automatic && input.name === "soil_moisture_percent";
      });

    if (sensorReadingSubmit) {
      sensorReadingSubmit.textContent = automatic
        ? "Generate & Save Demo Reading"
        : "Save Sensor Reading";
    }
  };

  if (sensorReadingMode) {
    sensorReadingMode.addEventListener(
      "change",
      updateSensorReadingMode
    );
    updateSensorReadingMode();
  }

  const generateDemoSensorReading = (field) => {
    const location = String(field?.location || "Unknown location")
      .trim()
      .toLowerCase();

    let seed = 0;

    for (let index = 0; index < location.length; index += 1) {
      seed = (seed * 31 + location.charCodeAt(index)) >>> 0;
    }

    seed = (seed ^ Date.now()) >>> 0;

    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const between = (min, max, decimals = 1) =>
      Number((min + random() * (max - min)).toFixed(decimals));

    return {
      soil_moisture_percent: between(25, 65),
      soil_temperature_c: between(22, 36),
      humidity_percent: between(40, 85),
      ph: between(5.5, 7.5, 2),
      electrical_conductivity_us_cm: between(150, 1200),
      recorded_at: new Date().toISOString(),
    };
  };

  if (
    sensorReadingForm &&
    sensorReadingStatus &&
    sensorReadingSubmit &&
    sensorRecordedAt
  ) {
    setSensorRecordedAtDefault();

    sensorReadingForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const fieldId = fieldSelect.value;

      if (!fieldId) {
        sensorReadingStatus.textContent =
          "Please select a field before saving a reading.";
        sensorReadingStatus.classList.add("monitoring-error");
        return;
      }

      if (!sensorReadingForm.reportValidity()) return;

            try {
        const selectedField = registeredFields.find(
          (field) => String(field.id) === String(fieldId)
        );

        const automatic =
          sensorReadingMode?.value === "automatic";

        let payload;

        if (automatic) {
          payload = generateDemoSensorReading(selectedField);
        } else {
          const formData = new FormData(sensorReadingForm);

          const moisture = Number(
            formData.get("soil_moisture_percent")
          );

          const recordedAt = new Date(
            String(formData.get("recorded_at"))
          );

          if (
            !Number.isFinite(moisture) ||
            moisture < 0 ||
            moisture > 100
          ) {
            throw new Error(
              "Soil moisture must be between 0 and 100%."
            );
          }

          if (Number.isNaN(recordedAt.getTime())) {
            throw new Error(
              "Please enter a valid measurement date and time."
            );
          }

          payload = {
            soil_moisture_percent: moisture,
            soil_temperature_c: optionalSensorNumber(
              formData,
              "soil_temperature_c"
            ),
            humidity_percent: optionalSensorNumber(
              formData,
              "humidity_percent"
            ),
            ph: optionalSensorNumber(formData, "ph"),
            electrical_conductivity_us_cm: optionalSensorNumber(
              formData,
              "electrical_conductivity_us_cm"
            ),
            recorded_at: recordedAt.toISOString(),
          };
        }

        sensorReadingSubmit.disabled = true;
        sensorReadingStatus.classList.remove("monitoring-error");
        sensorReadingStatus.textContent = "Saving sensor reading...";

        const selectedFieldName =
          selectedField?.name || `Field ${fieldId}`;

        await window.JalSaathiProfile.apiRequest(
          `/api/fields/${encodeURIComponent(fieldId)}/sensor-readings`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          }
        );

        sensorReadingForm.reset();
        setSensorRecordedAtDefault();
        updateSensorReadingMode();

        sensorReadingStatus.textContent = automatic
          ? `Simulated demo reading saved successfully for ${selectedFieldName}.`
          : `Manual sensor reading saved successfully for ${selectedFieldName}.`;

        if (fieldSelect.value === fieldId) {
          try {
            await loadSensorReadings();
          } catch (refreshError) {
            sensorReadingStatus.textContent =
              `Reading saved, but the timeline could not refresh: ${
                refreshError.message || "Please refresh the page."
              }`;
          }
        }
      } catch (error) {
        sensorReadingStatus.textContent =
          error.message || "The sensor reading could not be saved.";
        sensorReadingStatus.classList.add("monitoring-error");
      } finally {
        sensorReadingSubmit.disabled = !fieldSelect.value;
      }
    });
  }

  const loadSchedules = async () => {
    const fieldId = fieldSelect.value;
    const query = fieldId
      ? `?field_id=${encodeURIComponent(fieldId)}`
      : "";

    const result = await requestJson(
      `/api/irrigation/schedules${query}`
    );

    if (!result || !Array.isArray(result.schedules)) {
      throw new Error("The irrigation API returned an unexpected response.");
    }

    schedules = result.schedules;
  };

  const loadReservoirs = async () => {
    const fieldId = fieldSelect.value;
    const query = fieldId
      ? `?field_id=${encodeURIComponent(fieldId)}`
      : "";

    const result = await requestJson(
      `/api/irrigation/reservoirs${query}`
    );

    if (Array.isArray(result)) {
      reservoirs = result;
    } else if (result && Array.isArray(result.reservoirs)) {
      reservoirs = result.reservoirs;
    } else {
      throw new Error("The reservoir API returned an unexpected response.");
    }
  };

  const loadMonitoringData = async () => {
    message.textContent =
      "Loading irrigation schedules and reservoir information...";

    const results = await Promise.allSettled([
  loadSchedules(),
  loadReservoirs(),
  loadSensorReadings(),
]);
    const sensorError = results[2].status === "rejected";

    if (sensorError) {
      sensorSummary.innerHTML =
        '<p class="monitoring-empty monitoring-error">Unable to load sensor readings.</p>';
      sensorCharts.innerHTML = "";
    }
    const scheduleError = results[0].status === "rejected";
    const reservoirError = results[1].status === "rejected";

    if (scheduleError) {
      schedules = [];

      completedCount.textContent = "—";
      waterTotal.textContent = "—";

      dailyChart.innerHTML =
        '<p class="monitoring-empty monitoring-error">Unable to load irrigation history.</p>';

      statusChart.innerHTML =
        '<p class="monitoring-empty monitoring-error">Unable to load schedule status.</p>';

      weeklyChart.innerHTML =
        '<p class="monitoring-empty monitoring-error">Unable to load weekly activity.</p>';
            weeklyHistory.innerHTML =
        '<p class="monitoring-empty monitoring-error">Unable to load weekly irrigation history.</p>';
    }

    if (reservoirError) {
      reservoirs = [];

      reservoirChart.innerHTML =
        '<p class="monitoring-empty monitoring-error">Unable to load reservoir information.</p>';
    }

    if (!scheduleError && !reservoirError) {
      renderAllCharts();

      message.textContent =
        "Monitoring information loaded from your authenticated field records.";
    } else if (!scheduleError) {
      renderSummary();
      renderDailyWaterChart();
      renderStatusChart();
      renderWeeklyChart();
      renderWeeklyHistory();

      message.textContent =
        "Irrigation history loaded, but reservoir information is unavailable.";
    } else if (!reservoirError) {
      renderReservoirChart();

      message.textContent =
        "Reservoir information loaded, but irrigation history is unavailable.";
    } else {
      message.textContent =
        "Irrigation and reservoir information could not be loaded.";
    }
  };

  const loadFields = async () => {
    try {
      const fields = await requestJson("/api/fields");

      if (!Array.isArray(fields)) {
        throw new Error("The fields API returned an unexpected response.");
      }
        registeredFields = fields;
      fieldSelect.innerHTML = "";

      if (!fields.length) {
        fieldSelect.innerHTML =
          '<option value="">No saved fields</option>';

        fieldSelect.disabled = true;
        fieldName.textContent = "No fields";
        renderFieldOverview();
        await loadMonitoringData();
        return;
      }

      fields.forEach((field) => {
        const option = document.createElement("option");
        option.value = String(field.id);
        option.textContent = field.name || `Field ${field.id}`;
        fieldSelect.append(option);
      });

      fieldSelect.disabled = false;

      if (sensorReadingSubmit) {
        sensorReadingSubmit.disabled = !fieldSelect.value;
      }

      renderFieldOverview();
      await loadMonitoringData();
    } catch (error) {
      fieldSelect.innerHTML =
        '<option value="">Fields unavailable</option>';

      fieldSelect.disabled = true;
      registeredFields = [];
      renderFieldOverview();
      dailyChart.innerHTML =
        '<p class="monitoring-empty monitoring-error">Unable to load your fields.</p>';

      message.textContent =
        error.message || "Field information is unavailable.";
    }
  };
  if (exportButton) {
  exportButton.addEventListener("click", exportCsvReport);
}
  if (pdfButton && printDetails) {
  pdfButton.addEventListener("click", () => {
    if (!fieldSelect.value) {
      message.textContent = "Please select a field before exporting.";
      return;
    }

    renderPrintDetails();
    window.print();
  });
}
  fieldSelect.addEventListener("change", () => {
    if (sensorReadingSubmit) {
      sensorReadingSubmit.disabled = !fieldSelect.value;
    }

    renderFieldOverview();
    loadMonitoringData();
  });
  document.querySelectorAll("[data-irrigation-range]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedRange = button.dataset.irrigationRange;

      document.querySelectorAll("[data-irrigation-range]").forEach((item) => {
        item.setAttribute(
          "aria-pressed",
          String(item === button)
        );
      });

      renderSummary();
      renderDailyWaterChart();
    });
  });


  document.querySelectorAll("[data-monitoring-range]").forEach((button) => {
    button.addEventListener("click", () => {
      sensorRange = button.dataset.monitoringRange;

      document.querySelectorAll("[data-monitoring-range]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });

      loadSensorReadings().catch((error) => {
        sensorSummary.innerHTML =
          '<p class="monitoring-empty monitoring-error">Unable to load sensor readings.</p>';
        sensorCharts.innerHTML = "";
        message.textContent =
          error.message || "Sensor readings are unavailable.";
      });
    });
  });

  loadFields();

if (sensorRefreshTimer !== null) {
  clearInterval(sensorRefreshTimer);
}

sensorRefreshTimer = window.setInterval(() => {
  if (
    document.visibilityState === "visible" &&
    fieldSelect.value
  ) {
    loadSensorReadings().catch((error) => {
      console.error("Automatic sensor refresh failed:", error);
    });
  }
}, 30000);
  };

  window.JalSaathiMonitoring = { initialize };

  // Preserve initialization on the existing dashboard
  // until the monitoring section is moved.
  if (document.getElementById("monitoring-field-select")) {
    initialize();
  }
})();