"use client";

import { useState, useEffect } from "react";
import { ClipboardCheck } from "lucide-react";

export interface HRActionsTabProps {
  appraisalId: string;
  status: string;
  isHR: boolean;
  isManager?: boolean;
}

const REC_KEYS_LEFT: { key: string; label: string }[] = [
  { key: "pay_increment", label: "Pay Increment" },
  { key: "withhold_increment", label: "Withhold Increment" },
  { key: "suitable_for_promotion", label: "Suitable for Promotion" },
  { key: "remedial_action", label: "Remedial Action" },
  { key: "probation", label: "Probation" },
];

const REC_KEYS_RIGHT: { key: string; label: string }[] = [
  { key: "eligible_for_award", label: "Eligible for Award" },
  { key: "not_eligible_for_award", label: "Not Eligible for Award" },
  { key: "job_enrichment", label: "Job Enrichment" },
  { key: "reassignment", label: "Reassignment" },
  { key: "separation", label: "Separation" },
];

const DEFAULT_REC: Record<string, boolean> = {
  pay_increment: false,
  withhold_increment: false,
  eligible_for_award: false,
  not_eligible_for_award: false,
  suitable_for_promotion: false,
  job_enrichment: false,
  reassignment: false,
  remedial_action: false,
  probation: false,
  separation: false,
};

function normalizeRec(o: unknown): Record<string, boolean> {
  if (o == null || typeof o !== "object") return { ...DEFAULT_REC };
  const out = { ...DEFAULT_REC };
  for (const k of Object.keys(DEFAULT_REC)) {
    if (typeof (o as Record<string, unknown>)[k] === "boolean") {
      out[k] = (o as Record<string, boolean>)[k];
    }
  }
  return out;
}

export function HRActionsTab({ appraisalId, status, isHR, isManager = false }: HRActionsTabProps) {
  const [recs, setRecs] = useState<Record<string, boolean>>({ ...DEFAULT_REC });
  const [otherNotes, setOtherNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const isManagerReviewPhase = status === "MANAGER_REVIEW" || status === "SUBMITTED";
  const canViewAndEdit =
    (status === "HR_REVIEW" && isHR) || (isManagerReviewPhase && (isManager || isHR));

  useEffect(() => {
    if (!appraisalId || (!isHR && !isManager)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/appraisals/${appraisalId}/hr-recommendations`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setRecs(normalizeRec(data.recommendations));
          setOtherNotes(typeof data.other_notes === "string" ? data.other_notes : "");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appraisalId, isHR, isManager]);

  if (!canViewAndEdit) {
    return (
      <div className="flex items-center justify-center py-20 text-ds-text-secondary text-sm">
        HR recommendations are available during Manager Review or HR Review phase.
      </div>
    );
  }

  const handleSave = async () => {
    if (!canViewAndEdit) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/hr-recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recommendations: recs, other_notes: otherNotes }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || "Failed to save");
      else {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 4000);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-ds-text-secondary text-sm">
        Loading...
      </div>
    );
  }

  const SaveIcon = () => (
    <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );

  return (
    <div className="flex flex-col gap-6">
      {saveSuccess && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", borderRadius: "8px", background: "#ecfdf5", border: "1px solid #bbf0d9" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "#2e7d4f" }}>Success</div>
            <div style={{ fontSize: "13px", color: "#2e7d4f" }}>HR recommendations saved successfully.</div>
          </div>
        </div>
      )}
      <div
        style={{
          background: "white",
          borderRadius: "8px",
          border: "1px solid #e7e7e7",
          boxShadow: "none",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #e7e7e7", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "9px", background: "#f3f3f3", display: "flex", alignItems: "center", justifyContent: "center", color: "#0d0e10" }}>
              <ClipboardCheck className="w-4 h-4" />
            </div>
            <div>
              <div style={{ fontFamily: "var(--ds-font-sans)", fontSize: "15px", fontWeight: 600, color: "#0d0d0d", letterSpacing: "-0.01em" }}>
                HR Recommendations
              </div>
              <div style={{ fontSize: "12px", color: "#646f79", marginTop: "1px" }}>
                For HR and manager use during Manager Review or HR Review.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canViewAndEdit || saving}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              padding: "9px 20px",
              borderRadius: "8px",
              background: !saving && canViewAndEdit ? "#0d0e10" : "#e7e7e7",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              color: !saving && canViewAndEdit ? "white" : "#646f79",
              cursor: !saving && canViewAndEdit ? "pointer" : "not-allowed",
              boxShadow: !saving && canViewAndEdit ? "0 2px 8px rgba(13,148,136,0.35)" : "none",
              transition: "all 0.16s",
            }}
          >
            <SaveIcon /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
        <div style={{ padding: "20px 24px 24px" }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">
            <div className="flex flex-col">
              {REC_KEYS_LEFT.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center gap-2.5 py-2.5 px-3 rounded-[8px] cursor-pointer hover:bg-ds-surface transition-colors group"
                >
                  <input
                    type="checkbox"
                    checked={recs[key] ?? false}
                    onChange={(e) => setRecs((prev) => ({ ...prev, [key]: e.target.checked }))}
                    className="w-4 h-4 rounded border-ds-border accent-ds-accent"
                  />
                  <span className="text-[13px] font-medium text-ds-text-primary">{label}</span>
                </label>
              ))}
            </div>
            <div className="flex flex-col">
              {REC_KEYS_RIGHT.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center gap-2.5 py-2.5 px-3 rounded-[8px] cursor-pointer hover:bg-ds-surface transition-colors group"
                >
                  <input
                    type="checkbox"
                    checked={recs[key] ?? false}
                    onChange={(e) => setRecs((prev) => ({ ...prev, [key]: e.target.checked }))}
                    className="w-4 h-4 rounded border-ds-border accent-ds-accent"
                  />
                  <span className="text-[13px] font-medium text-ds-text-primary">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <textarea
            value={otherNotes}
            onChange={(e) => setOtherNotes(e.target.value)}
            placeholder="Additional notes or recommendations..."
            className="w-full border border-ds-border rounded-[8px] p-3 text-[13px] text-ds-text-primary resize-none min-h-[80px] focus:outline-none focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10"
            style={{ marginTop: "16px" }}
          />
        </div>
      </div>
    </div>
  );
}
