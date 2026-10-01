import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  generateAppraisalsForCycle: vi.fn(),
  calculateAppraisalScore: vi.fn(),
  generateRecommendation: vi.fn(),
  copyPreviousWorkplan: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  isPlaceholderUser: (u: { id?: string } | null) => u?.id === "placeholder-user-id",
}));
vi.mock("@/lib/appraisal-generator", () => ({
  generateAppraisalsForCycle: mocks.generateAppraisalsForCycle,
}));
vi.mock("@/lib/score-engine", () => ({
  calculateAppraisalScore: mocks.calculateAppraisalScore,
}));
vi.mock("@/lib/recommendation-engine", () => ({
  generateRecommendation: mocks.generateRecommendation,
}));
vi.mock("@/lib/workplan-copy", () => ({
  copyPreviousWorkplan: mocks.copyPreviousWorkplan,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

import { PATCH as statusPATCH } from "@/app/api/appraisals/[id]/status/route";
import { POST as generatePOST } from "@/app/api/cycles/[cycleId]/generate-appraisals/route";
import { POST as calculateScorePOST } from "@/app/api/appraisals/[id]/calculate-score/route";
import { POST as recommendationPOST } from "@/app/api/appraisals/[id]/recommendation/route";
import { POST as copyPreviousPOST } from "@/app/api/workplans/copy-previous/route";
import { PATCH as hrRecommendationsPATCH } from "@/app/api/hr/recommendations/route";

const USERS = {
  unauthenticated: null,
  placeholder: { id: "placeholder-user-id", email: "user@company.com", name: "Placeholder User", roles: ["employee"] },
  employee: { id: "emp-1", email: "emp@dbj.test", name: "Employee", roles: ["employee"], employee_id: "emp-1" },
  manager: { id: "mgr-1", email: "mgr@dbj.test", name: "Manager", roles: ["manager"], employee_id: "mgr-1" },
  gm: { id: "gm-1", email: "gm@dbj.test", name: "GM", roles: ["gm"], employee_id: "gm-1" },
  hr: { id: "hr-1", email: "hr@dbj.test", name: "HR", roles: ["hr"], employee_id: "hr-emp" },
  admin: { id: "admin-1", email: "admin@dbj.test", name: "Admin", roles: ["admin"], employee_id: "admin-emp" },
} as const;

type UserKey = keyof typeof USERS;

const DENIED: [UserKey, number][] = [
  ["unauthenticated", 401],
  ["placeholder", 401],
  ["employee", 403],
  ["manager", 403],
  ["gm", 403],
];
const ALLOWED: UserKey[] = ["hr", "admin"];

function asUser(key: UserKey) {
  mocks.getCurrentUser.mockResolvedValue(USERS[key]);
}

function post(url: string) {
  return new NextRequest(url, { method: "POST" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PATCH /api/appraisals/[id]/status (retired)", () => {
  it.each(Object.keys(USERS) as UserKey[])("returns 410 for %s and writes nothing", async (key) => {
    asUser(key);
    const res = await statusPATCH();
    expect(res.status).toBe(410);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/workplans/copy-previous (retired)", () => {
  it.each(Object.keys(USERS) as UserKey[])("returns 410 for %s and copies nothing", async (key) => {
    asUser(key);
    const res = await copyPreviousPOST();
    expect(res.status).toBe(410);
    expect(mocks.copyPreviousWorkplan).not.toHaveBeenCalled();
  });
});

describe("POST /api/cycles/[cycleId]/generate-appraisals", () => {
  const call = () =>
    generatePOST(post("http://localhost/api/cycles/cycle-1/generate-appraisals"), {
      params: Promise.resolve({ cycleId: "cycle-1" }),
    });

  it.each(DENIED)("rejects %s with %i", async (key, status) => {
    asUser(key);
    const res = await call();
    expect(res.status).toBe(status);
    expect(mocks.generateAppraisalsForCycle).not.toHaveBeenCalled();
  });

  it.each(ALLOWED)("allows %s", async (key) => {
    asUser(key);
    mocks.generateAppraisalsForCycle.mockResolvedValue({ cycleName: "FY 2026", appraisalsCreated: 3 });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cycle: "FY 2026", appraisals_created: 3 });
    expect(mocks.generateAppraisalsForCycle).toHaveBeenCalledWith("cycle-1");
  });
});

describe("POST /api/appraisals/[id]/calculate-score", () => {
  const call = () =>
    calculateScorePOST(post("http://localhost/api/appraisals/a-1/calculate-score"), {
      params: Promise.resolve({ id: "a-1" }),
    });

  it.each(DENIED)("rejects %s with %i", async (key, status) => {
    asUser(key);
    const res = await call();
    expect(res.status).toBe(status);
    expect(mocks.calculateAppraisalScore).not.toHaveBeenCalled();
  });

  it.each(ALLOWED)("allows %s", async (key) => {
    asUser(key);
    mocks.calculateAppraisalScore.mockResolvedValue({ total: 80 });
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.calculateAppraisalScore).toHaveBeenCalledWith("a-1");
  });
});

describe("POST /api/appraisals/[id]/recommendation", () => {
  const call = () =>
    recommendationPOST(post("http://localhost/api/appraisals/a-1/recommendation"), {
      params: Promise.resolve({ id: "a-1" }),
    });

  it.each(DENIED)("rejects %s with %i", async (key, status) => {
    asUser(key);
    const res = await call();
    expect(res.status).toBe(status);
    expect(mocks.generateRecommendation).not.toHaveBeenCalled();
  });

  it.each(ALLOWED)("allows %s", async (key) => {
    asUser(key);
    mocks.generateRecommendation.mockResolvedValue({
      appraisalId: "a-1",
      recommendation: "Retain",
      status: "generated",
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ appraisalId: "a-1", recommendation: "Retain", status: "generated" });
    expect(mocks.generateRecommendation).toHaveBeenCalledWith("a-1");
  });
});

describe("PATCH /api/hr/recommendations", () => {
  function fakeSupabase(existing: boolean) {
    const insert = vi.fn(async () => ({ error: null }));
    const update = vi.fn((_payload: Record<string, unknown>) => ({
      eq: async () => ({ error: null }),
    }));
    const client = {
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: existing ? { appraisal_id: "a-1" } : null }),
          }),
        }),
        insert,
        update,
      })),
    };
    return { client, insert, update };
  }

  const call = () =>
    hrRecommendationsPATCH(
      new NextRequest("http://localhost/api/hr/recommendations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appraisalId: "a-1", hrFinalDecision: "Promote" }),
      })
    );

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  });

  it.each(DENIED)("rejects %s with %i and never touches the database", async (key, status) => {
    asUser(key);
    const res = await call();
    expect(res.status).toBe(status);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each(ALLOWED)("allows %s to update an existing decision", async (key) => {
    asUser(key);
    const fake = fakeSupabase(true);
    mocks.createClient.mockReturnValue(fake.client);
    const res = await call();
    expect(res.status).toBe(200);
    expect(mocks.createClient).toHaveBeenCalledWith("https://example.supabase.co", "service-role-key");
    expect(fake.update).toHaveBeenCalledWith(
      expect.objectContaining({ hr_final_decision: "Promote", hr_decided_by: USERS[key]!.id })
    );
  });

  it("allows HR to insert a new decision", async () => {
    asUser("hr");
    const fake = fakeSupabase(false);
    mocks.createClient.mockReturnValue(fake.client);
    const res = await call();
    expect(res.status).toBe(200);
    expect(fake.insert).toHaveBeenCalledWith(
      expect.objectContaining({ appraisal_id: "a-1", hr_final_decision: "Promote", hr_decided_by: "hr-1" })
    );
  });

  it("fails closed instead of using the anon key when the service-role key is missing", async () => {
    asUser("hr");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
    const res = await call();
    expect(res.status).toBe(500);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
