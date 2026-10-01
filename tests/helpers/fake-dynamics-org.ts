/**
 * Stand-in for the two Dynamics HR lookups used to resolve a formal Mid-Year management track.
 * Every appraisal employee exists in HR as `hr-<employee_id>` with no direct reports unless set.
 *
 *   vi.mock("@/lib/dynamics-org-service", async (orig) => ({ ...(await orig()), ...fakeDynamicsOrg }));
 */

export const fakeHr = {
  directReports: {} as Record<string, number>,
  missing: new Set<string>(),
  error: null as Error | null,
  calls: [] as string[],
  reset() {
    this.directReports = {};
    this.missing = new Set();
    this.error = null;
    this.calls = [];
  },
};

export const fakeDynamicsOrg = {
  async getEmployeeBySystemUserId(systemUserId: string) {
    fakeHr.calls.push(`employee:${systemUserId}`);
    if (fakeHr.error) throw fakeHr.error;
    return fakeHr.missing.has(systemUserId) ? null : { xrm1_employeeid: `hr-${systemUserId}` };
  },
  async getDirectReports(hrEmployeeId: string) {
    fakeHr.calls.push(`reports:${hrEmployeeId}`);
    if (fakeHr.error) throw fakeHr.error;
    const count = fakeHr.directReports[hrEmployeeId.replace(/^hr-/, "")] ?? 0;
    return Array.from({ length: count }, (_, i) => ({ xrm1_employeeid: `hr-report-${i}` }));
  },
};
