import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  sendEmailViaGraph: vi.fn(),
  sendEmail: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  isPlaceholderUser: (u: { id?: string } | null) => u?.id === "placeholder-user-id",
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/email", () => ({ sendEmailViaGraph: mocks.sendEmailViaGraph }));
vi.mock("@/lib/notifications", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/notifications/create", () => ({ createNotificationForEmployeeId: mocks.notify }));
vi.mock("@/lib/email-templates", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-templates")>();
  return { ...actual, renderEmail: vi.fn(actual.renderEmail) };
});

import { GET as LIST, POST as PREVIEW } from "@/app/api/admin/email-preview/route";
import { POST as TEST_SEND } from "@/app/api/admin/test-email/route";
import { renderEmail } from "@/lib/email-templates";

const HR = { id: "u-hr", email: "hr.officer@dbankjm.com", roles: ["hr"] };
const ADMIN = { id: "u-admin", email: "admin@dbankjm.com", roles: ["admin"] };
const TEST_TO = "tester@dbankjm.com";

const UNAUTHORIZED: Array<[string, unknown, number]> = [
  ["unauthenticated", null, 401],
  ["placeholder", { id: "placeholder-user-id", roles: ["admin"] }, 401],
  ["employee", { id: "e", roles: ["employee"] }, 403],
  ["manager", { id: "m", roles: ["manager"] }, 403],
];

let db: FakeSupabase;
const renderSpy = vi.mocked(renderEmail);

function seed() {
  db = new FakeSupabase({
    appraisals: [
      { id: "a-1", employee_id: "emp-1", manager_employee_id: "mgr-1", cycle_id: "c-1", review_type: "annual", status: "IN_PROGRESS" },
      { id: "a-2", employee_id: "emp-2", manager_employee_id: "mgr-1", cycle_id: "c-1", review_type: "annual", status: "SELF_ASSESSMENT" },
    ],
    appraisal_cycles: [{ id: "c-1", name: "FY 2026", fiscal_year: "2026", end_date: "2027-03-31", midyear_due_date: "2026-10-30" }],
    employees: [
      { employee_id: "emp-1", full_name: "Jane Employee", email: "jane@example.test" },
      { employee_id: "emp-2", full_name: "Ann Analyst", email: "ann@example.test" },
      { employee_id: "mgr-1", full_name: "Mark Manager", email: "mark@example.test" },
    ],
    app_users: [{ employee_id: "emp-1", email: "jane.portal@example.test" }],
    midyear_window_notices: [],
    app_notifications: [],
    check_ins: [],
  });
  mocks.createClient.mockReturnValue(db);
}

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const preview = (body: unknown) => PREVIEW(post("/api/admin/email-preview", body));
const testSend = (body: unknown) => TEST_SEND(post("/api/admin/test-email", body));
const as = (user: unknown) => mocks.getCurrentUser.mockResolvedValue(user);

function expectNoSideEffects() {
  expect(db.writes).toEqual([]);
  expect(db.tables.midyear_window_notices).toEqual([]);
  expect(db.tables.app_notifications).toEqual([]);
  expect(db.tables.appraisals.map((a) => a.status)).toEqual(["IN_PROGRESS", "SELF_ASSESSMENT"]);
  expect(mocks.notify).not.toHaveBeenCalled();
  expect(mocks.sendEmail).not.toHaveBeenCalled();
}

