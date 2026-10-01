import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type DbError = { code?: string; message?: string } | null;
type Result = { data: unknown; error: DbError };
type Call = { table: string; op: string; payload?: unknown; eq?: [string, unknown]; cols?: string; order?: unknown[] };

const state = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  reads: {} as Record<string, Result>,
  write: { data: [{ id: "row-1" }], error: null } as Result,
  calls: [] as Call[],
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: state.getCurrentUser,
  isPlaceholderUser: (u: { id?: string } | null) => u?.id === "placeholder-user-id",
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    state.createClient(...args);
    return {
      from: (table: string) => ({
        select: (cols: string) => ({
          order: async (...order: unknown[]) => {
            state.calls.push({ table, op: "select", cols, order });
            return state.reads[table] ?? { data: [], error: null };
          },
        }),
        insert: async (payload: unknown) => {
          state.calls.push({ table, op: "insert", payload });
          return { data: null, error: state.write.error };
        },
        update: (payload: unknown) => ({
          eq: (col: string, val: unknown) => ({
            select: async () => {
              state.calls.push({ table, op: "update", payload, eq: [col, val] });
              return state.write;
            },
          }),
        }),
        delete: () => ({
          eq: (col: string, val: unknown) => ({
            select: async () => {
              state.calls.push({ table, op: "delete", eq: [col, val] });
              return state.write;
            },
          }),
        }),
      }),
    };
  },
}));

import { GET } from "@/app/api/admin/reference-data/route";
import { POST as createCategory } from "@/app/api/admin/reference-data/categories/route";
import { PATCH as updateCategory, DELETE as deleteCategory } from "@/app/api/admin/reference-data/categories/[id]/route";
import { POST as createFactor } from "@/app/api/admin/reference-data/factors/route";
import { PATCH as updateFactor, DELETE as deleteFactor } from "@/app/api/admin/reference-data/factors/[id]/route";
import { POST as createRule } from "@/app/api/admin/reference-data/rules/route";
import { PATCH as updateRule, DELETE as deleteRule } from "@/app/api/admin/reference-data/rules/[id]/route";

const HR = { id: "hr-1", roles: ["hr"] };
const ADMIN = { id: "admin-1", roles: ["admin"] };
const SERVICE_KEY = "service-role-secret-value";

const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/admin/reference-data/x", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id = "row-1") => ({ params: Promise.resolve({ id }) });

const categories = [
  { id: "c1", name: "Core", category_type: "core", applies_to: "both", active: true },
  { id: "c2", name: "Leadership", category_type: "leadership", applies_to: "manager", active: true },
  { id: "c3", name: "Technical", category_type: "technical", applies_to: "both", active: true },
];
const factors = Array.from({ length: 15 }, (_, i) => ({
  id: `f${i + 1}`, category_id: "c1", name: `Factor ${i + 1}`, description: null, display_order: i + 1, weight: 1, active: true,
}));
const ratingScale = Array.from({ length: 10 }, (_, i) => ({ id: `r${i + 1}`, code: String(i + 1), factor: (i + 1) / 10, label: `L${i + 1}` }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.reads = {};
  state.write = { data: [{ id: "row-1" }], error: null };
  state.calls = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://fake.local");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
});

const UNAUTHORIZED: Array<[string, unknown, number]> = [
  ["unauthenticated", null, 401],
  ["placeholder", { id: "placeholder-user-id", roles: ["admin"] }, 401],
  ["employee", { id: "e", roles: [] }, 403],
  ["manager", { id: "m", roles: ["manager"] }, 403],
  ["gm", { id: "g", roles: ["gm"] }, 403],
];

