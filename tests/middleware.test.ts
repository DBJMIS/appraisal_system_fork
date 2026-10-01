import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getToken = vi.hoisted(() => vi.fn());
vi.mock("next-auth/jwt", () => ({ getToken }));

import { config, middleware } from "@/middleware";

const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`https://ascend.example.test${path}`, init);

const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1" && !res.headers.get("location");
const redirectedTo = (res: Response) => {
  const location = res.headers.get("location");
  return location ? new URL(location).pathname : null;
};

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-nextauth-secret");
  getToken.mockReset();
  getToken.mockResolvedValue(null);
});

afterEach(() => vi.unstubAllEnvs());

describe("middleware: appraisal reminder cron route", () => {
  it.each([
    ["GET without a session (Vercel Cron)", "GET", { authorization: "Bearer anything" }],
    ["GET with no headers at all", "GET", {}],
    ["POST without a session", "POST", {}],
  ])("does not redirect %s to /login", async (_label, method, headers) => {
    const res = await middleware(req("/api/cron/appraisal-reminders", { method, headers }));
    expect(passedThrough(res)).toBe(true);
  });

  it("does not inspect or grant a session for the cron route", async () => {
    await middleware(req("/api/cron/appraisal-reminders"));
    expect(getToken).not.toHaveBeenCalled();
  });

  it.each([
    "/api/cron/appraisal-reminders-extra",
    "/api/cron/appraisal-reminders/run",
    "/api/cron/other-job",
    "/api/cron",
    "/api/cronjob/appraisal-reminders",
  ])("keeps the login redirect for the neighbouring path %s", async (path) => {
    const res = await middleware(req(path));
    expect(redirectedTo(res)).toBe("/login");
  });

  it("the matcher is unchanged, so the bypass is the exact-path check only", () => {
    expect(config.matcher).toEqual([
      "/((?!api/auth|api/webhooks/adobe-sign|login|_next/static|_next/image|favicon.ico|.*\\.).*)",
    ]);
  });
});

describe("middleware: existing protection is unchanged", () => {
  it.each(["/dashboard", "/appraisals/a-1", "/admin", "/hr/midyear"])("redirects an unauthenticated visit to %s to /login", async (path) => {
    const res = await middleware(req(path));
    expect(redirectedTo(res)).toBe("/login");
    expect(new URL(res.headers.get("location")!).searchParams.get("callbackUrl")).toBe(path);
  });

  it.each([
    "/api/appraisals/a-1/status",
    "/api/admin/email-preview",
    "/api/admin/test-email",
    "/api/sync/employees",
    "/api/admin/midyear/window-notices",
  ])("redirects an unauthenticated API call to %s", async (path) => {
    const res = await middleware(req(path, { method: "POST", headers: { "x-cron-secret": "anything" } }));
    expect(redirectedTo(res)).toBe("/login");
  });

  it("lets a signed-in user through and still enforces admin role routes", async () => {
    getToken.mockResolvedValue({ roles: ["employee"] });
    expect(passedThrough(await middleware(req("/dashboard")))).toBe(true);
    expect(redirectedTo(await middleware(req("/admin")))).toBe("/dashboard");
    expect(redirectedTo(await middleware(req("/admin/users")))).toBe("/dashboard");

    getToken.mockResolvedValue({ roles: ["hr"] });
    expect(passedThrough(await middleware(req("/admin")))).toBe(true);
  });

  it("keeps the existing public exceptions", async () => {
    for (const path of ["/login", "/api/auth/session", "/api/webhooks/adobe-sign"]) {
      expect(passedThrough(await middleware(req(path)))).toBe(true);
    }
  });
});
