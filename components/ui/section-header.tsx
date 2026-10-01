"use client";

import { cn } from "@/lib/utils";

type ColorVariant = "blue" | "violet" | "teal" | "gold";

interface SectionHeaderProps {
  /** Accepted for compatibility; section headings no longer render a decorative icon. */
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  count?: number;
  /** Accepted for compatibility; section headings are neutral. */
  variant?: ColorVariant;
  className?: string;
  action?: React.ReactNode;
}

export function SectionHeader({ title, subtitle, count, className, action }: SectionHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-ds-section text-ds-text-primary">{title}</h2>
          {count !== undefined && (
            <span className="inline-flex items-center rounded-ds-badge bg-ds-surface px-1.5 py-0.5 text-xs font-medium tabular-nums text-ds-text-secondary">
              {count}
            </span>
          )}
        </div>
        {subtitle && <p className="mt-0.5 text-[13px] leading-[1.45] text-ds-text-secondary">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
