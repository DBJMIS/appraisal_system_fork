"use client";

import { useState } from "react";
import type { CheckInWithResponses, CheckInResponse } from "@/types/checkins";
import { dedupeFiscalYearPrefix, formatCheckInDate, isFormalReviewMode } from "@/lib/midyear-config";
import { MidyearCompetencyList, type RatingScale } from "./MidyearAssessmentFields";
import { MidyearReviewTimes, MidyearWorkplanTable } from "./MidyearReviewWorkspace";
import { midyearReviewTimeline } from "@/lib/midyear-display";
import { WorkplanStatusInline, WorkplanStatusSummary, workplanAssessment } from "./WorkplanStatusSummary";
import { midyearStatusLabel } from "./MidyearReviewBanner";

const STATUS_STYLES: Record<string, { bg: string; border: string; text: string; dot: string; label: string }> = {
  ON_TRACK: { bg: "#ecfdf5", border: "#bbf0d9", text: "#2e7d4f", dot: "#34d399", label: "On track" },
  AT_RISK: { bg: "#fffbeb", border: "#fbe3a1", text: "#8a5a00", dot: "#fbbf24", label: "At risk" },
  BEHIND: { bg: "#fef2f2", border: "#fbd5d5", text: "#b42318", dot: "#f87171", label: "Behind" },
  COMPLETE: { bg: "#ecfdf5", border: "#bbf0d9", text: "#2e7d4f", dot: "#34d399", label: "Complete" },
};

