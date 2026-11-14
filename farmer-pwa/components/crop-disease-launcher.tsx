"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/components/i18n-provider";

function getDiseaseServiceOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_CROP_DISEASE_URL ?? process.env.CROP_DISEASE_URL ?? "http://localhost:8001";
  if (typeof window === "undefined") return configured;
  return (window as Window & { CROP_DISEASE_URL?: string }).CROP_DISEASE_URL ?? configured;
}

async function getHealthStatus() {
  const response = await fetch("/crop-disease-health", { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; status?: number; origin?: string; message?: string }
    | null;
  if (!response.ok || !payload?.ok) {
    throw new Error("Crop disease service is unavailable.");
  }
  return payload;
}

export function CropDiseaseLauncher() {
  const { t } = useI18n();
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");
  const [message, setMessage] = useState<string>("");
  const [origin, setOrigin] = useState<string>(getDiseaseServiceOrigin());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const health = await getHealthStatus();
        if (cancelled) return;
        setOrigin(health.origin ?? origin);
        setStatus("online");
        setMessage(t("Crop disease analysis is available."));
      } catch {
        if (cancelled) return;
        setStatus("offline");
        setMessage(t("The crop disease service is currently unavailable."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t, origin]);

  const launchUrl = useMemo(() => {
    const base = origin.replace(/\/+$/, "");
    return `${base}/`;
  }, [origin]);

  function openDiseaseService() {
    if (!launchUrl) return;
    window.open(launchUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="crop-disease-launcher" aria-live="polite">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t("FARM SUPPORT")}</p>
          <h2>{t("Crop disease detector")}</h2>
        </div>
      </div>
      <p className="muted">
        {t("Open the standalone crop disease tool to inspect a plant image and review the latest diagnosis support.")}
      </p>
      <div className="launcher-controls">
        <button type="button" className="primary-button" onClick={openDiseaseService} disabled={status === "checking"}>
          {status === "checking" ? t("Checking…") : t("Open crop disease tool")}
        </button>
      </div>
      <p className={`status-badge ${status}`}>
        {status === "online" ? t("Service connected") : status === "offline" ? t("Service unavailable") : t("Checking service")}
      </p>
      {message && <p className="muted">{message}</p>}
      <p className="muted small">
        {t("Service URL: {url}", { url: launchUrl })}
      </p>
    </div>
  );
}
