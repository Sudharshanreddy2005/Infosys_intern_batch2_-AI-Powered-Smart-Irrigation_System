"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertList } from "@/components/alert-list";
import { AppShell } from "@/components/app-shell";
import { FieldCard } from "@/components/field-card";
import { FieldsManagement } from "@/components/farm-management";
import { useFarmData } from "@/components/farm-data-provider";
import { ScheduleItem } from "@/components/schedule-item";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { WeatherCard } from "@/components/weather-card";
import { isThemeChoice, useTheme } from "@/components/theme-provider";
import { isLanguageCode, languageOptions, useI18n } from "@/components/i18n-provider";
import { login, registerFarmer } from "@/lib/api";
import type { ApiError, FarmerProfileUpdate, ForecastPeriod } from "@/lib/types";

function ProtectedContent({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}

export function DashboardPage() {
  const { data } = useFarmData();
  const { t, formatDateTime, formatNumber } = useI18n();
  if (!data) return <ProtectedContent><LoadingState /></ProtectedContent>;
  const today = localDateKey();
  const schedules = data.schedules.filter((item) => item.scheduled_date === today && item.status !== "cancelled");
  return <ProtectedContent>
    <section className="welcome"><div><p className="eyebrow">{formatDateTime(new Date(), { weekday: "long", month: "long", day: "numeric" })}</p><h1 className="greeting"><span className="greeting-line">{t("Namaste, {name}", { name: data.profile.name.split(" ")[0] })} <span className="greeting-wave" aria-hidden="true">👋</span></span></h1><p className="muted">{[data.profile.village, data.profile.district, data.profile.state].filter(Boolean).join(", ") || t("Here’s what’s happening with your farm today.")}</p></div><div className="welcome-art" aria-hidden="true">🌱</div></section>
    <section className="stats-grid" aria-label={t("Farm summary")}>
      <StatCard icon="♧" label="Registered fields" value={formatNumber(data.fields.length)} foot="Fields saved to your account" />
      <StatCard icon="◉" label="Soil moisture" value="—" foot="Sensor unavailable" />
      <StatCard icon="▦" label="Today’s irrigation" value={formatNumber(schedules.length)} foot="Saved schedule entries" />
      <StatCard icon="✿" label="Registered crops" value={formatNumber(data.crops.length)} foot="Crops saved to your account" />
    </section>
    <div className="dashboard-grid">
      <section><div className="section-heading"><div><p className="eyebrow">{t("YOUR FARM")}</p><h2>{t("Field conditions")}</h2></div><Link className="text-button" href="/fields">{t("View all fields")} <span aria-hidden="true">→</span></Link></div>
        {data.fields.length ? <div className="field-grid">{data.fields.slice(0, 3).map((field, index) => <FieldCard key={field.id} field={field} crops={data.crops} index={index} />)}</div> : <EmptyState title={t("No fields registered yet")}>{t("Add fields from your JalSaathi account to see them here.")}</EmptyState>}
      </section>
      <WeatherCard weather={data.weather} temporarilyUnavailable={data.weatherTemporarilyUnavailable} lastUpdated={data.weatherUpdatedAt} />
    </div>
    <section className="schedule-section"><div className="section-heading"><div><p className="eyebrow">{t("WATER MANAGEMENT")}</p><h2>{t("Today’s irrigation")}</h2></div><Link className="text-button" href="/schedule">{t("Open schedule")} <span aria-hidden="true">→</span></Link></div>
      {schedules.length ? <div className="schedule-list">{schedules.map((schedule) => <ScheduleItem key={schedule.id} schedule={schedule} />)}</div> : <EmptyState title={t("No irrigation scheduled for today")}>{t("Saved schedules will appear here when available.")}</EmptyState>}
    </section>
    <section className="alert-preview"><div><h2>{t("Farm alerts")}</h2><p>{t("Verified sensor alerts and notifications are not connected.")}</p></div><Link className="touch-link" href="/alerts">{t("Alerts not available")} <span aria-hidden="true">→</span></Link></section>
  </ProtectedContent>;
}

function StatCard({ icon, label, value, foot }: { icon: string; label: string; value: string; foot: string }) {
  const { t } = useI18n();
  return <article className="stat-card"><span className="stat-icon" aria-hidden="true">{icon}</span><span className="stat-label">{t(label)}</span><strong className="stat-value">{value}</strong><span className="stat-foot">{t(foot)}</span></article>;
}

export function FieldsPage() {
  return <FieldsManagement />;
}

export function FieldDetailsPage({ fieldId }: { fieldId: string }) {
  const { data } = useFarmData();
  const { t, formatNumber } = useI18n();
  const field = data?.fields.find((item) => String(item.id) === fieldId);
  if (!data) return <ProtectedContent><LoadingState /></ProtectedContent>;
  if (!field) return <ProtectedContent><ErrorState>{t("That field is not available in your account.")}</ErrorState><Link className="touch-link" href="/fields">{t("Back to fields")}</Link></ProtectedContent>;
  const crop = data.crops.find((item) => item.field_id === field.id);
  return <ProtectedContent><section className="page-title"><p className="eyebrow">{t("FIELD DETAILS")}</p><h1>{field.name}</h1><p className="muted">{field.location || t("Location not recorded")}</p></section>
    <article className="detail-card"><dl className="detail-list"><div><dt>{t("Crop")}</dt><dd>{crop?.name || field.crop || t("Not recorded")}</dd></div><div><dt>{t("Area")}</dt><dd>{formatNumber(field.area)} {field.area_unit}</dd></div><div><dt>{t("Soil moisture")}</dt><dd>{t("Sensor unavailable")}</dd></div><div><dt>{t("Last sensor update")}</dt><dd>{t("Not available")}</dd></div><div><dt>{t("Coordinates")}</dt><dd>{field.latitude != null && field.longitude != null ? `${formatNumber(field.latitude)}, ${formatNumber(field.longitude)}` : t("Not recorded")}</dd></div></dl><p className="sensor-note">{t("Live sensor updates are not connected to this field. Historical dataset readings are not shown here.")}</p></article>
    <Link className="touch-link" href="/fields">← {t("Back to fields")}</Link>
  </ProtectedContent>;
}

export function SchedulePage() {
  const { data, online, refreshing, refresh, refreshCooling } = useFarmData();
  const { t } = useI18n();
  if (!data) return <ProtectedContent><LoadingState /></ProtectedContent>;
  const schedules = data.schedules.filter((item) => item.scheduled_date === localDateKey() && item.status !== "cancelled");
  return <ProtectedContent><section className="page-title page-title-row"><div><p className="eyebrow">{t("WATER MANAGEMENT")}</p><h1>{t("Today’s Irrigation")}</h1><p className="muted">{t("Saved recommendations and schedule details for today.")}</p></div><button className="primary-button compact-button" type="button" onClick={() => void refresh()} disabled={!online || refreshing || refreshCooling} aria-label={t("Refresh today's irrigation schedule")}>{refreshing ? t("Refreshing…") : refreshCooling ? t("Refresh paused briefly") : t("Refresh schedule")}</button></section>
    {!schedules.length ? <EmptyState title={t("No irrigation scheduled for today")}>{t("Schedule information will appear here when it is available from your account.")}</EmptyState> : <div className="schedule-list">{schedules.map((schedule) => <ScheduleItem key={schedule.id} schedule={schedule} />)}</div>}
  </ProtectedContent>;
}

export function WeatherPage() {
  const { data } = useFarmData();
  const { t } = useI18n();
  if (!data) return <ProtectedContent><LoadingState /></ProtectedContent>;
  return <ProtectedContent><section className="page-title"><p className="eyebrow">{t("WEATHER")}</p><h1>{t("Weather")}</h1><p className="muted">{t("Current conditions and forecast from the configured weather provider.")}</p></section>
    <WeatherCard weather={data.weather} temporarilyUnavailable={data.weatherTemporarilyUnavailable} lastUpdated={data.weatherUpdatedAt} />
    <ForecastSection title={t("Hourly forecast")} periods={data.hourlyForecast?.data ?? []} mode="hourly" />
    <ForecastSection title={t("Daily forecast")} periods={data.dailyForecast?.data ?? []} mode="daily" />
  </ProtectedContent>;
}

function ForecastSection({ title, periods, mode }: { title: string; periods: ForecastPeriod[]; mode: "hourly" | "daily" }) {
  const { t, formatDateTime, formatNumber } = useI18n();
  return <section className="forecast-section"><h2>{title}</h2>{periods.length ? <div className="forecast-list">{periods.map((period) => <article className="forecast-item" key={period.time}><strong>{formatDateTime(period.time, mode === "hourly" ? { weekday: "short", hour: "numeric" } : { weekday: "short", month: "short", day: "numeric" })}</strong><span>{mode === "daily" ? `${period.temperature_low_c == null ? "—" : formatNumber(period.temperature_low_c)}° / ${period.temperature_high_c == null ? "—" : formatNumber(period.temperature_high_c)}°C` : `${period.temperature_c == null ? "—" : formatNumber(period.temperature_c)}°C`}</span><span>{period.rain_probability_percent == null ? "—" : formatNumber(period.rain_probability_percent)}% {t("rain probability")}</span>{period.is_stale && <small>{t("Cached weather")}</small>}</article>)}</div> : <EmptyState title={t("{title} not available", { title })}>{t("No forecast data is currently available from the weather provider.")}</EmptyState>}</section>;
}

export function AlertsPage() {
  return <ProtectedContent><AlertList /></ProtectedContent>;
}

export function ProfilePage() {
  const { data, online, updateProfile, signOut } = useFarmData();
  const { choice, setChoice } = useTheme();
  const { t, language, setLanguage } = useI18n();
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  if (!data) return <ProtectedContent><LoadingState /></ProtectedContent>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setProfileErrors({});
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) {
      setMessage(t("Enter your name."));
      setProfileErrors({ name: t("Enter your name.") });
      setSaving(false);
      return;
    }
    const payload: FarmerProfileUpdate = {
      name,
      phone: String(form.get("phone") ?? "").trim() || null,
      state: String(form.get("state") ?? "").trim() || null,
      district: String(form.get("district") ?? "").trim() || null,
      village: String(form.get("village") ?? "").trim() || null,
    };
    try {
      await updateProfile(payload);
      setMessage(t("Profile updated."));
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.status === 422) {
        const fieldErrors = (apiError.validationErrors ?? []).reduce<Record<string, string>>((result, issue) => {
          if (["name", "phone", "state", "district", "village"].includes(issue.field)) {
            result[issue.field] = t("The server rejected this value. Check it and try again.");
          }
          return result;
        }, {});
        setProfileErrors(Object.keys(fieldErrors).length ? fieldErrors : { name: t("The server rejected this value. Check it and try again.") });
      }
      setMessage(apiError.status === 401
        ? t("Your session expired. Your form is still here. Sign in again to continue.")
        : apiError.status === 422
          ? t("The server rejected this value. Check it and try again.")
          : t("Could not save your changes. Check the form and try again."));
    } finally {
      setSaving(false);
    }
  }

  return <ProtectedContent><section className="page-title"><p className="eyebrow">{t("ACCOUNT")}</p><h1>{t("Your profile")}</h1><p className="muted">{t("Your profile is private to your JalSaathi account.")}</p></section>
    <section className="theme-setting"><label htmlFor="theme-choice">{t("Appearance")}</label><select id="theme-choice" value={choice} onChange={(event) => { if (isThemeChoice(event.target.value)) setChoice(event.target.value); }}><option value="system">{t("System")}</option><option value="light">{t("Light")}</option><option value="dark">{t("Dark")}</option></select></section>
    <section className="theme-setting"><label htmlFor="language-choice">{t("Language")}</label><select id="language-choice" value={language} onChange={(event) => { if (isLanguageCode(event.target.value)) setLanguage(event.target.value); }}>{languageOptions.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></section>
    <section className="profile-card"><div className="profile-avatar" aria-hidden="true">{data.profile.name.trim().charAt(0).toUpperCase()}</div><form className="profile-form" onSubmit={submit}>
      <label htmlFor="profile-name">{t("Name")}</label><input id="profile-name" name="name" defaultValue={data.profile.name} required maxLength={100} disabled={!online || saving} aria-invalid={Boolean(profileErrors.name)} onChange={() => setProfileErrors((current) => ({ ...current, name: "" }))} />{profileErrors.name && <span className="form-field-error" role="alert">{profileErrors.name}</span>}
      <label htmlFor="profile-email">{t("Email")}</label><input id="profile-email" type="email" value={data.profile.email} readOnly aria-readonly="true" />
      <label htmlFor="profile-phone">{t("Phone")}</label><input id="profile-phone" name="phone" defaultValue={data.profile.phone ?? ""} maxLength={32} disabled={!online || saving} aria-invalid={Boolean(profileErrors.phone)} onChange={() => setProfileErrors((current) => ({ ...current, phone: "" }))} />{profileErrors.phone && <span className="form-field-error" role="alert">{profileErrors.phone}</span>}
      <label htmlFor="profile-village">{t("Village")}</label><input id="profile-village" name="village" defaultValue={data.profile.village ?? ""} maxLength={120} disabled={!online || saving} aria-invalid={Boolean(profileErrors.village)} onChange={() => setProfileErrors((current) => ({ ...current, village: "" }))} />{profileErrors.village && <span className="form-field-error" role="alert">{profileErrors.village}</span>}
      <label htmlFor="profile-district">{t("District")}</label><input id="profile-district" name="district" defaultValue={data.profile.district ?? ""} maxLength={100} disabled={!online || saving} aria-invalid={Boolean(profileErrors.district)} onChange={() => setProfileErrors((current) => ({ ...current, district: "" }))} />{profileErrors.district && <span className="form-field-error" role="alert">{profileErrors.district}</span>}
      <label htmlFor="profile-state">{t("State")}</label><input id="profile-state" name="state" defaultValue={data.profile.state ?? ""} maxLength={80} disabled={!online || saving} aria-invalid={Boolean(profileErrors.state)} onChange={() => setProfileErrors((current) => ({ ...current, state: "" }))} />{profileErrors.state && <span className="form-field-error" role="alert">{profileErrors.state}</span>}
      <button className="primary-button" type="submit" disabled={!online || saving}>{saving ? t("Saving…") : t("Save profile")}</button>
      {message && <p role="status">{message}{message.includes("Sign in again") && <> <Link href="/login">{t("Sign in")}</Link></>}</p>}
    </form></section>
    {!online && <p className="offline-hint">{t("You're offline.")} {t("Changes are available when you reconnect.")}</p>}
    <button className="secondary-button profile-signout" type="button" onClick={() => void signOut()} disabled={!online}>{t("Sign out")}</button>
  </ProtectedContent>;
}

