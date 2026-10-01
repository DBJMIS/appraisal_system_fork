"use client";

import { useState } from "react";
import type { CheckInWithResponses, CheckInResponse, ObjectiveStatus } from "@/types/checkins";
import { StatusPills } from "./StatusPills";
import { ProgressSlider } from "./ProgressSlider";
import { TrafficLightDots } from "./TrafficLightDots";
import { dedupeFiscalYearPrefix, formatCheckInDate } from "@/lib/midyear-config";

interface CheckInCardProps {
  appraisalId: string;
  checkIn: CheckInWithResponses;
  role: "EMPLOYEE" | "MANAGER" | "HR";
  onUpdate: () => void;
  /** When true, render content only (no outer card) for use inside the page's active card wrapper */
  embedded?: boolean;
}

const STATUS_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  ON_TRACK: { bg: "#ecfdf5", border: "#bbf0d9", text: "#2e7d4f", label: "On track" },
  AT_RISK: { bg: "#fffbeb", border: "#fbe3a1", text: "#8a5a00", label: "At risk" },
  BEHIND: { bg: "#fef2f2", border: "#fbd5d5", text: "#b42318", label: "Behind" },
  COMPLETE: { bg: "#ecfdf5", border: "#bbf0d9", text: "#2e7d4f", label: "Complete" },
};

const formatDate = (s: string | null) => formatCheckInDate(s) ?? "—";

