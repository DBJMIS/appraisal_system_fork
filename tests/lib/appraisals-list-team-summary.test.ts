import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../helpers/fake-supabase";
import type { AuthUser } from "@/lib/auth";

type Emp = {
  xrm1_employeeid: string;
  _xrm1_manager_employee_id_value: string | null;
  _xrm1_employee_user_id_value: string | null;
};

const state = vi.hoisted(() => ({
  db: null as unknown as FakeSupabase,
  org: [] as Emp[],
  batchFails: false,
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: () => state.db }));
vi.mock("@/lib/reporting-structure", () => ({
  getReportingStructureFromDynamics: vi.fn(async () => ({ employee_id: "x-viewer" })),
}));
vi.mock("@/lib/dynamics-org-service", () => ({
  getDirectReports: vi.fn(async (id: string) => state.org.filter((e) => e._xrm1_manager_employee_id_value === id)),
  getDirectReportsForManagers: vi.fn(async (ids: string[]) => {
    if (state.batchFails) throw new Error("dataverse unavailable");
    return state.org.filter((e) => ids.includes(e._xrm1_manager_employee_id_value ?? ""));
  }),
}));

const emp = (xrm: string, manager: string | null, sys: string | null): Emp => ({
  xrm1_employeeid: xrm,
  _xrm1_manager_employee_id_value: manager,
  _xrm1_employee_user_id_value: sys,
});

const appraisal = (id: string, employee: string, manager: string, status: string, cycle = "cy-1", division = "div-1") => ({
  id,
  employee_id: employee,
  manager_employee_id: manager,
  division_id: division,
  cycle_id: cycle,
  review_type: "ANNUAL",
  status,
  is_active: true,
  created_at: id,
});

function seed() {
  // viewer -> A (manages B1..B3) and C (no reports)
  state.org = [
    emp("x-a", "x-viewer", "sys-a"),
    emp("x-c", "x-viewer", "sys-c"),
    emp("x-b1", "x-a", "sys-b1"),
    emp("x-b2", "x-a", "sys-b2"),
    emp("x-b3", "x-a", "sys-b3"),
  ];
  state.db = new FakeSupabase({
    appraisals: [
      appraisal("ap-a", "sys-a", "sys-viewer", "IN_PROGRESS"),
      appraisal("ap-c", "sys-c", "sys-viewer", "DRAFT"),
      appraisal("ap-b1", "sys-b1", "sys-a", "DRAFT"),
      appraisal("ap-b2", "sys-b2", "sys-a", "DRAFT"),
      appraisal("ap-b3", "sys-b3", "sys-a", "IN_PROGRESS"),
      appraisal("ap-b1-old", "sys-b1", "sys-a", "COMPLETE", "cy-0"),
    ],
    employees: [
      { employee_id: "sys-a", full_name: "Alex Manager", department_name: "Ops" },
      { employee_id: "sys-c", full_name: "Casey Contributor", department_name: "Ops" },
      { employee_id: "sys-b1", full_name: "Beverly Secondlevel", department_name: "Ops" },
      { employee_id: "sys-viewer", full_name: "Viewer", department_name: "Ops" },
    ],
    appraisal_cycles: [
      { id: "cy-1", name: "FY 2026" },
      { id: "cy-0", name: "FY 2025" },
    ],
    appraisal_delegations: [],
  });
}

const viewer = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: "u-viewer",
  email: "viewer@example.test",
  name: "Viewer",
  roles: ["manager"],
  employee_id: "sys-viewer",
  division_id: "div-1",
  ...overrides,
});

async function load(user: AuthUser) {
  const { getAppraisalsListForUser } = await import("@/lib/appraisals-list-data");
  const { reportsAppraisals } = await getAppraisalsListForUser(user);
  const byEmployee = (id: string) => reportsAppraisals.find((r) => r.employeeId === id)!;
  return { reportsAppraisals, byEmployee };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://fake.local");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fake-key");
  state.batchFails = false;
  seed();
});

