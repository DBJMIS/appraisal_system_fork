"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { avatarAccent } from "@/lib/avatar-accent";

interface ParticipantForModal {
  participant_employee_id: string;
  participant_name: string;
  participant_department_name?: string;
}

interface EligibleEmployee {
  employee_id: string;
  full_name: string | null;
  department_name?: string | null;
}

interface AssignReviewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  participant: ParticipantForModal | null;
  cycleId: string;
  cycleLabel: string;
  onSuccess: () => void;
}

function getInitials(name: string, fallback?: string): string {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (name.length >= 2) return name.slice(0, 2).toUpperCase();
  return (fallback ?? "?").slice(0, 2).toUpperCase();
}

export function AssignReviewerModal({
  isOpen,
  onClose,
  participant,
  cycleId,
  cycleLabel,
  onSuccess,
}: AssignReviewerModalProps) {
  const [reviewerEmployeeId, setReviewerEmployeeId] = useState("");
  const [reviewType, setReviewType] = useState<"PEER" | "DIRECT_REPORT" | "MANAGER">("PEER");
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<EligibleEmployee[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !participant) {
      setEmployees([]);
      setReviewerEmployeeId("");
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({
      participant_employee_id: participant.participant_employee_id,
      reviewer_type: reviewType,
    });
    fetch(`/api/admin/feedback/eligible-reviewers?${params}`)
      .then((r) => r.json().catch(() => ({})))
      .then((data) => setEmployees(Array.isArray(data.employees) ? data.employees : []))
      .finally(() => setLoading(false));
  }, [isOpen, participant?.participant_employee_id, reviewType]);

  useEffect(() => {
    if (!isOpen) return;
    setReviewerEmployeeId("");
  }, [isOpen, reviewType]);

  async function handleAdd() {
    if (!reviewerEmployeeId.trim() || !participant) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/feedback/cycles/${cycleId}/reviewers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participant_employee_id: participant.participant_employee_id,
          reviewer_employee_id: reviewerEmployeeId.trim(),
          reviewer_type: reviewType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to add reviewer");
      }
      onSuccess();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen || !participant) return null;

  const TYPES: { value: "PEER" | "DIRECT_REPORT" | "MANAGER"; label: string }[] = [
    { value: "PEER", label: "Peer" },
    { value: "DIRECT_REPORT", label: "Direct report" },
    { value: "MANAGER", label: "Manager" },
  ];

  const overlay = (
    <div
      className="fixed inset-0 w-screen min-w-full h-screen min-h-full bg-black/40 flex items-center justify-center z-[9999]"
      style={{ top: 0, left: 0, right: 0, bottom: 0 }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-ds-panel border border-ds-border w-[520px] shadow-ds-dialog overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-ds-border bg-ds-surface">
          <div className="w-8 h-8 rounded-ds-panel bg-ds-surface border border-ds-border-strong flex items-center justify-center flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0d0e10" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-ds-text-primary">Assign reviewer</p>
            <p className="text-[11px] text-ds-text-secondary truncate">{cycleLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ds-text-secondary hover:text-ds-text-primary transition-colors text-[18px] leading-none"
          >
            &#215;
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary block mb-1.5">
              Participant
            </label>
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] bg-ds-surface border border-ds-border">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0" style={avatarAccent(participant.participant_name || participant.participant_employee_id).style}>
                {getInitials(participant.participant_name, participant.participant_employee_id)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-ds-text-primary truncate">{participant.participant_name}</p>
                <p className="text-[10px] text-ds-text-secondary truncate">{participant.participant_department_name ?? "—"}</p>
              </div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#646f79" strokeWidth="2" className="flex-shrink-0">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary block mb-1.5">
              Review type
            </label>
            <div className="flex gap-2 flex-wrap">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setReviewType(t.value)}
                  className={cn(
                    "px-4 py-1.5 rounded-ds-button border text-[11px] font-semibold transition-all",
                    reviewType === t.value
                      ? "bg-ds-text-primary text-white border-ds-text-primary"
                      : "bg-white text-ds-text-secondary border-ds-border hover:border-ds-text-primary"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary block mb-1.5">
              Reviewer
            </label>
            <select
              value={reviewerEmployeeId}
              onChange={(e) => setReviewerEmployeeId(e.target.value)}
              disabled={loading}
              className="w-full border border-ds-border rounded-[8px] px-3 py-2.5 text-[12px] text-ds-text-primary outline-none bg-white focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10 disabled:opacity-70"
            >
              <option value="">
                {loading ? "Loading…" : "Select reviewer…"}
              </option>
              {employees.map((emp) => (
                <option key={emp.employee_id} value={emp.employee_id}>
                  {emp.full_name ?? emp.employee_id}
                  {emp.department_name ? ` — ${emp.department_name}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-ds-border">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[8px] border border-ds-border text-[12px] font-semibold text-ds-text-secondary hover:border-ds-text-primary hover:text-ds-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={!reviewerEmployeeId.trim() || saving}
            className={cn(
              "px-4 py-2 rounded-[8px] text-[12px] font-semibold transition-colors",
              !reviewerEmployeeId.trim() || saving
                ? "bg-ds-surface text-ds-text-secondary cursor-not-allowed"
                : "bg-ds-accent text-white hover:bg-ds-accent-hover"
            )}
          >
            {saving ? "Adding…" : "Add reviewer"}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(overlay, document.body) : overlay;
}
