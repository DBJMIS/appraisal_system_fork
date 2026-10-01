import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeSupabase } from "../helpers/fake-supabase";
import { ACTIVE_FACTORS, CATEGORIES, RATING_SCALE } from "../helpers/factor-fixtures";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  chains: {} as Record<string, string[]>,
  chainCalls: 0,
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/hrmis-approval-auth", () => ({ resolveManagerSystemUserId: vi.fn(async () => "mgr-1") }));
vi.mock("@/lib/dynamics-org-service", () => ({
  getManagerChainSystemUserIds: vi.fn(async (employeeId: string, maxDepth: number) => {
    mocks.chainCalls++;
    return (mocks.chains[employeeId] ?? []).slice(0, maxDepth);
  }),
}));

import * as workplan from "@/app/api/appraisals/[id]/workplan/route";
import * as factorRatings from "@/app/api/appraisals/[id]/factor-ratings/route";
import * as technical from "@/app/api/appraisals/[id]/technical-competencies/route";
import * as audit from "@/app/api/appraisals/[id]/audit/route";
import * as hrRecommendations from "@/app/api/appraisals/[id]/hr-recommendations/route";
import { clearOversightCache } from "@/lib/appraisal-oversight";

const ID = "a-1";
const USERS = {
  employee: { id: "u-emp", roles: [], employee_id: "emp-1" },
  manager: { id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" },
  senior: { id: "u-sr", roles: ["manager"], employee_id: "sr-1" },
  head: { id: "u-head", roles: ["manager"], employee_id: "head-1" },
  unrelated: { id: "u-om", roles: ["manager"], employee_id: "mgr-2" },
  hr: { id: "u-hr", roles: ["hr"], employee_id: "hr-1" },
  admin: { id: "u-admin", roles: ["admin"], employee_id: "admin-1" },
};

let db: FakeSupabase;

function seed(status = "MANAGER_REVIEW", withWorkplan = true) {
  db = new FakeSupabase({
    appraisals: [{ id: ID, status, employee_id: "emp-1", manager_employee_id: "mgr-1", division_id: "div-1" }],
    appraisal_delegations: [],
    workplans: withWorkplan ? [{ id: "wp-1", appraisal_id: ID, status: "approved" }] : [],
    workplan_items: withWorkplan
      ? [{ id: "wi-1", workplan_id: "wp-1", major_task: "Deliver report", weight: 100, created_at: "2026-01-01" }]
      : [],
    appraisal_technical_competencies: [{ id: "tc-1", appraisal_id: ID, name: "Modelling", required_level: "3", display_order: 0 }],
    appraisal_factor_ratings: [
      { id: "r-1", appraisal_id: ID, factor_id: ACTIVE_FACTORS[0].id, self_rating_code: "B", manager_rating_code: null, self_comments: null, manager_comments: null, weight: 20 },
    ],
    evaluation_categories: CATEGORIES.map((c) => ({ ...c })),
    evaluation_factors: ACTIVE_FACTORS.map((f) => ({ ...f })),
    rating_scale: RATING_SCALE.map((r) => ({ ...r })),
    appraisal_audit: [{ id: "au-1", appraisal_id: ID, action_type: "STATUS", actor_id: null, acted_at: "2026-01-01", summary: "x" }],
    app_users: [],
  });
  mocks.createClient.mockReturnValue(db);
}

const ctx = () => ({ params: Promise.resolve({ id: ID }) });
const req = (method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost/api/appraisals/${ID}/x`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });

const as = (user: (typeof USERS)[keyof typeof USERS]) => mocks.getCurrentUser.mockResolvedValue(user);

const reads = {
  workplan: () => workplan.GET(req(), ctx()),
  factorRatings: () => factorRatings.GET(req(), ctx()),
  technical: () => technical.GET(req(), ctx()),
};

const mutations = {
  "POST workplan": () => workplan.POST(req("POST", { workplanId: "wp-1", items: [], idsToDelete: ["wi-1"] }), ctx()),
  "POST factor-ratings": () =>
    factorRatings.POST(req("POST", { ratings: [{ factor_id: ACTIVE_FACTORS[0].id, manager_rating_code: "A" }] }), ctx()),
  "POST technical-competencies": () => technical.POST(req("POST", { name: "New", required_level: "2" }), ctx()),
  "PUT technical-competencies": () =>
    technical.PUT(req("PUT", { competencies: [{ id: "tc-1", name: "Renamed", required_level: "4" }] }), ctx()),
  "DELETE technical-competencies": () => {
    // Deletion is only possible in Draft, so test the role check there.
    db.tables.appraisals[0].status = "DRAFT";
    return technical.DELETE(
      new NextRequest(`http://localhost/api/appraisals/${ID}/technical-competencies?competencyId=tc-1`, { method: "DELETE" }),
      ctx()
    );
  },
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://fake.local");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fake-key");
  // emp-1 reports to mgr-1, who reports to sr-1, who reports to head-1.
  mocks.chains = { "emp-1": ["mgr-1", "sr-1", "head-1"] };
  mocks.chainCalls = 0;
  clearOversightCache();
  seed();
});

