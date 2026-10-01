import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../helpers/fake-supabase";
import { ACTIVE_FACTORS, CATEGORIES, CATEGORY_TYPES, INACTIVE_FACTORS, RATING_SCALE } from "../helpers/factor-fixtures";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/hrmis-approval-auth", () => ({ resolveManagerSystemUserId: vi.fn().mockResolvedValue(null) }));

import { GET, POST } from "@/app/api/appraisals/[id]/factor-ratings/route";

const APPRAISAL_ID = "a-1";
const USERS = {
  employee: { id: "u-emp", roles: [], employee_id: "emp-1" },
  manager: { id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" },
  hr: { id: "u-hr", roles: ["hr"], employee_id: "hr-1" },
  outsider: { id: "u-out", roles: [], employee_id: "someone-else" },
  otherGm: { id: "u-gm", roles: ["gm"], employee_id: "gm-1", division_id: "div-other" },
};

let db: FakeSupabase;

function seed() {
  db = new FakeSupabase(
    {
      appraisals: [
        { id: APPRAISAL_ID, status: "DRAFT", employee_id: "emp-1", manager_employee_id: "mgr-1", division_id: "div-1" },
      ],
      evaluation_categories: CATEGORIES.map((c) => ({ ...c })),
      evaluation_factors: [...ACTIVE_FACTORS, ...INACTIVE_FACTORS].map((f) => ({ ...f })),
      rating_scale: RATING_SCALE.map((r) => ({ ...r })),
      appraisal_factor_ratings: [],
    },
    { appraisal_factor_ratings: [["appraisal_id", "factor_id"]] }
  );
  mocks.createClient.mockReturnValue(db);
}

const get = () => GET(new Request(`http://localhost/api/appraisals/${APPRAISAL_ID}/factor-ratings`), { params: Promise.resolve({ id: APPRAISAL_ID }) });
const post = (body: unknown) =>
  POST(
    new Request(`http://localhost/api/appraisals/${APPRAISAL_ID}/factor-ratings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: APPRAISAL_ID }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  seed();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/appraisals/[id]/factor-ratings with zero saved ratings", () => {
  it.each(CATEGORY_TYPES)("returns the 5 active %s factors from the master configuration", async (type) => {
    mocks.getCurrentUser.mockResolvedValue(USERS.employee);
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ratings).toEqual([]);
    const factors = body.factors.filter((f: { category_type: string }) => f.category_type === type);
    expect(factors).toHaveLength(5);
    for (const f of factors) {
      expect(Object.keys(f).sort()).toEqual(
        ["category_id", "category_type", "description", "display_order", "id", "name", "weight"].sort()
      );
    }
    expect(factors.map((f: { display_order: number }) => f.display_order)).toEqual([1, 2, 3, 4, 5]);
  });

  it("excludes inactive factors and factors in inactive categories", async () => {
    mocks.getCurrentUser.mockResolvedValue(USERS.employee);
    const body = await (await get()).json();
    const ids = body.factors.map((f: { id: string }) => f.id);
    expect(ids).not.toContain("core-inactive");
    expect(ids).not.toContain("old-f1");
    expect(ids).toHaveLength(15);
  });

  it("returns master weights unchanged", async () => {
    mocks.getCurrentUser.mockResolvedValue(USERS.employee);
    const body = await (await get()).json();
    const total = (type: string) =>
      body.factors
        .filter((f: { category_type: string }) => f.category_type === type)
        .reduce((s: number, f: { weight: number | null }) => s + Number(f.weight ?? 0), 0);
    expect([total("core"), total("productivity"), total("leadership")]).toEqual([0, 70, 135]);
  });

  it("returns the rating scale ordered from highest factor", async () => {
    mocks.getCurrentUser.mockResolvedValue(USERS.employee);
    const body = await (await get()).json();
    expect(body.ratingScale).toHaveLength(10);
    expect(body.ratingScale[0]).toEqual({ code: "10", label: "Label 10", factor: 1 });
    expect(body.ratingScale[9]).toEqual({ code: "1", label: "Label 1", factor: 0.1 });
  });

  it("keeps the existing factorMeta and categoryTypes fields", async () => {
    mocks.getCurrentUser.mockResolvedValue(USERS.employee);
    const body = await (await get()).json();
    expect(body.factorMeta["core-f1"]).toEqual({ category_id: "cat-core", weight: null });
    expect(body.categoryTypes["cat-lead"]).toBe("leadership");
  });

  it("still returns saved ratings", async () => {
    db.tables.appraisal_factor_ratings.push({
      id: "r-1", appraisal_id: APPRAISAL_ID, factor_id: "core-f1", self_rating_code: "7",
      manager_rating_code: null, self_comments: "c", manager_comments: null, weight: 20,
    });
    mocks.getCurrentUser.mockResolvedValue(USERS.employee);
    const body = await (await get()).json();
    expect(body.ratings).toEqual([
      { factor_id: "core-f1", self_rating_code: "7", manager_rating_code: null, self_comments: "c", manager_comments: null, weight: 20 },
    ]);
  });

  it.each(["employee", "manager", "hr"] as const)("allows %s", async (key) => {
    mocks.getCurrentUser.mockResolvedValue(USERS[key]);
    expect((await get()).status).toBe(200);
  });

  it.each(["outsider", "otherGm"] as const)("rejects %s with 403 and no factor data", async (key) => {
    mocks.getCurrentUser.mockResolvedValue(USERS[key]);
    const res = await get();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.factors).toBeUndefined();
    expect(body.ratingScale).toBeUndefined();
  });

  it("rejects unauthenticated requests with 401", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });
});

describe("POST /api/appraisals/[id]/factor-ratings lazy save", () => {
  const coreRatings = (selfCode: string | null, weight = 20) =>
    ACTIVE_FACTORS.filter((f) => f.category_id === "cat-core").map((f) => ({
      factor_id: f.id,
      self_rating_code: selfCode,
      manager_rating_code: null,
      self_comments: null,
      manager_comments: null,
      weight,
    }));

  it("DRAFT weight save: first save inserts rows, second save updates them without duplicates", async () => {
    mocks.getCurrentUser.mockResolvedValue(USERS.employee);
    expect(db.tables.appraisal_factor_ratings).toHaveLength(0);

    const first = await post({ ratings: coreRatings(null) });
    expect(first.status).toBe(200);
    expect(db.tables.appraisal_factor_ratings).toHaveLength(5);
    const idsAfterFirst = db.tables.appraisal_factor_ratings.map((r) => r.id).sort();

    const weights = [30, 25, 20, 15, 10];
    const second = await post({ ratings: coreRatings(null).map((r, i) => ({ ...r, weight: weights[i] })) });
    expect(second.status).toBe(200);
    expect(db.tables.appraisal_factor_ratings).toHaveLength(5);
    expect(db.tables.appraisal_factor_ratings.map((r) => r.id).sort()).toEqual(idsAfterFirst);
    expect(db.tables.appraisal_factor_ratings.map((r) => r.weight).sort()).toEqual([10, 15, 20, 25, 30]);
  });

  it("SELF_ASSESSMENT self-rating save: first save inserts rows, second save updates them without duplicates", async () => {
    db.tables.appraisals[0].status = "SELF_ASSESSMENT";
    mocks.getCurrentUser.mockResolvedValue(USERS.employee);

    const first = await post({ ratings: coreRatings("6", 0) });
    expect(first.status).toBe(200);
    expect(db.tables.appraisal_factor_ratings).toHaveLength(5);
    const idsAfterFirst = db.tables.appraisal_factor_ratings.map((r) => r.id).sort();

    const second = await post({ ratings: coreRatings("8", 0) });
    expect(second.status).toBe(200);
    expect(db.tables.appraisal_factor_ratings).toHaveLength(5);
    expect(db.tables.appraisal_factor_ratings.map((r) => r.id).sort()).toEqual(idsAfterFirst);
    expect(db.tables.appraisal_factor_ratings.every((r) => r.self_rating_code === "8")).toBe(true);
  });

  it("rejects saves from users outside the appraisal and writes nothing", async () => {
    mocks.getCurrentUser.mockResolvedValue(USERS.outsider);
    const res = await post({ ratings: coreRatings(null) });
    expect(res.status).toBe(403);
    expect(db.tables.appraisal_factor_ratings).toHaveLength(0);
  });

  it("still enforces the DRAFT weight total", async () => {
    mocks.getCurrentUser.mockResolvedValue(USERS.employee);
    const ratings = coreRatings(null, 10);
    const res = await post({ ratings });
    expect(res.status).toBe(400);
    expect(db.tables.appraisal_factor_ratings).toHaveLength(0);
  });
});