const formatDate = (s: string | null) => formatCheckInDate(s) ?? "—";

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    MIDYEAR: "bg-ds-surface border-ds-border-strong text-ds-accent",
    QUARTERLY: "bg-ds-surface border-ds-border-strong text-ds-info",
    ADHOC: "bg-ds-info-subtle border-ds-info-border text-ds-info",
  };
  const labels: Record<string, string> = {
    MIDYEAR: "Mid-year",
    QUARTERLY: "Quarterly",
    ADHOC: "Ad hoc",
  };
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-ds-badge text-[9px] font-semibold uppercase tracking-[.04em] border flex-shrink-0 ${styles[type] ?? styles.ADHOC}`}
    >
      {labels[type] ?? type}
    </span>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const style = STATUS_STYLES[status] ?? { bg: "#f3f3f3", border: "#e7e7e7", text: "#646f79", label: status };
  return (
    <span
      className="inline-flex px-2 py-0.5 rounded-ds-badge text-[9px] font-semibold"
      style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.text }}
    >
      {style.label}
    </span>
  );
}

function deriveOverallOutcome(responses: CheckInResponse[]): { label: string; color: string } {
  const statuses = responses.map((r) => r.mgr_status_override ?? r.employee_status);
  if (statuses.includes("BEHIND")) return { label: "Behind", color: "#b42318" };
  if (statuses.includes("AT_RISK")) return { label: "At risk", color: "#8a5a00" };
  if (statuses.every((s) => s === "COMPLETE")) return { label: "Complete", color: "#2e7d4f" };
  return { label: "On track", color: "#2e7d4f" };
}

interface HistoryCheckInCardProps {
  checkIn: CheckInWithResponses;
  ratingScale?: RatingScale;
}

export function HistoryCheckInCard({ checkIn, ratingScale }: HistoryCheckInCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState(false);
  const responses = checkIn.responses ?? [];
  const isFormal = isFormalReviewMode(checkIn.review_mode);
  const competencyRatings = checkIn.competency_ratings ?? [];
  const isCancelled = checkIn.status === "CANCELLED";
  const completedRevisions = (checkIn.midyear_revisions ?? []).filter((r) => r.completed_at != null);
  const completedDate =
    (isFormal ? midyearReviewTimeline(checkIn)?.completedAt : null) ??
    checkIn.manager_reviewed_at ??
    checkIn.employee_submitted_at ??
    checkIn.updated_at;
  const { label: overallOutcomeLabel, color: overallOutcomeColor } = deriveOverallOutcome(responses);
  const statuses = responses.map((r) => r.mgr_status_override ?? r.employee_status);

  const cardContent = isCancelled ? (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="w-9 h-9 rounded-ds-panel flex items-center justify-center flex-shrink-0 bg-ds-surface border border-ds-border">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#646f79" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-ds-text-secondary truncate">{dedupeFiscalYearPrefix(checkIn.title)}</p>
        <p className="text-[10px] text-ds-text-secondary mt-0.5">{formatDate(checkIn.created_at)}</p>
      </div>
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-ds-badge bg-ds-surface border border-ds-border text-[10px] font-semibold text-ds-text-secondary flex-shrink-0">
        Cancelled
      </span>
    </div>
  ) : (
    <div
      className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-ds-surface transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div
        className={`w-9 h-9 rounded-ds-panel flex items-center justify-center flex-shrink-0 ${
          checkIn.status === "COMPLETE" ? "bg-ds-success-subtle border border-ds-success-border" : "bg-ds-surface border border-ds-border"
        }`}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke={checkIn.status === "COMPLETE" ? "#2e7d4f" : "#646f79"}
          strokeWidth="2"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-[13px] font-semibold text-ds-text-primary truncate">{dedupeFiscalYearPrefix(checkIn.title)}</p>
          <TypeBadge type={checkIn.check_in_type} />
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-ds-text-secondary">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          {formatDate(checkIn.created_at)}
          <span className="text-ds-border">·</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          Completed {formatDate(completedDate)}
        </div>
      </div>
      <WorkplanStatusInline statuses={statuses} className="mr-2 max-w-[45%]" />
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-ds-badge bg-ds-success-subtle border border-ds-success-border text-[10px] font-semibold text-ds-success flex-shrink-0">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#2e7d4f" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Complete
      </span>
      <svg
        className={`flex-shrink-0 text-ds-text-secondary transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </div>
  );

  return (
    <div
      className="rounded-ds-panel bg-white overflow-hidden transition-colors"
      style={{
        border: `0.5px solid ${hover ? "#0d0e10" : "#e7e7e7"}`,
        borderRadius: 8,
        boxShadow: "none",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {cardContent}

      {expanded && !isCancelled && isFormal && (
        <div data-midyear-history className="border-t border-ds-border">
          <div className="space-y-4 px-5 py-4">
            <p data-midyear-history-meta className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-ds-text-secondary">
              <span>{checkIn.review_mode === "FORMAL_SCORED" ? "Formal · Scored" : "Formal"}</span>
              <span aria-hidden className="text-ds-border-strong">
                ·
              </span>
              <span>
                Status: <span className="font-semibold text-ds-text-primary">{midyearStatusLabel(checkIn)}</span>
              </span>
              {completedRevisions.length > 0 && (
                <>
                  <span aria-hidden className="text-ds-border-strong">
                    ·
                  </span>
                  <span data-midyear-history-revision>
                    Revised (revision {completedRevisions[completedRevisions.length - 1].revision_number})
                  </span>
                </>
              )}
            </p>
            {completedRevisions.length > 0 && (
              <section data-midyear-history-revisions className="space-y-1">
                <h4 className="text-[13px] font-semibold text-ds-text-primary">Revision history</h4>
                <ul className="m-0 list-none space-y-1 p-0">
                  {completedRevisions.map((r) => (
                    <li key={r.revision_number} data-midyear-history-revision-entry={r.revision_number} className="text-[12px] leading-[18px] text-ds-text-secondary">
                      <span className="font-medium text-ds-text-primary">Revision {r.revision_number}</span>
                      {` · reopened by ${r.reopened_by_name ?? "HR"}`}
                      {formatCheckInDate(r.reopened_at) ? ` on ${formatCheckInDate(r.reopened_at)}` : ""}
                      {formatCheckInDate(r.completed_at) ? ` · completed ${formatCheckInDate(r.completed_at)}` : ""}
                      <span className="block whitespace-pre-wrap break-words">Reason: {r.reopen_reason}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="space-y-2">
              <h4 className="text-[13px] font-semibold text-ds-text-primary">Workplan Progress</h4>
              <WorkplanStatusSummary statuses={statuses} assessment={workplanAssessment(responses, "manager")} />
              <MidyearWorkplanTable responses={responses} mode="readonly" showEmployee showManager />
            </section>
            {competencyRatings.length > 0 && (
              <section className="space-y-2">
                <h4 className="text-[13px] font-semibold text-ds-text-primary">Competencies</h4>
                <MidyearCompetencyList ratings={competencyRatings} editable={null} ratingScale={ratingScale} />
              </section>
            )}
            {checkIn.manager_overall_notes && (
              <section className="space-y-2">
                <h4 className="text-[13px] font-semibold text-ds-text-primary">Manager overall notes</h4>
                <p className="whitespace-pre-wrap rounded-[8px] border border-ds-border px-3 py-2 text-[12px] leading-[18px] text-ds-text-primary">
                  {checkIn.manager_overall_notes}
                </p>
              </section>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 border-t border-ds-border">
            <MidyearReviewTimes checkIn={checkIn} />
            <span className="text-[11px] text-ds-text-secondary">
              Overall outcome: <strong style={{ color: overallOutcomeColor }}>{overallOutcomeLabel}</strong>
            </span>
          </div>
        </div>
      )}

      {expanded && !isCancelled && !isFormal && (
        <div className="border-t border-ds-border">
          {responses.map((response, i) => (
            <div
              key={response.id}
              className={`px-5 py-4 ${i > 0 ? "border-t border-ds-border" : ""}`}
            >
              <p className="text-[12px] font-semibold text-ds-text-primary mb-0.5">
                {response.workplan_item?.major_task ?? "Objective"}
              </p>
              <p className="text-[10px] text-ds-text-secondary mb-3">
                {response.workplan_item?.key_output ?? "—"}
                {response.workplan_item?.metric_target != null &&
                  ` · Target: ${response.workplan_item.metric_target}`}
                · Weight: {response.workplan_item?.weight ?? 0}%
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary mb-2">Employee</p>
                  <div className="bg-ds-surface border border-ds-border rounded-[8px] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <StatusBadge status={response.employee_status} />
                      {response.progress_pct != null && (
                        <span className="text-[9px] font-semibold px-2 py-0.5 rounded-ds-badge bg-ds-surface border border-ds-border-strong text-ds-info">
                          {response.progress_pct}%
                        </span>
                      )}
                    </div>
                    {response.employee_comment && (
                      <p className="text-[11px] text-ds-text-primary leading-relaxed">{response.employee_comment}</p>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[.07em] text-ds-accent mb-2">
                    Manager response
                  </p>
                  <div className="bg-ds-surface border border-ds-border-strong rounded-[8px] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      {response.mgr_status_override ? (
                        <StatusBadge status={response.mgr_status_override} />
                      ) : (
                        <span className="text-[9px] font-semibold px-2 py-0.5 rounded-ds-badge bg-ds-success-subtle border border-ds-success-border text-ds-success">
                          Agreed
                        </span>
                      )}
                    </div>
                    {response.mgr_comment && (
                      <p className="text-[11px] text-ds-text-primary leading-relaxed">{response.mgr_comment}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {checkIn.manager_overall_notes && (
            <div className="px-5 py-3 border-t border-ds-border bg-ds-surface">
              <p className="text-[9px] font-semibold uppercase tracking-[.07em] text-ds-accent mb-1.5">
                Manager overall notes
              </p>
              <p className="text-[12px] text-ds-text-primary leading-relaxed">{checkIn.manager_overall_notes}</p>
            </div>
          )}
          <div className="flex items-center justify-between px-5 py-3 border-t border-ds-border bg-ds-surface">
            <span className="text-[11px] text-ds-text-secondary">
              Reviewed by manager · {formatDate(checkIn.manager_reviewed_at)}
            </span>
            <span className="text-[11px] text-ds-text-secondary">
              Overall outcome: <strong style={{ color: overallOutcomeColor }}>{overallOutcomeLabel}</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
