"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { CheckIn, CheckInType } from "@/types/checkins";
import type { WorkplanItemForCheckIn } from "@/types/checkins";
import { dedupeFiscalYearPrefix, formalMidyearCreateBody, formatCycleLabel, midyearReviewTitle, type MidyearConfig } from "@/lib/midyear-config";

interface NewCheckInModalProps {
  appraisalId: string;
  employeeName: string;
  cycleLabel: string;
  workplanItems: WorkplanItemForCheckIn[];
  onCreated: (checkIn: CheckIn) => void;
  onClose: () => void;
  /** Cycle Mid-Year settings; when enabled, Mid-Year is offered as the formal Mid-Year Review. */
  midyear?: MidyearConfig;
  fiscalYear?: string | null;
  /** A formal Mid-Year Review already exists for this appraisal, so it is not offered again. */
  formalMidyearExists?: boolean;
}

function defaultTitle(type: CheckInType, cycleLabel: string): string {
  if (type === "MIDYEAR") return `Mid-year check-in ${cycleLabel}`;
  if (type === "QUARTERLY") {
    const now = new Date();
    const q = Math.floor(now.getMonth() / 3) + 1;
    return `Q${q} check-in ${cycleLabel}`;
  }
  return "";
}

export function NewCheckInModal({
  appraisalId,
  employeeName,
  cycleLabel: rawCycleLabel,
  workplanItems,
  onCreated,
  onClose,
  midyear,
  fiscalYear = null,
  formalMidyearExists = false,
}: NewCheckInModalProps) {
  const cycleLabel = formatCycleLabel(rawCycleLabel);
  const formalEnabled = midyear?.enabled === true;
  const typeOptions: CheckInType[] =
    formalEnabled && formalMidyearExists ? ["QUARTERLY", "ADHOC"] : ["MIDYEAR", "QUARTERLY", "ADHOC"];
  const initialType = typeOptions[0];
  const [checkInType, setCheckInType] = useState<CheckInType>(initialType);
  const [title, setTitle] = useState(() => defaultTitle(initialType, cycleLabel));
  const [dueDate, setDueDate] = useState("");
  const [noteToEmployee, setNoteToEmployee] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFormal = formalEnabled && checkInType === "MIDYEAR";
  const formalDueDate = isFormal ? midyear?.dueDate ?? null : null;

  const handleTypeChange = (type: CheckInType) => {
    setCheckInType(type);
    setTitle(defaultTitle(type, cycleLabel));
  };

  const handleSubmit = async () => {
    if (!isFormal && !title.trim()) {
      setError("Title is required");
      return;
    }
    if (workplanItems.length === 0) {
      setError("No approved workplan found — check-in cannot be created");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/checkins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isFormal
            ? formalMidyearCreateBody(midyear, {
                due_date: dueDate.trim() || null,
                note_to_employee: noteToEmployee.trim() || null,
              })
            : {
                title: title.trim(),
                check_in_type: checkInType,
                due_date: dueDate.trim() || null,
                note_to_employee: noteToEmployee.trim() || null,
              }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to create check-in");
      onCreated(data.checkIn);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create check-in");
    } finally {
      setSubmitting(false);
    }
  };

  const overlay = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-ds-panel border border-ds-border w-[540px] overflow-hidden"
        style={{ boxShadow: "var(--ds-shadow-dialog)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-ds-border bg-ds-surface">
          <div className="w-8 h-8 rounded-ds-panel bg-ds-surface border border-ds-border-strong flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0d0e10" strokeWidth="2">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-ds-text-primary font-sans">New check-in</p>
            <p className="text-[11px] text-ds-text-secondary">
              {employeeName} · {cycleLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ds-text-secondary hover:text-ds-text-primary text-[18px] leading-none p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5 space-y-4" style={{ fontFamily: "var(--ds-font-sans)" }}>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary mb-1.5">
              Check-in type
            </label>
            <div className="flex gap-2 flex-wrap">
              {typeOptions.map((t) => (
                <button
                  key={t}
                  type="button"
                  data-checkin-type={t}
                  onClick={() => handleTypeChange(t)}
                  className="px-3 py-2 rounded-[8px] border text-[12px] font-semibold transition-colors"
                  style={{
                    background: checkInType === t ? "#0d0d0d" : "#f3f3f3",
                    borderColor: checkInType === t ? "#0d0d0d" : "#e7e7e7",
                    color: checkInType === t ? "white" : "#646f79",
                  }}
                >
                  {t === "MIDYEAR" ? (formalEnabled ? "Mid-Year Review" : "Mid-year") : t === "QUARTERLY" ? "Quarterly" : "Ad hoc"}
                </button>
              ))}
            </div>
            {isFormal && (
              <p data-formal-midyear-note className="mt-1.5 text-[11px] text-ds-text-secondary">
                Formal Mid-Year Review{midyear?.scoringEnabled ? " · scored" : ""}. Title and due date are set by the appraisal cycle.
              </p>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary mb-1.5">
              Title
            </label>
            {isFormal ? (
              <p data-formal-midyear-title className="px-3 py-2.5 rounded-[8px] border border-ds-border bg-ds-surface text-[12px] text-ds-text-primary">
                {dedupeFiscalYearPrefix(midyearReviewTitle(fiscalYear))}
              </p>
            ) : (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Mid-year check-in 2025/2026"
                className="w-full px-3 py-2.5 rounded-[8px] border border-ds-border text-[12px] text-ds-text-primary focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10 outline-none"
              />
            )}
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary mb-1.5">
              Due date
            </label>
            {formalDueDate ? (
              <p data-formal-midyear-due className="px-3 py-2.5 rounded-[8px] border border-ds-border bg-ds-surface text-[12px] text-ds-text-primary">
                {formalDueDate}
              </p>
            ) : (
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-[8px] border border-ds-border text-[12px] text-ds-text-primary focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10 outline-none"
              />
            )}
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary mb-1.5">
              Note to employee
            </label>
            <textarea
              value={noteToEmployee}
              onChange={(e) => setNoteToEmployee(e.target.value)}
              placeholder="e.g. Please focus on the Cyber Security Policy progress and flag any blockers..."
              rows={3}
              className="w-full px-3 py-2.5 rounded-[8px] border border-ds-border text-[12px] text-ds-text-primary resize-y focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10 outline-none"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary mb-1.5">
              Objectives that will be included
            </label>
            <div
              className="rounded-ds-panel border p-3 max-h-40 overflow-y-auto"
              style={{ background: "#f3f3f3", borderColor: "#d0d4d8" }}
            >
              {workplanItems.length === 0 ? (
                <p className="text-[12px] text-ds-warning">No approved workplan found — check-in cannot be created</p>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0d0e10" strokeWidth="2" className="flex-shrink-0">
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                      </svg>
                      <span className="text-[11px] font-semibold text-ds-accent-hover">Auto-populated from approved workplan</span>
                    </div>
                    <span className="text-[10px] text-ds-accent-hover font-semibold">{workplanItems.length} objective(s)</span>
                  </div>
                  <ul className="space-y-2">
                    {workplanItems.map((wi) => (
                      <li key={wi.id} className="flex items-start gap-2 text-[12px] text-ds-text-primary">
                        <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: "#2e7d4f" }} />
                        <span>{wi.major_task || wi.key_output || "Objective"}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-ds-border">
          {error && (
            <p className="text-[12px] text-ds-error mr-auto self-center" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[8px] border border-ds-border text-[12px] font-semibold text-ds-text-secondary hover:border-ds-text-primary hover:text-ds-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || workplanItems.length === 0}
            className="px-4 py-2 rounded-[8px] bg-ds-accent text-white text-[12px] font-semibold hover:bg-ds-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Creating…" : "Create & notify employee"}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined") {
    return createPortal(overlay, document.body);
  }
  return null;
}
