"use client";

import { cn } from "@/lib/utils";

interface CycleChipProps {
  year: string;
  className?: string;
}

export function CycleChip({ year, className }: CycleChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-ds-badge border border-ds-border bg-ds-surface px-1.5 py-0.5 text-xs font-medium leading-4 tabular-nums text-ds-text-primary",
        className
      )}
    >
      {year}
    </span>
  );
}
