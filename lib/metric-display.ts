import { formatMidyearDate } from "@/lib/midyear-config";

export interface MetricTargetSource {
  metric_type?: string | null;
  metric_target?: number | string | null;
  metric_deadline?: string | null;
}

function formatDate(value: string): string {
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? formatMidyearDate(day) ?? value : value;
}

/**
 * Configured target for display only. Must follow the annual workplan's read-only Target cell:
 * NUMBER → the number, DATE → the deadline, anything else → the value as a percentage.
 * A non-numeric target is shown as entered. Returns null when no target is configured.
 */
export function formatMetricTarget(item: MetricTargetSource): string | null {
  const type = (item.metric_type ?? "PERCENT").toUpperCase();
  const target = item.metric_target;
  if (type === "DATE" && item.metric_deadline) return formatDate(item.metric_deadline);
  if (target == null || target === "") return null;
  if (typeof target === "string" && !Number.isFinite(Number(target))) return target;
  return type === "NUMBER" ? `${target}` : `${target}%`;
}
