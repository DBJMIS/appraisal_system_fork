import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeSupabase } from "../helpers/fake-supabase";
import { REOPEN_REASON_MAX, loadMidyearRevisions, reopenMidyearReview, validateReopenReason } from "@/lib/midyear-revisions";
import { openMidyearRevision } from "@/lib/midyear-display";
import { canReopenMidyear, formalActionDenied, MIDYEAR_LOCKED_MESSAGE } from "@/lib/midyear-lifecycle";
import type { MidyearRevision } from "@/types/checkins";

const revision = (n: number, completed: boolean): MidyearRevision => ({
  revision_number: n,
  reopened_at: "2026-10-20T10:00:00Z",
  reopened_by: "u-hr",
  reopened_by_name: "Helen HR",
  reopen_reason: "Reason",
  previous_score_revision: n - 1,
  completed_at: completed ? "2026-10-21T10:00:00Z" : null,
  completed_by: completed ? "u-mgr" : null,
  score_revision: completed ? n : null,
});

describe("reopen permission", () => {
  it.each([
    [{ isEmployee: false, isHrAdmin: true }, true],
    [{ isEmployee: true, isHrAdmin: true }, false],
    [{ isEmployee: true, isHrAdmin: false }, false],
    [{ isEmployee: false, isHrAdmin: false }, false],
  ])("%o → %s", (actor, allowed) => {
    expect(canReopenMidyear(actor)).toBe(allowed);
  });

  it("managers, delegates and the test bypass cannot reopen", () => {
    expect(formalActionDenied("REOPEN", { isEmployee: false, hasManagerAccess: true, isHrAdmin: false, testBypass: true })).toBe(
      "Only HR or an administrator can reopen a completed Mid-Year Review."
    );
    expect(formalActionDenied("REOPEN", { isEmployee: false, hasManagerAccess: false, isHrAdmin: true, testBypass: false })).toBeNull();
  });
});

describe("validateReopenReason", () => {
  it("trims and requires a reason within the limit", () => {
    expect(validateReopenReason("  Wrong target  ")).toEqual({ ok: true, reason: "Wrong target" });
    for (const bad of [undefined, null, "", "   ", 12]) expect(validateReopenReason(bad).ok).toBe(false);
    expect(validateReopenReason("x".repeat(REOPEN_REASON_MAX)).ok).toBe(true);
    expect(validateReopenReason("x".repeat(REOPEN_REASON_MAX + 1)).ok).toBe(false);
  });
});

describe("openMidyearRevision", () => {
  it("is the latest revision while it is open and the review is not complete", () => {
    expect(openMidyearRevision({ status: "EMPLOYEE_SUBMITTED", midyear_revisions: [revision(2, true), revision(3, false)] })?.revision_number).toBe(3);
    expect(openMidyearRevision({ status: "MANAGER_REVIEWED", midyear_revisions: [revision(2, false)] })?.revision_number).toBe(2);
  });

  it("is null for a complete review, even if a revision was left open by an interrupted completion", () => {
    expect(openMidyearRevision({ status: "COMPLETE", midyear_revisions: [revision(2, false)] })).toBeNull();
    expect(openMidyearRevision({ status: "EMPLOYEE_SUBMITTED", midyear_revisions: [revision(2, true)] })).toBeNull();
    expect(openMidyearRevision({ status: "EMPLOYEE_SUBMITTED" })).toBeNull();
    expect(openMidyearRevision(null)).toBeNull();
  });
});

describe("reopenMidyearReview error mapping", () => {
  const call = async (message: string) => {
    const db = new FakeSupabase({});
    db.rpcHandlers.reopen_midyear_review = () => ({ data: null, error: { message } });
    return reopenMidyearReview(db as unknown as SupabaseClient, { checkInId: "ci", actorId: "u", actorName: null, reason: "r" });
  };

  it.each([
    ["midyear_reopen_not_complete", 409, "Only a completed Mid-Year Review can be reopened."],
    ["midyear_reopen_appraisal_locked", 409, MIDYEAR_LOCKED_MESSAGE],
    ["midyear_reopen_not_formal", 400, "Only a formal Mid-Year Review can be reopened."],
    ["midyear_reopen_reason_required", 400, "A reason for revision is required."],
    ["midyear_reopen_not_found", 404, "Check-in not found"],
    ['duplicate key value violates unique constraint "idx_midyear_review_revisions_one_open"', 409, "This Mid-Year Review is already being revised."],
    ["something else", 500, "The Mid-Year Review could not be reopened."],
  ])("%s → %i", async (message, status, error) => {
    expect(await call(message)).toEqual({ ok: false, status, error });
  });
});

describe("loadMidyearRevisions", () => {
  it("groups revisions per check-in, oldest first", async () => {
    const db = new FakeSupabase({
      midyear_review_revisions: [
        { check_in_id: "ci-1", ...revision(3, false) },
        { check_in_id: "ci-1", ...revision(2, true) },
        { check_in_id: "ci-2", ...revision(2, true) },
      ],
    });
    const out = await loadMidyearRevisions(db as unknown as SupabaseClient, ["ci-1"]);
    expect(out.get("ci-1")?.map((r) => r.revision_number)).toEqual([2, 3]);
    expect(out.has("ci-2")).toBe(false);
  });
});
