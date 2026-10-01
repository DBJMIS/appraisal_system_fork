"use client";

import React, { useId, useRef, useState } from "react";
import type { CheckInWithResponses, CheckInResponse, ObjectiveStatus } from "@/types/checkins";
import { dedupeFiscalYearPrefix, formatCheckInDate, isFormalReviewMode } from "@/lib/midyear-config";
import type { AssessmentOwner } from "@/lib/midyear-assessment";
import { MIDYEAR_APPRAISAL_STATUS, calcMidyearCompleteness, midyearStageBlockers } from "@/lib/midyear-lifecycle";
import { openMidyearRevision } from "@/lib/midyear-display";
import {
  competencyPayload,
  midyearWorkplanResult,
  type CompetencyDraft,
  type RatingScale,
} from "./MidyearAssessmentFields";
import {
  MIDYEAR_BUTTON,
  MidyearReviewWorkspace,
  type MidyearRowDraft,
  type MidyearWorkspaceView,
} from "./MidyearReviewWorkspace";
import { CancelCheckInDialog } from "./CancelCheckInDialog";
import { Toast } from "@/components/ui/toast";
import { useDraftSaveFeedback, type DraftSaveResult, type DraftSaveState } from "@/hooks/useDraftSaveFeedback";

const MIDYEAR_DRAFT_SAVED = { title: "Draft saved", description: "Your Mid-Year Review progress has been saved." };
const DRAFT_BUTTON_LABEL: Record<DraftSaveState, string> = { idle: "Save draft", saving: "Saving…", saved: "Saved ✓" };
const SUBMIT_BLOCKED_HELP = "Complete the required items before submitting.";
const MANAGER_SUBMIT_BLOCKED_HELP = "Complete the required manager items before submitting.";

const CARD_STYLE = { borderRadius: 8, boxShadow: "none" };
const STATUS_STYLES: Record<string, { bg: string; border: string; text: string; dot: string; label: string }> = {
  ON_TRACK: { bg: "#ecfdf5", border: "#bbf0d9", text: "#2e7d4f", dot: "#34d399", label: "On track" },
  AT_RISK: { bg: "#fffbeb", border: "#fbe3a1", text: "#8a5a00", dot: "#fbbf24", label: "At risk" },
  BEHIND: { bg: "#fef2f2", border: "#fbd5d5", text: "#b42318", dot: "#f87171", label: "Behind" },
  COMPLETE: { bg: "#ecfdf5", border: "#bbf0d9", text: "#2e7d4f", dot: "#34d399", label: "Complete" },
};

const formatDate = (s: string | null) => formatCheckInDate(s) ?? "—";

function formatType(t: string): string {
  if (t === "MIDYEAR") return "Mid-year";
  if (t === "QUARTERLY") return "Quarterly";
  return "Ad hoc";
}

type WorkplanItemForProgress = {
  id: string;
  major_task?: string;
  key_output?: string;
  metric_target: number | null;
  metric_type: string | null;
  weight?: number;
};

type CheckInResponseDraft = {
  employee_status?: ObjectiveStatus | null;
  progress_pct?: number | null;
  progress_actual?: number | null;
  completion_date?: string | null;
  apply_date_to_annual?: boolean;
  boolean_complete?: boolean | null;
  employee_comment?: string | null;
  mgr_status_override?: ObjectiveStatus | null;
  mgr_comment?: string | null;
  employee_actual_raw?: number | null;
  employee_completion_date?: string | null;
  mgr_actual_raw?: number | null;
  mgr_completion_date?: string | null;
};

/** The local edit when there is one (including an explicit null), else the stored value. */
function pick<K extends keyof CheckInResponseDraft>(
  local: Partial<CheckInResponseDraft> | undefined,
  key: K,
  stored: CheckInResponseDraft[K] | undefined
): CheckInResponseDraft[K] | undefined {
  return local && key in local && local[key] !== undefined ? local[key] : stored;
}

function toProgressPct(
  draft: CheckInResponseDraft,
  item: WorkplanItemForProgress
): number | null {
  const type = (item.metric_type ?? "NUMBER").toUpperCase();
  if (type === "NUMBER" && draft.progress_actual != null && (item.metric_target ?? 0) > 0) {
    return Math.round((draft.progress_actual / (item.metric_target ?? 1)) * 100);
  }
  if (type === "PERCENTAGE") return draft.progress_pct ?? null;
  if (type === "BOOLEAN") return draft.boolean_complete === true ? 100 : draft.boolean_complete === false ? 0 : null;
  if (type === "DATE") return draft.completion_date ? 100 : null;
  return draft.progress_pct ?? null;
}

