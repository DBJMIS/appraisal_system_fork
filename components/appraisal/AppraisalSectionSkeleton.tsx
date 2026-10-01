import { cn } from "@/utils/cn";

export type AppraisalSectionSkeletonVariant = "workplan" | "competency" | "summary" | "checkins";

interface AppraisalSectionSkeletonProps {
  variant: AppraisalSectionSkeletonVariant;
  /** Announced to screen readers, e.g. "Loading workplan…". */
  label: string;
  /** Number of placeholder rows (workplan, competency). */
  rows?: number;
}

/** One placeholder block. Very light neutral, 6px radius, a subtle pulse that stops for reduced motion. */
function Bar({ className }: { className?: string }) {
  return <span data-skeleton-block className={cn("block h-3 rounded-ds-control bg-ds-surface-hover motion-safe:animate-pulse", className)} />;
}

// Fixed, varied widths so rows do not look like identical bars.
const LINE_WIDTHS = ["w-[88%]", "w-[72%]", "w-[94%]", "w-[64%]", "w-[80%]", "w-[70%]"];
const SUB_WIDTHS = ["w-[56%]", "w-[44%]", "w-[62%]", "w-[38%]", "w-[50%]", "w-[46%]"];
const SHORT_WIDTHS = ["w-[60%]", "w-[42%]", "w-[74%]", "w-[52%]", "w-[66%]", "w-[48%]"];
const pick = (list: string[], i: number) => list[i % list.length];

/** Objective · Target · Weight · Actual YTD · Result */
const WORKPLAN_COLS =
  "grid grid-cols-[minmax(0,2.6fr)_minmax(0,1.1fr)_minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,0.8fr)] items-start gap-4 px-4";

function WorkplanSkeleton({ rows }: { rows: number }) {
  return (
    <div className="w-full">
      <div className="mb-4" />
      <div className="w-full overflow-hidden rounded-ds-panel border border-ds-border bg-ds-background">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-ds-border px-6 pb-4 pt-5">
          <div className="flex items-center gap-2.5">
            <Bar className="h-8 w-8 rounded-ds-panel" />
            <div>
              <Bar className="h-4 w-44" />
              <Bar className="mt-1.5 h-3 w-72 max-w-[60vw]" />
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <Bar className="h-8 w-24 rounded-ds-panel" />
            <Bar className="h-8 w-28 rounded-ds-panel" />
          </div>
        </div>
        <div className={cn(WORKPLAN_COLS, "border-b border-ds-border bg-ds-surface py-2.5")}>
          <Bar className="h-2.5 w-24" />
          <Bar className="h-2.5 w-14" />
          <Bar className="h-2.5 w-12" />
          <Bar className="h-2.5 w-16" />
          <Bar className="h-2.5 w-12" />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} data-skeleton-row className={cn(WORKPLAN_COLS, "border-b border-ds-border py-3.5 last:border-b-0")}>
            <div className="space-y-1.5">
              <Bar className={pick(LINE_WIDTHS, i)} />
              <Bar className={cn("h-2.5", pick(SUB_WIDTHS, i))} />
            </div>
            <Bar className={pick(SHORT_WIDTHS, i)} />
            <Bar className="w-9" />
            <Bar className={pick(SHORT_WIDTHS, i + 2)} />
            <Bar className="h-5 w-16 rounded-ds-panel" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Competency · Weight · Employee rating · Comment · Manager rating · Score (comment and employee rating hidden below md). */
const COMPETENCY_COLS =
  "grid grid-cols-[minmax(0,2.6fr)_minmax(0,0.7fr)_minmax(0,1.8fr)_minmax(0,0.7fr)] md:grid-cols-[minmax(0,2.6fr)_minmax(0,0.7fr)_minmax(0,1.8fr)_minmax(0,2fr)_minmax(0,1.8fr)_minmax(0,0.7fr)] items-start gap-5 px-2.5";

function CompetencySkeleton({ rows }: { rows: number }) {
  return (
    <div>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <Bar className="h-5 w-52" />
          <Bar className="mt-1.5 h-3 w-80 max-w-[70vw]" />
          <Bar className="mt-2 h-2.5 w-96 max-w-[75vw]" />
        </div>
        <Bar className="h-8 w-28 shrink-0 rounded-ds-panel" />
      </div>
      <div className="overflow-hidden rounded-ds-panel border border-ds-border bg-ds-background">
        <div className={cn(COMPETENCY_COLS, "border-b border-ds-border bg-ds-surface py-2")}>
          <Bar className="h-2.5 w-20" />
          <Bar className="ml-auto h-2.5 w-10" />
          <Bar className="h-2.5 w-24 max-md:hidden" />
          <Bar className="h-2.5 w-28 max-md:hidden" />
          <Bar className="h-2.5 w-24" />
          <Bar className="ml-auto h-2.5 w-10" />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} data-skeleton-row className={cn(COMPETENCY_COLS, "border-b border-ds-border py-2.5")}>
            <div className="space-y-1.5">
              <Bar className={pick(SHORT_WIDTHS, i)} />
              <Bar className={cn("h-2.5", pick(LINE_WIDTHS, i + 1))} />
            </div>
            <Bar className="ml-auto w-8" />
            <Bar className="h-8 w-full max-md:hidden" />
            <Bar className="h-8 w-full max-md:hidden" />
            <Bar className="h-8 w-full" />
            <Bar className="ml-auto w-8" />
          </div>
        ))}
        <div className={cn(COMPETENCY_COLS, "bg-ds-surface py-2")}>
          <Bar className="h-3 w-12" />
          <Bar className="ml-auto w-10" />
          <span className="max-md:hidden" />
          <span className="max-md:hidden" />
          <span />
          <Bar className="ml-auto w-10" />
        </div>
      </div>
    </div>
  );
}