describe("My Team's Appraisals team summary", () => {
  it("summarises a manager's direct reports for the same cycle when the viewer may see them", async () => {
    const { byEmployee } = await load(viewer({ roles: ["hr"] }));
    const summary = byEmployee("sys-a").teamSummary!;
    expect(summary.directReportCount).toBe(3);
    expect(summary.appraisalCount).toBe(3);
    expect(summary.buckets.map((b) => [b.label, b.count])).toEqual([
      ["Draft", 2],
      ["In Progress", 1],
    ]);
  });

  it("shows no summary for an employee with no direct reports", async () => {
    const { byEmployee } = await load(viewer({ roles: ["hr"] }));
    expect(byEmployee("sys-c").teamSummary).toBeUndefined();
  });

  it("counts mixed statuses into the four groups", async () => {
    state.db.tables.appraisals.push(
      appraisal("ap-b4", "sys-b4", "sys-a", "MANAGER_REVIEW"),
      appraisal("ap-b5", "sys-b5", "sys-a", "COMPLETE"),
      appraisal("ap-b6", "sys-b6", "sys-a", "PENDING_SIGNOFF")
    );
    state.org.push(emp("x-b4", "x-a", "sys-b4"), emp("x-b5", "x-a", "sys-b5"), emp("x-b6", "x-a", "sys-b6"));
    const { byEmployee } = await load(viewer({ roles: ["admin"] }));
    const summary = byEmployee("sys-a").teamSummary!;
    expect(summary.directReportCount).toBe(6);
    expect(summary.buckets.map((b) => [b.label, b.count, b.tone])).toEqual([
      ["Draft", 2, "neutral"],
      ["Pending", 2, "warning"],
      ["In Progress", 1, "progress"],
      ["Complete", 1, "success"],
    ]);
  });

  it("gives a plain manager the team summary of a manager-of-record below them (read-only oversight)", async () => {
    const { byEmployee } = await load(viewer());
    const summary = byEmployee("sys-a").teamSummary!;
    expect(summary.appraisalCount).toBe(3);
    expect(summary.buckets.map((b) => [b.label, b.count])).toEqual([
      ["Draft", 2],
      ["In Progress", 1],
    ]);
  });

  it("leaves the team list unchanged if the org lookup fails", async () => {
    state.batchFails = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reportsAppraisals } = await load(viewer({ roles: ["hr"] }));
    expect(reportsAppraisals.map((r) => r.appraisalId).sort()).toEqual(["ap-a", "ap-c"]);
    expect(reportsAppraisals.every((r) => r.teamSummary === undefined)).toBe(true);
    expect(JSON.stringify(reportsAppraisals)).not.toContain("ap-b1");
    warn.mockRestore();
  });
});

