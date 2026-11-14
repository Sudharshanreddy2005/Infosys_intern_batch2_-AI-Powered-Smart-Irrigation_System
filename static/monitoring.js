(function () {
  "use strict";

  const metrics = [
    { key: "soilMoisture", label: "Soil moisture", unit: "%", value: 42 },
    { key: "temperature", label: "Temperature", unit: "°C", value: 28 },
    { key: "humidity", label: "Humidity", unit: "%", value: 61 },
    { key: "rainfall", label: "Rainfall", unit: "mm", value: null },
  ];

  const latestSensorReading = {};
  for (const metric of metrics) {
    latestSensorReading[metric.key] = metric.value;
  }

  const formatNumber = (value) => window.JalSaathiI18n?.formatNumber
    ? window.JalSaathiI18n.formatNumber(value)
    : String(value);
  const numberMarkup = (value, unit) => window.JalSaathiI18n?.numberMarkup
    ? unit === "°C"
      ? String(window.JalSaathiI18n.formatTemperature(value)).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character])
      : window.JalSaathiI18n.numberMarkup(value, {}, unit)
    : `${formatNumber(value)}${unit}`;
  const formatSensorValue = (metric) => {
    const value = latestSensorReading[metric.key];
    if (value === null || value === undefined || Number.isNaN(value)) {
      return `${metric.label}: "Not available"`;
    }

    const formattedValue = metric.unit === "°C" && window.JalSaathiI18n?.formatTemperature
      ? window.JalSaathiI18n.formatTemperature(value)
      : `${formatNumber(value)}${metric.unit}`;
    return `${metric.label}: ${formattedValue}`;
  };

  const renderCards = () => {
    const grid = document.getElementById("metric-grid");
    if (!grid) return;

    grid.innerHTML = metrics
      .map((metric) => {
        const sensorValue = latestSensorReading[metric.key];
        const displayValue = sensorValue === null || sensorValue === undefined || Number.isNaN(sensorValue)
          ? "Not available"
          : numberMarkup(sensorValue, metric.unit);

        return `
          <article class="metric-card" data-metric="${metric.key}">
            <h2>${metric.label}</h2>
            <div class="metric-value">${displayValue}</div>
            <div class="meta">Latest Recorded Sensor Reading</div>
          </article>
        `;
      })
      .join("");

    const summary = document.getElementById("monitoring-summary");
    if (summary) {
      summary.textContent = metrics.map((metric) => formatSensorValue(metric)).join(" | ");
    }
  };

  const exportCsv = () => {
    const rows = [
      ["Metric", "Value", "Unit"],
      ...metrics.map((metric) => [metric.label, latestSensorReading[metric.key] ?? "Not available", metric.unit]),
    ];

    const csvContent = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "field-monitoring-report.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  };

  const printReport = () => {
    if (typeof window.print === "function") {
      window.print();
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    renderCards();

    const downloadButton = document.getElementById("download-report");
    if (downloadButton) {
      downloadButton.addEventListener("click", exportCsv);
    }

    const printButton = document.getElementById("print-report");
    if (printButton) {
      printButton.addEventListener("click", printReport);
    }

    const status = document.getElementById("monitoring-summary");
    if (status) {
      status.textContent = "Sensor reading saved successfully";
    }
  });

  window.JalSaathiMonitoring = Object.freeze({
    metrics,
    latestSensorReading,
    exportCsv,
    printReport,
  });
})();
