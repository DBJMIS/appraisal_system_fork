import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  fetchAgreementLifecycle: vi.fn(),
  downloadSignedPDF: vi.fn(),
  sendNotification: vi.fn(),
  resolveManagerAccessForAppraisal: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  isPlaceholderUser: (u: { id?: string } | null) => u?.id === "placeholder",
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/adobe-sign", () => ({
  fetchAgreementLifecycle: mocks.fetchAgreementLifecycle,
  downloadSignedPDF: mocks.downloadSignedPDF,
}));
vi.mock("@/lib/notifications", () => ({ sendNotification: mocks.sendNotification }));
vi.mock("@/lib/hrmis-approval-auth", () => ({ resolveDepartmentHeadSystemUserId: vi.fn().mockResolvedValue("hod-1") }));
vi.mock("@/lib/appraisal-test-bypass", () => ({ allowAppraisalTestBypass: () => false }));
vi.mock("@/lib/appraisal-manager-access", () => ({
  resolveManagerAccessForAppraisal: mocks.resolveManagerAccessForAppraisal,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: () => { throw new Error("NOT_FOUND"); } }));

import { transitionStatus } from "@/lib/appraisal-workflow";
import { POST as webhookV1 } from "@/app/api/webhooks/adobe-sign/route";
import { POST as webhookV2 } from "@/app/api/webhooks/adobe-sign-v2/route";
import { POST as saveWorkplan } from "@/app/api/appraisals/[id]/workplan/route";
import { POST as requestChanges } from "@/app/api/appraisals/[id]/request-changes/route";
import { GET as listEvidence } from "@/app/api/appraisals/[id]/workplan/[itemId]/evidence/route";
import { GET as achieveitPlans } from "@/app/api/achieveit/plans/route";
import { POST as send360Notifications } from "@/app/api/feedback/cycles/[id]/send-notifications/route";
import HrLayout from "@/app/hr/layout";

const EMPLOYEE = { id: "u-emp", roles: ["employee"], employee_id: "emp-1" };
const MANAGER = { id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" };
const HR = { id: "u-hr", roles: ["hr"], employee_id: null };

let db: FakeSupabase;
let signedUrls: string[];
let consoleSpies: { mockRestore: () => void }[] = [];

function seedDb(tables: Record<string, Record<string, unknown>[]>) {
  db = new FakeSupabase(tables);
  signedUrls = [];
  Object.assign(db, {
    storage: {
      from: (bucket: string) => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        createSignedUrl: vi.fn(async (path: string) => {
          signedUrls.push(`${bucket}:${path}`);
          return { data: { signedUrl: `https://signed/${bucket}/${path}` } };
        }),
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  });
  mocks.createClient.mockReturnValue(db);
}

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  mocks.resolveManagerAccessForAppraisal.mockResolvedValue({ hasManagerAccess: false });
  mocks.downloadSignedPDF.mockResolvedValue(Buffer.from("%PDF"));
  mocks.sendNotification.mockResolvedValue(undefined);
  consoleSpies = [
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "log").mockImplementation(() => {}),
  ];
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const spy of consoleSpies) spy.mockRestore();
});

describe("transitionStatus — atomic transitions", () => {
  beforeEach(() => {
    seedDb({
      appraisals: [{ id: "a-1", status: "HR_REVIEW" }],
      appraisal_timeline: [],
      appraisal_audit: [],
    });
  });

  it("applies a valid transition once and records timeline and audit after the update", async () => {
    const res = await transitionStatus(db as never, "a-1", "COMPLETE", "u-hr", "Closed by HR");
    expect(res.error).toBeNull();
    expect(db.tables.appraisals[0].status).toBe("COMPLETE");
    expect(db.tables.appraisal_timeline).toHaveLength(1);
    expect(db.tables.appraisal_audit).toHaveLength(1);
    const order = db.writes.map((w) => w.table);
    expect(order.indexOf("appraisals")).toBeLessThan(order.indexOf("appraisal_timeline"));
  });

  it("a request that lost the race changes nothing and writes no history", async () => {
    const realFrom = db.from.bind(db);
    let first = true;
    vi.spyOn(db, "from").mockImplementation((table: string) => {
      const q = realFrom(table);
      if (table === "appraisals" && first) {
        first = false;
        const realSingle = q.single.bind(q);
        // Another request completes the same transition between this request's read and write.
        Object.assign(q, {
          single: async () => {
            const r = await realSingle();
            db.tables.appraisals[0].status = "COMPLETE";
            return r;
          },
        });
      }
      return q;
    });
    const res = await transitionStatus(db as never, "a-1", "COMPLETE", "u-hr");
    expect(res.error).toMatch(/updated by someone else/);
    expect(db.tables.appraisal_timeline).toHaveLength(0);
    expect(db.tables.appraisal_audit).toHaveLength(0);
  });

  it("still rejects transitions outside the workflow map", async () => {
    await expect(transitionStatus(db as never, "a-1", "DRAFT", "u-hr")).rejects.toThrow(/Invalid appraisal status transition/);
    expect(db.tables.appraisals[0].status).toBe("HR_REVIEW");
  });
});

