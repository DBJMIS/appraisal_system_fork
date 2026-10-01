import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      update: (updates: Record<string, unknown>) => {
        mocks.update(updates);
        return {
          eq: () => ({
            select: () => ({
              single: async () => ({ data: { roles: updates.roles ?? [], is_active: true }, error: null }),
            }),
          }),
        };
      },
    }),
  }),
}));

import { PATCH } from "@/app/api/admin/users/[id]/route";

function patch(body: unknown) {
  return PATCH(
    new NextRequest("http://localhost/api/admin/users/u-1", { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "u-1" }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://fake.local");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fake-key");
});

describe("PATCH /api/admin/users/[id] authorization (unchanged)", () => {
  it.each([
    ["anonymous", null],
    ["employee", { id: "e", roles: [] }],
    ["manager", { id: "m", roles: ["manager"] }],
    ["gm", { id: "g", roles: ["gm"] }],
  ])("rejects %s with 401 and writes nothing", async (_label, user) => {
    mocks.getCurrentUser.mockResolvedValue(user);
    const res = await patch({ roles: ["admin"] });
    expect(res.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([["hr"], ["admin"]])("allows %s to update roles", async (role) => {
    mocks.getCurrentUser.mockResolvedValue({ id: "x", roles: [role] });
    const res = await patch({ roles: ["hr"] });
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ roles: ["hr"] }));
  });

  it("still rejects roles other than hr/admin", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "x", roles: ["admin"] });
    const res = await patch({ roles: ["hr", "gm"] });
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
