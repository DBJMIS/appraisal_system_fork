import { cn } from "@/lib/utils";

const TONE_CLASSES: Record<string, string> = {
  success: "border-ds-success-border bg-ds-success-subtle text-ds-success",
  error: "border-ds-error-border bg-ds-error-subtle text-ds-error",
  warning: "border-ds-warning-border bg-ds-warning-subtle text-ds-warning",
  neutral: "border-ds-border bg-ds-surface text-ds-text-primary",
  muted: "border-ds-border bg-ds-surface text-ds-text-secondary",
};

/** Text label plus semantic colour, so status never relies on colour alone. */
export function DeliveryStatusBadge({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      data-delivery-status={label}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        TONE_CLASSES[tone] ?? TONE_CLASSES.muted
      )}
    >
      {label}
    </span>
  );
}
