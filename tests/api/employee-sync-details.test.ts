import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Op = [string, unknown[]];
type Query = { table: string; ops: Op[] };
type Handler = (q: Query) => unknown;

const state = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  dynamicsRows: [] as Record<string, unknown>[],
  handler: (() => ({ data: null, error: null })) as (q: { table: string; ops: [string, unknown[]][] }) => unknown,
  queries: [] as { table: string; ops: [string, unknown[]][] }[],
}));

/** Chainable, awaitable query builder that records every call and resolves via the active handler. */
function fakeClient() {
  return {
    from(table: string) {
      const q: Query = { table, ops: [] };
      state.queries.push(q);
      const builder: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (typeof prop === "symbol") return undefined;
            if (prop === "then") {
              return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
                Promise.resolve().then(() => state.handler(q)).then(res, rej);
            }
            return (...args: unknown[]) => {
              q.ops.push([prop, args]);
              return builder;
            };
          },
        }
      );
      return builder;
    },
  };
}

vi.mock("@/lib/auth", () => ({
  getCurrentUser: state.getCurrentUser,
  isPlaceholderUser: (u: { id?: string } | null) => u?.id === "placeholder-user-id",
}));
vi.mock("@/lib/dynamics-sync", () => ({
  createDataverseApiClient: async () => ({ get: async () => ({ data: { value: state.dynamicsRows } }) }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => fakeClient() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));

import { POST as runSync, GET as syncHistory } from "@/app/api/sync/employees/route";
import { GET as syncDetail } from "@/app/api/sync/employees/[syncId]/route";
import { POST as createMissing } from "@/app/api/appraisals/create-missing/route";

const HR = { id: "hr-1", roles: ["hr"] };
const LOG_ID = "11111111-1111-4111-8111-111111111111";
const op = (q: Query, name: string) => q.ops.find((o) => o[0] === name);
const dyn = (id: string, name: string, email: string) => ({
  _xrm1_employee_user_id_value: id,
  xrm1_fullname: name,
  emailaddress: email,
  statecode: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.queries = [];
  state.dynamicsRows = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://fake.local");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fake-service-key");
});

/* ------------------------------------------------------------------ */
/* Sync capture                                                        */
/* ------------------------------------------------------------------ */

type SyncWorld = {
  existing: { employee_id: string; is_active: boolean; full_name: string | null }[];
  emailConflicts: Set<string>;
  byEmail: Record<string, string>;
  appraisalCounts: Record<string, number>;
  cycleAppraisals: string[];
  detailsColumnMissing?: boolean;
};

function syncHandler(world: SyncWorld): Handler {
  return (q) => {
    if (q.table === "employee_sync_log") {
      if (op(q, "insert")) return { data: { id: LOG_ID }, error: null };
      const update = op(q, "update");
      if (update) {
        const payload = update[1][0] as Record<string, unknown>;
        if (world.detailsColumnMissing && "details" in payload) {
          return { error: { code: "PGRST204", message: "Could not find the 'details' column" } };
        }
        return { error: null };
      }
    }
    if (q.table === "employees") {
      const upsert = op(q, "upsert");
      if (upsert) {
        const row = upsert[1][0] as { employee_id: string };
        return world.emailConflicts.has(row.employee_id)
          ? { error: { message: 'duplicate key value violates unique constraint "employees_email_key"' } }
          : { error: null };
      }
      if (op(q, "update")) return { error: null };
      const ilike = op(q, "ilike");
      if (ilike) {
        const id = world.byEmail[String(ilike[1][1])];
        return { data: id ? { employee_id: id } : null, error: null };
      }
      if (op(q, "select")) return { data: world.existing, error: null };
    }
    if (q.table === "appraisals") {
      const select = op(q, "select")!;
      if ((select[1][1] as { head?: boolean } | undefined)?.head) {
        return { count: world.appraisalCounts[String(op(q, "eq")![1][1])] ?? 0, error: null };
      }
      return { data: world.cycleAppraisals.map((employee_id) => ({ employee_id })), error: null };
    }
    if (q.table === "appraisal_cycles") return { data: { id: "cycle-1", created_at: "2026-04-15" }, error: null };
    return { data: null, error: null };
  };
}

function baseWorld(): SyncWorld {
  return {
    existing: [
      { employee_id: "A", is_active: true, full_name: "Alice Anders" },
      { employee_id: "B", is_active: false, full_name: "Bob Old Name" },
      { employee_id: "C", is_active: true, full_name: "Carol Chen" },
      { employee_id: "R-old", is_active: true, full_name: "Rae Old" },
      { employee_id: "E-old", is_active: true, full_name: "Eve Old" },
    ],
    emailConflicts: new Set(["R-new", "E-new"]),
    byEmail: { "r@dbankjm.com": "R-old", "e@dbankjm.com": "E-old" },
    appraisalCounts: { "R-old": 0, "E-old": 1 },
    cycleAppraisals: ["A", "B", "E-old"],
  };
}

const BASE_DYNAMICS = [
  dyn("A", "Alice Anders", "a@dbankjm.com"),
  dyn("B", "Bob Returned", "b@dbankjm.com"),
  dyn("N", "Nora New", "n@dbankjm.com"),
  dyn("D2", "Dup Person", "N@dbankjm.com"),
  dyn("R-new", "Rae Rekeyed", "r@dbankjm.com"),
  dyn("E-new", "Eve Conflict", "e@dbankjm.com"),
  dyn("X", "External Person", "x@example.com"),
];

async function sync(world: SyncWorld = baseWorld()) {
  state.getCurrentUser.mockResolvedValue(HR);
  state.dynamicsRows = BASE_DYNAMICS;
  state.handler = syncHandler(world);
  const res = await runSync(new NextRequest("http://localhost/api/sync/employees", { method: "POST" }));
  const logUpdates = state.queries
    .filter((q) => q.table === "employee_sync_log" && op(q, "update"))
    .map((q) => op(q, "update")![1][0] as Record<string, unknown>);
  return { res, body: await res.json(), logUpdates, details: logUpdates[0]?.details as Record<string, unknown[]> };
}

describe("sync detail capture", () => {
  it("records a genuinely new employee under added with the Dynamics name", async () => {
    const { details } = await sync();
    expect(details.added).toEqual([{ employee_id: "N", full_name: "Nora New" }]);
  });

  it("records an inactive existing employee returned by Dynamics under reactivated", async () => {
    const { details } = await sync();
    expect(details.reactivated).toEqual([{ employee_id: "B", full_name: "Bob Returned" }]);
  });

  it("fails the run and deactivates nobody when Dynamics returns no usable employees", async () => {
    state.getCurrentUser.mockResolvedValue(HR);
    state.dynamicsRows = [dyn("X", "External Person", "x@example.com")];
    state.handler = syncHandler(baseWorld());
    const res = await runSync(new NextRequest("http://localhost/api/sync/employees", { method: "POST" }));
    expect(res.status).toBe(500);
    const deactivations = state.queries.filter(
      (q) => q.table === "employees" && op(q, "update") && op(q, "in")
    );
    expect(deactivations).toHaveLength(0);
    const failed = state.queries
      .filter((q) => q.table === "employee_sync_log" && op(q, "update"))
      .map((q) => op(q, "update")![1][0] as Record<string, unknown>);
    expect(failed.at(-1)).toMatchObject({ status: "failed" });
  });

  it("records a missing previously active employee under deactivated with a neutral reason", async () => {
    const { details } = await sync();
    expect(details.deactivated).toEqual([
      { employee_id: "C", full_name: "Carol Chen", reason: "not_in_active_dynamics_sync" },
    ]);
  });

  it("captures the no-appraisal list with names", async () => {
    const { details, logUpdates } = await sync();
    expect(details.no_appraisal).toEqual([
      { employee_id: "N", full_name: "Nora New" },
      { employee_id: "R-new", full_name: "Rae Rekeyed" },
      { employee_id: "E-new", full_name: "Eve Conflict" },
    ]);
    expect(logUpdates[0].new_employee_ids).toEqual(["N", "R-new", "E-new"]);
  });

  it("does not present a re-keyed or email-matched employee as genuinely new", async () => {
    const { details } = await sync();
    const addedIds = details.added.map((p) => (p as { employee_id: string }).employee_id);
    expect(addedIds).not.toContain("R-new");
    expect(addedIds).not.toContain("E-new");
    expect(details.skipped).toEqual([
      { employee_id: "D2", full_name: "Dup Person", reason: "duplicate_email" },
      { employee_id: "R-new", full_name: "Rae Rekeyed", reason: "rekeyed" },
      { employee_id: "E-new", full_name: "Eve Conflict", reason: "email_conflict" },
    ]);
    const deactivatedIds = details.deactivated.map((p) => (p as { employee_id: string }).employee_id);
    expect(deactivatedIds).not.toContain("R-old");
  });

  it("stores names as snapshots at sync time", async () => {
    const { details } = await sync();
    expect(details.reactivated[0]).toMatchObject({ full_name: "Bob Returned" });
    expect(details.deactivated[0]).toMatchObject({ full_name: "Carol Chen" });
    expect(JSON.stringify(details)).not.toContain("@");
    expect(JSON.stringify(details)).not.toContain("External Person");
  });

  it("loads only the minimum extra field in the pre-sync snapshot", async () => {
    await sync();
    const snapshot = state.queries.find((q) => q.table === "employees" && op(q, "select") && q.ops.length === 1)!;
    expect(op(snapshot, "select")![1][0]).toBe("employee_id, is_active, full_name");
  });

  it("leaves employee writes, matching and aggregate counts unchanged", async () => {
    const { body } = await sync();
    const upserts = state.queries.filter((q) => q.table === "employees" && op(q, "upsert")).map((q) => op(q, "upsert")![1][0]);
    for (const row of upserts) expect(Object.keys(row as object).sort()).toEqual(["division_id", "email", "employee_id", "full_name", "is_active"]);
    const deactivation = state.queries.find((q) => q.table === "employees" && op(q, "update") && op(q, "in"))!;
    expect(op(deactivation, "update")![1][0]).toEqual({ is_active: false });
    expect(op(deactivation, "in")![1]).toEqual(["employee_id", ["C", "R-old"]]);
    expect(body).toEqual({
      ok: true,
      employees_synced: 5,
      employees_added: 3,
      employees_deactivated: 2,
      new_without_appraisal: 3,
      duration_ms: expect.any(Number),
    });
  });
});

describe("sync detail persistence", () => {
  it("saves aggregate counts and details in the same completion update", async () => {
    const { logUpdates } = await sync();
    expect(logUpdates).toHaveLength(1);
    expect(logUpdates[0]).toMatchObject({
      status: "completed",
      employees_synced: 5,
      employees_added: 3,
      employees_deactivated: 2,
      duration_ms: expect.any(Number),
      details: expect.objectContaining({ added: expect.any(Array), skipped: expect.any(Array) }),
    });
    expect(Object.keys(logUpdates[0].details as object).sort()).toEqual(
      ["added", "deactivated", "no_appraisal", "reactivated", "skipped"]
    );
  });

  it("still completes the aggregate row when the details column is not yet migrated", async () => {
    const { res, logUpdates } = await sync({ ...baseWorld(), detailsColumnMissing: true });
    expect(res.status).toBe(200);
    expect(logUpdates).toHaveLength(2);
    expect(logUpdates[1]).not.toHaveProperty("details");
    expect(logUpdates[1]).toMatchObject({ status: "completed", employees_deactivated: 2 });
  });

  it("returns old rows with null details from the history route unchanged", async () => {
    state.getCurrentUser.mockResolvedValue(HR);
    const rows = [{ id: LOG_ID, status: "completed", employees_deactivated: 5, new_employee_ids: [], details: null }];
    state.handler = () => ({ data: rows, error: null });
    const res = await syncHistory();
    expect(await res.json()).toEqual({ log: rows });
  });

  it("create-missing clears new_employee_ids only and never touches details", async () => {
    state.getCurrentUser.mockResolvedValue(HR);
    state.handler = (q) => {
      if (q.table === "appraisal_cycles") return { data: { id: "cycle-1" }, error: null };
      if (q.table === "employees") return { data: { employee_id: "N", division_id: "d1" }, error: null };
      if (q.table === "appraisals") return op(q, "insert") ? { error: null } : { data: null, error: null };
      if (q.table === "employee_sync_log") return op(q, "update") ? { error: null } : { data: { id: LOG_ID }, error: null };
      return { data: null, error: null };
    };
    const res = await createMissing(
      new NextRequest("http://localhost/api/appraisals/create-missing", {
        method: "POST",
        body: JSON.stringify({ employee_ids: ["N"] }),
      })
    );
    expect(res.status).toBe(200);
    const logUpdates = state.queries
      .filter((q) => q.table === "employee_sync_log" && op(q, "update"))
      .map((q) => op(q, "update")![1][0]);
    expect(logUpdates).toEqual([{ new_employee_ids: [] }]);
  });
});

/* ------------------------------------------------------------------ */
/* Detail API                                                          */
/* ------------------------------------------------------------------ */

const RECORDED = {
  id: LOG_ID,
  triggered_by: "manual",
  triggered_at: "2026-10-01T13:00:00Z",
  completed_at: "2026-10-01T13:00:16Z",
  status: "completed",
  employees_synced: 127,
  employees_added: 1,
  employees_deactivated: 1,
  new_employee_ids: [],
  error_message: null,
  duration_ms: 16100,
  details: {
    added: [{ employee_id: "N", full_name: "Nora New" }],
    reactivated: [],
    deactivated: [{ employee_id: "C", full_name: "Carol Chen", reason: "not_in_active_dynamics_sync" }],
    no_appraisal: [{ employee_id: "N", full_name: "Nora New" }],
    skipped: [],
  },
};
const HISTORICAL_ID = "22222222-2222-4222-8222-222222222222";
const HISTORICAL = { ...RECORDED, id: HISTORICAL_ID, triggered_by: "cron", details: null, employees_deactivated: 5 };

function detailHandler(opts: { fail?: boolean } = {}): Handler {
  return (q) => {
    if (opts.fail) return { data: null, error: { code: "XX000", message: "internal db detail" } };
    const id = op(q, "eq")?.[1][1];
    return { data: [RECORDED, HISTORICAL].find((r) => r.id === id) ?? null, error: null };
  };
}

const getDetail = (id: string) => syncDetail(new Request(`http://localhost/api/sync/employees/${id}`), { params: Promise.resolve({ syncId: id }) });

describe("GET /api/sync/employees/[syncId]", () => {
  beforeEach(() => {
    state.handler = detailHandler();
  });

  it.each([["hr", HR], ["admin", { id: "ad-1", roles: ["admin"] }]])("returns the stored snapshot for %s", async (_l, user) => {
    state.getCurrentUser.mockResolvedValue(user);
    const res = await getDetail(LOG_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: LOG_ID,
      triggered_at: RECORDED.triggered_at,
      completed_at: RECORDED.completed_at,
      triggered_by: "Manual",
      status: "completed",
      employees_synced: 127,
      employees_added: 1,
      employees_deactivated: 1,
      duration_ms: 16100,
      details: RECORDED.details,
      details_recorded: true,
      details_capture_enabled: true,
    });
  });

  it("reports capture as not enabled when the details column is absent from the row", async () => {
    state.getCurrentUser.mockResolvedValue(HR);
    const { details: _omitted, ...withoutColumn } = HISTORICAL;
    state.handler = () => ({ data: withoutColumn, error: null });
    const body = await (await getDetail(HISTORICAL_ID)).json();
    expect(body).toMatchObject({ details: null, details_recorded: false, details_capture_enabled: false });
  });

  it("serves names from the stored snapshot without reading the employees table", async () => {
    state.getCurrentUser.mockResolvedValue(HR);
    await getDetail(LOG_ID);
    expect(state.queries.map((q) => q.table)).toEqual(["employee_sync_log"]);
  });

  it("marks historical runs as not recorded instead of empty", async () => {
    state.getCurrentUser.mockResolvedValue(HR);
    const body = await (await getDetail(HISTORICAL_ID)).json();
    expect(body).toMatchObject({
      details: null,
      details_recorded: false,
      details_capture_enabled: true,
      triggered_by: "Auto",
      employees_deactivated: 5,
    });
  });

  it.each([
    ["unauthenticated", null, 401],
    ["placeholder", { id: "placeholder-user-id", roles: ["admin"] }, 401],
    ["employee", { id: "e", roles: [] }, 403],
    ["manager", { id: "m", roles: ["manager"] }, 403],
    ["gm", { id: "g", roles: ["gm"] }, 403],
  ])("rejects %s and reads nothing", async (_l, user, status) => {
    state.getCurrentUser.mockResolvedValue(user);
    const res = await getDetail(LOG_ID);
    expect(res.status).toBe(status);
    expect(state.queries).toHaveLength(0);
  });

  it("returns 404 for an unknown sync id", async () => {
    state.getCurrentUser.mockResolvedValue(HR);
    const res = await getDetail("33333333-3333-4333-8333-333333333333");
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("returns 404 for a malformed id without querying", async () => {
    state.getCurrentUser.mockResolvedValue(HR);
    const res = await getDetail("not-a-uuid");
    expect(res.status).toBe(404);
    expect(state.queries).toHaveLength(0);
  });

  it("returns a controlled error without raw database text", async () => {
    state.getCurrentUser.mockResolvedValue(HR);
    state.handler = detailHandler({ fail: true });
    const res = await getDetail(LOG_ID);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Could not load sync details. Please try again.", code: "DB_ERROR" });
  });
});
