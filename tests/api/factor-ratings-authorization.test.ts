import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../helpers/fake-supabase";
import { ACTIVE_FACTORS, CATEGORIES, INACTIVE_FACTORS, RATING_SCALE } from "../helpers/factor-fixtures";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  resolveManagerSystemUserId: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/hrmis-approval-auth", () => ({ resolveManagerSystemUserId: mocks.resolveManagerSystemUserId }));

import { POST } from "@/app/api/appraisals/[id]/factor-ratings/route";

const APPRAISAL_ID = "a-1";
const USERS = {
  employee: { id: "u-emp", roles: [], employee_id: "emp-1" },
  manager: { id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" },
  delegate: { id: "u-del", roles: [], employee_id: "del-1" },
  otherManager: { id: "u-om", roles: ["manager"], employee_id: "mgr-2" },
  hr: { id: "u-hr", roles: ["hr"], employee_id: "hr-1" },
  admin: { id: "u-admin", roles: ["admin"], employee_id: "admin-1" },
  gm: { id: "u-gm", roles: ["gm"], employee_id: "gm-1", division_id: "div-1" },
  outsider: { id: "u-out", roles: [], employee_id: "someone-else" },
};

const CORE_IDS = ACTIVE_FACTORS.filter((f) => f.category_id === "cat-core").map((f) => f.id);
const LEAD_IDS = ACTIVE_FACTORS.filter((f) => f.category_id === "cat-lead").map((f) => f.id);

type Row = Record<string, unknown>;
let db: FakeSupabase;

function storedRow(factorId: string, overrides: Row = {}): Row {
  return {
    id: `r-${factorId}`,
    appraisal_id: APPRAISAL_ID,
    factor_id: factorId,
    self_rating_code: null,
    manager_rating_code: null,
    self_comments: null,
    manager_comments: null,
    weight: 20,
    ...overrides,
  };
}

function seed(status: string, ratings: Row[] = CORE_IDS.map((id) => storedRow(id))) {
  db = new FakeSupabase(
    {
      appraisals: [
        { id: APPRAISAL_ID, status, employee_id: "emp-1", manager_employee_id: "mgr-1", division_id: "div-1" },
      ],
      appraisal_delegations: [{ id: "d-1", appraisal_id: APPRAISAL_ID, delegated_to: "del-1" }],
      evaluation_categories: CATEGORIES.map((c) => ({ ...c })),
      evaluation_factors: [...ACTIVE_FACTORS, ...INACTIVE_FACTORS].map((f) => ({ ...f })),
      rating_scale: RATING_SCALE.map((r) => ({ ...r })),
      appraisal_factor_ratings: ratings.map((r) => ({ ...r })),
    },
    { appraisal_factor_ratings: [["appraisal_id", "factor_id"]] }
  );
  mocks.createClient.mockReturnValue(db);
}

/** Same shape the Core/Productivity/Leadership sections send: every field for every factor, plus the displayed weight. */
function componentPayload(factorIds: string[], edits: Record<string, Row> = {}) {
  return factorIds.map((factorId) => {
    const stored = db.tables.appraisal_factor_ratings.find((r) => r.factor_id === factorId);
    const master = ACTIVE_FACTORS.find((f) => f.id === factorId);
    return {
      factor_id: factorId,
      self_rating_code: stored?.self_rating_code ?? null,
      manager_rating_code: stored?.manager_rating_code ?? null,
      self_comments: stored?.self_comments ?? null,
      manager_comments: stored?.manager_comments ?? null,
      weight: stored?.weight ?? (Number(master?.weight) || 0),
      ...(edits[factorId] ?? {}),
    };
  });
}

const post = (ratings: unknown[]) =>
  POST(
    new Request(`http://localhost/api/appraisals/${APPRAISAL_ID}/factor-ratings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ratings }),
    }),
    { params: Promise.resolve({ id: APPRAISAL_ID }) }
  );

const snapshot = () => JSON.parse(JSON.stringify(db.tables.appraisal_factor_ratings));
const row = (factorId: string) => db.tables.appraisal_factor_ratings.find((r) => r.factor_id === factorId)!;
const as = (key: keyof typeof USERS) => mocks.getCurrentUser.mockResolvedValue(USERS[key]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  mocks.resolveManagerSystemUserId.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("employee-owned fields", () => {
  it("employee can change self rating and self comments in SELF_ASSESSMENT", async () => {
    seed("SELF_ASSESSMENT");
    as("employee");
    const [f1] = CORE_IDS;
    const res = await post(componentPayload(CORE_IDS, { [f1]: { self_rating_code: "7", self_comments: "mine" } }));
    expect(res.status).toBe(200);
    expect(row(f1)).toMatchObject({ self_rating_code: "7", self_comments: "mine", manager_rating_code: null, weight: 20 });
  });

  it("employee cannot change manager rating or manager comments", async () => {
    seed("SELF_ASSESSMENT");
    as("employee");
    const before = snapshot();
    const [f1, f2] = CORE_IDS;
    expect((await post(componentPayload(CORE_IDS, { [f1]: { manager_rating_code: "9" } }))).status).toBe(403);
    expect((await post(componentPayload(CORE_IDS, { [f2]: { manager_comments: "x" } }))).status).toBe(403);
    expect(snapshot()).toEqual(before);
  });

  it("employee cannot change self fields after SELF_ASSESSMENT", async () => {
    for (const status of ["MANAGER_REVIEW", "PENDING_SIGNOFF", "HR_REVIEW", "COMPLETE"]) {
      seed(status);
      as("employee");
      const before = snapshot();
      const res = await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { self_rating_code: "3" } }));
      expect(res.status, status).toBe(409);
      expect(snapshot()).toEqual(before);
    }
  });

  it("employee cannot enter assessment ratings in DRAFT", async () => {
    seed("DRAFT");
    as("employee");
    const before = snapshot();
    const res = await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { self_rating_code: "5" } }));
    expect(res.status).toBe(409);
    expect(snapshot()).toEqual(before);
  });
});

describe("manager-owned fields", () => {
  it("assigned manager can change manager rating and comments in MANAGER_REVIEW; self fields untouched", async () => {
    seed("MANAGER_REVIEW", CORE_IDS.map((id) => storedRow(id, { self_rating_code: "6", self_comments: "emp" })));
    as("manager");
    const [f1] = CORE_IDS;
    const res = await post(componentPayload(CORE_IDS, { [f1]: { manager_rating_code: "8", manager_comments: "good" } }));
    expect(res.status).toBe(200);
    expect(row(f1)).toMatchObject({ manager_rating_code: "8", manager_comments: "good", self_rating_code: "6", self_comments: "emp" });
  });

  it("manager cannot change employee self fields", async () => {
    seed("MANAGER_REVIEW", CORE_IDS.map((id) => storedRow(id, { self_rating_code: "6" })));
    as("manager");
    const before = snapshot();
    const res = await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { self_rating_code: "2" } }));
    expect(res.status).toBe(403);
    expect(snapshot()).toEqual(before);
  });

  it("manager cannot change manager fields outside MANAGER_REVIEW", async () => {
    for (const status of ["DRAFT", "SELF_ASSESSMENT", "PENDING_SIGNOFF", "HR_REVIEW", "COMPLETE"]) {
      seed(status);
      as("manager");
      const before = snapshot();
      const res = await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { manager_rating_code: "4" } }));
      expect(res.status, status).toBe(409);
      expect(snapshot()).toEqual(before);
    }
  });

  it("a manager who is not assigned to this appraisal is rejected", async () => {
    seed("MANAGER_REVIEW");
    as("otherManager");
    const before = snapshot();
    const res = await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { manager_rating_code: "4" } }));
    expect(res.status).toBe(403);
    expect(snapshot()).toEqual(before);
  });

  it("uses the existing manager resolution (HRMIS manager takes precedence over the stored manager)", async () => {
    mocks.resolveManagerSystemUserId.mockResolvedValue("mgr-2");
    seed("MANAGER_REVIEW");
    as("otherManager");
    expect((await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { manager_rating_code: "4" } }))).status).toBe(200);
    expect(row(CORE_IDS[0]).manager_rating_code).toBe("4");

    as("manager");
    expect((await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { manager_rating_code: "5" } }))).status).toBe(403);
    expect(row(CORE_IDS[0]).manager_rating_code).toBe("4");
  });
});

describe("delegates", () => {
  it("a valid delegate can change manager fields in MANAGER_REVIEW", async () => {
    seed("MANAGER_REVIEW");
    as("delegate");
    const res = await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { manager_rating_code: "7", manager_comments: "d" } }));
    expect(res.status).toBe(200);
    expect(row(CORE_IDS[0])).toMatchObject({ manager_rating_code: "7", manager_comments: "d" });
  });

  it("a delegate cannot change employee self fields", async () => {
    seed("MANAGER_REVIEW");
    as("delegate");
    const before = snapshot();
    expect((await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { self_rating_code: "7" } }))).status).toBe(403);
    expect(snapshot()).toEqual(before);
  });

  it("a delegate cannot change manager fields once the appraisal is COMPLETE", async () => {
    seed("COMPLETE");
    as("delegate");
    const before = snapshot();
    expect((await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { manager_rating_code: "7" } }))).status).toBe(409);
    expect(snapshot()).toEqual(before);
  });
});

describe("HR, admin and GM", () => {
  it.each(["hr", "admin", "gm"] as const)("%s cannot change self or manager fields in any status", async (key) => {
    for (const status of ["DRAFT", "SELF_ASSESSMENT", "MANAGER_REVIEW", "PENDING_SIGNOFF", "HR_REVIEW", "COMPLETE"]) {
      for (const field of ["self_rating_code", "self_comments", "manager_rating_code", "manager_comments"]) {
        seed(status);
        as(key);
        const before = snapshot();
        const res = await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { [field]: "5" } }));
        expect(res.status, `${key} ${status} ${field}`).toBe(403);
        expect(snapshot()).toEqual(before);
      }
    }
  });

  it.each(["hr", "admin", "gm"] as const)("%s saving an unchanged round-trip payload succeeds and writes nothing", async (key) => {
    seed("MANAGER_REVIEW", CORE_IDS.map((id) => storedRow(id, { self_rating_code: "6", manager_rating_code: "7" })));
    as(key);
    const before = snapshot();
    expect((await post(componentPayload(CORE_IDS))).status).toBe(200);
    expect(snapshot()).toEqual(before);
  });

  it("GM cannot change weights in DRAFT", async () => {
    seed("DRAFT");
    as("gm");
    const before = snapshot();
    const weights = [30, 25, 20, 15, 10];
    const res = await post(componentPayload(CORE_IDS).map((r, i) => ({ ...r, weight: weights[i] })));
    expect(res.status).toBe(403);
    expect(snapshot()).toEqual(before);
  });

  it.each(["hr", "admin"] as const)("%s keeps the DRAFT weight editing the UI already offers", async (key) => {
    seed("DRAFT");
    as(key);
    const weights = [30, 25, 20, 15, 10];
    const res = await post(componentPayload(CORE_IDS).map((r, i) => ({ ...r, weight: weights[i] })));
    expect(res.status).toBe(200);
    expect(CORE_IDS.map((id) => row(id).weight)).toEqual(weights);
  });
});

describe("weights", () => {
  it("employee and manager can change weights in DRAFT", async () => {
    for (const key of ["employee", "manager", "delegate"] as const) {
      seed("DRAFT");
      as(key);
      const weights = [40, 30, 10, 10, 10];
      const res = await post(componentPayload(CORE_IDS).map((r, i) => ({ ...r, weight: weights[i] })));
      expect(res.status, key).toBe(200);
      expect(CORE_IDS.map((id) => row(id).weight)).toEqual(weights);
    }
  });

  it("weights cannot change after DRAFT, but unchanged weights are accepted", async () => {
    for (const status of ["SELF_ASSESSMENT", "MANAGER_REVIEW", "PENDING_SIGNOFF", "HR_REVIEW", "COMPLETE"]) {
      seed(status);
      as(status === "MANAGER_REVIEW" ? "manager" : "employee");
      const before = snapshot();
      const res = await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { weight: 50 } }));
      expect(res.status, status).toBe(409);
      expect(snapshot()).toEqual(before);
    }
    seed("SELF_ASSESSMENT");
    as("employee");
    expect((await post(componentPayload(CORE_IDS))).status).toBe(200);
  });

  it("still enforces the DRAFT weight total for authorized weight editors", async () => {
    seed("DRAFT");
    as("employee");
    const before = snapshot();
    const res = await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { weight: 60 } }));
    expect(res.status).toBe(400);
    expect(snapshot()).toEqual(before);
  });
});

describe("partial updates", () => {
  it("omitted fields are preserved, not nulled", async () => {
    seed("SELF_ASSESSMENT", CORE_IDS.map((id) => storedRow(id, { self_comments: "keep", manager_rating_code: "5", manager_comments: "m" })));
    as("employee");
    const res = await post([{ factor_id: CORE_IDS[0], self_rating_code: "9" }]);
    expect(res.status).toBe(200);
    expect(row(CORE_IDS[0])).toMatchObject({
      self_rating_code: "9",
      self_comments: "keep",
      manager_rating_code: "5",
      manager_comments: "m",
      weight: 20,
    });
  });

  it("unchanged round-tripped fields owned by another party do not cause rejection", async () => {
    seed("SELF_ASSESSMENT", CORE_IDS.map((id) => storedRow(id, { manager_rating_code: "5", manager_comments: "m" })));
    as("employee");
    const res = await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { self_rating_code: "8" } }));
    expect(res.status).toBe(200);
    expect(row(CORE_IDS[0])).toMatchObject({ self_rating_code: "8", manager_rating_code: "5", manager_comments: "m" });
  });

  it("treats an empty string and null as the same unchanged value", async () => {
    seed("SELF_ASSESSMENT");
    as("employee");
    const res = await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { manager_comments: "" } }));
    expect(res.status).toBe(200);
    expect(row(CORE_IDS[0]).manager_comments).toBeNull();
  });

  it("the owner can explicitly clear their own field", async () => {
    seed("SELF_ASSESSMENT", CORE_IDS.map((id) => storedRow(id, { self_comments: "old" })));
    as("employee");
    const res = await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { self_comments: null } }));
    expect(res.status).toBe(200);
    expect(row(CORE_IDS[0]).self_comments).toBeNull();
  });

  it("a rejected payload writes nothing, even for factors earlier in the payload", async () => {
    seed("SELF_ASSESSMENT");
    as("employee");
    const before = snapshot();
    const res = await post(
      componentPayload(CORE_IDS, {
        [CORE_IDS[0]]: { self_rating_code: "8" },
        [CORE_IDS[4]]: { manager_rating_code: "8" },
      })
    );
    expect(res.status).toBe(403);
    expect(snapshot()).toEqual(before);
  });
});

describe("lazy first save", () => {
  it("employee first save in SELF_ASSESSMENT creates rows with only their fields and the displayed weight", async () => {
    seed("SELF_ASSESSMENT", []);
    as("employee");
    const res = await post(componentPayload(LEAD_IDS, { [LEAD_IDS[0]]: { self_rating_code: "6", self_comments: "c" } }));
    expect(res.status).toBe(200);
    expect(db.tables.appraisal_factor_ratings).toHaveLength(5);
    const created = row(LEAD_IDS[0]);
    expect(created).toMatchObject({ self_rating_code: "6", self_comments: "c" });
    expect(created.manager_rating_code ?? null).toBeNull();
    expect(created.manager_comments ?? null).toBeNull();
    const master = ACTIVE_FACTORS.find((f) => f.id === LEAD_IDS[0])!;
    expect(created.weight).toBe(Number(master.weight) || 0);
  });

  it("manager first save in MANAGER_REVIEW creates rows with only manager fields", async () => {
    seed("MANAGER_REVIEW", []);
    as("manager");
    const res = await post(componentPayload(LEAD_IDS, { [LEAD_IDS[0]]: { manager_rating_code: "9" } }));
    expect(res.status).toBe(200);
    expect(db.tables.appraisal_factor_ratings).toHaveLength(5);
    const created = row(LEAD_IDS[0]);
    expect(created.manager_rating_code).toBe("9");
    expect(created.self_rating_code ?? null).toBeNull();
    expect(created.self_comments ?? null).toBeNull();
  });

  it("DRAFT first save of weights creates rows with weights and no ratings", async () => {
    seed("DRAFT", []);
    as("employee");
    const res = await post(componentPayload(CORE_IDS).map((r) => ({ ...r, weight: 20 })));
    expect(res.status).toBe(200);
    expect(db.tables.appraisal_factor_ratings).toHaveLength(5);
    expect(db.tables.appraisal_factor_ratings.every((r) => r.weight === 20 && (r.self_rating_code ?? null) === null)).toBe(true);
  });

  it("no rows are created in locked statuses", async () => {
    for (const status of ["PENDING_SIGNOFF", "HR_REVIEW", "COMPLETE"]) {
      seed(status, []);
      as("employee");
      expect((await post(componentPayload(CORE_IDS))).status, status).toBe(200);
      expect(db.tables.appraisal_factor_ratings, status).toHaveLength(0);
    }
  });
});

describe("COMPLETE is immutable", () => {
  it.each(["employee", "manager", "delegate", "hr", "admin", "gm"] as const)("%s cannot change anything", async (key) => {
    seed("COMPLETE", CORE_IDS.map((id) => storedRow(id, { self_rating_code: "6", manager_rating_code: "7" })));
    as(key);
    const before = snapshot();
    for (const edit of [{ self_rating_code: "1" }, { manager_rating_code: "1" }, { self_comments: "x" }, { manager_comments: "x" }, { weight: 1 }]) {
      const res = await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: edit }));
      expect([403, 409]).toContain(res.status);
    }
    expect(snapshot()).toEqual(before);
  });
});

describe("dev-only test bypass is preserved", () => {
  it("lets any appraisal viewer edit manager fields in MANAGER_REVIEW only when the bypass is enabled", async () => {
    seed("MANAGER_REVIEW");
    as("hr");
    expect((await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { manager_rating_code: "4" } }))).status).toBe(403);

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_APPRAISAL_TEST_BYPASS", "true");
    expect((await post(componentPayload(CORE_IDS, { [CORE_IDS[0]]: { manager_rating_code: "4" } }))).status).toBe(200);
    expect(row(CORE_IDS[0]).manager_rating_code).toBe("4");
  });
});
