"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type ColorVariant = "blue" | "teal" | "violet" | "gold";

interface QuickActionItemProps {
  href: string;
  icon: React.ReactNode;
  name: string;
  description: string;
  /** Accepted for compatibility; quick actions are neutral. */
  variant?: ColorVariant;
  className?: string;
}

export function QuickActionItem({
  href,
  icon,
  name,
  description,
  className,
}: QuickActionItemProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center justify-between gap-3 border-b border-ds-border px-4 py-3 transition-colors duration-100 hover:bg-ds-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-focus",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 text-ds-text-secondary [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ds-text-primary">{name}</p>
          <p className="truncate text-xs text-ds-text-secondary">{description}</p>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-ds-text-muted group-hover:text-ds-text-primary" aria-hidden="true" />
    </Link>
  );
}
