import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { FakeSupabase } from "../helpers/fake-supabase";
import { MGMT_INPUT, NON_MGMT_INPUT } from "../helpers/score-fixtures";
import { calcSummary, type SummaryCalcProps } from "@/lib/summary-calc";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  generateAppraisalPDFWithScore: vi.fn(),
  uploadTransientDocument: vi.fn(),
  createAgreement: vi.fn(),
  fetchCompletionReport: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/appraisal-pdf", () => ({ generateAppraisalPDFWithScore: mocks.generateAppraisalPDFWithScore }));
vi.mock("@/lib/adobe-sign", () => ({
  uploadTransientDocument: mocks.uploadTransientDocument,
  createAgreement: mocks.createAgreement,
}));
vi.mock("@/lib/hrmis-approval-auth", () => ({ resolveDepartmentHeadSystemUserId: vi.fn().mockResolvedValue("mgr-1") }));
vi.mock("@/lib/appraisal-manager-access", () => ({
  resolveManagerAccessForAppraisal: vi.fn().mockResolvedValue({ hasManagerAccess: true }),
}));
vi.mock("@/lib/appraisal-test-bypass", () => ({ allowAppraisalTestBypass: () => false }));
vi.mock("@/lib/notifications/create", () => ({ createNotificationForEmployeeId: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/appraisal-completion-report", () => ({ fetchCompletionReport: mocks.fetchCompletionReport }));

import { POST } from "@/app/api/appraisals/[id]/signoff/submit/route";

const APPRAISAL_ID = "a-1";
const MANAGER = { id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" };

let db: FakeSupabase;
let consoleSpies: { mockRestore: () => void }[] = [];

function seed(status = "MANAGER_REVIEW") {
  db = new FakeSupabase(
    {
      appraisals: [
        { id: APPRAISAL_ID, employee_id: "emp-1", manager_employee_id: "mgr-1", status, manager_comments: null },
      ],
      employees: [
        { employee_id: "emp-1", full_name: "Employee", email: "emp@example.test" },
        { employee_id: "mgr-1", full_name: "Manager", email: "mgr@example.test" },
      ],
      app_users: [],
      appraisal_agreements: [],
      appraisal_score_snapshots: [],
    },
    { appraisal_score_snapshots: [["appraisal_id", "score_type"]] }
  );
  Object.assign(db, {
    storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }) }) },
  });
  mocks.createClient.mockReturnValue(db);
}

function pdfWithScore(input: SummaryCalcProps | null) {
  mocks.generateAppraisalPDFWithScore.mockResolvedValue({
    pdf: Buffer.from("%PDF"),
    scoreSource: input ? { isManagementTrack: input.isManagementTrack, input, result: calcSummary(input) } : null,
  });
}

const submit = () =>
  POST(
    new Request(`http://localhost/api/appraisals/${APPRAISAL_ID}/signoff/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id: APPRAISAL_ID }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  mocks.getCurrentUser.mockResolvedValue(MANAGER);
  mocks.uploadTransientDocument.mockResolvedValue("transient-1");
  mocks.createAgreement.mockResolvedValue("agreement-1");
  mocks.fetchCompletionReport.mockResolvedValue({ canSubmit: true, blockers: [] });
  consoleSpies = [
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
  ];
  seed();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const spy of consoleSpies) spy.mockRestore();
});

describe("POST /api/appraisals/[id]/signoff/submit — FINAL score snapshot", () => {
  it("writes FINAL from the same calcSummary result the PDF was built from", async () => {
    pdfWithScore(NON_MGMT_INPUT);
    const res = await submit();
    expect(res.status).toBe(200);

    const rows = db.tables.appraisal_score_snapshots;
    expect(rows).toHaveLength(1);
    const expected = calcSummary(NON_MGMT_INPUT);
    expect(rows[0]).toMatchObject({
      appraisal_id: APPRAISAL_ID,
      score_type: "FINAL",
      check_in_id: null,
      is_management_track: false,
      total_points: expected.totalPoints,
      overall_grade: expected.overallGrade,
      grade_label: expected.gradeBand,
      calculated_by: MANAGER.id,
    });
    expect(rows[0].components).toEqual(expected.components);
    expect(rows[0].inputs).toEqual(NON_MGMT_INPUT);
    expect(mocks.generateAppraisalPDFWithScore).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing sign-off outcome: agreement created and status PENDING_SIGNOFF", async () => {
    pdfWithScore(NON_MGMT_INPUT);
    const res = await submit();
    expect(await res.json()).toEqual({ success: true, agreementId: "agreement-1" });
    expect(db.tables.appraisals[0].status).toBe("PENDING_SIGNOFF");
    expect(db.tables.appraisal_agreements).toHaveLength(1);
  });

  it("re-submission after cancel/recall upserts the single FINAL row with the new score", async () => {
    pdfWithScore(NON_MGMT_INPUT);
    await submit();

    db.tables.appraisal_agreements[0].status = "CANCELLED";
    db.tables.appraisals[0].status = "MANAGER_REVIEW";
    pdfWithScore(MGMT_INPUT);
    const res = await submit();
    expect(res.status).toBe(200);

    const rows = db.tables.appraisal_score_snapshots;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      score_type: "FINAL",
      is_management_track: true,
      total_points: calcSummary(MGMT_INPUT).totalPoints,
    });
  });

  it("does not touch FINAL when the appraisal is COMPLETE (sign-off is refused as before)", async () => {
    seed("COMPLETE");
    db.tables.appraisal_score_snapshots.push({ id: "s-1", appraisal_id: APPRAISAL_ID, score_type: "FINAL", total_points: 80.6 });
    pdfWithScore(MGMT_INPUT);
    const res = await submit();
    expect(res.status).toBe(400);
    expect(mocks.generateAppraisalPDFWithScore).not.toHaveBeenCalled();
    expect(db.tables.appraisal_score_snapshots).toEqual([
      { id: "s-1", appraisal_id: APPRAISAL_ID, score_type: "FINAL", total_points: 80.6 },
    ]);
  });

  it("refuses sign-off while required manager fields are incomplete, before any PDF or Adobe call", async () => {
    mocks.fetchCompletionReport.mockResolvedValue({ canSubmit: false, blockers: ["Manager ratings incomplete"] });
    pdfWithScore(NON_MGMT_INPUT);
    const res = await submit();
    expect(res.status).toBe(400);
    expect((await res.json()).blockers).toEqual(["Manager ratings incomplete"]);
    expect(mocks.generateAppraisalPDFWithScore).not.toHaveBeenCalled();
    expect(mocks.createAgreement).not.toHaveBeenCalled();
    expect(db.tables.appraisals[0].status).toBe("MANAGER_REVIEW");
    expect(db.tables.appraisal_agreements).toHaveLength(0);
  });

  it("skips the snapshot when the PDF had no score, without affecting sign-off", async () => {
    pdfWithScore(null);
    const res = await submit();
    expect(res.status).toBe(200);
    expect(db.tables.appraisal_score_snapshots).toHaveLength(0);
  });

  it("a snapshot failure is logged and does not block sign-off", async () => {
    mocks.generateAppraisalPDFWithScore.mockResolvedValue({
      pdf: Buffer.from("%PDF"),
      scoreSource: { isManagementTrack: true, input: NON_MGMT_INPUT, result: calcSummary(NON_MGMT_INPUT) },
    });
    const res = await submit();
    expect(res.status).toBe(200);
    expect(db.tables.appraisals[0].status).toBe("PENDING_SIGNOFF");
    expect(db.tables.appraisal_score_snapshots).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("FINAL score snapshot not stored"),
      expect.any(Error)
    );
  });
});