function seedSignoff(agreementStatus = "OUT_FOR_SIGNATURE", appraisalStatus = "PENDING_SIGNOFF") {
  seedDb({
    appraisal_agreements: [
      { id: "ag-1", appraisal_id: "a-1", adobe_agreement_id: "adobe-1", status: agreementStatus, employee_signed_at: null, manager_signed_at: null, hr_signed_at: null },
    ],
    appraisals: [{ id: "a-1", employee_id: "emp-1", manager_employee_id: "mgr-1", status: appraisalStatus }],
    employees: [
      { id: "e1", employee_id: "emp-1", email: "emp@example.test", full_name: "Employee" },
      { id: "e2", employee_id: "mgr-1", email: "mgr@example.test", full_name: "Manager" },
      { id: "e3", employee_id: "hod-1", email: "hod@example.test", full_name: "Head" },
    ],
    app_users: [],
  });
}

describe.each([
  ["v1", webhookV1, { event: "AGREEMENT_WORKFLOW_COMPLETED", agreement: { id: "adobe-1" } }],
  ["v2", webhookV2, { event: "AGREEMENT_WORKFLOW_COMPLETED", agreement: { id: "adobe-1" } }],
] as const)("Adobe Sign webhook %s", (_name, handler, completedEvent) => {
  it("completion confirmed by Adobe moves PENDING_SIGNOFF to HR_REVIEW and stores SIGNED", async () => {
    seedSignoff();
    mocks.fetchAgreementLifecycle.mockResolvedValue("SIGNED");
    const res = await handler(json(completedEvent, { "x-adobesign-clientid": "client-abc" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-AdobeSign-ClientId")).toBe("client-abc");
    expect(db.tables.appraisals[0].status).toBe("HR_REVIEW");
    expect(db.tables.appraisal_agreements[0].status).toBe("SIGNED");
  });

  it("ignores a completion Adobe does not confirm (forged or premature)", async () => {
    seedSignoff();
    mocks.fetchAgreementLifecycle.mockResolvedValue("OUT_FOR_SIGNATURE");
    await handler(json(completedEvent));
    expect(db.tables.appraisals[0].status).toBe("PENDING_SIGNOFF");
    expect(db.tables.appraisal_agreements[0].status).toBe("OUT_FOR_SIGNATURE");
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("a repeated completion is a no-op: no PDF re-download, no emails, no status change", async () => {
    seedSignoff("SIGNED", "COMPLETE");
    mocks.fetchAgreementLifecycle.mockResolvedValue("SIGNED");
    await handler(json(completedEvent));
    expect(mocks.downloadSignedPDF).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
    expect(db.tables.appraisals[0].status).toBe("COMPLETE");
  });

  it("a late decline cannot move a completed appraisal back to MANAGER_REVIEW", async () => {
    seedSignoff("OUT_FOR_SIGNATURE", "COMPLETE");
    mocks.fetchAgreementLifecycle.mockResolvedValue("DECLINED");
    await handler(json({ event: "AGREEMENT_REJECTED", agreement: { id: "adobe-1" } }));
    expect(db.tables.appraisals[0].status).toBe("COMPLETE");
  });

  it("returns 500 (so Adobe retries) when Adobe cannot be reached, without changing state", async () => {
    seedSignoff();
    mocks.fetchAgreementLifecycle.mockRejectedValue(new Error("network"));
    const res = await handler(json(completedEvent, { "x-adobesign-clientid": "client-abc" }));
    expect(res.status).toBe(500);
    expect(res.headers.get("X-AdobeSign-ClientId")).toBe("client-abc");
    expect(db.tables.appraisals[0].status).toBe("PENDING_SIGNOFF");
  });
});

function seedWorkplan(status: string) {
  seedDb({
    appraisals: [
      { id: "a-1", employee_id: "emp-1", manager_employee_id: "mgr-1", status },
      { id: "a-2", employee_id: "emp-2", manager_employee_id: "mgr-2", status: "DRAFT" },
    ],
    workplans: [
      { id: "wp-1", appraisal_id: "a-1" },
      { id: "wp-2", appraisal_id: "a-2" },
    ],
    workplan_items: [
      { id: "it-1", workplan_id: "wp-1", weight: 100, major_task: "Mine" },
      { id: "it-2", workplan_id: "wp-2", weight: 100, major_task: "Someone else's" },
    ],
  });
}

const saveBody = (workplanId: string, items: unknown[], idsToDelete: string[] = []) =>
  json({ workplanId, items, idsToDelete });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/appraisals/[id]/workplan — scope and lock", () => {
  it.each(["PENDING_SIGNOFF", "HR_REVIEW", "COMPLETE"])("refuses changes once the appraisal is %s", async (status) => {
    seedWorkplan(status);
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    const res = await saveWorkplan(saveBody("wp-1", [{ id: "it-1", weight: 100, actual_result: 99 }]), ctx("a-1"));
    expect(res.status).toBe(409);
    expect(db.tables.workplan_items.find((r) => r.id === "it-1")?.actual_result).toBeUndefined();
  });

  it("refuses a workplanId that belongs to another appraisal", async () => {
    seedWorkplan("DRAFT");
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    const res = await saveWorkplan(saveBody("wp-2", [{ id: "new-1", weight: 100 }]), ctx("a-1"));
    expect(res.status).toBe(404);
    expect(db.tables.workplan_items).toHaveLength(2);
  });

  it("cannot delete or overwrite items from another appraisal's workplan", async () => {
    seedWorkplan("DRAFT");
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    const res = await saveWorkplan(
      saveBody("wp-1", [{ id: "it-2", weight: 100, major_task: "Hijacked" }], ["it-2"]),
      ctx("a-1")
    );
    expect(res.status).toBe(200);
    const foreign = db.tables.workplan_items.find((r) => r.id === "it-2");
    expect(foreign).toMatchObject({ workplan_id: "wp-2", major_task: "Someone else's" });
  });

  it("still saves the employee's own workplan in an editable status", async () => {
    seedWorkplan("SELF_ASSESSMENT");
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    const res = await saveWorkplan(saveBody("wp-1", [{ id: "it-1", weight: 100, actual_result: 80 }]), ctx("a-1"));
    expect(res.status).toBe(200);
    expect(db.tables.workplan_items.find((r) => r.id === "it-1")).toMatchObject({ actual_result: 80, points: 80 });
  });
});

describe("POST /api/appraisals/[id]/request-changes", () => {
  it("clears earlier approvals so the revised workplan needs both approvals again", async () => {
    seedDb({
      appraisals: [{ id: "a-1", employee_id: "emp-1", manager_employee_id: "mgr-1", status: "PENDING_APPROVAL" }],
      appraisal_approvals: [
        { id: "ap-1", appraisal_id: "a-1", role: "EMPLOYEE" },
        { id: "ap-x", appraisal_id: "a-other", role: "EMPLOYEE" },
      ],
      appraisal_timeline: [],
      appraisal_audit: [],
    });
    mocks.getCurrentUser.mockResolvedValue(MANAGER);
    mocks.resolveManagerAccessForAppraisal.mockResolvedValue({ hasManagerAccess: true });
    const res = await requestChanges(json({ reason: "Adjust weights" }), ctx("a-1"));
    expect(res.status).toBe(200);
    expect(db.tables.appraisals[0].status).toBe("DRAFT");
    expect(db.tables.appraisal_approvals.map((r) => r.id)).toEqual(["ap-x"]);
  });
});

describe("GET evidence — storage path guard", () => {
  it("only signs files in the evidence bucket under the appraisal's own prefix", async () => {
    seedDb({
      appraisals: [{ id: "a-1", employee_id: "emp-1", manager_employee_id: "mgr-1", division_id: null }],
      workplan_item_evidence: [
        { id: "ev-1", appraisal_id: "a-1", workplan_item_id: "it-1", evidence_type: "FILE", storage_bucket: "workplan-evidence", storage_path: "a-1/it-1/1-file.pdf", created_at: "1" },
        { id: "ev-2", appraisal_id: "a-1", workplan_item_id: "it-1", evidence_type: "FILE", storage_bucket: "appraisal-pdfs", storage_path: "a-9/signed.pdf", created_at: "2" },
        { id: "ev-3", appraisal_id: "a-1", workplan_item_id: "it-1", evidence_type: "FILE", storage_bucket: "workplan-evidence", storage_path: "a-9/it-9/x.pdf", created_at: "3" },
      ],
    });
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    const res = await listEvidence(new Request("http://localhost/e") as unknown as NextRequest, {
      params: Promise.resolve({ id: "a-1", itemId: "it-1" }),
    });
    expect(res.status).toBe(200);
    expect(signedUrls).toEqual(["workplan-evidence:a-1/it-1/1-file.pdf"]);
  });
});

describe("role guards", () => {
  it("AchieveIt plan proxy requires HR/Admin", async () => {
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    expect((await achieveitPlans()).status).toBe(403);
  });

  it("360 send-notifications requires HR/Admin", async () => {
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    const res = await send360Notifications(json({}), ctx("cycle-1"));
    expect(res.status).toBe(403);
  });

  it("HR pages redirect non-HR users and render for HR", async () => {
    mocks.getCurrentUser.mockResolvedValue(MANAGER);
    await expect(HrLayout({ children: null })).rejects.toThrow("REDIRECT:/dashboard");
    mocks.getCurrentUser.mockResolvedValue(HR);
    await expect(HrLayout({ children: null })).resolves.toBeTruthy();
  });
});
