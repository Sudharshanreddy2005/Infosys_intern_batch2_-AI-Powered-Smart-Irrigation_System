import type { ReactNode } from "react";
import { useI18n } from "@/components/i18n-provider";

export function LoadingState({ label = "Loading your farm…" }: { label?: string }) {
  const { t } = useI18n();
  return <div className="state-card" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />{t(label)}</div>;
}

export function ErrorState({ children }: { children: ReactNode }) {
  return <div className="state-card state-error" role="alert">{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="state-card state-empty"><span aria-hidden="true">🌾</span><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

export function OfflineBanner({ lastUpdated }: { lastUpdated?: string | null }) {
  const { t, formatDateTime } = useI18n();
  const updated = lastUpdated ? formatDateTime(lastUpdated) : t("not available");
  return <div className="offline-banner" role="status">{t("Offline - showing data from {updated}. Read-only.", { updated })}</div>;
}
