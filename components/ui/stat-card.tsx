"use client";

import { cn } from "@/lib/utils";

type ColorVariant = "blue" | "gold" | "teal" | "rose";

interface StatCardProps {
  label: string;
  value: string | number;
  meta?: string;
  /** Accepted for compatibility; metric panels no longer render a decorative icon. */
  icon?: React.ReactNode;
  /** Accepted for compatibility; metric panels are neutral. */
  variant?: ColorVariant;
  className?: string;
}

export function StatCard({ label, value, meta, className }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-ds-panel border border-ds-border bg-ds-surface-elevated p-4",
        className
      )}
    >
      <span className="text-xs font-medium text-ds-text-secondary">{label}</span>
      <div className="mt-2">
        <span className="text-ds-page-title tabular-nums text-ds-text-primary">{value}</span>
      </div>
      {meta && <p className="mt-1 text-xs text-ds-text-secondary">{meta}</p>}
    </div>
  );
}
