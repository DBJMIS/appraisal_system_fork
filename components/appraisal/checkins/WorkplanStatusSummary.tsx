"use client";

import type { ObjectiveStatus } from "@/types/checkins";
import {
  hasEmployeeMidyearResult,
  hasScoreableMidyearResult,
  isRequiredMidyearObjective,
  type CompletenessResponse,
} from "@/lib/midyear-lifecycle";
import { OBJECTIVE_STATUS } from "./MidyearAssessmentFields";

type SummaryKey = ObjectiveStatus | "NOT_SET";

const STATUS_ITEMS: Array<{ key: SummaryKey; label: string; swatch: string }> = [
  { key: "ON_TRACK", label: "On track", swatch: "bg-ds-mint" },
  { key: "AT_RISK", label: "At risk", swatch: "bg-ds-amber" },
  { key: "BEHIND", label: "Behind", swatch: "bg-ds-coral" },
  { key: "COMPLETE", label: "Complete", swatch: "bg-ds-success" },
  { key: "NOT_SET", label: "Not set", swatch: "bg-ds-border-strong" },
];

export type ObjectiveStatusCounts = Record<SummaryKey, number>;

/** One status per objective; anything other than a known status counts as Not set. */
export function countObjectiveStatuses(statuses: Array<ObjectiveStatus | null | undefined>): ObjectiveStatusCounts {
  const counts: ObjectiveStatusCounts = { ON_TRACK: 0, AT_RISK: 0, BEHIND: 0, COMPLETE: 0, NOT_SET: 0 };
  for (const s of statuses) counts[s && s in OBJECTIVE_STATUS ? s : "NOT_SET"] += 1;
  return counts;
}

/** Objectives with a Mid-Year result under the completeness rule for the stage. */
export function workplanAssessment(rows: CompletenessResponse[], stage: "employee" | "manager") {
  const required = rows.filter(isRequiredMidyearObjective);
  const assessed = required.filter(stage === "employee" ? hasEmployeeMidyearResult : hasScoreableMidyearResult).length;
  return { required: required.length, assessed };
}

const percent = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Consolidated objective-status overview: totals and per-status counts instead of one marker per
 * objective, so it reads the same for 5 or 100+ objectives. Read-only.
 */
export function WorkplanStatusSummary({
  statuses,
  assessment = null,
  pendingNote = null,
}: {
  /** The current status of each objective, in any order. */
  statuses: Array<ObjectiveStatus | null | undefined>;
  assessment?: { required: number; assessed: number } | null;
  /** Shown instead of the counts while statuses are not visible to this viewer. */
  pendingNote?: string | null;
}) {
  const total = statuses.length;
  if (total === 0) return null;
  const counts = countObjectiveStatuses(statuses);
  const items = STATUS_ITEMS.filter((i) => i.key !== "NOT_SET" || counts.NOT_SET > 0);
  const remaining = assessment ? assessment.required - assessment.assessed : 0;
  return (
    <div data-workplan-summary className="space-y-2 rounded-[8px] border border-ds-border px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <p className="text-[12px] text-ds-text-secondary">
          <span className="font-semibold text-ds-text-primary">Workplan summary</span>
          <span aria-hidden className="mx-1.5 text-ds-border-strong">
            ·
          </span>
          <span data-workplan-summary-total className="tabular-nums">
            {plural(total, "objective")}
          </span>
        </p>
        {assessment && assessment.required > 0 && (
          <p data-workplan-summary-assessed className="text-[11px] tabular-nums text-ds-text-secondary">
            {assessment.assessed} of {plural(assessment.required, "objective")} assessed
            {remaining > 0 && <span className="text-ds-text-muted"> · {remaining} still require input</span>}
          </p>
        )}
      </div>
      {pendingNote ? (
        <p data-workplan-summary-pending className="text-[12px] text-ds-text-muted">
          {pendingNote}
        </p>
      ) : (
        <>
          <div aria-hidden data-workplan-summary-bar className="flex h-1.5 w-full overflow-hidden rounded-full bg-ds-surface">
            {items
              .filter((i) => counts[i.key] > 0)
              .map((i) => (
                <span key={i.key} data-workplan-summary-segment={i.key} className={i.swatch} style={{ width: `${Math.round((counts[i.key] / total) * 10000) / 100}%` }} />
              ))}
          </div>
          <dl data-workplan-summary-counts className="grid grid-cols-2 gap-x-4 gap-y-1 sm:flex sm:flex-wrap sm:gap-x-5">
            {items.map((i) => (
              <div key={i.key} data-workplan-summary-status={i.key} className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden className={`h-2 w-2 flex-shrink-0 rounded-full ${i.swatch}`} />
                <dt className="text-[11px] text-ds-text-secondary">{i.label}</dt>
                <dd className="text-[12px] font-semibold tabular-nums text-ds-text-primary">
                  {counts[i.key]}
                  <span className="ml-1 font-normal text-ds-text-muted">({percent(counts[i.key], total)}%)</span>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

/** One-line variant for collapsed cards: only the statuses that occur, as label + number. */
export function WorkplanStatusInline({ statuses, className = "" }: { statuses: Array<ObjectiveStatus | null | undefined>; className?: string }) {
  const total = statuses.length;
  if (total === 0) return null;
  const counts = countObjectiveStatuses(statuses);
  return (
    <p data-workplan-summary-inline className={`flex flex-wrap items-center justify-end gap-x-2.5 gap-y-0.5 text-[10px] text-ds-text-secondary ${className}`}>
      <span data-workplan-summary-total className="font-semibold tabular-nums text-ds-text-primary">
        {plural(total, "objective")}
      </span>
      {STATUS_ITEMS.filter((i) => counts[i.key] > 0).map((i) => (
        <span key={i.key} data-workplan-summary-status={i.key} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${i.swatch}`} />
          {i.label} <span className="font-semibold tabular-nums text-ds-text-primary">{counts[i.key]}</span>
        </span>
      ))}
    </p>
  );
}
