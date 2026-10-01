"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReviewTypeBadge } from "@/components/ui/review-type-badge";
import { EmployeeCell } from "@/components/ui/employee-cell";
import { CycleChip } from "@/components/ui/cycle-chip";
import { TeamStatusSummary } from "@/components/appraisal/TeamStatusSummary";
import type { TeamStatusSummary as TeamStatusSummaryData } from "@/lib/team-status-summary";

export interface TeamAppraisalRow {
  appraisalId: string;
  employeeName: string;
  cycleName: string;
  reviewType: string;
  status: string;
  delegatedToName?: string | null;
  teamSummary?: TeamStatusSummaryData | null;
  team?: TeamAppraisalRow[];
  access?: "direct" | "oversight";
}

const ChevronRightIcon = () => (
  <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

function TeamToggle({ expanded, name, onToggle }: { expanded: boolean; name: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-team-toggle
      aria-expanded={expanded}
      aria-label={`${expanded ? "Hide" : "Show"} ${name}'s team appraisals`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-ds-text-secondary transition-colors hover:bg-ds-surface hover:text-ds-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        className={cn("h-3 w-3 transition-transform duration-150", expanded && "rotate-90")}
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}

/** One team row plus, when expanded, that person's own team appraisals underneath (view only). */
export function TeamAppraisalRowGroup({
  row,
  depth = 0,
  first = false,
}: {
  row: TeamAppraisalRow;
  depth?: number;
  first?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const team = row.team ?? [];
  const canExpand = team.length > 0;
  const oversight = row.access === "oversight";

  const summaryLine = (
    <div className="flex items-start gap-1">
      {canExpand && <TeamToggle expanded={expanded} name={row.employeeName} onToggle={() => setExpanded((v) => !v)} />}
      <TeamStatusSummary summary={row.teamSummary} />
    </div>
  );

  return (
    <>
      <tr
        data-team-row
        data-depth={depth}
        data-access={oversight ? "oversight" : "direct"}
        className={cn("group transition-colors hover:bg-ds-surface", depth > 0 ? "bg-ds-background" : "cursor-pointer")}
        style={{ borderTop: first ? undefined : "1px solid var(--border-color)" }}
      >
        <td className={depth > 0 ? "px-5 py-2.5" : "px-5 py-3.5"}>
          {depth > 0 ? (
            <div style={{ paddingLeft: (depth - 1) * 20 }}>
              <div className="flex items-center gap-1.5 text-[13px] text-ds-text-primary">
                <span aria-hidden="true" className="text-ds-text-muted">↳</span>
                <span className="truncate">{row.employeeName}</span>
              </div>
              <div className="pl-[18px]">{summaryLine}</div>
            </div>
          ) : (
            <div>
              <EmployeeCell name={row.employeeName} />
              {row.delegatedToName && (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ds-text-secondary">
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-ds-lavender" />
                  Delegated to {row.delegatedToName}
                </div>
              )}
              {summaryLine}
            </div>
          )}
        </td>
        <td className={depth > 0 ? "px-5 py-2.5" : "px-5 py-3.5"}>
          <CycleChip year={row.cycleName} />
        </td>
        <td className={depth > 0 ? "px-5 py-2.5" : "px-5 py-3.5"}>
          <ReviewTypeBadge type={row.reviewType} />
        </td>
        <td className={depth > 0 ? "px-5 py-2.5" : "px-5 py-3.5"}>
          <div className="flex items-center gap-2">
            <StatusBadge status={row.status} />
          </div>
        </td>
        <td className={cn("text-right", depth > 0 ? "px-5 py-2.5" : "px-5 py-3.5")}>
          {oversight ? (
            <Link
              href={`/appraisals/${row.appraisalId}`}
              data-view-only
              title="View only"
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium text-text-secondary transition-colors hover:bg-ds-surface hover:text-ds-text-primary"
            >
              View
              <span className="sr-only"> {row.employeeName}&apos;s appraisal (view only)</span>
            </Link>
          ) : (
            <Link
              href={`/appraisals/${row.appraisalId}`}
              className="group inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium text-text-secondary transition-all hover:bg-accent hover:text-white"
              style={{ border: "1px solid var(--border-color)" }}
            >
              Open
              <ChevronRightIcon />
            </Link>
          )}
        </td>
      </tr>
      {expanded && team.map((child) => <TeamAppraisalRowGroup key={child.appraisalId} row={child} depth={depth + 1} />)}
    </>
  );
}