describe("GET /api/admin/reference-data", () => {
  it.each([["hr", HR], ["admin", ADMIN]])("returns all reference data for %s", async (_l, user) => {
    state.getCurrentUser.mockResolvedValue(user);
    state.reads = {
      evaluation_categories: { data: categories, error: null },
      evaluation_factors: { data: factors, error: null },
      rating_scale: { data: ratingScale, error: null },
      recommendation_rules: { data: [], error: null },
    };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categories).toHaveLength(3);
    expect(body.factors).toHaveLength(15);
    expect(body.ratingScale).toHaveLength(10);
    expect(body.rules).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(SERVICE_KEY);
    expect(state.createClient).toHaveBeenCalledWith("http://fake.local", SERVICE_KEY);
  });

  it("preserves the existing select columns and ordering", async () => {
    state.getCurrentUser.mockResolvedValue(HR);
    await GET();
    const byTable = Object.fromEntries(state.calls.map((c) => [c.table, c]));
    expect(byTable.evaluation_categories).toMatchObject({ cols: "*", order: ["category_type"] });
    expect(byTable.evaluation_factors).toMatchObject({
      cols: "id, category_id, name, description, display_order, weight, active",
      order: ["display_order"],
    });
    expect(byTable.rating_scale).toMatchObject({ cols: "id, code, factor, label", order: ["factor", { ascending: false }] });
    expect(byTable.recommendation_rules).toMatchObject({ cols: "*", order: ["rating_label"] });
  });

  it.each(UNAUTHORIZED)("rejects %s and reads nothing", async (_l, user, status) => {
    state.getCurrentUser.mockResolvedValue(user);
    const res = await GET();
    expect(res.status).toBe(status);
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.calls).toHaveLength(0);
  });

  it("returns a controlled error when any read fails, without leaking DB detail", async () => {
    state.getCurrentUser.mockResolvedValue(HR);
    state.reads = {
      evaluation_categories: { data: categories, error: null },
      rating_scale: { data: null, error: { code: "42501", message: "permission denied for table rating_scale" } },
    };
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Could not load reference data. Please try again.", code: "DB_ERROR" });
    expect(JSON.stringify(body)).not.toContain("permission denied");
  });

  it("returns a configuration error when the service role is not configured", async () => {
    state.getCurrentUser.mockResolvedValue(HR);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("CONFIG_ERROR");
  });
});

