/**
 * Dev-only: when set, allows the current user to perform any appraisal role action
 * (employee, manager, HOD, HR) for workflow testing without switching accounts.
 * Only active when NODE_ENV=development and ALLOW_APPRAISAL_TEST_BYPASS=true.
 */
export function allowAppraisalTestBypass(): boolean {
  return process.env.NODE_ENV === "development" && process.env.ALLOW_APPRAISAL_TEST_BYPASS === "true";
}

/**
 * Client-side counterpart for UI affordances.
 * Only active when NODE_ENV=development and NEXT_PUBLIC_ALLOW_APPRAISAL_TEST_BYPASS=true.
 */
export function allowAppraisalTestBypassClient(): boolean {
  return process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_ALLOW_APPRAISAL_TEST_BYPASS === "true";
}
