"use client";

import { ReportingPerson } from "@/lib/reporting-structure";
import { avatarAccent } from "@/lib/avatar-accent";

interface CycleAppraisal {
  review_type: string;
  status: string;
  cycle_name: string;
}

interface ReportsToCardProps {
  manager: ReportingPerson | null;
  cycleAppraisals: CycleAppraisal[];
  activeCycleName: string | null;
}

function getInitials(fullname: string | null): string {
  if (!fullname) return "??";
  return fullname
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatStatus(status: string): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ReportsToCard({
  manager,
  cycleAppraisals,
  activeCycleName,
}: ReportsToCardProps) {
  const annualAppraisal = cycleAppraisals.find(
    (a) => a.review_type?.toLowerCase() === "annual"
  );
  const midYearAppraisal: CycleAppraisal | null = cycleAppraisals.find(
    (a) => a.review_type?.toLowerCase() === "mid_year"
  ) ?? null;

  return (
    <div className="overflow-hidden rounded-ds-panel border border-ds-border bg-ds-background">
      {/* Header */}
      <div className="border-b border-ds-border px-5 py-3.5">
        <h2 className="m-0 text-[14px] font-semibold text-ds-text-primary">Who You Report To</h2>
      </div>

      {/* Manager block */}
      <div className="border-b border-ds-border px-5 py-4">
        {manager ? (
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[14px] font-semibold ${avatarAccent(manager.full_name).className}`}>
              {getInitials(manager.full_name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-xs text-ds-text-secondary">Line Manager</p>
              <p className="m-0 truncate text-[14px] font-medium text-ds-text-primary">
                {manager.full_name || "Unknown"}
              </p>
              {manager.email && (
                <p className="m-0 truncate text-xs text-ds-text-secondary">{manager.email}</p>
              )}
            </div>
            <button
              type="button"
              className="shrink-0 rounded-ds-button border border-ds-border-strong bg-ds-background px-3 py-1.5 text-xs font-medium text-ds-text-primary transition-colors duration-100 hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus"
            >
              View
            </button>
          </div>
        ) : (
          <p className="m-0 py-2 text-center text-[13px] text-ds-text-secondary">No manager assigned</p>
        )}
      </div>

      {/* Active Cycle Snapshot */}
      <div className="px-5 py-4">
        <p className="m-0 mb-2 text-xs font-medium text-ds-text-secondary">Active Cycle Snapshot</p>
        <dl className="m-0 grid grid-cols-2 divide-x divide-ds-border rounded-ds-panel border border-ds-border">
          <div className="px-3 py-2.5">
            <dt className="text-xs text-ds-text-secondary">Mid-Year</dt>
            <dd className="m-0 mt-0.5 text-[15px] font-semibold text-ds-text-primary">
              {midYearAppraisal ? formatStatus(midYearAppraisal.status) : "—"}
            </dd>
            <dd className="m-0 mt-0.5 text-xs text-ds-text-secondary">{activeCycleName || "No active cycle"}</dd>
          </div>
          <div className="px-3 py-2.5">
            <dt className="text-xs text-ds-text-secondary">Annual</dt>
            <dd className="m-0 mt-0.5 text-[15px] font-semibold text-ds-text-primary">
              {annualAppraisal ? formatStatus(annualAppraisal.status) : "—"}
            </dd>
            <dd className="m-0 mt-0.5 text-xs text-ds-text-secondary">{activeCycleName || "No active cycle"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