describe("category writes", () => {
  beforeEach(() => state.getCurrentUser.mockResolvedValue(HR));

  it("creates a category", async () => {
    const res = await createCategory(req("POST", { name: "Core", category_type: "core", applies_to: "both" }));
    expect(res.status).toBe(201);
    expect(state.calls).toEqual([
      { table: "evaluation_categories", op: "insert", payload: { name: "Core", category_type: "core", applies_to: "both" } },
    ]);
  });

  it("validates category input", async () => {
    const res = await createCategory(req("POST", { name: " ", category_type: "core" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Name is required.");
    expect(state.calls).toHaveLength(0);
  });

  it("rejects a non-object body", async () => {
    const res = await createCategory(req("POST", ["x"]));
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it("updates a category by id", async () => {
    const res = await updateCategory(req("PATCH", { name: "Core 2", category_type: "core", applies_to: "manager" }), ctx("c1"));
    expect(res.status).toBe(200);
    expect(state.calls[0]).toMatchObject({ table: "evaluation_categories", op: "update", eq: ["id", "c1"] });
  });

  it("deletes a category by id", async () => {
    const res = await deleteCategory(req("DELETE"), ctx("c1"));
    expect(res.status).toBe(200);
    expect(state.calls[0]).toMatchObject({ table: "evaluation_categories", op: "delete", eq: ["id", "c1"] });
  });

  it("returns 404 when an update affects zero rows", async () => {
    state.write = { data: [], error: null };
    const res = await updateCategory(req("PATCH", { name: "Core", category_type: "core" }), ctx("missing"));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("returns 404 when a delete affects zero rows", async () => {
    state.write = { data: [], error: null };
    const res = await deleteCategory(req("DELETE"), ctx("missing"));
    expect(res.status).toBe(404);
  });

  it("returns 409 with the existing message when the category is in use", async () => {
    state.write = { data: null, error: { code: "23503", message: "update or delete violates foreign key constraint" } };
    const res = await deleteCategory(req("DELETE"), ctx("c1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Cannot delete category: It has related factors. Delete the factors first.");
  });

  it("does not return raw database errors on write failure", async () => {
    state.write = { data: null, error: { code: "XX000", message: "internal db detail" } };
    const res = await createCategory(req("POST", { name: "Core", category_type: "core" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Could not create category. Please try again.");
    expect(JSON.stringify(body)).not.toContain("internal db detail");
  });
});

describe("factor writes", () => {
  beforeEach(() => state.getCurrentUser.mockResolvedValue(ADMIN));

  it("creates a factor with the existing payload shape", async () => {
    const res = await createFactor(req("POST", { category_id: "c1", name: "Quality", description: "", display_order: 3, weight: 0 }));
    expect(res.status).toBe(201);
    expect(state.calls[0].payload).toEqual({ category_id: "c1", name: "Quality", description: null, display_order: 3, weight: null });
  });

  it("validates factor input", async () => {
    const res = await createFactor(req("POST", { name: "Quality" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Category and name are required.");
  });

  it("updates a factor", async () => {
    const res = await updateFactor(req("PATCH", { category_id: "c1", name: "Quality", display_order: 1, weight: 2 }), ctx("f1"));
    expect(res.status).toBe(200);
    expect(state.calls[0]).toMatchObject({ table: "evaluation_factors", op: "update", eq: ["id", "f1"] });
  });

  it.each([true, false])("toggles a factor active=%s without touching other fields", async (active) => {
    const res = await updateFactor(req("PATCH", { active }), ctx("f1"));
    expect(res.status).toBe(200);
    expect(state.calls[0]).toMatchObject({ table: "evaluation_factors", op: "update", payload: { active }, eq: ["id", "f1"] });
  });

  it("deletes a factor", async () => {
    const res = await deleteFactor(req("DELETE"), ctx("f1"));
    expect(res.status).toBe(200);
    expect(state.calls[0]).toMatchObject({ table: "evaluation_factors", op: "delete" });
  });

  it("returns 404 for a zero-row toggle and delete", async () => {
    state.write = { data: [], error: null };
    expect((await updateFactor(req("PATCH", { active: false }), ctx("x"))).status).toBe(404);
    expect((await deleteFactor(req("DELETE"), ctx("x"))).status).toBe(404);
  });

  it("returns 409 when the factor has related ratings", async () => {
    state.write = { data: null, error: { code: "23503", message: "fk" } };
    const res = await deleteFactor(req("DELETE"), ctx("f1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Cannot delete factor: It has related appraisal ratings. Deactivate it instead.");
  });
});

describe("rule writes", () => {
  beforeEach(() => state.getCurrentUser.mockResolvedValue(HR));

  it("creates a rule", async () => {
    const res = await createRule(req("POST", { rating_label: "Exceeds", recommendation: "Promote", description: "" }));
    expect(res.status).toBe(201);
    expect(state.calls[0]).toEqual({
      table: "recommendation_rules",
      op: "insert",
      payload: { rating_label: "Exceeds", recommendation: "Promote", description: null },
    });
  });

  it("validates rule input", async () => {
    const res = await createRule(req("POST", { rating_label: "Exceeds" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Rating label and recommendation are required.");
  });

  it("updates a rule", async () => {
    const res = await updateRule(req("PATCH", { rating_label: "Exceeds", recommendation: "Bonus" }), ctx("r1"));
    expect(res.status).toBe(200);
    expect(state.calls[0]).toMatchObject({ table: "recommendation_rules", op: "update", eq: ["id", "r1"] });
  });

  it("toggles a rule", async () => {
    const res = await updateRule(req("PATCH", { active: false }), ctx("r1"));
    expect(res.status).toBe(200);
    expect(state.calls[0].payload).toEqual({ active: false });
  });

  it("deletes a rule", async () => {
    const res = await deleteRule(req("DELETE"), ctx("r1"));
    expect(res.status).toBe(200);
    expect(state.calls[0]).toMatchObject({ table: "recommendation_rules", op: "delete", eq: ["id", "r1"] });
  });

  it("returns 404 for zero-row update and delete", async () => {
    state.write = { data: [], error: null };
    expect((await updateRule(req("PATCH", { rating_label: "A", recommendation: "B" }), ctx("x"))).status).toBe(404);
    expect((await deleteRule(req("DELETE"), ctx("x"))).status).toBe(404);
  });
});

describe("write routes reject non-HR/admin users", () => {
  const writes: Array<[string, () => Promise<Response>]> = [
    ["POST categories", () => createCategory(req("POST", { name: "A", category_type: "core" }))],
    ["PATCH categories/[id]", () => updateCategory(req("PATCH", { name: "A", category_type: "core" }), ctx())],
    ["DELETE categories/[id]", () => deleteCategory(req("DELETE"), ctx())],
    ["POST factors", () => createFactor(req("POST", { category_id: "c1", name: "A" }))],
    ["PATCH factors/[id]", () => updateFactor(req("PATCH", { active: false }), ctx())],
    ["DELETE factors/[id]", () => deleteFactor(req("DELETE"), ctx())],
    ["POST rules", () => createRule(req("POST", { rating_label: "A", recommendation: "B" }))],
    ["PATCH rules/[id]", () => updateRule(req("PATCH", { active: true }), ctx())],
    ["DELETE rules/[id]", () => deleteRule(req("DELETE"), ctx())],
  ];

  for (const [label, user, status] of UNAUTHORIZED) {
    it.each(writes)(`${label}: %s returns ${status} and writes nothing`, async (_name, call) => {
      state.getCurrentUser.mockResolvedValue(user);
      const res = await call();
      expect(res.status).toBe(status);
      expect(state.createClient).not.toHaveBeenCalled();
      expect(state.calls).toHaveLength(0);
    });
  }
});
