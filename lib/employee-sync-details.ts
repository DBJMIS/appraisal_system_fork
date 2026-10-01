/**
 * Per-run Employee Sync detail snapshot stored in employee_sync_log.details.
 * Names are captured at sync time and must never be re-resolved from the current employees table.
 */

export type SyncDetailPerson = { employee_id: string; full_name: string | null };

export type SyncDeactivatedReason = "not_in_active_dynamics_sync";
export type SyncSkippedReason = "duplicate_email" | "rekeyed" | "email_conflict";

export type EmployeeSyncDetails = {
  added: SyncDetailPerson[];
  reactivated: SyncDetailPerson[];
  deactivated: Array<SyncDetailPerson & { reason: SyncDeactivatedReason | string }>;
  no_appraisal: SyncDetailPerson[];
  skipped: Array<Partial<SyncDetailPerson> & { reason: SyncSkippedReason | string }>;
};

export const SYNC_DETAIL_SECTIONS = ["added", "reactivated", "deactivated", "no_appraisal", "skipped"] as const;
export type SyncDetailSection = (typeof SYNC_DETAIL_SECTIONS)[number];

export const SYNC_DETAIL_SECTION_LABELS: Record<SyncDetailSection, string> = {
  added: "Added",
  reactivated: "Reactivated",
  deactivated: "Deactivated",
  no_appraisal: "No appraisal",
  skipped: "Skipped",
};

export const SYNC_REASON_LABELS: Record<string, string> = {
  not_in_active_dynamics_sync: "Not returned in the active Dynamics employee list for this sync.",
  duplicate_email: "Duplicate email in Dynamics; another record with this email was kept.",
  rekeyed: "Matched an existing record by email; employee ID updated.",
  email_conflict: "Matched an existing record by email; existing employee ID kept.",
};

export function syncReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  return SYNC_REASON_LABELS[reason] ?? reason;
}

const asList = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const person = (x: Record<string, unknown>): SyncDetailPerson => ({
  employee_id: str(x.employee_id) ?? "",
  full_name: str(x.full_name),
});

/** Normalises a stored details value; returns null when details were not recorded. */
export function parseSyncDetails(value: unknown): EmployeeSyncDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return {
    added: asList(v.added).map(person),
    reactivated: asList(v.reactivated).map(person),
    deactivated: asList(v.deactivated).map((x) => ({
      ...person(x),
      reason: str(x.reason) ?? "not_in_active_dynamics_sync",
    })),
    no_appraisal: asList(v.no_appraisal).map(person),
    skipped: asList(v.skipped).map((x) => ({
      ...(str(x.employee_id) ? { employee_id: str(x.employee_id)! } : {}),
      ...(str(x.full_name) ? { full_name: str(x.full_name) } : {}),
      reason: str(x.reason) ?? "unknown",
    })),
  };
}