describe("read-only oversight: ancestor managers", () => {
  it.each(Object.keys(reads) as (keyof typeof reads)[])("manager's manager can read %s", async (name) => {
    as(USERS.senior);
    const res = await reads[name]();
    expect(res.status).toBe(200);
  });

  it("a higher ancestor can also read, and sees the stored data", async () => {
    as(USERS.head);
    const wp = await (await reads.workplan()).json();
    expect(wp.items.map((i: { id: string }) => i.id)).toEqual(["wi-1"]);
    const tc = await (await reads.technical()).json();
    expect(tc.competencies.map((c: { id: string }) => c.id)).toEqual(["tc-1"]);
    const fr = await (await reads.factorRatings()).json();
    expect(fr.ratings).toHaveLength(1);
  });

  it("does not create a workplan when an ancestor opens an appraisal that has none", async () => {
    seed("DRAFT", false);
    as(USERS.senior);
    const res = await reads.workplan();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workplan: null, items: [] });
    expect(db.writes).toEqual([]);
    expect(db.tables.workplans).toHaveLength(0);
  });

  it.each(Object.keys(mutations) as (keyof typeof mutations)[])("ancestor gets 403 on %s and nothing is written", async (name) => {
    as(USERS.senior);
    const res = await mutations[name]();
    expect(res.status).toBe(403);
    expect(db.writes).toEqual([]);
  });

  it("ancestor cannot read the audit trail or HR recommendations", async () => {
    as(USERS.senior);
    expect((await audit.GET(req(), ctx())).status).toBe(403);
    expect((await hrRecommendations.GET(req(), ctx())).status).toBe(403);
  });
});

describe("unrelated managers", () => {
  it.each(Object.keys(reads) as (keyof typeof reads)[])("get 403 reading %s", async (name) => {
    as(USERS.unrelated);
    expect((await reads[name]()).status).toBe(403);
  });

  it.each(Object.keys(mutations) as (keyof typeof mutations)[])("get 403 on %s", async (name) => {
    as(USERS.unrelated);
    expect((await mutations[name]()).status).toBe(403);
    expect(db.writes).toEqual([]);
  });

  it("are denied when they sit beyond the depth limit", async () => {
    mocks.chains = { "emp-1": ["mgr-1", "l2", "l3", "l4", "mgr-2"] };
    as(USERS.unrelated);
    expect((await reads.workplan()).status).toBe(403);
  });

  it("are denied when the hierarchy lookup fails", async () => {
    const org = await import("@/lib/dynamics-org-service");
    vi.mocked(org.getManagerChainSystemUserIds).mockRejectedValueOnce(new Error("down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    as(USERS.senior);
    expect((await reads.technical()).status).toBe(403);
    warn.mockRestore();
  });
});

describe("existing direct access is unchanged", () => {
  it("direct manager keeps mutation permissions", async () => {
    as(USERS.manager);
    const rating = await mutations["POST factor-ratings"]();
    expect(rating.status).toBe(200);
    expect(db.tables.appraisal_factor_ratings[0].manager_rating_code).toBe("A");

    const added = await mutations["POST technical-competencies"]();
    expect(added.status).toBe(200);

    const saved = await mutations["POST workplan"]();
    expect(saved.status).toBe(200);
    expect(db.tables.workplan_items).toHaveLength(0);
  });

  it("direct manager reads without a hierarchy lookup", async () => {
    as(USERS.manager);
    expect((await reads.technical()).status).toBe(200);
    expect((await reads.factorRatings()).status).toBe(200);
    expect(mocks.chainCalls).toBe(0);
  });

  it("employee reads their own appraisal without a hierarchy lookup", async () => {
    as(USERS.employee);
    expect((await reads.workplan()).status).toBe(200);
    expect(mocks.chainCalls).toBe(0);
  });

  it.each([["hr"], ["admin"]] as const)("%s reads and edits as before, without a hierarchy lookup", async (role) => {
    as(USERS[role]);
    expect((await reads.workplan()).status).toBe(200);
    expect((await reads.factorRatings()).status).toBe(200);
    expect((await reads.technical()).status).toBe(200);
    expect((await audit.GET(req(), ctx())).status).toBe(200);
    expect((await mutations["POST technical-competencies"]()).status).toBe(200);
    expect(mocks.chainCalls).toBe(0);
  });

  it("an HR user who opens an appraisal with no workplan still gets one created, as before", async () => {
    seed("DRAFT", false);
    as(USERS.hr);
    const res = await reads.workplan();
    expect(res.status).toBe(200);
    expect(db.tables.workplans).toHaveLength(1);
  });
});
