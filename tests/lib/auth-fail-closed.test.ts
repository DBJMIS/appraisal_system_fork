import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { getCurrentUser } from "@/lib/auth";

function fakeAppUsersClient(row: Record<string, unknown> | null) {
  return {
    from: () => ({
      select: () => ({
        ilike: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("SEED_USER_EMAIL", "");
  mocks.getServerSession.mockResolvedValue({
    user: { email: "hr@dbj.test", name: "HR", employee_id: "hr-emp" },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getCurrentUser Supabase credentials", () => {
  it("returns null rather than downgrading to the anon key when the service-role key is missing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", undefined);
    const user = await getCurrentUser();
    expect(user).toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("uses the service-role key and resolves app_users roles when configured", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    mocks.createClient.mockReturnValue(
      fakeAppUsersClient({
        id: "hr-1",
        email: "hr@dbj.test",
        display_name: "HR",
        role: null,
        roles: ["hr"],
        employee_id: "hr-emp",
        division_id: null,
      })
    );
    const user = await getCurrentUser();
    expect(mocks.createClient).toHaveBeenCalledWith("https://example.supabase.co", "service-role-key");
    expect(user?.id).toBe("hr-1");
    expect(user?.roles).toEqual(["hr"]);
  });
});
