import type { StatusTone } from "@/lib/appraisal-status-display";

export type TeamStatusBucketKey = "draft" | "pending" | "in_progress" | "complete";

export interface TeamStatusBucket {
  key: TeamStatusBucketKey;
  label: string;
  tone: StatusTone;
  count: number;
}

/** Aggregate counts only; never carries appraisal ids, employee ids or names. */
export interface TeamStatusSummary {
  directReportCount: number;
  appraisalCount: number;
  buckets: TeamStatusBucket[];
}

const BUCKETS: ReadonlyArray<{ key: TeamStatusBucketKey; label: string; tone: StatusTone; statuses: string[] }> = [
  { key: "draft", label: "Draft", tone: "neutral", statuses: ["DRAFT"] },
  {
    key: "pending",
    label: "Pending",
    tone: "warning",
    statuses: ["PENDING_APPROVAL", "SUBMITTED", "MANAGER_REVIEW", "HOD_REVIEW", "PENDING_SIGNOFF", "HR_REVIEW"],
  },
  { key: "in_progress", label: "In Progress", tone: "progress", statuses: ["IN_PROGRESS", "SELF_ASSESSMENT"] },
  { key: "complete", label: "Complete", tone: "success", statuses: ["COMPLETE"] },
];

export function teamStatusBucket(status: string | null | undefined): TeamStatusBucketKey | null {
  const s = (status ?? "").trim().toUpperCase();
  return BUCKETS.find((b) => b.statuses.includes(s))?.key ?? null;
}

/** Returns null when the employee has no direct reports, so no summary is shown. */
export function summarizeTeamStatuses(
  directReportCount: number,
  statuses: ReadonlyArray<string | null | undefined>
): TeamStatusSummary | null {
  if (directReportCount <= 0) return null;
  const counts = new Map<TeamStatusBucketKey, number>();
  for (const status of statuses) {
    const key = teamStatusBucket(status);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    directReportCount,
    appraisalCount: statuses.length,
    buckets: BUCKETS.filter((b) => (counts.get(b.key) ?? 0) > 0).map((b) => ({
      key: b.key,
      label: b.label,
      tone: b.tone,
      count: counts.get(b.key) ?? 0,
    })),
  };
}

export function formatTeamSummary(summary: TeamStatusSummary): string {
  if (summary.appraisalCount === 0) {
    return `Team: ${summary.directReportCount} direct ${summary.directReportCount === 1 ? "report" : "reports"}`;
  }
  const head = `Team: ${summary.appraisalCount} ${summary.appraisalCount === 1 ? "appraisal" : "appraisals"}`;
  return [head, ...summary.buckets.map((b) => `${b.count} ${b.label}`)].join(" · ");
}
