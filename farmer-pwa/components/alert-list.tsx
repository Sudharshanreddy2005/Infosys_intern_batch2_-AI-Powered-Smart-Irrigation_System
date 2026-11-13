import { EmptyState } from "@/components/states";
import { useI18n } from "@/components/i18n-provider";

export function AlertList() {
  const { t } = useI18n();
  return <section aria-labelledby="alerts-title"><div className="page-title"><p className="eyebrow">{t("FARM UPDATES")}</p><h1 id="alerts-title">{t("Alerts")}</h1><p className="muted">{t("Alerts require a verified sensor or notification source.")}</p></div><EmptyState title={t("Alerts not available")}>{t("No verified alert source is connected, so there are no alerts to show.")}</EmptyState></section>;
}