export function LoginPage() {
  return <AuthPage mode="login" />;
}

export function RegisterPage() {
  return <AuthPage mode="register" />;
}

function AuthPage({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { error: accountError, prepareForAccount } = useFarmData();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const action = mode === "login"
      ? login(email, password)
      : registerFarmer({
        name: String(form.get("name") ?? "").trim(),
        email,
        password,
        village: String(form.get("village") ?? "").trim() || undefined,
      });
    void action.then(async (profile) => {
      await prepareForAccount(profile);
      router.replace("/dashboard");
    })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : t("Sign-in failed. Please try again.")))
      .finally(() => setBusy(false));
  }

  return <main className="auth-page"><Link className="auth-brand" href="/dashboard"><span className="brand-mark" aria-hidden="true">J</span>JalSaathi</Link><section className="auth-card" aria-labelledby="auth-title">
    <p className="eyebrow">{t("YOUR FARM, AT A GLANCE")}</p><h1 id="auth-title">{t(mode === "login" ? "Welcome back" : "Create your farmer account")}</h1><p className="muted">{t(mode === "login" ? "Sign in to see your fields and irrigation schedule." : "Create an account to save your farm information.")}</p>
    {(error || accountError) && <ErrorState>{t(error || accountError)}</ErrorState>}
    <form className="profile-form" onSubmit={submit}>
      {mode === "register" && <><label htmlFor="auth-name">{t("Your name")}</label><input id="auth-name" name="name" autoComplete="name" required maxLength={100} /><label htmlFor="auth-village">{t("Village (optional)")}</label><input id="auth-village" name="village" autoComplete="address-level2" maxLength={120} /></>}
      <label htmlFor="auth-email">{t("Email address")}</label><input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={254} />
      <label htmlFor="auth-password">{t("Password")}</label><input id="auth-password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 12 : 1} maxLength={128} />
      {mode === "register" && <small className="muted">{t("Use at least 12 characters.")}</small>}
      <button className="primary-button" type="submit" disabled={busy || !online}>{busy ? t("Please wait…") : mode === "login" ? t("Sign in") : t("Create account")}</button>
    </form>
    {mode === "login" && <p className="auth-switch"><Link href="/forgot-password">{t("Forgot password?")}</Link> {t("Password reset is not available yet.")}</p>}
    {!online && <p className="offline-hint">{t("Connect to the internet to continue.")}</p>}
    <p className="auth-switch">{t(mode === "login" ? "New to JalSaathi?" : "Already have an account?")} <Link href={mode === "login" ? "/register" : "/login"}>{mode === "login" ? t("Create an account") : t("Sign in")}</Link></p>
  </section></main>;
}

function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
