import { beforeEach, describe, expect, it, vi } from "vitest";

type Emp = {
  xrm1_employeeid: string;
  _xrm1_manager_employee_id_value: string | null;
  _xrm1_employee_user_id_value: string | null;
};

const state = vi.hoisted(() => ({ org: [] as Emp[], calls: 0, clients: 0, fail: false }));

vi.mock("@/lib/dynamics-sync", () => ({
  createDataverseApiClient: vi.fn(async () => {
    state.clients++;
    return {
      get: vi.fn(async (url: string) => {
        state.calls++;
        if (state.fail) throw Object.assign(new Error("token expired for tenant"), { name: "DataverseError" });
        const filter = decodeURIComponent(url.match(/\$filter=([^&]+)/)![1]);
        const [, field, value] = filter.match(/^(\S+) eq (\S+)$/)!;
        const match = state.org.find((e) => (e as Record<string, unknown>)[field] === value);
        return { data: { value: match ? [match] : [] } };
      }),
    };
  }),
}));

const emp = (xrm: string, manager: string | null, sys: string | null): Emp => ({
  xrm1_employeeid: xrm,
  _xrm1_manager_employee_id_value: manager,
  _xrm1_employee_user_id_value: sys,
});

beforeEach(async () => {
  state.calls = 0;
  state.clients = 0;
  state.fail = false;
  // ceo -> senior -> manager -> employee
  state.org = [
    emp("x-ceo", null, "sys-ceo"),
    emp("x-senior", "x-ceo", "sys-senior"),
    emp("x-manager", "x-senior", "sys-manager"),
    emp("x-employee", "x-manager", "sys-employee"),
    emp("x-other", "x-ceo", "sys-other"),
  ];
  const { clearOversightCache } = await import("@/lib/appraisal-oversight");
  clearOversightCache();
});

describe("getManagerChainSystemUserIds", () => {
  it("returns the managers above an employee, nearest first, using one Dataverse client", async () => {
    const { getManagerChainSystemUserIds } = await import("@/lib/dynamics-org-service");
    expect(await getManagerChainSystemUserIds("sys-employee", 10)).toEqual(["sys-manager", "sys-senior", "sys-ceo"]);
    expect(state.clients).toBe(1);
    expect(state.calls).toBe(4);
  });

  it("stops at a circular reporting line", async () => {
    state.org = [
      emp("x-a", "x-b", "sys-a"),
      emp("x-b", "x-c", "sys-b"),
      emp("x-c", "x-a", "sys-c"),
    ];
    const { getManagerChainSystemUserIds } = await import("@/lib/dynamics-org-service");
    expect(await getManagerChainSystemUserIds("sys-a", 50)).toEqual(["sys-b", "sys-c"]);
    expect(state.calls).toBe(3);
  });

  it("stops when an employee is recorded as their own manager", async () => {
    state.org = [emp("x-a", "x-a", "sys-a")];
    const { getManagerChainSystemUserIds } = await import("@/lib/dynamics-org-service");
    expect(await getManagerChainSystemUserIds("sys-a", 50)).toEqual([]);
  });

  it("never walks further than the depth limit", async () => {
    state.org = Array.from({ length: 12 }, (_, i) => emp(`x-${i}`, `x-${i + 1}`, `sys-${i}`));
    const { getManagerChainSystemUserIds } = await import("@/lib/dynamics-org-service");
    expect(await getManagerChainSystemUserIds("sys-0", 3)).toEqual(["sys-1", "sys-2", "sys-3"]);
    expect(state.calls).toBe(4);
  });

  it("returns nothing for a blank id or zero depth without calling Dynamics", async () => {
    const { getManagerChainSystemUserIds } = await import("@/lib/dynamics-org-service");
    expect(await getManagerChainSystemUserIds("", 4)).toEqual([]);
    expect(await getManagerChainSystemUserIds("sys-employee", 0)).toEqual([]);
    expect(state.calls).toBe(0);
  });
});

describe("canViewAppraisalForOversight", () => {
  it("allows the manager's manager and higher, within the depth limit", async () => {
    const { canViewAppraisalForOversight } = await import("@/lib/appraisal-oversight");
    expect(await canViewAppraisalForOversight("sys-senior", "sys-employee")).toBe(true);
    expect(await canViewAppraisalForOversight("sys-ceo", "sys-employee")).toBe(true);
  });

  it("matches ids regardless of case and braces", async () => {
    const { canViewAppraisalForOversight } = await import("@/lib/appraisal-oversight");
    expect(await canViewAppraisalForOversight("{SYS-SENIOR}", "sys-employee")).toBe(true);
  });

  it("denies an unrelated manager, a subordinate and the employee themselves", async () => {
    const { canViewAppraisalForOversight } = await import("@/lib/appraisal-oversight");
    expect(await canViewAppraisalForOversight("sys-other", "sys-employee")).toBe(false);
    expect(await canViewAppraisalForOversight("sys-employee", "sys-manager")).toBe(false);
    expect(await canViewAppraisalForOversight("sys-employee", "sys-employee")).toBe(false);
  });

  it("denies anyone above the depth limit", async () => {
    const { canViewAppraisalForOversight, OVERSIGHT_MAX_DEPTH } = await import("@/lib/appraisal-oversight");
    state.org = Array.from({ length: OVERSIGHT_MAX_DEPTH + 3 }, (_, i) => emp(`x-${i}`, `x-${i + 1}`, `sys-${i}`));
    expect(await canViewAppraisalForOversight(`sys-${OVERSIGHT_MAX_DEPTH}`, "sys-0")).toBe(true);
    expect(await canViewAppraisalForOversight(`sys-${OVERSIGHT_MAX_DEPTH + 1}`, "sys-0")).toBe(false);
  });

  it("denies when either id is missing, without calling Dynamics", async () => {
    const { canViewAppraisalForOversight, hasOversightReadAccess } = await import("@/lib/appraisal-oversight");
    expect(await canViewAppraisalForOversight(null, "sys-employee")).toBe(false);
    expect(await canViewAppraisalForOversight("sys-ceo", undefined)).toBe(false);
    expect(await hasOversightReadAccess({ employee_id: null }, { employee_id: "sys-employee" })).toBe(false);
    expect(await hasOversightReadAccess(null, { employee_id: "sys-employee" })).toBe(false);
    expect(state.calls).toBe(0);
  });

  it("fails closed when Dynamics is unavailable and does not log the error message", async () => {
    state.fail = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { canViewAppraisalForOversight } = await import("@/lib/appraisal-oversight");
    expect(await canViewAppraisalForOversight("sys-senior", "sys-employee")).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("tenant");
    warn.mockRestore();
  });

  it("caches the chain briefly so repeated checks on one page do not re-query Dynamics", async () => {
    const { canViewAppraisalForOversight } = await import("@/lib/appraisal-oversight");
    await canViewAppraisalForOversight("sys-senior", "sys-employee");
    const after = state.calls;
    await canViewAppraisalForOversight("sys-ceo", "sys-employee");
    expect(state.calls).toBe(after);
  });
});