function renderProgressInput(
  item: WorkplanItemForProgress,
  draft: CheckInResponseDraft,
  onChange: (fields: Partial<CheckInResponseDraft>) => void
): React.ReactNode {
  const type = (item.metric_type ?? "NUMBER").toUpperCase();

  if (type === "NUMBER") {
    const target = item.metric_target ?? 0;
    return (
      <div>
        <p className="text-[9px] font-semibold uppercase tracking-[.08em] text-ds-text-secondary mb-2">
          Actual value
          <span className="ml-2 normal-case tracking-normal font-normal text-ds-text-secondary">
            Target: {target}
          </span>
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            value={draft.progress_actual ?? ""}
            onChange={(e) =>
              onChange({
                progress_actual: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
            placeholder="0"
            className="w-[90px] border border-ds-border rounded-[8px] px-3 py-2 text-[13px] font-semibold text-ds-text-primary text-center focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10 outline-none bg-white"
          />
          <span className="text-[12px] text-ds-text-secondary">of {target}</span>
          {draft.progress_actual != null && target > 0 && (
            <span className="inline-flex items-center px-3 py-1 rounded-ds-badge bg-ds-surface border border-ds-border-strong text-[11px] font-semibold text-ds-accent">
              {Math.min(100, Math.round((Number(draft.progress_actual) / target) * 100))}% complete
            </span>
          )}
        </div>
      </div>
    );
  }

  if (type === "PERCENTAGE") {
    const progress = draft.progress_pct ?? 0;
    return (
      <div style={{ marginBottom: 12 }}>
        <p className="text-[9px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary mb-2">
          Progress — <span className="text-ds-accent">{progress}%</span>
        </p>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={progress}
            onChange={(e) => onChange({ progress_pct: Number(e.target.value) })}
            className="w-[180px] flex-shrink-0 h-2 rounded-full appearance-none bg-ds-border [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ds-accent"
            style={{ accentColor: "#0d0e10" }}
          />
          <div className="w-[120px] h-[4px] rounded-full bg-ds-border overflow-hidden flex-shrink-0">
            <div
              className="h-full rounded-full bg-ds-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[12px] font-semibold text-ds-accent w-[36px] flex-shrink-0 tabular-nums">
            {progress}%
          </span>
        </div>
      </div>
    );
  }

  if (type === "DATE") {
    return (
      <div style={{ marginBottom: 12 }}>
        <p className="text-[9px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary mb-2">
          Completion date
          {item.metric_target != null && (
            <span className="ml-2 font-normal normal-case tracking-normal text-ds-text-secondary">
              Target: {item.metric_target}
            </span>
          )}
        </p>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={draft.completion_date ?? ""}
            onChange={(e) => onChange({ completion_date: e.target.value || undefined })}
            className="border border-ds-border rounded-[8px] px-3 py-2 text-[12px] text-ds-text-primary focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10 outline-none"
          />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={draft.apply_date_to_annual ?? false}
              onChange={(e) => onChange({ apply_date_to_annual: e.target.checked })}
              className="w-3.5 h-3.5 accent-ds-accent"
            />
            <span className="text-[11px] text-ds-text-secondary">Apply to annual appraisal</span>
          </label>
        </div>
      </div>
    );
  }

  if (type === "BOOLEAN") {
    return (
      <div style={{ marginBottom: 12 }}>
        <p className="text-[9px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary mb-2">
          Completion
        </p>
        <div className="flex gap-2">
          {(["Done", "Not done"] as const).map((opt) => {
            const isDone = opt === "Done";
            const selected = draft.boolean_complete === isDone;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange({ boolean_complete: isDone })}
                className={`px-4 py-1.5 rounded-full text-[11px] font-semibold border transition-all ${
                  selected && isDone
                    ? "bg-ds-success-subtle border-ds-success-border text-ds-success"
                    : selected && !isDone
                      ? "bg-ds-error-subtle border-ds-error-border text-ds-error"
                      : "bg-white border-ds-border text-ds-text-secondary"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
}

interface ActiveCheckInCardProps {
  appraisalId: string;
  checkIn: CheckInWithResponses;
  appraisal: { employeeName: string; employee_id: string; manager_employee_id: string | null; status?: string };
  currentUser: { employee_id: string | null; roles: string[] };
  /** VIEWER is used for formal Mid-Year Reviews only (read-only). */
  role: "MANAGER" | "EMPLOYEE" | "HR" | "VIEWER";
  onUpdate: () => void;
  ratingScale?: RatingScale;
}

export function ActiveCheckInCard({
  appraisalId,
  checkIn,
  appraisal,
  currentUser,
  role,
  onUpdate,
  ratingScale,
}: ActiveCheckInCardProps) {
  const [localResponses, setLocalResponses] = useState<Record<string, Partial<CheckInResponseDraft>>>({});
  const [managerOverallNotes, setManagerOverallNotes] = useState(checkIn.manager_overall_notes ?? "");
  const [loading, setLoading] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [competencyDrafts, setCompetencyDrafts] = useState<Record<string, CompetencyDraft>>({});
  const submitInFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const submitHelpId = useId();

  const responses = checkIn.responses ?? [];
  const status = checkIn.status as string;
  const isFormal = isFormalReviewMode(checkIn.review_mode);
  // A formal Mid-Year Review is read-only once the appraisal leaves In progress.
  const formalLocked = isFormal && appraisal.status != null && appraisal.status !== MIDYEAR_APPRAISAL_STATUS;
  const effectiveRole = formalLocked ? "VIEWER" : role;
  // HR keeps the manager view for informal check-ins; formal manager inputs belong to the manager or delegate.
  const isManager = effectiveRole === "MANAGER" || (!isFormal && effectiveRole === "HR");
  const isEmployee = effectiveRole === "EMPLOYEE";
  const completeness = checkIn.midyear_completeness;
  const competencyRatings = checkIn.competency_ratings ?? [];
  const updateCompetency = (id: string, next: CompetencyDraft) =>
    setCompetencyDrafts((prev) => ({ ...prev, [id]: next }));
  const competencyBody = (owner: AssessmentOwner) =>
    isFormal ? { competencies: competencyPayload(competencyRatings, competencyDrafts, owner) } : {};

  const getResponse = (r: CheckInResponse): CheckInResponseDraft & { employee_comment?: string | null } => {
    const local = localResponses[r.workplan_item_id];
    // Formal manager tracking uses null for Agree, so an explicit local null must win over a stored override.
    const mgrStatus = (
      isFormal ? pick(local, "mgr_status_override", r.mgr_status_override) : local?.mgr_status_override ?? r.mgr_status_override
    ) as ObjectiveStatus | null;
    const mgrActual = pick(local, "mgr_actual_raw", r.mgr_actual_raw);
    const mgrDate = pick(local, "mgr_completion_date", r.mgr_completion_date);
    // During the manager review an Agreed objective without the manager's own value takes the
    // employee's Mid-Year value; a manager edit (including clearing the field) replaces it.
    const adoptsEmployee =
      isFormal &&
      (status === "EMPLOYEE_SUBMITTED" || status === "MANAGER_REVIEWED") &&
      mgrStatus == null &&
      mgrActual == null &&
      mgrDate == null &&
      !(local && (local.mgr_actual_raw !== undefined || local.mgr_completion_date !== undefined));
    return {
      employee_status: (local?.employee_status ?? r.employee_status) as ObjectiveStatus | null,
      progress_pct: local?.progress_pct ?? r.progress_pct ?? 0,
      progress_actual: local?.progress_actual,
      completion_date: local?.completion_date,
      apply_date_to_annual: local?.apply_date_to_annual ?? false,
      boolean_complete: local?.boolean_complete,
      employee_comment: local?.employee_comment ?? r.employee_comment,
      mgr_status_override: mgrStatus,
      mgr_comment: local?.mgr_comment ?? r.mgr_comment,
      employee_actual_raw: pick(local, "employee_actual_raw", r.employee_actual_raw),
      employee_completion_date: pick(local, "employee_completion_date", r.employee_completion_date),
      mgr_actual_raw: adoptsEmployee ? r.employee_actual_raw ?? null : mgrActual,
      mgr_completion_date: adoptsEmployee ? r.employee_completion_date ?? null : mgrDate,
    };
  };

  const send = async (body: Record<string, unknown>): Promise<DraftSaveResult> => {
    setLoading(true);
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/checkins/${checkIn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const blockers: string[] = Array.isArray(data.blockers) ? data.blockers : [];
        throw new Error([data.error || "Request failed", ...blockers.map((b) => `• ${b}`)].join("\n"));
      }
      onUpdate();
      setConfirmSubmit(false);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "Request failed" };
    } finally {
      setLoading(false);
    }
  };

  const patch = async (body: Record<string, unknown>): Promise<boolean> => {
    const result = await send(body);
    if (!result.ok) alert(result.message);
    return result.ok;
  };

  /** Final submission: one request at a time, even for clicks that land before the re-render. */
  const guardedSubmit = async (body: Record<string, unknown>) => {
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitting(true);
    try {
      await patch(body);
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };

  const draftSave = useDraftSaveFeedback(MIDYEAR_DRAFT_SAVED);
  const saveDraft = (body: Record<string, unknown>) => draftSave.run(() => send(body));

  const buildResponsesPayload = () =>
    responses.map((r) => {
      const curr = getResponse(r);
      const wp = r.workplan_item;
      const item: WorkplanItemForProgress = wp
        ? {
            id: wp.id,
            major_task: wp.major_task,
            key_output: wp.key_output,
            metric_target: wp.metric_target ?? null,
            metric_type: wp.metric_type ?? null,
            weight: wp.weight,
          }
        : { id: r.workplan_item_id, metric_target: null, metric_type: null };
      const formalResult =
        isFormal && wp
          ? midyearWorkplanResult("employee", wp, {
              actual_raw: curr.employee_actual_raw ?? null,
              completion_date: curr.employee_completion_date ?? null,
            })
          : null;
      const progress_pct = formalResult ?? toProgressPct(curr, item);
      return {
        workplan_item_id: r.workplan_item_id,
        employee_status: curr.employee_status,
        progress_pct: progress_pct != null ? Math.min(100, Math.max(0, progress_pct)) : null,
        employee_comment: curr.employee_comment ?? null,
        mgr_status_override: curr.mgr_status_override,
        mgr_comment: curr.mgr_comment ?? null,
        ...(curr.completion_date != null && { completion_date: curr.completion_date }),
        ...(curr.apply_date_to_annual && { apply_date_to_annual: true }),
        ...(isFormal && {
          employee_actual_raw: curr.employee_actual_raw ?? null,
          employee_completion_date: curr.employee_completion_date ?? null,
          mgr_actual_raw: curr.mgr_actual_raw ?? null,
          mgr_completion_date: curr.mgr_completion_date ?? null,
        }),
      };
    });

  if (isFormal) {
    const view: MidyearWorkspaceView =
      status === "OPEN" && isEmployee
        ? "EMPLOYEE_EDIT"
        : (status === "EMPLOYEE_SUBMITTED" || status === "MANAGER_REVIEWED") && isManager
          ? "MANAGER_EDIT"
          : status === "OPEN" && isManager
            ? "MANAGER_WAITING"
            : "READ_ONLY";
    const updateDraft = (workplanItemId: string, fields: MidyearRowDraft) =>
      setLocalResponses((prev) => ({ ...prev, [workplanItemId]: { ...prev[workplanItemId], ...fields } }));
    // Formal read-only view: HR / viewers / the employee, and locked reviews in any active state.
    // A review being revised is completed again, never cancelled (the API refuses it too).
    const revising = openMidyearRevision(checkIn) != null;
    const canCancel = view === "READ_ONLY" && (effectiveRole === "MANAGER" || effectiveRole === "HR") && !revising;

    let blockers: { title: string; items: string[]; ready?: string } | null = null;
    let actions: { left?: React.ReactNode; right?: React.ReactNode } | null = null;

    // The server writes the submitted values and then applies the same rule, so evaluate the owner's
    // inputs on the current form values (the other party's are the saved ones); snapshot weight blockers
    // come from the server. The API remains the authority and rejects incomplete submissions.
    const liveStageBlockers = (owner: AssessmentOwner) => {
      const field = owner === "employee" ? "employee_rating_code" : "manager_rating_code";
      const ownerRatings = new Map(
        competencyPayload(competencyRatings, competencyDrafts, owner).map((c) => [c.id, (c[field] as string | null) ?? null])
      );
      const live = calcMidyearCompleteness({
        reviewMode: checkIn.review_mode,
        responses: responses.map((r) => {
          const curr = getResponse(r);
          const result = midyearWorkplanResult(
            owner,
            r.workplan_item ?? {},
            owner === "employee"
              ? { actual_raw: curr.employee_actual_raw ?? null, completion_date: curr.employee_completion_date ?? null }
              : { actual_raw: curr.mgr_actual_raw ?? null, completion_date: curr.mgr_completion_date ?? null }
          );
          return {
            weight_snapshot: r.weight_snapshot,
            employee_result: owner === "employee" ? result : r.employee_result,
            mgr_result: owner === "manager" ? result : r.mgr_result,
          };
        }),
        competencies: competencyRatings.map((c) => ({
          section: c.section,
          weight_snapshot: c.weight_snapshot,
          employee_rating_code: owner === "employee" ? ownerRatings.get(c.id) ?? null : c.employee_rating_code,
          manager_rating_code: owner === "manager" ? ownerRatings.get(c.id) ?? null : c.manager_rating_code,
        })),
        isManagementTrack: checkIn.is_management_track,
      });
      return midyearStageBlockers(
        { ...live, weights: completeness?.weights ?? live.weights },
        owner === "employee" ? "EMPLOYEE_SUBMIT" : "MANAGER_REVIEW"
      );
    };

    if (view === "EMPLOYEE_EDIT") {
      const submitBlockers = liveStageBlockers("employee");
      const submitBlocked = submitBlockers.length > 0;
      const submitToManager = () => {
        if (submitBlocked) return;
        return guardedSubmit({ action: "EMPLOYEE_SUBMIT", responses: buildResponsesPayload(), ...competencyBody("employee") });
      };
      const submitButtonClass = submitBlocked ? `${MIDYEAR_BUTTON.disabled} gap-2` : MIDYEAR_BUTTON.primary;
      const submitHelp = submitBlocked ? (
        <span id={submitHelpId} className="sr-only">
          {SUBMIT_BLOCKED_HELP}
        </span>
      ) : null;
      blockers = {
        title: "Required before you can submit",
        items: submitBlockers,
        ready: "All required items complete",
      };
      actions = {
        left: (
          <button
            type="button"
            data-midyear-save-draft={draftSave.state}
            onClick={() => saveDraft({ action: "EMPLOYEE_SAVE_DRAFT", responses: buildResponsesPayload(), ...competencyBody("employee") })}
            disabled={loading || draftSave.state === "saving"}
            className={MIDYEAR_BUTTON.secondary}
          >
            {DRAFT_BUTTON_LABEL[draftSave.state]}
          </button>
        ),
        right: !confirmSubmit ? (
          <span title={submitBlocked ? SUBMIT_BLOCKED_HELP : undefined} className="inline-flex w-full sm:w-auto">
            <button
              type="button"
              data-midyear-submit
              onClick={() => setConfirmSubmit(true)}
              disabled={loading || submitBlocked}
              aria-describedby={submitBlocked ? submitHelpId : undefined}
              className={submitButtonClass}
            >
              Submit to manager
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
            {submitHelp}
          </span>
        ) : (
          <>
            <span className="text-center text-[11px] text-ds-text-secondary sm:text-left">Once submitted you cannot edit.</span>
            <button type="button" onClick={() => setConfirmSubmit(false)} className={MIDYEAR_BUTTON.quiet}>
              Cancel
            </button>
            <button
              type="button"
              data-midyear-confirm-submit
              onClick={submitToManager}
              disabled={loading || submitBlocked}
              aria-describedby={submitBlocked ? submitHelpId : undefined}
              title={submitBlocked ? SUBMIT_BLOCKED_HELP : undefined}
              className={submitButtonClass}
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Submitting…
                </>
              ) : (
                "Confirm submit"
              )}
            </button>
            {submitHelp}
          </>
        ),
      };
    } else if (view === "MANAGER_EDIT" && status === "MANAGER_REVIEWED") {
      // After Submit manager review the manager can keep revising; only Complete locks the review.
      const finalBlockers = liveStageBlockers("manager");
      const completeBlocked = finalBlockers.length > 0;
      const managerBody = () => ({
        responses: buildResponsesPayload(),
        manager_overall_notes: managerOverallNotes || null,
        ...competencyBody("manager"),
      });
      // Saves the values on screen first, so the score is recorded from what the manager sees.
      const completeReview = async () => {
        if (completeBlocked || submitInFlight.current) return;
        submitInFlight.current = true;
        setSubmitting(true);
        try {
          const saved = await send({ action: "MANAGER_RESPOND", saveOnly: true, ...managerBody() });
          if (!saved.ok) {
            alert(saved.message);
            return;
          }
          await patch({ action: "COMPLETE" });
        } finally {
          submitInFlight.current = false;
          setSubmitting(false);
        }
      };
      blockers = { title: "Required before the Mid-Year Review can be completed", items: finalBlockers };
      actions = {
        left: (
          <>
            {!revising && (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Cancel this Mid-Year Review? This cannot be undone.")) patch({ action: "CANCEL" });
                }}
                disabled={loading}
                className={MIDYEAR_BUTTON.danger}
              >
                Cancel review
              </button>
            )}
            <button
              type="button"
              data-midyear-save-draft={draftSave.state}
              onClick={() => saveDraft({ action: "MANAGER_RESPOND", saveOnly: true, ...managerBody() })}
              disabled={loading || draftSave.state === "saving"}
              className={MIDYEAR_BUTTON.secondary}
            >
              {DRAFT_BUTTON_LABEL[draftSave.state]}
            </button>
          </>
        ),
        right: (
          <button
            type="button"
            data-midyear-complete
            onClick={completeReview}
            disabled={loading || submitting || completeBlocked}
            className={completeBlocked ? MIDYEAR_BUTTON.disabled : MIDYEAR_BUTTON.primary}
          >
            {submitting ? "Completing…" : "Complete Mid-Year Review ✓"}
          </button>
        ),
      };
    } else if (view === "MANAGER_EDIT") {
      const reviewBlockers = liveStageBlockers("manager");
      const reviewBlocked = reviewBlockers.length > 0;
      const submitReview = () => {
        if (reviewBlocked) return;
        return guardedSubmit({
          action: "MANAGER_COMPLETE",
          responses: buildResponsesPayload(),
          manager_overall_notes: managerOverallNotes || null,
          ...competencyBody("manager"),
        });
      };
      blockers = {
        title: "Required before you can submit your review",
        items: reviewBlockers,
        ready: "All required manager items complete",
      };
      actions = {
        left: (
          <button
            type="button"
            data-midyear-save-draft={draftSave.state}
            onClick={() =>
              saveDraft({
                action: "MANAGER_RESPOND",
                saveOnly: true,
                responses: buildResponsesPayload(),
                manager_overall_notes: managerOverallNotes || null,
                ...competencyBody("manager"),
              })
            }
            disabled={loading || draftSave.state === "saving"}
            className={MIDYEAR_BUTTON.secondary}
          >
            {DRAFT_BUTTON_LABEL[draftSave.state]}
          </button>
        ),
        right: (
          <span title={reviewBlocked ? MANAGER_SUBMIT_BLOCKED_HELP : undefined} className="inline-flex w-full sm:w-auto">
            <button
              type="button"
              data-midyear-manager-submit
              onClick={submitReview}
              disabled={loading || reviewBlocked}
              aria-describedby={reviewBlocked ? submitHelpId : undefined}
              className={reviewBlocked ? `${MIDYEAR_BUTTON.disabled} gap-2` : MIDYEAR_BUTTON.primary}
            >
              {submitting ? "Submitting…" : "Submit manager review ✓"}
            </button>
            {reviewBlocked && (
              <span id={submitHelpId} className="sr-only">
                {MANAGER_SUBMIT_BLOCKED_HELP}
              </span>
            )}
          </span>
        ),
      };
    } else if (view === "MANAGER_WAITING") {
      actions = {
        left: (
          <button
            type="button"
            data-cancel-checkin
            onClick={() => setCancelDialogOpen(true)}
            disabled={loading}
            className={MIDYEAR_BUTTON.danger}
          >
            Cancel check-in
          </button>
        ),
        right: (
          <button type="button" disabled title="Available after employee submits" className={MIDYEAR_BUTTON.disabled}>
            Add manager response
          </button>
        ),
      };
    } else if (canCancel) {
      actions = {
        left: (
          <button
            type="button"
            onClick={() => {
              if (confirm("Cancel this Mid-Year Review? This cannot be undone.")) patch({ action: "CANCEL" });
            }}
            disabled={loading}
            className={MIDYEAR_BUTTON.danger}
          >
            Cancel review
          </button>
        ),
      };
    }

    return (
      <>
        <MidyearReviewWorkspace
          checkIn={checkIn}
          view={view}
          employeeName={appraisal.employeeName}
          locked={formalLocked}
          getDraft={getResponse}
          onDraftChange={updateDraft}
          competencyDrafts={competencyDrafts}
          onCompetencyChange={updateCompetency}
          ratingScale={ratingScale}
          managerOverallNotes={managerOverallNotes}
          onManagerOverallNotesChange={setManagerOverallNotes}
          blockers={blockers}
          actions={actions}
          lastSavedAt={view === "EMPLOYEE_EDIT" || view === "MANAGER_EDIT" ? draftSave.lastSavedAt : null}
        />
        <Toast
          message={draftSave.toast}
          duration={draftSave.toast?.tone === "success" ? 4000 : null}
          onDismiss={draftSave.dismissToast}
        />
        {view === "MANAGER_WAITING" && (
          <CancelCheckInDialog
            open={cancelDialogOpen}
            onOpenChange={setCancelDialogOpen}
            onConfirm={() => patch({ action: "CANCEL" })}
          />
        )}
      </>
    );
  }

  // State A: OPEN, MANAGER
  if (status === "OPEN" && isManager) {
    const borderStyle = { border: "1.5px solid #0d0e10" };
    return (
      <div className="rounded-ds-panel overflow-hidden bg-white" style={{ ...CARD_STYLE, ...borderStyle }}>
        <div className="flex items-center gap-3 px-5 py-3.5 bg-ds-surface border-b border-ds-border-strong">
          <div className="w-8 h-8 rounded-[8px] bg-ds-surface border border-ds-border-strong flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0d0e10" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-ds-accent-hover">{dedupeFiscalYearPrefix(checkIn.title)}</p>
            <p className="text-[11px] text-ds-accent mt-0.5">
              {formatType(checkIn.check_in_type)} · Due {formatDate(checkIn.due_date)} · Initiated by you
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-ds-badge border text-[10px] font-semibold bg-ds-warning-subtle border-ds-warning-border text-ds-warning">
            Awaiting employee
          </span>
        </div>
        <div className="px-5 py-4 bg-ds-warning-subtle border-b border-ds-warning-border">
          <p className="text-[12px] text-ds-warning">
            Waiting for {appraisal.employeeName} to complete their check-in. You can add your response once they submit.
          </p>
        </div>
        <div className="p-5 space-y-4">
          {responses.map((r) => {
            const wp = r.workplan_item;
            return (
              <div key={r.id} className="pb-4 border-b border-ds-border last:border-0 last:pb-0">
                <p className="text-[12px] font-semibold text-ds-text-primary">{wp?.major_task ?? "Objective"}</p>
                <p className="text-[11px] text-ds-text-secondary mt-0.5">
                  {wp?.key_output ?? "—"} · Target: {wp?.metric_target ?? "—"} · Weight: {wp?.weight ?? 0}%
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {wp?.metric_type?.toUpperCase() === "NUMBER" && wp?.metric_target != null ? (
                    <span className="inline-flex px-2 py-1 rounded text-[10px] bg-ds-surface border border-ds-border text-ds-text-secondary">
                      Actual: — / {wp.metric_target}
                    </span>
                  ) : (
                    <span className="inline-flex px-2 py-1 rounded text-[10px] bg-ds-surface border border-ds-border text-ds-text-secondary">Progress: —</span>
                  )}
                  <span className="inline-flex px-2 py-1 rounded text-[10px] bg-ds-surface border border-ds-border text-ds-text-secondary">Status: awaiting input</span>
                  <span className="inline-flex px-2 py-1 rounded text-[10px] bg-ds-surface border border-ds-border text-ds-text-secondary">Comment: —</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-t border-ds-border bg-ds-surface">
          <button
            type="button"
            data-cancel-checkin
            onClick={() => setCancelDialogOpen(true)}
            disabled={loading}
            className="px-4 py-2 rounded-[8px] border border-ds-error text-[12px] font-semibold text-ds-error hover:bg-ds-error-subtle transition-colors disabled:opacity-50"
          >
            Cancel check-in
          </button>
          <button
            type="button"
            disabled
            title="Available after employee submits"
            className="px-4 py-2 rounded-[8px] bg-ds-border text-[12px] font-semibold text-ds-text-secondary cursor-not-allowed"
          >
            Add manager response
          </button>
        </div>
        <CancelCheckInDialog
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          onConfirm={() => patch({ action: "CANCEL" })}
        />
      </div>
    );
  }

  // State B: OPEN, EMPLOYEE
  if (status === "OPEN" && isEmployee) {
    const STATUS_LABELS: Record<string, string> = {
      ON_TRACK: "On track",
      AT_RISK: "At risk",
      BEHIND: "Behind",
      COMPLETE: "Complete",
    };
    const statusPillStyles = (s: string, selected: boolean) => {
      const base = "bg-white border-ds-border text-ds-text-secondary";
      if (!selected) {
        const hover: Record<string, string> = {
          ON_TRACK: "hover:border-ds-success-border hover:text-ds-success",
          AT_RISK: "hover:border-ds-warning-border hover:text-ds-warning",
          BEHIND: "hover:border-ds-error-border hover:text-ds-error",
          COMPLETE: "hover:border-ds-success-border hover:text-ds-success",
        };
        return `${base} ${hover[s] ?? ""}`;
      }
      const sel: Record<string, string> = {
        ON_TRACK: "bg-ds-success-subtle border-ds-success-border text-ds-success",
        AT_RISK: "bg-ds-warning-subtle border-ds-warning-border text-ds-warning",
        BEHIND: "bg-ds-error-subtle border-ds-error-border text-ds-error",
        COMPLETE: "bg-ds-success-subtle border-ds-success-border text-ds-success",
      };
      return sel[s] ?? base;
    };
    return (
      <div className="bg-white rounded-ds-panel overflow-hidden mb-4 border border-ds-border border-l-4 border-l-ds-warning">
        <div className="flex items-center justify-between gap-3 px-5 py-4 bg-ds-warning-subtle border-b border-ds-warning-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-[9px] bg-white border border-ds-warning-border flex items-center justify-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a5a00" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div>
              <p className="font-sans text-[13px] font-semibold text-ds-warning">{dedupeFiscalYearPrefix(checkIn.title)}</p>
              <p className="text-[11px] text-ds-warning mt-0.5">
                {formatType(checkIn.check_in_type)} · Due {formatDate(checkIn.due_date)} · Your manager is waiting for your input
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-ds-badge bg-white border border-ds-warning-border text-[10px] font-semibold text-ds-warning whitespace-nowrap flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-ds-amber" />
            Action required
          </span>
        </div>
        {checkIn.note_to_employee && (
          <div className="flex items-start gap-3 mx-5 mt-4 px-4 py-3 bg-ds-warning-subtle border border-ds-warning-border rounded-ds-panel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a5a00" strokeWidth="2" className="flex-shrink-0 mt-0.5">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            <div>
              <p className="text-[10px] font-semibold text-ds-warning uppercase tracking-[.07em] mb-1">Note from your manager</p>
              <p className="text-[12px] text-ds-warning leading-relaxed">{checkIn.note_to_employee}</p>
            </div>
          </div>
        )}
        <div className="p-5">
          {responses.map((r, i) => {
            const wp = r.workplan_item;
            const curr = getResponse(r);
            const updateDraft = (fields: Partial<CheckInResponseDraft>) =>
              setLocalResponses((prev) => ({
                ...prev,
                [r.workplan_item_id]: { ...prev[r.workplan_item_id], ...fields },
              }));
            const itemForProgress: WorkplanItemForProgress = wp
              ? { id: wp.id, major_task: wp.major_task, key_output: wp.key_output, metric_target: wp.metric_target ?? null, metric_type: wp.metric_type ?? null, weight: wp.weight }
              : { id: r.workplan_item_id, metric_target: null, metric_type: "PERCENTAGE" };
            return (
              <div
                key={r.id}
                className={`rounded-ds-panel border border-ds-border bg-ds-surface p-4 ${i > 0 ? "mt-3" : ""}`}
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <p className="font-sans text-[13px] font-semibold text-ds-text-primary">{wp?.major_task ?? "Objective"}</p>
                    <p className="text-[11px] text-ds-text-secondary mt-0.5">
                      {wp?.key_output ?? "—"}
                      {wp?.metric_target != null && ` · Target: ${wp.metric_target}`}
                      · Weight: {wp?.weight ?? 0}%
                    </p>
                  </div>
                  {curr.employee_status && (
                    <span
                      className="inline-flex items-center px-2.5 py-1 rounded-ds-badge text-[10px] font-semibold flex-shrink-0"
                      style={{
                        background: STATUS_STYLES[curr.employee_status]?.bg ?? "#f3f3f3",
                        border: `1px solid ${STATUS_STYLES[curr.employee_status]?.border ?? "#e7e7e7"}`,
                        color: STATUS_STYLES[curr.employee_status]?.text ?? "#646f79",
                      }}
                    >
                      {STATUS_STYLES[curr.employee_status]?.label ?? curr.employee_status}
                    </span>
                  )}
                </div>
                <div className="border-t border-ds-border mb-4" />
                <div className="mb-4">
                  <p className="text-[9px] font-semibold uppercase tracking-[.08em] text-ds-text-secondary mb-2">How are you tracking?</p>
                  <div className="flex gap-2 flex-wrap">
                    {(["ON_TRACK", "AT_RISK", "BEHIND", "COMPLETE"] as const).map((s) => {
                      const selected = curr.employee_status === s;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => updateDraft({ employee_status: s })}
                          className={`px-4 py-1.5 rounded-ds-button text-[11px] font-semibold border transition-all ${statusPillStyles(s, selected)}`}
                        >
                          {STATUS_LABELS[s]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="mb-4 bg-white rounded-[8px] border border-ds-border p-3">
                  {renderProgressInput(itemForProgress, curr, updateDraft)}
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[.08em] text-ds-text-secondary mb-2">Your comment</p>
                  <textarea
                    rows={3}
                    value={curr.employee_comment ?? ""}
                    onChange={(e) => updateDraft({ employee_comment: e.target.value || null })}
                    placeholder="Describe your progress, any blockers, or context for your manager..."
                    className="w-full border border-ds-border rounded-[8px] px-3 py-2.5 text-[12px] text-ds-text-primary bg-white resize-none outline-none placeholder:text-ds-border-strong leading-relaxed focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10 transition-colors"
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-ds-border bg-ds-surface">
          <button
            type="button"
            onClick={() => patch({ action: "EMPLOYEE_SAVE_DRAFT", responses: buildResponsesPayload(), ...competencyBody("employee") })}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] border border-ds-border text-[12px] font-semibold text-ds-text-secondary bg-white hover:border-ds-text-primary hover:text-ds-text-primary disabled:opacity-50 transition-colors"
          >
            {loading ? "Saving…" : "Save draft"}
          </button>
          {!confirmSubmit ? (
            <button
              type="button"
              onClick={() => setConfirmSubmit(true)}
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-[8px] bg-ds-accent text-white text-[12px] font-semibold hover:bg-ds-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Submit to manager
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ds-text-secondary">Once submitted you cannot edit.</span>
              <button
                type="button"
                onClick={() => setConfirmSubmit(false)}
                className="px-3 py-1.5 rounded text-[11px] border border-ds-border text-ds-text-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => patch({ action: "EMPLOYEE_SUBMIT", responses: buildResponsesPayload(), ...competencyBody("employee") })}
                disabled={loading}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-[8px] bg-ds-accent text-white text-[12px] font-semibold hover:bg-ds-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Submitting…
                  </>
                ) : (
                  "Confirm submit"
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // State C: EMPLOYEE_SUBMITTED, MANAGER
  if (status === "EMPLOYEE_SUBMITTED" && isManager) {
    const borderStyle = { border: "1.5px solid #0d0e10" };
    return (
      <div className="rounded-ds-panel overflow-hidden bg-white" style={{ ...CARD_STYLE, ...borderStyle }}>
        <div className="flex items-center gap-3 px-5 py-3.5 bg-ds-surface border-b border-ds-border-strong">
          <div className="w-8 h-8 rounded-[8px] bg-ds-surface border border-ds-border-strong flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0d0e10" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-ds-accent-hover">{dedupeFiscalYearPrefix(checkIn.title)}</p>
            <p className="text-[11px] text-ds-accent mt-0.5">
              Employee submitted {checkIn.employee_submitted_at ? formatDate(checkIn.employee_submitted_at) : ""} · Add your response
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-ds-badge border text-[10px] font-semibold bg-ds-surface border-ds-border-strong text-ds-info">
            Employee submitted
          </span>
        </div>
        <div className="px-5 py-3 bg-ds-surface border-b border-ds-border-strong">
          <p className="text-[12px] text-ds-accent-hover">
            {appraisal.employeeName} has submitted their check-in — review and add your response below
          </p>
        </div>
        <div className="p-5 space-y-6">
          {responses.map((r) => {
            const wp = r.workplan_item;
            const curr = getResponse(r);
            const empStatus = r.employee_status;
            const empStyle = empStatus ? STATUS_STYLES[empStatus] : { bg: "#f3f3f3", border: "#e7e7e7", text: "#646f79", label: "—" };
            return (
              <div key={r.id} className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 border-b border-ds-border last:border-0 last:pb-0">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary mb-1.5">Employee</p>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <span
                        className="inline-flex px-2 py-1 rounded text-[10px] font-semibold"
                        style={{ background: empStyle.bg, border: `1px solid ${empStyle.border}`, color: empStyle.text }}
                      >
                        {empStyle.label}
                      </span>
                      <span className="inline-flex px-2 py-1 rounded text-[10px] font-semibold bg-ds-surface border border-ds-border-strong text-ds-info">
                        {r.progress_pct ?? 0}%
                      </span>
                    </div>
                    <div className="rounded-[8px] border border-ds-border bg-ds-surface p-3">
                      <p className="text-[11px] text-ds-text-primary whitespace-pre-wrap">{r.employee_comment || "—"}</p>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary mb-1.5">Your response</p>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setLocalResponses((prev) => ({
                            ...prev,
                            [r.workplan_item_id]: { ...prev[r.workplan_item_id], mgr_status_override: null },
                          }))
                        }
                        className="px-2.5 py-1 rounded text-[10px] font-semibold transition-colors"
                        style={{
                          background: curr.mgr_status_override == null ? "#ecfdf5" : "#f3f3f3",
                          border: `1px solid ${curr.mgr_status_override == null ? "#bbf0d9" : "#e7e7e7"}`,
                          color: curr.mgr_status_override == null ? "#2e7d4f" : "#646f79",
                        }}
                      >
                        Agree
                      </button>
                      {(["AT_RISK", "BEHIND"] as const).map((s) => {
                        const style = STATUS_STYLES[s];
                        const selected = curr.mgr_status_override === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() =>
                              setLocalResponses((prev) => ({
                                ...prev,
                                [r.workplan_item_id]: { ...prev[r.workplan_item_id], mgr_status_override: s },
                              }))
                            }
                            className="px-2.5 py-1 rounded text-[10px] font-semibold transition-colors"
                            style={{
                              background: selected ? style.bg : "#f3f3f3",
                              border: `1px solid ${selected ? style.border : "#e7e7e7"}`,
                              color: selected ? style.text : "#646f79",
                            }}
                          >
                            {style.label}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      value={curr.mgr_comment ?? ""}
                      onChange={(e) =>
                        setLocalResponses((prev) => ({
                          ...prev,
                          [r.workplan_item_id]: { ...prev[r.workplan_item_id], mgr_comment: e.target.value || null },
                        }))
                      }
                      placeholder="Add your comments or guidance..."
                      rows={2}
                      className="w-full px-3 py-2 rounded-[8px] border border-ds-border text-[12px] text-ds-text-primary focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10 outline-none resize-y"
                    />
                  </div>
                </div>
                <p className="text-[12px] font-semibold text-ds-text-primary md:col-span-2">{wp?.major_task ?? "Objective"}</p>
              </div>
            );
          })}
          <div className="pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary mb-1.5">Overall notes for employee</p>
            <textarea
              value={managerOverallNotes}
              onChange={(e) => setManagerOverallNotes(e.target.value)}
              placeholder="Summary comments visible to the employee after you complete this check-in..."
              rows={3}
              className="w-full px-3 py-2 rounded-[8px] border border-ds-border text-[12px] text-ds-text-primary focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10 outline-none resize-y"
            />
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-t border-ds-border bg-ds-surface">
          <button
            type="button"
            onClick={() =>
              patch({
                action: "MANAGER_RESPOND",
                saveOnly: true,
                responses: buildResponsesPayload(),
                manager_overall_notes: managerOverallNotes || null,
                ...competencyBody("manager"),
              })
            }
            disabled={loading}
            className="px-4 py-2 rounded-[8px] border border-ds-border text-[12px] font-semibold text-ds-text-secondary hover:border-ds-text-primary hover:text-ds-text-primary transition-colors disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={() =>
              patch({
                action: "MANAGER_COMPLETE",
                responses: buildResponsesPayload(),
                manager_overall_notes: managerOverallNotes || null,
                ...competencyBody("manager"),
              })
            }
            disabled={loading}
            className="px-4 py-2 rounded-[8px] bg-ds-accent text-white text-[12px] font-semibold hover:bg-ds-accent-hover transition-colors disabled:opacity-50 inline-flex items-center gap-2"
          >
            {loading ? "Completing…" : "Complete check-in ✓"}
          </button>
        </div>
      </div>
    );
  }

  // State D: EMPLOYEE_SUBMITTED, EMPLOYEE (read-only)
  if (status === "EMPLOYEE_SUBMITTED" && isEmployee) {
    return (
      <div className="rounded-ds-panel overflow-hidden bg-white border border-ds-border" style={CARD_STYLE}>
        <div className="flex items-center gap-3 px-5 py-3.5 bg-ds-surface border-b border-ds-border">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-ds-text-primary">{dedupeFiscalYearPrefix(checkIn.title)}</p>
            <p className="text-[11px] text-ds-text-secondary mt-0.5">
              {formatType(checkIn.check_in_type)} · Due {formatDate(checkIn.due_date)}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-ds-badge border text-[10px] font-semibold bg-ds-surface border-ds-border-strong text-ds-info">
            Submitted — awaiting manager review
          </span>
        </div>
        <div className="p-5 space-y-4">
          {responses.map((r) => {
            const wp = r.workplan_item;
            const empStatus = r.employee_status;
            const empStyle = empStatus ? STATUS_STYLES[empStatus] : { bg: "#f3f3f3", border: "#e7e7e7", text: "#646f79", label: "—" };
            return (
              <div key={r.id} className="pb-4 border-b border-ds-border last:border-0 last:pb-0">
                <p className="text-[12px] font-semibold text-ds-text-primary">{wp?.major_task ?? "Objective"}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span
                    className="inline-flex px-2 py-1 rounded text-[10px] font-semibold"
                    style={{ background: empStyle.bg, border: `1px solid ${empStyle.border}`, color: empStyle.text }}
                  >
                    {empStyle.label}
                  </span>
                  <span className="inline-flex px-2 py-1 rounded text-[10px] font-semibold bg-ds-surface border border-ds-border-strong text-ds-info">
                    {r.progress_pct ?? 0}%
                  </span>
                </div>
                <div className="mt-2 rounded-[8px] border border-ds-border bg-ds-surface p-3">
                  <p className="text-[11px] text-ds-text-primary whitespace-pre-wrap">{r.employee_comment || "—"}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
}
