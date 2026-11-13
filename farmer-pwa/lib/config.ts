export const MOISTURE_THRESHOLDS = {
  criticalMaximum: 20,
  needsAttentionMaximum: 40,
} as const;

export const MOISTURE_STATUS = {
  healthy: { label: "Healthy", className: "healthy" },
  needsAttention: { label: "Needs attention", className: "attention" },
  critical: { label: "Critical", className: "critical" },
  unavailable: { label: "Sensor unavailable", className: "sensor-unavailable" },
} as const;

export function moistureStatus(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return MOISTURE_STATUS.unavailable;
  if (value <= MOISTURE_THRESHOLDS.criticalMaximum) return MOISTURE_STATUS.critical;
  if (value <= MOISTURE_THRESHOLDS.needsAttentionMaximum) return MOISTURE_STATUS.needsAttention;
  return MOISTURE_STATUS.healthy;
}
