import type { CurrentWeather } from "@/lib/types";
import { useI18n } from "@/components/i18n-provider";

export function WeatherCard({
  weather,
  temporarilyUnavailable = false,
  lastUpdated,
}: {
  weather: CurrentWeather | null;
  temporarilyUnavailable?: boolean;
  lastUpdated?: string | null;
}) {
  const { t, formatNumber, formatDateTime } = useI18n();
  const temperature = typeof weather?.temperature_c === "number"
    ? `${formatNumber(Math.round(weather.temperature_c))}°C`
    : t("Not available");
  const location = weather?.locality || weather?.location || t("Weather location not available");
  return (
    <article className="weather-card">
      <div className="weather-card-heading"><span className="weather-icon" aria-hidden="true">☼</span><div><p className="eyebrow">{t("CURRENT WEATHER")}</p><h2>{location}</h2></div></div>
      <strong className="weather-temperature">{temperature}</strong>
      <p>{weather?.humidity_percent != null ? `${formatNumber(Math.round(weather.humidity_percent))}% ${t("humidity")}` : t("Humidity not available")}</p>
      {temporarilyUnavailable && <p className="weather-fallback" role="status">
        {t("Weather temporarily unavailable, showing last data")}
        {lastUpdated && <small>{t("Last weather update {date}", { date: formatDateTime(lastUpdated) })}</small>}
      </p>}
      {weather?.is_stale && <span className="stale-label">{t("Weather provider cache · {minutes} min old", { minutes: formatNumber(weather.data_age_minutes ?? 0) })}</span>}
      {weather?.observation_time && <small>{t("Observed {date}", { date: formatDateTime(weather.observation_time) })}</small>}
    </article>
  );
}
