"use client";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Accepted for compatibility; page titles no longer render a decorative icon. */
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, className, action }: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-ds-page-title tracking-[-0.01em] text-ds-text-primary">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] leading-[1.45] text-ds-text-secondary">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
