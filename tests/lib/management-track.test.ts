import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeHr } from "../helpers/fake-dynamics-org";

vi.mock("@/lib/dynamics-org-service", async (orig) => ({ ...(await orig<object>()), ...(await import("../helpers/fake-dynamics-org")).fakeDynamicsOrg }));

import { ManagementTrackError, resolveManagementTrack } from "@/lib/management-track";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

beforeEach(() => fakeHr.reset());

describe("resolveManagementTrack", () => {
  it("flagged management is the management track without an HR lookup", async () => {
    expect(await resolveManagementTrack({ employee_id: "emp-1", is_management: true })).toBe(true);
    expect(fakeHr.calls).toEqual([]);
  });

  it("an employee with direct reports in Dynamics HR is the management track", async () => {
    fakeHr.directReports["emp-1"] = 2;
    expect(await resolveManagementTrack({ employee_id: "emp-1", is_management: false })).toBe(true);
    expect(fakeHr.calls).toEqual(["employee:emp-1", "reports:hr-emp-1"]);
  });

  it("an employee without direct reports is not the management track", async () => {
    expect(await resolveManagementTrack({ employee_id: "emp-1", is_management: null })).toBe(false);
  });

  it("a failed HR lookup is a controlled error, not a default", async () => {
    fakeHr.error = new Error("Dataverse unavailable");
    await expect(resolveManagementTrack({ employee_id: "emp-1", is_management: false })).rejects.toBeInstanceOf(ManagementTrackError);
    await expect(resolveManagementTrack({ employee_id: "emp-1", is_management: false })).rejects.toThrow(
      "Could not determine management track: HR lookup failed (Dataverse unavailable)"
    );
  });

  it("an employee missing from HR is a controlled error, not a default", async () => {
    fakeHr.missing.add("emp-1");
    await expect(resolveManagementTrack({ employee_id: "emp-1", is_management: false })).rejects.toThrow(
      "Could not determine management track: employee not found in HR"
    );
  });
});

describe("one management-track source", () => {
  const trackPaths = [
    "lib/management-track.ts",
    "lib/midyear-assessment.ts",
    "lib/appraisal-completion.ts",
    "lib/appraisal-completion-report.ts",
    "lib/pdf/fetch-appraisal-pdf-data.ts",
    "app/api/appraisals/[id]/checkins/route.ts",
  ];

  it("no management-track path filters employees by manager_employee_id", () => {
    for (const file of trackPaths) {
      expect(read(file), file).not.toMatch(/from\("employees"\)[^;]*\.eq\("manager_employee_id"/);
    }
  });

  it("Mid-Year creation, annual completion and the PDF all use resolveManagementTrack", () => {
    for (const file of ["app/api/appraisals/[id]/checkins/route.ts", "lib/appraisal-completion-report.ts", "lib/pdf/fetch-appraisal-pdf-data.ts"]) {
      expect(read(file), file).toContain('import { resolveManagementTrack } from "@/lib/management-track";');
      expect(read(file), file).toContain("await resolveManagementTrack(");
    }
  });

  it("uses the same Dynamics lookups as the appraisal page's reporting structure", () => {
    expect(read("lib/management-track.ts")).toMatch(/import \{ getDirectReports, getEmployeeBySystemUserId \} from "@\/lib\/dynamics-org-service"/);
    expect(read("lib/reporting-structure.ts")).toMatch(/getEmployeeBySystemUserId\(systemUserId\)/);
    expect(read("lib/reporting-structure.ts")).toMatch(/getDirectReports\(emp\.xrm1_employeeid\)/);
    expect(read("app/appraisals/[id]/page.tsx")).toContain("const showLeadership = appraisal.is_management || hasDirectReports;");
  });

  it("stays out of modules that browser components import", () => {
    for (const file of ["lib/midyear-assessment.ts", "lib/appraisal-completion.ts"]) {
      expect(read(file), file).not.toMatch(/from "@\/lib\/(management-track|dynamics-org-service|appraisal-completion-report)"/);
    }
    expect(read("lib/appraisal-completion.ts")).not.toContain("export async function fetchCompletionReport");
  });
});
