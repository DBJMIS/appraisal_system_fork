"use client";

import { cn } from "@/lib/utils";

type ReviewType = "mid_year" | "annual" | "quarterly" | "q1" | "q2" | "q3" | "q4";

interface ReviewTypeBadgeProps {
  type: string;
  className?: string;
}

const typeLabels: Record<string, string> = {
  mid_year: "Mid Year",
  annual: "Annual",
  quarterly: "Quarterly",
  q1: "Q1",
  q2: "Q2",
  q3: "Q3",
  q4: "Q4",
};

export function ReviewTypeBadge({ type, className }: ReviewTypeBadgeProps) {
  const normalizedType = type.toLowerCase().replace(/\s+/g, "_");
  const label =
    typeLabels[normalizedType] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-ds-badge border border-ds-border bg-ds-background px-1.5 py-0.5 text-xs font-medium leading-4 text-ds-text-secondary",
        className
      )}
    >
      {label}
    </span>
  );
}
