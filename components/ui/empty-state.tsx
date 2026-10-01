"use client";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  className?: string;
  action?: React.ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  className,
  action,
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-8 text-center", className)}>
      <span className="text-ds-text-muted [&_svg]:h-5 [&_svg]:w-5" aria-hidden="true">
        {icon}
      </span>
      <h3 className="mt-3 text-ds-heading text-ds-text-primary">{title}</h3>
      <p className="mt-1 max-w-[320px] text-[13px] leading-[1.45] text-ds-text-secondary">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
