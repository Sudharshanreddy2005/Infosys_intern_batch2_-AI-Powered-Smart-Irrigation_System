import Link from "next/link";
import { moistureStatus } from "@/lib/config";
import type { FarmCrop, FarmField } from "@/lib/types";
import { useI18n } from "@/components/i18n-provider";

export function FieldCard({ field, crops, index = 0 }: { field: FarmField; crops: FarmCrop[]; index?: number }) {
  const { t, formatNumber, formatDateTime } = useI18n();
  const crop = crops.find((item) => item.field_id === field.id)?.name ?? field.crop ?? t("Crop not set");
  const status = moistureStatus(field.soil_moisture_percent);
  const statusLabel = t(status.label);
  return (
    <article className={`field-card ${status.className}`}>
      <div className="field-card-top">
        <span className="field-illustration" aria-hidden="true">{["🌱", "🌿", "🌾"][index % 3]}</span>
        <span className={`status-pill ${status.className}`}><span aria-hidden="true" />{statusLabel}</span>
      </div>
      <p className="eyebrow">{t("FIELD {number}", { number: formatNumber(index + 1, { minimumIntegerDigits: 2, useGrouping: false }) })}</p>
      <h2>{field.name}</h2>
      <p className="field-crop">{crop}</p>
      <dl className="field-details">
        <div><dt>{t("Area")}</dt><dd>{formatNumber(field.area)} {field.area_unit}</dd></div>
        <div><dt>{t("Soil moisture")}</dt><dd>{typeof field.soil_moisture_percent === "number" ? `${formatNumber(field.soil_moisture_percent)}% · ${statusLabel}` : statusLabel}</dd></div>
        <div><dt>{t("Last sensor update")}</dt><dd>{field.last_sensor_update ? formatDateTime(field.last_sensor_update) : t("Not available")}</dd></div>
      </dl>
      <p className="sensor-note">{t("Live sensor updates are not connected to this field.")}</p>
      <Link className="touch-link" href={`/fields/${field.id}`} aria-label={t("View details for {name}", { name: field.name })}>{t("View details")} <span aria-hidden="true">→</span></Link>
    </article>
  );
}