export function CheckInCard({ appraisalId, checkIn, role, onUpdate, embedded = false }: CheckInCardProps) {
  const cardStyle = { borderColor: "#e7e7e7", boxShadow: "none" };
  const wrap = (children: React.ReactNode) =>
    embedded ? (
      <div className="p-5">{children}</div>
    ) : (
      <div className="rounded-ds-panel border p-5" style={cardStyle}>{children}</div>
    );
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localResponses, setLocalResponses] = useState<Record<string, { employee_status?: ObjectiveStatus | null; progress_pct?: number | null; employee_comment?: string | null; mgr_status_override?: ObjectiveStatus | null; mgr_comment?: string | null }>>({});
  const [managerOverallNotes, setManagerOverallNotes] = useState(checkIn.manager_overall_notes ?? "");

  const responses = checkIn.responses ?? [];
  const status = checkIn.status as string;

  const patch = async (body: Record<string, unknown>) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/checkins/${checkIn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed");
      onUpdate();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const getResponse = (r: CheckInResponse) => {
    const local = localResponses[r.workplan_item_id];
    return {
      employee_status: local?.employee_status ?? r.employee_status,
      progress_pct: local?.progress_pct ?? r.progress_pct ?? 0,
      employee_comment: local?.employee_comment ?? r.employee_comment,
      mgr_status_override: local?.mgr_status_override ?? r.mgr_status_override,
      mgr_comment: local?.mgr_comment ?? r.mgr_comment,
    };
  };

  const buildResponsesPayload = () =>
    responses.map((r) => ({
      workplan_item_id: r.workplan_item_id,
      ...getResponse(r),
    }));

  // ── CANCELLED ─────────────────────────────────────────────────────────
  if (status === "CANCELLED") {
    return (
      <div
        className="bg-white border border-ds-border rounded-ds-panel overflow-hidden mb-2 p-4 opacity-80"
        style={{ boxShadow: "none" }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-ds-text-primary font-sans">{dedupeFiscalYearPrefix(checkIn.title)}</span>
          <span className="px-2.5 py-1 rounded-ds-badge border text-[10px] font-semibold bg-ds-surface border-ds-border text-ds-text-secondary">
            Cancelled
          </span>
        </div>
        <p className="text-[10px] text-ds-text-secondary mt-1">{formatDate(checkIn.created_at)}</p>
      </div>
    );
  }

  // ── MANAGER_REVIEWED or COMPLETE (collapsed history) ───────────────────
  if (status === "MANAGER_REVIEWED" || status === "COMPLETE") {
    return (
      <div
        className="bg-white border border-ds-border rounded-ds-panel overflow-hidden mb-2"
        style={{ boxShadow: "none" }}
      >
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-ds-surface transition-colors text-left"
        >
          <div className="w-7 h-7 rounded-[8px] bg-ds-success-subtle border border-ds-success-border flex items-center justify-center flex-shrink-0">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2e7d4f" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-ds-text-primary truncate font-sans">{dedupeFiscalYearPrefix(checkIn.title)}</p>
            <p className="text-[10px] text-ds-text-secondary mt-0.5">
              {formatDate(checkIn.created_at)}
              {checkIn.manager_reviewed_at && ` · Completed ${formatDate(checkIn.manager_reviewed_at)}`}
            </p>
          </div>
          <TrafficLightDots responses={responses} />
          <span className="px-2.5 py-1 rounded-ds-badge border text-[10px] font-semibold bg-ds-success-subtle border-ds-success-border text-ds-success flex-shrink-0">
            Complete
          </span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#646f79"
            strokeWidth="2"
            className={`flex-shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        {expanded && (
          <div className="border-t border-ds-border px-4 pb-4 pt-2 space-y-4">
            {responses.map((r) => (
              <div key={r.id} className="space-y-2">
                <p className="text-[11px] font-semibold text-ds-text-secondary uppercase tracking-wider">
                  {r.workplan_item?.major_task || "Objective"}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-[8px] border border-ds-border p-3 bg-white">
                    <p className="text-[10px] font-semibold text-ds-text-secondary mb-1">Employee</p>
                    <p className="text-[12px] text-ds-text-primary">
                      {r.employee_status && (
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold mr-2"
                          style={{
                            background: STATUS_STYLES[r.employee_status]?.bg,
                            border: `1px solid ${STATUS_STYLES[r.employee_status]?.border ?? "#e7e7e7"}`,
                            color: STATUS_STYLES[r.employee_status]?.text,
                          }}
                        >
                          {STATUS_STYLES[r.employee_status]?.label ?? r.employee_status}
                        </span>
                      )}
                      {r.progress_pct != null && <span>{r.progress_pct}%</span>}
                      {r.employee_comment && <p className="mt-1 text-ds-text-secondary">{r.employee_comment}</p>}
                    </p>
                  </div>
                  <div className="rounded-[8px] border p-3" style={{ background: "#f3f3f3", borderColor: "#d0d4d8" }}>
                    <p className="text-[10px] font-semibold text-ds-accent-hover mb-1">Manager</p>
                    <p className="text-[12px] text-ds-text-primary">
                      {r.mgr_status_override && (
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold mr-2"
                          style={{
                            background: STATUS_STYLES[r.mgr_status_override]?.bg,
                            border: `1px solid ${STATUS_STYLES[r.mgr_status_override]?.border ?? "#e7e7e7"}`,
                            color: STATUS_STYLES[r.mgr_status_override]?.text,
                          }}
                        >
                          {STATUS_STYLES[r.mgr_status_override]?.label ?? r.mgr_status_override}
                        </span>
                      )}
                      {r.mgr_comment && <p className="mt-1 text-ds-text-secondary">{r.mgr_comment}</p>}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {checkIn.manager_overall_notes && (
              <div className="rounded-[8px] border p-3" style={{ background: "#f3f3f3", borderColor: "#d0d4d8" }}>
                <p className="text-[10px] font-semibold text-ds-accent-hover mb-1">Overall notes</p>
                <p className="text-[12px] text-ds-text-primary">{checkIn.manager_overall_notes}</p>
              </div>
            )}
            <p className="text-[10px] text-ds-text-secondary">
              Signed off on {formatDate(checkIn.manager_reviewed_at)}
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── OPEN, role=EMPLOYEE ──────────────────────────────────────────────────
  if (status === "OPEN" && role === "EMPLOYEE") {
    return wrap(
      <>
        <div className="rounded-ds-panel border mb-4 px-3 py-2" style={{ background: "#fffbeb", borderColor: "#fbe3a1" }}>
          <p className="text-[12px] font-semibold text-ds-warning">Action required</p>
        </div>
        <div className="space-y-4">
          {responses.map((r) => {
            const val = getResponse(r);
            return (
              <div key={r.id} className="rounded-ds-panel border border-ds-border p-3 space-y-2">
                <p className="text-[12px] font-semibold text-ds-text-primary" style={{ fontFamily: "var(--ds-font-sans)" }}>
                  {r.workplan_item?.major_task || "Objective"}
                </p>
                <StatusPills
                  value={val.employee_status ?? null}
                  onChange={(s) =>
                    setLocalResponses((prev) => ({
                      ...prev,
                      [r.workplan_item_id]: { ...prev[r.workplan_item_id], employee_status: s },
                    }))
                  }
                />
                <div className="relative">
                  <ProgressSlider
                    value={val.progress_pct ?? 0}
                    onChange={(n) =>
                      setLocalResponses((prev) => ({
                        ...prev,
                        [r.workplan_item_id]: { ...prev[r.workplan_item_id], progress_pct: n },
                      }))
                    }
                  />
                </div>
                <textarea
                  placeholder="Describe your progress..."
                  value={val.employee_comment ?? ""}
                  onChange={(e) =>
                    setLocalResponses((prev) => ({
                      ...prev,
                      [r.workplan_item_id]: { ...prev[r.workplan_item_id], employee_comment: e.target.value },
                    }))
                  }
                  rows={2}
                  className="w-full px-3 py-2 rounded-[8px] border border-ds-border text-[12px] resize-y"
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-2 mt-4 pt-4 border-t border-ds-border">
          <button
            type="button"
            disabled={loading}
            onClick={() => patch({ action: "EMPLOYEE_SAVE_DRAFT", responses: buildResponsesPayload() })}
            className="px-4 py-2 rounded-[8px] border border-ds-border text-[12px] font-semibold text-ds-text-secondary hover:bg-ds-surface disabled:opacity-60"
          >
            {loading ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => patch({ action: "EMPLOYEE_SUBMIT", responses: buildResponsesPayload() })}
            className="px-4 py-2 rounded-[8px] text-[12px] font-semibold text-white bg-ds-accent hover:opacity-90 disabled:opacity-60"
          >
            {loading ? "Submitting…" : "Submit to manager →"}
          </button>
        </div>
      </>
    );
  }

  // ── OPEN, role=MANAGER/HR ──────────────────────────────────────────────
  if (status === "OPEN" && (role === "MANAGER" || role === "HR")) {
    return wrap(
      <>
        <div className="rounded-ds-panel border mb-4 px-3 py-2" style={{ background: "#f3f3f3", borderColor: "#e7e7e7" }}>
          <p className="text-[12px] font-semibold text-ds-text-secondary">Awaiting employee input</p>
        </div>
        <div className="space-y-3">
          {responses.map((r) => (
            <div key={r.id} className="rounded-[8px] border border-ds-border p-3 flex items-center justify-between">
              <p className="text-[12px] text-ds-text-secondary">{r.workplan_item?.major_task || "Objective"}</p>
              <span className="text-[11px] text-ds-text-secondary">—</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-4 pt-4 border-t border-ds-border">
          <button
            type="button"
            disabled
            title="Available after employee submits"
            className="px-4 py-2 rounded-[8px] border border-ds-border text-[12px] font-semibold text-ds-text-secondary bg-ds-surface cursor-not-allowed"
          >
            Add manager response
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => patch({ action: "CANCEL" })}
            className="px-4 py-2 rounded-[8px] border border-ds-error-border text-[12px] font-semibold text-ds-error hover:bg-ds-error-subtle disabled:opacity-60"
          >
            {loading ? "Cancelling…" : "Cancel check-in"}
          </button>
        </div>
      </>
    );
  }

  // ── EMPLOYEE_SUBMITTED, role=EMPLOYEE ────────────────────────────────────
  if (status === "EMPLOYEE_SUBMITTED" && role === "EMPLOYEE") {
    return wrap(
      <>
        <div className="rounded-ds-panel border mb-4 px-3 py-2" style={{ background: "#f3f3f3", borderColor: "#d0d4d8" }}>
          <p className="text-[12px] font-semibold text-ds-info">Submitted — awaiting manager review</p>
        </div>
        <div className="space-y-3">
          {responses.map((r) => {
            const val = getResponse(r);
            return (
              <div key={r.id} className="rounded-[8px] border border-ds-border p-3">
                <p className="text-[12px] font-semibold text-ds-text-primary">{r.workplan_item?.major_task || "Objective"}</p>
                <p className="text-[11px] text-ds-text-secondary mt-1">
                  {val.employee_status && STATUS_STYLES[val.employee_status]?.label}
                  {val.progress_pct != null && ` · ${val.progress_pct}%`}
                  {val.employee_comment && ` · ${val.employee_comment}`}
                </p>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  // ── EMPLOYEE_SUBMITTED, role=MANAGER/HR ──────────────────────────────────
  if (status === "EMPLOYEE_SUBMITTED" && (role === "MANAGER" || role === "HR")) {
    return wrap(
      <>
        <div className="rounded-ds-panel border mb-4 px-3 py-2" style={{ background: "#f3f3f3", borderColor: "#d0d4d8" }}>
          <p className="text-[12px] font-semibold text-ds-accent-hover">Employee has submitted — add your response</p>
        </div>
        <div className="space-y-4">
          {responses.map((r) => {
            const val = getResponse(r);
            return (
              <div key={r.id} className="rounded-ds-panel border border-ds-border p-3 space-y-2">
                <p className="text-[12px] font-semibold text-ds-text-primary">{r.workplan_item?.major_task || "Objective"}</p>
                <div className="rounded-[8px] border border-ds-border p-2 bg-ds-surface text-[11px] text-ds-text-secondary">
                  Employee: {val.employee_status && STATUS_STYLES[val.employee_status]?.label}
                  {val.progress_pct != null && ` · ${val.progress_pct}%`}
                  {val.employee_comment && ` — ${val.employee_comment}`}
                </div>
                <StatusPills
                  value={val.mgr_status_override ?? null}
                  onChange={(s) =>
                    setLocalResponses((prev) => ({
                      ...prev,
                      [r.workplan_item_id]: { ...prev[r.workplan_item_id], mgr_status_override: s },
                    }))
                  }
                />
                <textarea
                  placeholder="Manager comment..."
                  value={val.mgr_comment ?? ""}
                  onChange={(e) =>
                    setLocalResponses((prev) => ({
                      ...prev,
                      [r.workplan_item_id]: { ...prev[r.workplan_item_id], mgr_comment: e.target.value },
                    }))
                  }
                  rows={2}
                  className="w-full px-3 py-2 rounded-[8px] border border-ds-border text-[12px] resize-y"
                />
              </div>
            );
          })}
        </div>
        <div className="mt-4">
          <label className="block text-[11px] font-semibold text-ds-text-secondary mb-2">Overall notes</label>
          <textarea
            value={managerOverallNotes}
            onChange={(e) => setManagerOverallNotes(e.target.value)}
            placeholder="Optional overall feedback..."
            rows={2}
            className="w-full px-3 py-2 rounded-[8px] border border-ds-border text-[12px] resize-y"
          />
        </div>
        <div className="flex gap-2 mt-4 pt-4 border-t border-ds-border">
          <button
            type="button"
            disabled={loading}
            onClick={() =>
              patch({
                action: "MANAGER_RESPOND",
                responses: buildResponsesPayload(),
                manager_overall_notes: managerOverallNotes || null,
              })
            }
            className="px-4 py-2 rounded-[8px] border border-ds-border text-[12px] font-semibold text-ds-text-secondary hover:bg-ds-surface disabled:opacity-60"
          >
            {loading ? "Saving…" : "Save draft"}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={async () => {
              await patch({
                action: "MANAGER_RESPOND",
                responses: buildResponsesPayload(),
                manager_overall_notes: managerOverallNotes || null,
              });
              await patch({ action: "MANAGER_COMPLETE" });
            }}
            className="px-4 py-2 rounded-[8px] text-[12px] font-semibold text-white bg-ds-accent hover:opacity-90 disabled:opacity-60"
          >
            {loading ? "Completing…" : "Complete check-in ✓"}
          </button>
        </div>
      </>
    );
  }

  return null;
}
