"use client";

import type { CheckInWithResponses } from "@/types/checkins";
import { fiscalYearLabel, formatMidyearDate, type MidyearConfig } from "@/lib/midyear-config";
import { isMidyearScored, openMidyearRevision, pickCurrentFormalReview } from "@/lib/midyear-display";

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Awaiting employee input",
  EMPLOYEE_SUBMITTED: "Awaiting manager review",
  MANAGER_REVIEWED: "Manager reviewed – awaiting completion",
  COMPLETE: "Complete",
};

/** The formal review the banner reports on: the live one, else the most recent cancelled one. */
export function currentFormalReview(checkIns: CheckInWithResponses[]): CheckInWithResponses | null {
  return pickCurrentFormalReview(checkIns);
}

export function midyearStatusLabel(review: CheckInWithResponses | null): string {
  if (!review) return "Not started";
  if (review.status === "CANCELLED") return "Cancelled – can be restarted";
  const revision = openMidyearRevision(review);
  if (revision) return `Revision in progress (revision ${revision.revision_number})`;
  return STATUS_LABELS[review.status] ?? review.status;
}

interface Props {
  midyear: MidyearConfig;
  fiscalYear: string | null;
  checkIns: CheckInWithResponses[];
  /** Shows the Start Mid-Year Review action; the caller decides who may start it. */
  onStart?: () => void;
  starting?: boolean;
  /** Keeps the action visible but unavailable, with the reason shown as a hint. */
  startBlockedReason?: string | null;
  startError?: string | null;
  /** Shows the Reopen Mid-Year Review action; the caller decides who may reopen. */
  onReopen?: () => void;
}

export function MidyearReviewBanner({
  midyear,
  fiscalYear,
  checkIns,
  onStart,
  starting = false,
  startBlockedReason = null,
  startError = null,
  onReopen,
}: Props) {
  const review = currentFormalReview(checkIns);
  const scored = isMidyearScored(review, midyear);
  const revising = openMidyearRevision(review) != null;
  const fy = fiscalYearLabel(fiscalYear);
  const start = formatMidyearDate(midyear.windowStart);
  const due = formatMidyearDate(midyear.dueDate);
  const window = start && due ? `${start} – ${due}` : start ? `Opens ${start}` : due ? `Until ${due}` : "Not set";

  return (
    <div
      data-midyear-banner
      className="px-4 py-3 bg-ds-surface border border-ds-border rounded-ds-panel mb-4 flex flex-wrap items-center gap-x-6 gap-y-2"
    >
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-semibold text-ds-text-primary" data-midyear-banner-title>
          Mid-Year Review{fy ? ` · ${fy}` : ""}
          {revising ? " · Revision in progress" : ""}
        </p>
        <span
          data-midyear-banner-mode
          className="text-[10px] font-semibold uppercase tracking-[.07em] px-2 py-0.5 rounded-full border border-ds-border text-ds-text-secondary bg-white"
        >
          {scored ? "Formal · Scored" : "Formal"}
        </span>
      </div>
      <p className="text-[12px] text-ds-text-secondary">
        Review window: <span className="text-ds-text-primary" data-midyear-banner-window>{window}</span>
      </p>
      <p className="text-[12px] text-ds-text-secondary">
        Due: <span className="text-ds-text-primary" data-midyear-banner-due>{due ?? "Not set"}</span>
      </p>
      <p className="text-[12px] text-ds-text-secondary">
        Status: <span className="text-ds-text-primary font-semibold" data-midyear-banner-status>{midyearStatusLabel(review)}</span>
      </p>
      {onStart && (
        <div className="ml-auto flex flex-col items-end gap-1">
          <button
            type="button"
            data-midyear-start
            onClick={onStart}
            disabled={starting || !!startBlockedReason}
            title={startBlockedReason ?? undefined}
            className="px-3.5 py-1.5 rounded-[8px] bg-ds-accent text-white text-[12px] font-semibold hover:bg-ds-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {starting ? "Starting…" : "Start Mid-Year Review"}
          </button>
          {startBlockedReason && (
            <p data-midyear-start-hint className="text-[11px] text-ds-text-secondary">
              {startBlockedReason}
            </p>
          )}
          {startError && (
            <p data-midyear-start-error role="alert" className="text-[11px] text-ds-error max-w-[320px] text-right whitespace-pre-line">
              {startError}
            </p>
          )}
        </div>
      )}
      {onReopen && review?.status === "COMPLETE" && (
        <div className="ml-auto">
          <button
            type="button"
            data-midyear-reopen
            onClick={onReopen}
            className="px-3.5 py-1.5 rounded-[8px] border border-ds-border bg-white text-ds-text-primary text-[12px] font-semibold hover:border-ds-text-primary transition-colors"
          >
            Reopen Mid-Year Review
          </button>
        </div>
      )}
    </div>
  );
}
