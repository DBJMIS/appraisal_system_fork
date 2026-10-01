import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { statusToneClasses } from "@/lib/appraisal-status-display";
import type { TeamStatusSummary as TeamStatusSummaryData } from "@/lib/team-status-summary";

export function TeamStatusSummary({ summary }: { summary: TeamStatusSummaryData | null | undefined }) {
  if (!summary || summary.directReportCount <= 0) return null;

  const { appraisalCount, directReportCount, buckets } = summary;
  const head =
    appraisalCount > 0
      ? `Team: ${appraisalCount} ${appraisalCount === 1 ? "appraisal" : "appraisals"}`
      : `Team: ${directReportCount} direct ${directReportCount === 1 ? "report" : "reports"}`;

  return (
    <div
      data-team-summary
      title="Appraisals in this cycle for people reporting to this employee"
      className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ds-text-secondary"
    >
      <span>{head}</span>
      {appraisalCount === 0 && (
        <>
          <span aria-hidden="true" className="text-ds-text-muted">·</span>
          <span data-team-empty>No team appraisals for this cycle</span>
        </>
      )}
      {appraisalCount > 0 &&
        buckets.map((b) => (
          <Fragment key={b.key}>
            <span aria-hidden="true" className="text-ds-text-muted">·</span>
            <span data-team-bucket={b.key} className="inline-flex items-center gap-1">
              <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusToneClasses[b.tone].dot)} />
              {b.count} {b.label}
            </span>
          </Fragment>
        ))}
    </div>
  );
}