describe("My Team's Appraisals hierarchy", () => {
  it("keeps direct reports as top-level rows with direct access", async () => {
    const { reportsAppraisals } = await load(viewer());
    expect(reportsAppraisals.map((r) => r.appraisalId).sort()).toEqual(["ap-a", "ap-c"]);
    expect(reportsAppraisals.every((r) => r.access === "direct")).toBe(true);
  });

  it("nests the same-cycle team appraisals of a direct report as oversight rows", async () => {
    const { byEmployee } = await load(viewer());
    const team = byEmployee("sys-a").team!;
    expect(team.map((t) => [t.appraisalId, t.status, t.access]).sort()).toEqual([
      ["ap-b1", "DRAFT", "oversight"],
      ["ap-b2", "DRAFT", "oversight"],
      ["ap-b3", "IN_PROGRESS", "oversight"],
    ]);
    expect(team.find((t) => t.appraisalId === "ap-b1")!.employeeName).toBe("Beverly Secondlevel");
    expect(JSON.stringify(team)).not.toContain("ap-b1-old");
  });

  it("gives an employee without a team no nested rows and no summary", async () => {
    const { byEmployee } = await load(viewer());
    expect(byEmployee("sys-c").team).toBeUndefined();
    expect(byEmployee("sys-c").teamSummary).toBeUndefined();
  });

  it("reports a team with no appraisals in the cycle as a headcount without nested rows", async () => {
    state.db.tables.appraisals = state.db.tables.appraisals.filter((a) => !String(a.id).startsWith("ap-b"));
    const { byEmployee } = await load(viewer());
    expect(byEmployee("sys-a").team).toBeUndefined();
    expect(byEmployee("sys-a").teamSummary).toEqual({ directReportCount: 3, appraisalCount: 0, buckets: [] });
  });

  it("nests recursively (senior manager → manager → employee) with correct nested status", async () => {
    state.org.push(emp("x-d1", "x-b1", "sys-d1"));
    state.db.tables.appraisals.push(appraisal("ap-d1", "sys-d1", "sys-b1", "MANAGER_REVIEW"));
    const { byEmployee } = await load(viewer());
    const b1 = byEmployee("sys-a").team!.find((t) => t.appraisalId === "ap-b1")!;
    expect(b1.team!.map((t) => [t.appraisalId, t.status, t.access])).toEqual([["ap-d1", "MANAGER_REVIEW", "oversight"]]);
    expect(b1.teamSummary!.buckets.map((b) => [b.label, b.count])).toEqual([["Pending", 1]]);
  });

  it("stops at a circular reporting line instead of looping", async () => {
    // B1 is (wrongly) recorded as managing A and the viewer.
    state.org.push(emp("x-a", "x-b1", "sys-a"), emp("x-viewer", "x-b1", "sys-viewer"));
    const { reportsAppraisals, byEmployee } = await load(viewer());
    expect(reportsAppraisals.map((r) => r.appraisalId).sort()).toEqual(["ap-a", "ap-c"]);
    const b1 = byEmployee("sys-a").team!.find((t) => t.appraisalId === "ap-b1")!;
    expect(b1.team).toBeUndefined();
    const serialised = JSON.stringify(reportsAppraisals);
    expect(serialised.match(/"appraisalId":"ap-a"/g)).toHaveLength(1);
  });

  it("does not go deeper than the oversight depth limit", async () => {
    const { OVERSIGHT_MAX_DEPTH } = await import("@/lib/appraisal-oversight");
    // Chain below B1: L3 -> L4 -> L5 ... one appraisal per level.
    let manager = "x-b1";
    let managerSys = "sys-b1";
    for (let level = 3; level <= OVERSIGHT_MAX_DEPTH + 2; level++) {
      state.org.push(emp(`x-l${level}`, manager, `sys-l${level}`));
      state.db.tables.appraisals.push(appraisal(`ap-l${level}`, `sys-l${level}`, managerSys, "DRAFT"));
      manager = `x-l${level}`;
      managerSys = `sys-l${level}`;
    }
    const { reportsAppraisals } = await load(viewer());
    const serialised = JSON.stringify(reportsAppraisals);
    for (let level = 3; level <= OVERSIGHT_MAX_DEPTH; level++) expect(serialised).toContain(`ap-l${level}`);
    expect(serialised).not.toContain(`ap-l${OVERSIGHT_MAX_DEPTH + 1}`);
    expect(serialised).not.toContain(`ap-l${OVERSIGHT_MAX_DEPTH + 2}`);
  });

  it("looks up each hierarchy level with one batched Dynamics call", async () => {
    const org = await import("@/lib/dynamics-org-service");
    const batch = vi.mocked(org.getDirectReportsForManagers);
    batch.mockClear();
    await load(viewer());
    // Level 2 finds B1..B3; level 3 asks for all of them at once; no per-employee calls.
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[1][0].sort()).toEqual(["x-b1", "x-b2", "x-b3"]);
  });
});