let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  mocks.sendEmailViaGraph.mockResolvedValue({ success: true });
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ascend.dbankjm.test");
  vi.stubEnv("AZURE_FROM_EMAIL", "dbjservices@dbankjm.com");
  vi.stubEnv("APPRAISAL_TEST_EMAIL_ALLOWED_DOMAINS", "dbankjm.com");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/email-preview", () => {
  it.each([["hr", HR], ["admin", ADMIN]])("renders for %s without sending or writing anything", async (_l, user) => {
    as(user);
    const res = await preview({ kind: "MIDYEAR_DUE_SOON", appraisalId: "a-1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subject).toBe("Mid-Year Review due 30 Oct 2026");
    expect(body.recipientRole).toBe("employee");
    expect(body.warnings).toEqual([]);
    expect(body.text).toContain("Your Mid-Year Review for FY 2026/27 is due on 30 Oct 2026.");
    expect(body.html).toContain('href="https://ascend.dbankjm.test/appraisals/a-1"');
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it("uses the shared template renderer", async () => {
    as(HR);
    const body = await (await preview({ kind: "FINAL_REVIEW_AVAILABLE", appraisalId: "a-1" })).json();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy).toHaveBeenCalledWith("FINAL_REVIEW_AVAILABLE", expect.objectContaining({ appraisalId: "a-1", dueDate: "31 Mar 2027" }));
    const rendered = renderSpy.mock.results[0].value as { subject: string; text: string; html: string };
    expect({ subject: body.subject, text: body.text, html: body.html }).toEqual(rendered);
  });

  it("never includes employee or manager email addresses", async () => {
    as(HR);
    const body = await (await preview({ kind: "MIDYEAR_WINDOW_OPEN", appraisalId: "a-1" })).json();
    expect(body.recipientRole).toBe("manager");
    expect(JSON.stringify(body)).not.toContain("@example.test");
  });

  it("surfaces a missing application URL", async () => {
    as(HR);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const body = await (await preview({ kind: "MIDYEAR_DUE_SOON", appraisalId: "a-1" })).json();
    expect(body.warnings.join(" ")).toContain("NEXT_PUBLIC_APP_URL is not set");
    expect(body.html).not.toContain("href=");
    expect(body.text).not.toContain("/appraisals/");
  });

  it.each([
    ["an unknown kind", { kind: "PAYSLIP", appraisalId: "a-1" }, 400],
    ["a missing kind", { appraisalId: "a-1" }, 400],
    ["a missing appraisal", { kind: "MIDYEAR_READY" }, 400],
    ["a malformed appraisal id", { kind: "MIDYEAR_READY", appraisalId: "a-1' or 1=1" }, 400],
    ["a non-object body", ["x"], 400],
    ["invalid JSON", "{not json", 400],
    ["an appraisal that does not exist", { kind: "MIDYEAR_READY", appraisalId: "nope" }, 404],
  ])("rejects %s", async (_l, body, status) => {
    as(HR);
    const res = await preview(body);
    expect(res.status).toBe(status);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it.each(UNAUTHORIZED)("rejects %s", async (_l, user, status) => {
    as(user);
    expect((await preview({ kind: "MIDYEAR_READY", appraisalId: "a-1" })).status).toBe(status);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(renderSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/email-preview", () => {
  it("lists notification types and the cycle's appraisals by name and status", async () => {
    as(HR);
    const res = await LIST(new NextRequest("http://localhost/api/admin/email-preview?cycleId=c-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kinds.map((k: { kind: string }) => k.kind)).toEqual([
      "MIDYEAR_WINDOW_OPEN",
      "MIDYEAR_READY",
      "MIDYEAR_DUE_SOON",
      "MIDYEAR_OVERDUE",
      "MIDYEAR_MANAGER_REVIEW_PENDING",
      "FINAL_REVIEW_AVAILABLE",
      "FINAL_REVIEW_DUE_SOON",
      "FINAL_REVIEW_OVERDUE",
      "MANAGER_REVIEW_PENDING",
    ]);
    expect(body.appraisals).toEqual([
      { id: "a-2", label: "Ann Analyst · Self Assessment" },
      { id: "a-1", label: "Jane Employee · In progress" },
    ]);
    expect(body.appUrl).toEqual({ configured: true, warning: null });
    expect(JSON.stringify(body)).not.toContain("@example.test");
    expect(db.writes).toEqual([]);
  });

  it("returns no appraisals without a cycle and validates the cycle id", async () => {
    as(HR);
    expect((await (await LIST(new NextRequest("http://localhost/api/admin/email-preview"))).json()).appraisals).toEqual([]);
    expect((await LIST(new NextRequest("http://localhost/api/admin/email-preview?cycleId=bad%20id"))).status).toBe(400);
  });

  it.each(UNAUTHORIZED)("rejects %s", async (_l, user, status) => {
    as(user);
    expect((await LIST(new NextRequest("http://localhost/api/admin/email-preview?cycleId=c-1"))).status).toBe(status);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/test-email", () => {
  it("sends one [TEST] copy to the supplied address via Graph, using the shared renderer", async () => {
    as(HR);
    const res = await testSend({ to: TEST_TO, kind: "MIDYEAR_DUE_SOON", appraisalId: "a-1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, transport: "graph" });

    expect(renderSpy).toHaveBeenCalledWith("MIDYEAR_DUE_SOON", expect.objectContaining({ appraisalId: "a-1" }));
    const rendered = renderSpy.mock.results[0].value as { subject: string; text: string; html: string };
    expect(mocks.sendEmailViaGraph).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmailViaGraph).toHaveBeenCalledWith({
      to: TEST_TO,
      subject: "[TEST] Mid-Year Review due 30 Oct 2026",
      textContent: rendered.text,
      htmlContent: rendered.html,
    });
    expectNoSideEffects();
  });

  it("never sends to the employee or manager", async () => {
    as(HR);
    for (const kind of ["MIDYEAR_READY", "MIDYEAR_WINDOW_OPEN", "MANAGER_REVIEW_PENDING"]) {
      await testSend({ to: TEST_TO, kind, appraisalId: "a-1" });
    }
    const recipients = mocks.sendEmailViaGraph.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(recipients).toEqual([TEST_TO, TEST_TO, TEST_TO]);
    expect(JSON.stringify(mocks.sendEmailViaGraph.mock.calls)).not.toContain("@example.test");
  });

  it.each([
    ["a missing address", { kind: "MIDYEAR_READY", appraisalId: "a-1" }],
    ["an empty address", { to: "  ", kind: "MIDYEAR_READY", appraisalId: "a-1" }],
    ["an invalid address", { to: "not-an-email", kind: "MIDYEAR_READY", appraisalId: "a-1" }],
    ["two addresses", { to: `${TEST_TO}, other@dbankjm.com`, kind: "MIDYEAR_READY", appraisalId: "a-1" }],
    ["semicolon-separated addresses", { to: `${TEST_TO};other@dbankjm.com`, kind: "MIDYEAR_READY", appraisalId: "a-1" }],
    ["a recipient list", { to: [TEST_TO], kind: "MIDYEAR_READY", appraisalId: "a-1" }],
    ["CC", { to: TEST_TO, cc: "boss@dbankjm.com", kind: "MIDYEAR_READY", appraisalId: "a-1" }],
    ["BCC", { to: TEST_TO, bcc: ["boss@dbankjm.com"], kind: "MIDYEAR_READY", appraisalId: "a-1" }],
    ["an address outside the allowed domains", { to: "someone@gmail.com", kind: "MIDYEAR_READY", appraisalId: "a-1" }],
    ["a look-alike subdomain", { to: "x@dbankjm.com.evil.test", kind: "MIDYEAR_READY", appraisalId: "a-1" }],
    ["an unknown kind", { to: TEST_TO, kind: "PAYSLIP", appraisalId: "a-1" }],
    ["a missing appraisal", { to: TEST_TO, kind: "MIDYEAR_READY" }],
  ])("rejects %s with 400 and sends nothing", async (_l, body) => {
    as(HR);
    const res = await testSend(body);
    expect(res.status).toBe(400);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it("returns 404 for an unknown appraisal and sends nothing", async () => {
    as(HR);
    expect((await testSend({ to: TEST_TO, kind: "MIDYEAR_READY", appraisalId: "nope" })).status).toBe(404);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
  });

  it("defaults the allowed domain to the sending mailbox's domain", async () => {
    as(HR);
    vi.stubEnv("APPRAISAL_TEST_EMAIL_ALLOWED_DOMAINS", "");
    expect((await testSend({ to: TEST_TO, kind: "MIDYEAR_READY", appraisalId: "a-1" })).status).toBe(200);
    expect((await testSend({ to: "x@other.test", kind: "MIDYEAR_READY", appraisalId: "a-1" })).status).toBe(400);
  });

  it("refuses to send when no allowed domain can be determined", async () => {
    as(HR);
    vi.stubEnv("APPRAISAL_TEST_EMAIL_ALLOWED_DOMAINS", "");
    vi.stubEnv("AZURE_FROM_EMAIL", "");
    const res = await testSend({ to: TEST_TO, kind: "MIDYEAR_READY", appraisalId: "a-1" });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("CONFIG_ERROR");
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
  });

  it.each([
    ["Graph 403", "Graph sendMail failed (403): {\"error\":{\"code\":\"ErrorAccessDenied\",\"message\":\"Access is denied.\"}}", "GRAPH_403"],
    ["token failure", "Token request failed (401): {\"error\":\"invalid_client\",\"error_description\":\"AADSTS7000215 client secret\"}", "TOKEN_401"],
    ["missing sender", "AZURE_FROM_EMAIL is not set", "SENDER_NOT_CONFIGURED"],
    ["unknown failure", "something odd: secret=abc", "SEND_FAILED"],
  ])("returns a controlled 502 on %s without leaking transport detail", async (_l, error, code) => {
    as(HR);
    mocks.sendEmailViaGraph.mockResolvedValue({ success: false, error });
    const res = await testSend({ to: TEST_TO, kind: "MIDYEAR_READY", appraisalId: "a-1" });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, transport: "graph", code });
    expect(typeof body.error).toBe("string");
    const raw = JSON.stringify(body);
    for (const leak of ["ErrorAccessDenied", "Access is denied", "AADSTS", "invalid_client", "client secret", "secret=abc"]) {
      expect(raw).not.toContain(leak);
    }
    expectNoSideEffects();
  });

  it("returns a controlled 502 when Graph cannot be reached", async () => {
    as(HR);
    mocks.sendEmailViaGraph.mockRejectedValue(new Error("getaddrinfo ENOTFOUND graph.microsoft.com"));
    const res = await testSend({ to: TEST_TO, kind: "MIDYEAR_READY", appraisalId: "a-1" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, transport: "graph", error: "Could not reach Microsoft Graph.", code: "GRAPH_UNREACHABLE" });
  });

  it("writes a structured log without the email body", async () => {
    as(HR);
    await testSend({ to: TEST_TO, kind: "MIDYEAR_DUE_SOON", appraisalId: "a-1" });
    expect(info).toHaveBeenCalledTimes(1);
    const [tag, line] = info.mock.calls[0] as [string, string];
    expect(tag).toBe("[admin-test-email]");
    const entry = JSON.parse(line);
    expect(entry).toMatchObject({
      event: "appraisal_test_email",
      actor_id: "u-hr",
      actor_email: "hr.officer@dbankjm.com",
      recipient: TEST_TO,
      kind: "MIDYEAR_DUE_SOON",
      appraisal_id: "a-1",
      success: true,
    });
    expect(new Date(entry.timestamp).toString()).not.toBe("Invalid Date");
    expect(line).not.toContain("Mid-Year Review");
    expect(line).not.toContain("<html");

    mocks.sendEmailViaGraph.mockResolvedValue({ success: false, error: "Graph sendMail failed (500): boom" });
    await testSend({ to: TEST_TO, kind: "MIDYEAR_DUE_SOON", appraisalId: "a-1" });
    const failure = JSON.parse((warn.mock.calls[0] as [string, string])[1]);
    expect(failure).toMatchObject({ success: false, error_code: "GRAPH_500" });
    expect((warn.mock.calls[0] as [string, string])[1]).not.toContain("boom");
  });

  it.each(UNAUTHORIZED)("rejects %s and sends nothing", async (_l, user, status) => {
    as(user);
    expect((await testSend({ to: TEST_TO, kind: "MIDYEAR_READY", appraisalId: "a-1" })).status).toBe(status);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("static guards", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  function sourceFiles(dir: string): string[] {
    const abs = path.join(process.cwd(), dir);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "node_modules" ? [] : sourceFiles(rel);
      return /\.(ts|tsx|js|mjs)$/.test(e.name) ? [rel] : [];
    });
  }

  it("introduces no SMTP or Nodemailer", () => {
    const pkg = JSON.parse(read("package.json")) as Record<string, Record<string, string> | undefined>;
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      expect(Object.keys(pkg[field] ?? {})).not.toContain("nodemailer");
    }
    const offenders = ["app", "lib", "components", "hooks"]
      .flatMap(sourceFiles)
      .filter((f) => /from\s+["']nodemailer["']|require\(["']nodemailer["']\)|createTransport\(|process\.env\.SMTP_/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("test send uses Graph directly, not the error-swallowing wrapper, and writes no records", () => {
    const route = read("app/api/admin/test-email/route.ts");
    expect(route).toContain('from "@/lib/email"');
    expect(route).toContain("sendEmailViaGraph");
    expect(route).not.toContain("@/lib/notifications");
    for (const src of [route, read("app/api/admin/email-preview/route.ts"), read("lib/email-context.ts")]) {
      expect(src).not.toMatch(/midyear_window_notices|createNotification|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    }
  });
});