/** Component · Weight · Actual % · Points · Grade · Grade thresholds */
const SUMMARY_COLS =
  "grid grid-cols-[minmax(0,2.4fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] sm:grid-cols-[minmax(0,2.4fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,3fr)] items-start gap-4 px-3";

function SummarySkeleton() {
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="rounded-ds-panel border border-ds-border bg-ds-background">
        <div className="grid grid-cols-1 divide-y divide-ds-border sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:divide-x sm:divide-y-0">
          <div className="px-5 py-4">
            <Bar className="h-2.5 w-20" />
            <Bar className="mt-2 h-10 w-28 rounded-ds-panel" />
          </div>
          <div className="px-5 py-4">
            <Bar className="h-2.5 w-12" />
            <Bar className="mt-2 h-7 w-24 rounded-ds-panel" />
          </div>
          <div className="px-5 py-4">
            <Bar className="h-2.5 w-12" />
            <Bar className="mt-2 h-5 w-24 rounded-ds-panel" />
          </div>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-ds-border px-5 py-3.5">
          {["w-36", "w-28", "w-24", "w-20", "w-40"].map((w) => (
            <Bar key={w} className={w} />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3">
          <Bar className="h-5 w-72 max-w-[70vw]" />
          <Bar className="mt-1.5 h-3 w-56" />
        </div>
        <div className="overflow-hidden rounded-ds-panel border border-ds-border bg-ds-background">
          <div className={cn(SUMMARY_COLS, "border-b border-ds-border bg-ds-surface py-2.5")}>
            <Bar className="h-2.5 w-20" />
            <Bar className="ml-auto h-2.5 w-10" />
            <Bar className="ml-auto h-2.5 w-12" />
            <Bar className="ml-auto h-2.5 w-10" />
            <Bar className="h-2.5 w-10" />
            <Bar className="h-2.5 w-36 max-sm:hidden" />
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} data-skeleton-row className={cn(SUMMARY_COLS, "border-b border-ds-border py-3")}>
              <div className="space-y-1.5">
                <Bar className={pick(SHORT_WIDTHS, i + 1)} />
                <Bar className={cn("h-2.5", pick(SUB_WIDTHS, i))} />
              </div>
              <Bar className="ml-auto w-8" />
              <Bar className="ml-auto w-10" />
              <Bar className="ml-auto w-10" />
              <Bar className="w-10" />
              <Bar className="w-full max-sm:hidden" />
            </div>
          ))}
          <div className={cn(SUMMARY_COLS, "bg-ds-surface py-3")}>
            <Bar className="w-12" />
            <Bar className="ml-auto w-8" />
            <Bar className="ml-auto w-12" />
            <Bar className="ml-auto w-10" />
            <Bar className="w-6" />
          </div>
        </div>
      </div>

      <div>
        <Bar className="mb-2 h-3.5 w-36" />
        <div className="divide-y divide-ds-border rounded-ds-panel border border-ds-border bg-ds-background">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5">
              <Bar className="w-4" />
              <Bar className={pick(SUB_WIDTHS, i + 2)} />
              <Bar className="w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CheckInsSkeleton() {
  return (
    <div className="py-4">
      <div className="rounded-ds-panel border border-ds-border bg-ds-background px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Bar className="h-4 w-48" />
            <Bar className="mt-1.5 h-3 w-64 max-w-[70%]" />
          </div>
          <Bar className="h-5 w-20 rounded-ds-panel" />
        </div>
        <div className="mt-4 space-y-2">
          <Bar className="w-[92%]" />
          <Bar className="w-[78%]" />
          <Bar className="w-[60%]" />
        </div>
      </div>
      <div className="mb-3 mt-6 flex items-center justify-between">
        <Bar className="h-2.5 w-24" />
        <Bar className="h-8 w-28 rounded-ds-panel" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} data-skeleton-row className="flex items-center justify-between gap-4 rounded-ds-panel border border-ds-border bg-ds-background px-4 py-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Bar className={cn("max-w-[260px]", pick(SHORT_WIDTHS, i))} />
              <Bar className={cn("h-2.5 max-w-[200px]", pick(SUB_WIDTHS, i))} />
            </div>
            <Bar className="h-5 w-16 rounded-ds-panel" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Loading placeholder for an appraisal tab's content area, shaped like the loaded section so the page
 * does not jump. The blocks are decorative (aria-hidden); assistive technology hears only `label`.
 */
export function AppraisalSectionSkeleton({ variant, label, rows }: AppraisalSectionSkeletonProps) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" data-section-skeleton={variant}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        {variant === "workplan" && <WorkplanSkeleton rows={rows ?? 5} />}
        {variant === "competency" && <CompetencySkeleton rows={rows ?? 6} />}
        {variant === "summary" && <SummarySkeleton />}
        {variant === "checkins" && <CheckInsSkeleton />}
      </div>
    </div>
  );
}
