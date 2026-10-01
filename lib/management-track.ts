/**
 * Management track (whether Leadership applies), resolved the way the appraisal page decides it:
 * `appraisals.is_management`, or direct reports in Dynamics HR (xrm1_employees via the same
 * org-service lookups as getReportingStructureFromDynamics).
 * Used by formal Mid-Year creation, annual completion and the appraisal PDF. Server-only: it calls Dataverse.
 */

import { getDirectReports, getEmployeeBySystemUserId } from "@/lib/dynamics-org-service";

export class ManagementTrackError extends Error {
  constructor(detail: string) {
    super(`Could not determine management track: ${detail}`);
    this.name = "ManagementTrackError";
  }
}

/** Never guesses: a failed or inconclusive HR lookup throws ManagementTrackError. */
export async function resolveManagementTrack(appraisal: {
  employee_id: string;
  is_management?: boolean | null;
}): Promise<boolean> {
  if (appraisal.is_management === true) return true;

  let hrEmployeeId: string | null;
  try {
    const employee = await getEmployeeBySystemUserId(appraisal.employee_id);
    hrEmployeeId = employee?.xrm1_employeeid ?? null;
  } catch (err) {
    throw new ManagementTrackError(`HR lookup failed (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!hrEmployeeId) throw new ManagementTrackError("employee not found in HR");

  try {
    const directReports = await getDirectReports(hrEmployeeId);
    return directReports.length > 0;
  } catch (err) {
    throw new ManagementTrackError(`direct reports lookup failed (${err instanceof Error ? err.message : String(err)})`);
  }
}
