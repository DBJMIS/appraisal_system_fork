"use client";

import { cn } from "@/lib/utils";

interface CycleBannerProps {
  fiscalYear: string;
  dateRange: string;
  isActive?: boolean;
  className?: string;
}

export function CycleBanner({
  fiscalYear,
  dateRange,
  isActive = true,
  className,
}: CycleBannerProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-ds-panel border border-ds-border bg-ds-surface px-4 py-3",
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium text-ds-text-secondary">Active Cycle</p>
        <p className="text-ds-section text-ds-text-primary">{fiscalYear}</p>
        <p className="text-xs text-ds-text-secondary">{dateRange}</p>
      </div>
      {isActive && (
        <span className="inline-flex items-center gap-1.5 rounded-ds-badge border border-ds-success-border bg-ds-success-subtle px-1.5 py-0.5 text-xs font-medium leading-4 text-ds-success">
          <span className="h-1.5 w-1.5 rounded-full bg-ds-success" aria-hidden="true" />
          In Progress
        </span>
      )}
    </div>
  );
}
