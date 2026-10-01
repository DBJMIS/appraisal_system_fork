/**
 * Controlled correction of a completed formal Mid-Year Review:
 * COMPLETE → reopen (HR/admin, with a reason) → the manager revises through the existing review
 * steps → COMPLETE, which records a new MIDYEAR score revision. Server-only: callers pass a
 * service-role client. Reopening itself runs in the database (reopen_midyear_review, 0075).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MidyearRevision } from "@/types/checkins";
import { MIDYEAR_LOCKED_MESSAGE } from "@/lib/midyear-lifecycle";

export const REOPEN_REASON_MAX = 2000;

export type ReopenReasonCheck = { ok: true; reason: string } | { ok: false; error: string };

export function validateReopenReason(reason: unknown): ReopenReasonCheck {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) return { ok: false, error: "A reason for revision is required." };
  if (text.length > REOPEN_REASON_MAX) {
    return { ok: false, error: `The reason for revision must be ${REOPEN_REASON_MAX} characters or fewer.` };
  }
  return { ok: true, reason: text };
}

export type ReopenOutcome =
  | { ok: true; revisionNumber: number; reopenedAt: string; previousScoreRevision: number | null }
  | { ok: false; status: number; error: string };

const REOPEN_ERRORS: Array<[RegExp, number, string]> = [
  [/midyear_reopen_not_complete/, 409, "Only a completed Mid-Year Review can be reopened."],
  [/midyear_reopen_appraisal_locked/, 409, MIDYEAR_LOCKED_MESSAGE],
  [/midyear_reopen_not_formal/, 400, "Only a formal Mid-Year Review can be reopened."],
  [/midyear_reopen_reason_required|midyear_review_revisions_reason_check/, 400, "A reason for revision is required."],
  [/midyear_reopen_not_found/, 404, "Check-in not found"],
  [/idx_midyear_review_revisions_one_open|midyear_review_revisions_check_in_number_key/, 409, "This Mid-Year Review is already being revised."],
];

/** Reopens a COMPLETE formal review in one transaction. The caller has already checked who may do this. */
export async function reopenMidyearReview(
  supabase: SupabaseClient,
  params: { checkInId: string; actorId: string; actorName: string | null; reason: string }
): Promise<ReopenOutcome> {
  const { data, error } = await supabase.rpc("reopen_midyear_review", {
    p_check_in_id: params.checkInId,
    p_actor: params.actorId,
    p_actor_name: params.actorName,
    p_reason: params.reason,
  });
  if (error) {
    const known = REOPEN_ERRORS.find(([pattern]) => pattern.test(error.message ?? ""));
    if (known) return { ok: false, status: known[1], error: known[2] };
    return { ok: false, status: 500, error: "The Mid-Year Review could not be reopened." };
  }
  const result = (data ?? {}) as { revision_number?: number; reopened_at?: string; previous_score_revision?: number | null };
  return {
    ok: true,
    revisionNumber: Number(result.revision_number),
    reopenedAt: String(result.reopened_at ?? ""),
    previousScoreRevision: result.previous_score_revision ?? null,
  };
}

const REVISION_COLUMNS =
  "check_in_id, revision_number, reopened_at, reopened_by, reopened_by_name, reopen_reason, previous_score_revision, completed_at, completed_by, score_revision";

function toRevision(row: Record<string, unknown>): MidyearRevision {
  return {
    revision_number: Number(row.revision_number),
    reopened_at: String(row.reopened_at ?? ""),
    reopened_by: String(row.reopened_by ?? ""),
    reopened_by_name: (row.reopened_by_name as string | null) ?? null,
    reopen_reason: String(row.reopen_reason ?? ""),
    previous_score_revision: row.previous_score_revision == null ? null : Number(row.previous_score_revision),
    completed_at: (row.completed_at as string | null) ?? null,
    completed_by: (row.completed_by as string | null) ?? null,
    score_revision: row.score_revision == null ? null : Number(row.score_revision),
  };
}

/** Revisions per check-in, oldest first. A read failure leaves the reviews without revision details. */
export async function loadMidyearRevisions(supabase: SupabaseClient, checkInIds: string[]): Promise<Map<string, MidyearRevision[]>> {
  const out = new Map<string, MidyearRevision[]>();
  if (checkInIds.length === 0) return out;
  try {
    const { data, error } = await supabase
      .from("midyear_review_revisions")
      .select(REVISION_COLUMNS)
      .in("check_in_id", checkInIds)
      .order("revision_number", { ascending: true });
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const id = String(row.check_in_id);
      const list = out.get(id) ?? [];
      list.push(toRevision(row));
      out.set(id, list);
    }
  } catch (err) {
    console.warn("[midyear-revisions] revisions unavailable:", err instanceof Error ? err.message : err);
  }
  return out;
}

/**
 * First manager submission per reopened review, from the insert-only audit trail. A read failure
 * leaves the reviews without it.
 */
export async function loadOriginalManagerReviews(
  supabase: SupabaseClient,
  appraisalId: string,
  revisionsByCheckIn: Map<string, MidyearRevision[]>
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const reopened = new Set([...revisionsByCheckIn].filter(([, list]) => list.length > 0).map(([id]) => id));
  if (reopened.size === 0) return out;
  try {
    const { data, error } = await supabase
      .from("appraisal_audit")
      .select("acted_at, detail")
      .eq("appraisal_id", appraisalId)
      .eq("action_type", "midyear_manager_reviewed")
      .order("acted_at", { ascending: true });
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ acted_at: string; detail: { check_in_id?: string } | null }>) {
      const id = row.detail?.check_in_id;
      if (id && reopened.has(id) && !out.has(id)) out.set(id, row.acted_at);
    }
  } catch (err) {
    console.warn("[midyear-revisions] manager review history unavailable:", err instanceof Error ? err.message : err);
  }
  return out;
}

/** The revision being prepared on a check-in, or null. */
export async function findOpenMidyearRevision(supabase: SupabaseClient, checkInId: string): Promise<MidyearRevision | null> {
  const { data, error } = await supabase
    .from("midyear_review_revisions")
    .select(REVISION_COLUMNS)
    .eq("check_in_id", checkInId)
    .is("completed_at", null)
    .maybeSingle();
  if (error) throw new Error(`Mid-Year revision lookup failed: ${error.message}`);
  return data ? toRevision(data as Record<string, unknown>) : null;
}

/**
 * Closes the open revision once the revised review is COMPLETE. A failure is logged rather than
 * thrown: the review is already complete, and the next reopen closes a revision left open.
 */
export async function completeMidyearRevision(
  supabase: SupabaseClient,
  open: MidyearRevision,
  params: { checkInId: string; actorId: string | null; scoreRevision: number | null; completedAt: string }
): Promise<MidyearRevision> {
  const update = { completed_at: params.completedAt, completed_by: params.actorId, score_revision: params.scoreRevision };
  const { error } = await supabase
    .from("midyear_review_revisions")
    .update(update)
    .eq("check_in_id", params.checkInId)
    .eq("revision_number", open.revision_number)
    .is("completed_at", null);
  if (error) console.error("[midyear-revisions] revision not closed:", error.message);
  return { ...open, ...update };
}
