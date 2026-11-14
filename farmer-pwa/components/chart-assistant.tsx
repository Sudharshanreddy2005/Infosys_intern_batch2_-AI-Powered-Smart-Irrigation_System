"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { askChartAssistant } from "@/lib/api";
import { useI18n, languageOptions, type TranslationSource } from "@/components/i18n-provider";
import type {
  ApiError,
  AssistantHistoryEntry,
  ChartAssistantContext,
  ChartAssistantForecastPoint,
  ChartAssistantRequest,
  ChartPeriod,
  FarmSnapshot,
} from "@/lib/types";

type Message = AssistantHistoryEntry & { context?: ChartAssistantContext };

const HISTORY_LIMIT = 12;

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function historyStorageKey(accountId: number): string {
  return `jalsaathi.chart-assistant.v1.${accountId}`;
}

function restoreHistory(accountId: number): Message[] {
  try {
    const raw = window.sessionStorage.getItem(historyStorageKey(accountId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Stored Chart Assistant history is not a list.");
    return parsed.flatMap((item): Message[] => {
      if (!item || typeof item !== "object" || !("role" in item) || !("content" in item) ||
          (item.role !== "user" && item.role !== "assistant") ||
          typeof item.content !== "string" || !item.content.trim()) return [];
      return [{ role: item.role, content: item.content }];
    }).slice(-HISTORY_LIMIT);
  } catch (error) {
    console.error("JalSaathi Chart Assistant history could not be restored:", error);
    return [];
  }
}

function assistantErrorMessage(error: unknown): TranslationSource {
  const status = (error as ApiError)?.status;
  if (status === 401) return "Your session has expired. Sign in again to reload your farm.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (typeof status === "number" && status >= 500) return "The service is temporarily unavailable. Try again later.";
  return "Chart Assistant could not respond. Please check your connection and try again.";
}

export function ChartAssistantDialog({
  open,
  onClose,
  data,
  online,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  data: FarmSnapshot;
  online: boolean;
}>) {
  const { language, t, formatDateTime, formatNumber, formatTemperature } = useI18n();
  const [fieldValue, setFieldValue] = useState("all");
  const [cropValue, setCropValue] = useState("all");
  const [period, setPeriod] = useState<ChartPeriod>("7d");
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 6);
    return localDateKey(date);
  });
  const [endDate, setEndDate] = useState(() => localDateKey(new Date()));
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyAccount, setHistoryAccount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<TranslationSource | "">("");
  const questionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setHistoryAccount(null);
    setMessages(restoreHistory(data.profile.id));
    setHistoryAccount(data.profile.id);
  }, [data.profile.id]);

  useEffect(() => {
    if (historyAccount !== data.profile.id) return;
    try {
      const saved = messages.map(({ role, content }) => ({ role, content }));
      window.sessionStorage.setItem(historyStorageKey(data.profile.id), JSON.stringify(saved));
    } catch (error) {
      console.error("JalSaathi Chart Assistant history could not be saved:", error);
    }
  }, [data.profile.id, historyAccount, messages]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    window.setTimeout(() => questionRef.current?.focus(), 0);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  const selectedFieldId = fieldValue === "all" ? null : Number(fieldValue);
  const availableCrops = useMemo(
    () => data.crops.filter((crop) => selectedFieldId === null || crop.field_id === selectedFieldId),
    [data.crops, selectedFieldId],
  );
  const rangeInvalid = period === "custom" &&
    (!selectedFieldId || !startDate || !endDate || endDate < startDate);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedQuestion = question.trim();
    if (!submittedQuestion || busy) return;
    if (!online) {
      setErrorMessage("The assistant is unavailable offline.");
      return;
    }
    if (rangeInvalid) return;

    setErrorMessage("");
    setQuestion("");
    setBusy(true);
    const userMessage: Message = { role: "user", content: submittedQuestion };
    setMessages((current) => [
      ...current,
      userMessage,
    ].slice(-HISTORY_LIMIT));

    const languageCode = languageOptions.find((option) => option.code === language)?.locale ?? "en-IN";
    const payload: ChartAssistantRequest = {
      assistant_mode: "chart",
      question: submittedQuestion,
      language_code: languageCode,
      field_id: selectedFieldId,
      crop_id: cropValue === "all" ? null : Number(cropValue),
      chart_period: period,
      history: messages.slice(-6).map(({ role, content }) => ({ role, content })),
      ...(period === "custom" ? { start_date: startDate, end_date: endDate } : {}),
    };

    try {
      const result = await askChartAssistant(payload);
      const assistantMessage: Message = {
        role: "assistant",
        content: result.answer,
        context: result.context,
      };
      setMessages((current) => [
        ...current,
        assistantMessage,
      ].slice(-HISTORY_LIMIT));
    } catch (error) {
      setErrorMessage(assistantErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function clearConversation() {
    setMessages([]);
    setErrorMessage("");
    try {
      window.sessionStorage.removeItem(historyStorageKey(data.profile.id));
    } catch (error) {
      console.error("JalSaathi Chart Assistant history could not be cleared:", error);
    }
  }

  if (!open) return null;

  return (
    <div
      className="chart-assistant-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="chart-assistant-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chart-assistant-title"
      >
        <header className="chart-assistant-heading">
          <div>
            <p className="eyebrow">{t("FARM SUPPORT")}</p>
            <h2 id="chart-assistant-title">{t("Chart Assistant")}</h2>
            <p className="muted">{t("Ask about your fields, irrigation schedules, or weather charts.")}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={t("Close")}>×</button>
        </header>

        <div className="chart-assistant-controls">
          <label className="form-field">
            {t("Select a field")}
            <select
              className="form-input"
              value={fieldValue}
              onChange={(event) => {
                setFieldValue(event.target.value);
                setCropValue("all");
              }}
              disabled={!online || busy}
            >
              <option value="all">{t("All fields")}</option>
              {data.fields.map((field) => (
                <option key={field.id} value={field.id}>{field.name}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            {t("Select a crop")}
            <select
              className="form-input"
              value={cropValue}
              onChange={(event) => {
                const nextCrop = data.crops.find((crop) => crop.id === Number(event.target.value));
                setCropValue(event.target.value);
                if (nextCrop?.field_id) setFieldValue(String(nextCrop.field_id));
              }}
              disabled={!online || busy}
            >
              <option value="all">{t("All crops")}</option>
              {availableCrops.map((crop) => (
                <option key={crop.id} value={crop.id}>{crop.name}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            {t("Chart period")}
            <select
              className="form-input"
              value={period}
              onChange={(event) => setPeriod(event.target.value as ChartPeriod)}
              disabled={!online || busy}
            >
              <option value="24h">{t("24 hours")}</option>
              <option value="7d">{t("7 days")}</option>
              <option value="30d">{t("30 days")}</option>
              <option value="custom">{t("Custom dates")}</option>
            </select>
          </label>
          {period === "custom" && (
            <div className="chart-date-range">
              <label className="form-field">
                {t("Start date")}
                <input className="form-input" type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} disabled={!online || busy} />
              </label>
              <label className="form-field">
                {t("End date")}
                <input className="form-input" type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} disabled={!online || busy} />
              </label>
              {rangeInvalid && <p className="form-field-error" role="alert">{t("Custom dates require a selected field and a valid range of 30 days or less.")}</p>}
            </div>
          )}
        </div>

        <div className="chart-assistant-thread" aria-live="polite" aria-relevant="additions text">
          {messages.length === 0 && (
            <p className="chart-assistant-welcome">{t("Your saved farm data will be used to answer. Missing readings will be identified, not estimated.")}</p>
          )}
          {messages.map((message, index) => (
            <article className={`chart-assistant-message ${message.role}`} key={`${index}-${message.role}`}>
              <p>{message.content}</p>
              {message.context && (
                <ChartVisualizations
                  context={message.context}
                  t={t}
                  formatDateTime={formatDateTime}
                  formatNumber={formatNumber}
                  formatTemperature={formatTemperature}
                />
              )}
            </article>
          ))}
          {busy && <p className="chart-assistant-loading" role="status">{t("Chart Assistant is thinking…")}</p>}
        </div>

        {errorMessage && <p className="notice notice-error" role="alert">{t(errorMessage)}</p>}
        {!online && <p className="offline-hint">{t("The assistant is unavailable offline.")}</p>}

        <form className="chart-assistant-form" onSubmit={(event) => void submit(event)}>
          <label className="sr-only" htmlFor="chart-assistant-question">{t("Enter your question")}</label>
          <textarea
            id="chart-assistant-question"
            ref={questionRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t("Enter your question")}
            maxLength={1500}
            rows={2}
            required
            disabled={!online || busy}
          />
          <div className="chart-assistant-form-actions">
            <button className="text-button" type="button" onClick={clearConversation} disabled={busy || messages.length === 0}>
              {t("New conversation")}
            </button>
            <button className="primary-button" type="submit" disabled={!online || busy || !question.trim() || rangeInvalid}>
              {busy ? t("Sending…") : t("Send message")}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ChartVisualizations({
  context,
  t,
  formatDateTime,
  formatNumber,
  formatTemperature,
}: {
  context: ChartAssistantContext;
  t: (source: TranslationSource) => string;
  formatDateTime: (value: string | Date) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatTemperature: (value: number | null | undefined) => string;
}) {
  const points = context.weather_forecast.status === "available" ? context.weather_forecast.data : [];
  const forecastMetrics: { key: keyof ChartAssistantForecastPoint; label: TranslationSource; unit: string }[] = [
    { key: "temperature_c", label: "Temperature", unit: "°C" },
    { key: "humidity_percent", label: "Humidity", unit: "%" },
    { key: "rainfall_mm_per_hr", label: "Rainfall", unit: "mm/h" },
  ];
  const charts = forecastMetrics.flatMap((metric) => {
    const values = points
      .flatMap((point) => {
        const value = point[metric.key];
        return typeof value === "number" && Number.isFinite(value)
          ? [{ time: point.time, value }]
          : [];
      })
      .slice(0, 24);
    return values.length > 1 ? [{ ...metric, values }] : [];
  });
  const schedules = context.planned_irrigation.status === "available"
    ? context.planned_irrigation.data
    : [];
  const currentWeather = context.current_weather?.status === "available"
    ? context.current_weather.values
    : undefined;
  const hasCurrentWeather = Boolean(currentWeather && Object.values(currentWeather).some((value) => typeof value === "number"));

  if (charts.length === 0 && schedules.length === 0 && !hasCurrentWeather) {
    return <p className="chart-data-note">{t("No verified chart data is available for this selection.")}</p>;
  }

  return (
    <div className="chart-visualizations">
      {hasCurrentWeather && currentWeather && (
        <div className="chart-current-weather">
          {typeof currentWeather.temperature_c === "number" && (
            <span>{t("Temperature")} <strong>{formatTemperature(currentWeather.temperature_c)}</strong></span>
          )}
          {typeof currentWeather.humidity_percent === "number" && (
            <span>{t("Humidity")} <strong>{formatNumber(currentWeather.humidity_percent)}%</strong></span>
          )}
          {typeof currentWeather.rainfall_mm_per_hr === "number" && (
            <span>{t("Rainfall")} <strong>{formatNumber(currentWeather.rainfall_mm_per_hr)} {t("mm/h")}</strong></span>
          )}
        </div>
      )}
      {charts.map((chart) => (
        <MiniChart
          key={chart.key}
          title={t(chart.label)}
          unit={chart.unit}
          values={chart.values}
          formatDateTime={formatDateTime}
          formatNumber={formatNumber}
        />
      ))}
      {schedules.length > 0 && (
        <MiniChart
          title={t("Planned irrigation")}
          unit={context.planned_irrigation.unit}
          values={schedules.slice(-24).map((schedule) => ({
            time: schedule.scheduled_date,
            value: schedule.water_liters,
          }))}
          formatDateTime={formatDateTime}
          formatNumber={formatNumber}
        />
      )}
      <p className="chart-data-note">{t("Planned irrigation volumes are schedules, not actual water use.")}</p>
    </div>
  );
}

function MiniChart({
  title,
  unit,
  values,
  formatDateTime,
  formatNumber,
}: {
  title: string;
  unit: string;
  values: { time: string; value: number }[];
  formatDateTime: (value: string | Date) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}) {
  if (values.length === 0) return null;
  const width = 360;
  const height = 100;
  const padding = 12;
  const min = Math.min(...values.map((point) => point.value));
  const max = Math.max(...values.map((point) => point.value));
  const span = max - min || 1;
  const coordinates = values.map((point, index) => ({
    ...point,
    x: values.length === 1 ? width / 2 : padding + index * (width - padding * 2) / (values.length - 1),
    y: height - padding - ((point.value - min) / span) * (height - padding * 2),
  }));
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <section className="assistant-chart">
      <h3>{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        {coordinates.length > 1 && <polyline points={line} />}
        {coordinates.map((point, index) => (
          <circle key={`${point.time}-${index}`} cx={point.x} cy={point.y} r="3">
            <title>{`${formatDateTime(point.time)}: ${formatNumber(point.value)} ${unit}`}</title>
          </circle>
        ))}
      </svg>
      <div className="assistant-chart-summary">
        <span>{formatDateTime(values[0].time)}</span>
        <strong>{formatNumber(min)}–{formatNumber(max)} {unit}</strong>
        <span>{formatDateTime(values[values.length - 1].time)}</span>
      </div>
    </section>
  );
}
