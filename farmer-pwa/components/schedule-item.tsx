"use client";

import Link from "next/link";
import { useState } from "react";
import type { ApiError, IrrigationSchedule, ScheduleAction } from "@/lib/types";
import { useFarmData } from "@/components/farm-data-provider";
import { useI18n } from "@/components/i18n-provider";

type ScheduleStatus = { label: "Upcoming" | "In Progress" | "Completed"; className: string };

function statusFor(schedule: IrrigationSchedule): ScheduleStatus {
  if (schedule.status === "completed") return { label: "Completed", className: "complete" };
  if (
    schedule.status === "confirmed" &&
    schedule.scheduled_date === localDateKey() &&
    schedule.start_time &&
    schedule.end_time
  ) {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (schedule.start_time.slice(0, 5) <= currentTime && currentTime <= schedule.end_time.slice(0, 5)) {
      return { label: "In Progress", className: "progress" };
    }
  }
  return { label: "Upcoming", className: "upcoming" };
}

function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function ScheduleItem({ schedule }: { schedule: IrrigationSchedule }) {
  const { t, formatTime, formatNumber } = useI18n();
  const { online, performScheduleAction } = useFarmData();
  const [busyAction, setBusyAction] = useState<ScheduleAction | null>(null);
  const [cancelPrompt, setCancelPrompt] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const status = statusFor(schedule);
  const reason = schedule.plan?.reason || schedule.plan?.notes?.join(" ") ||
    (schedule.plan?.action === "irrigate" ? t("Irrigation recommended by your farm plan.") : t("See the saved irrigation plan for details."));
  const statusLabel = t(status.label);

  async function runAction(action: ScheduleAction) {
    if (!online || busyAction) return;
    setBusyAction(action);
    setErrorMessage("");
    try {
      await performScheduleAction(schedule.id, action);
      setCancelPrompt(false);
      const message = action === "confirm"
        ? t("Schedule confirmed and water reserved.")
        : action === "cancel"
          ? t("Schedule cancelled; any reservation was released.")
          : t("Schedule marked completed; reserved water was recorded as used.");
      window.dispatchEvent(new CustomEvent("jalsaathi:schedule-action", { detail: { message } }));
    } catch (error) {
      const apiError = error as ApiError;
      setErrorMessage(apiError.status === 401
        ? t("Your session expired. Sign in again to continue.")
        : apiError.status === 404
          ? t("This irrigation schedule is no longer available.")
          : apiError.status === 409
            ? t("This schedule could not be changed. Refresh the schedule and try again.")
            : t("The schedule action could not be completed. Please try again."));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <article className="schedule-card">
      <div className="schedule-time"><span aria-hidden="true">◷</span><strong>{schedule.start_time ? formatTime(schedule.start_time) : t("Time not set")}</strong>{schedule.end_time && <span>{t("to")} {formatTime(schedule.end_time)}</span>}</div>
      <div className="schedule-main">
        <div className="schedule-card-heading"><div><h3>{schedule.field_name}</h3><p>{schedule.crop_name}</p></div><span className={`schedule-status ${status.className}`}>{statusLabel}</span></div>
        <p className="schedule-reason">{reason}</p>
        <div className="schedule-metrics">
          <span><strong>{schedule.duration_minutes ? `${formatNumber(schedule.duration_minutes)} ${t("min")}` : t("Not available")}</strong>{t("Duration")}</span>
          <span><strong>{schedule.water_liters != null ? `${formatNumber(Math.round(schedule.water_liters))} L` : t("Not available")}</strong>{t("Water quantity")}</span>
        </div>
        {(schedule.status === "recommended" || schedule.status === "insufficient_water" || schedule.status === "confirmed") && <div className="schedule-actions">
          {schedule.status === "recommended" && <button className="primary-button schedule-action-button" type="button" onClick={() => void runAction("confirm")} disabled={!online || busyAction !== null}>{busyAction === "confirm" ? t("Please wait…") : t("Confirm")}</button>}
          {schedule.status === "confirmed" && <button className="primary-button schedule-action-button" type="button" onClick={() => void runAction("complete")} disabled={!online || busyAction !== null}>{busyAction === "complete" ? t("Please wait…") : t("Mark completed")}</button>}
          {["recommended", "insufficient_water", "confirmed"].includes(schedule.status) && <button className="secondary-button schedule-action-button" type="button" onClick={() => { setErrorMessage(""); setCancelPrompt(true); }} disabled={!online || busyAction !== null}>{t("Cancel schedule")}</button>}
        </div>}
        {!online && schedule.status !== "cancelled" && schedule.status !== "completed" && <p className="schedule-offline-hint" role="status">{t("You're offline.")} {t("Schedule actions are available when you reconnect.")}</p>}
        {errorMessage && <p className="schedule-action-error" role="alert">{errorMessage}{errorMessage.includes("Sign in again") && <> <Link href="/login">{t("Sign in")}</Link></>}</p>}
      </div>
      {cancelPrompt && <div className="form-sheet-backdrop"><section className="confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby={`cancel-schedule-${schedule.id}`} aria-describedby={`cancel-schedule-message-${schedule.id}`}>
        <h2 id={`cancel-schedule-${schedule.id}`}>{t("Cancel this irrigation schedule?")}</h2>
        <p id={`cancel-schedule-message-${schedule.id}`}>{t("Canceling this schedule may release reserved water. This action cannot be undone.")}</p>
        <div className="form-sheet-actions">
          <button className="secondary-button" type="button" onClick={() => setCancelPrompt(false)} disabled={busyAction !== null}>{t("Keep schedule")}</button>
          <button className="danger-button" type="button" onClick={() => void runAction("cancel")} disabled={!online || busyAction !== null}>{busyAction === "cancel" ? t("Please wait…") : t("Confirm cancellation")}</button>
        </div>
        {!online && <p className="schedule-offline-hint" role="status">{t("You're offline.")} {t("Schedule actions are available when you reconnect.")}</p>}
      </section></div>}
    </article>
  );
}
