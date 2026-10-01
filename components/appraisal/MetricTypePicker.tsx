"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, Check, Hash, Percent, type LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";
import type { MetricType } from "@/lib/metric-calc";

interface MetricTypePickerProps {
  current: MetricType;
  onSelect: (type: MetricType) => void;
  onClose: () => void;
}

interface AccentClasses {
  tile: string;
  icon: string;
  selected: string;
  indicator: string;
}

const ACCENTS: Record<"lavender" | "amber" | "mint", AccentClasses> = {
  lavender: {
    tile: "border-ds-lavender-border bg-ds-lavender-subtle",
    icon: "text-ds-lavender-text",
    selected: "border-ds-lavender bg-ds-lavender-subtle",
    indicator: "border-ds-lavender-text bg-ds-lavender-text",
  },
  amber: {
    tile: "border-ds-amber-border bg-ds-amber-subtle",
    icon: "text-ds-warning",
    selected: "border-ds-amber bg-ds-amber-subtle",
    indicator: "border-ds-warning bg-ds-warning",
  },
  mint: {
    tile: "border-ds-mint-border bg-ds-mint-subtle",
    icon: "text-ds-success",
    selected: "border-ds-mint bg-ds-mint-subtle",
    indicator: "border-ds-success bg-ds-success",
  },
};

const OPTIONS: Array<{
  type: MetricType;
  Icon: LucideIcon;
  accent: keyof typeof ACCENTS;
  title: string;
  summary: string;
  detail: string;
}> = [
  {
    type: "NUMBER",
    Icon: Hash,
    accent: "lavender",
    title: "Number — Fraction",
    summary: "Enter actual / target",
    detail: "e.g. 4 / 5 policies completed · 4 ÷ 5 = 80%",
  },
  {
    type: "DATE",
    Icon: CalendarClock,
    accent: "amber",
    title: "Date — Deadline Based",
    summary: "Enter deadline and completion date",
    detail: "On time = 100%; late is reduced by days overdue.",
  },
  {
    type: "PERCENT",
    Icon: Percent,
    accent: "mint",
    title: "Percentage — Direct Entry",
    summary: "Enter the percentage directly, e.g. 99.2% uptime",
    detail: "Use when the metric is already a percentage.",
  },
];

export function MetricTypePicker({ current, onSelect, onClose }: MetricTypePickerProps) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const firstRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    (selectedRef.current ?? firstRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const content = (
    <>
      <div
        className="fixed inset-0 z-[9998] bg-[#0d0d0d]/40 backdrop-blur-sm"
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="metric-type-title"
        aria-describedby="metric-type-desc"
        data-metric-type-dialog
        className="fixed left-1/2 top-1/2 z-[9999] w-[440px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-ds-border bg-white p-5 shadow-ds-dialog"
      >
        <h3 id="metric-type-title" className="font-sans text-[18px] font-medium leading-6 text-ds-text-primary">
          Select Metric Type
        </h3>
        <p id="metric-type-desc" className="mt-0.5 text-[12px] leading-snug text-ds-text-secondary">
          This determines how the system calculates the % from your actual entry
        </p>

        <div role="radiogroup" aria-labelledby="metric-type-title" className="mt-4 flex flex-col gap-2">
          {OPTIONS.map((opt, i) => {
            const selected = current === opt.type;
            const accent = ACCENTS[opt.accent];
            return (
              <button
                key={opt.type}
                ref={(el) => {
                  if (selected) selectedRef.current = el;
                  if (i === 0) firstRef.current = el;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                data-metric-option={opt.type}
                onClick={() => onSelect(opt.type)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[8px] border px-3 py-2.5 text-left transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus focus-visible:ring-offset-1",
                  selected
                    ? accent.selected
                    : "border-ds-border bg-white hover:border-ds-border-strong hover:bg-ds-surface"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border",
                    accent.tile
                  )}
                >
                  <opt.Icon className={cn("h-4 w-4", accent.icon)} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium leading-5 text-ds-text-primary">{opt.title}</span>
                  <span className="block text-[12.5px] leading-[18px] text-ds-text-secondary">{opt.summary}</span>
                  <span data-metric-detail className="block text-[12px] leading-[18px] tabular-nums text-ds-text-secondary">
                    {opt.detail}
                  </span>
                </span>
                <span
                  data-metric-indicator
                  aria-hidden
                  className={cn(
                    "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border",
                    selected ? accent.indicator : "border-ds-text-muted bg-white"
                  )}
                >
                  {selected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-ds-button px-3 text-[13px] font-medium text-ds-text-secondary transition-colors hover:bg-ds-surface hover:text-ds-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
