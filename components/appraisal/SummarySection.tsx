"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AppraisalData } from "./AppraisalTabs";

interface Scores {
  competency_score: number | null;
  technical_score: number | null;
  productivity_score: number | null;
  leadership_score: number | null;
  workplan_score: number | null;
  total_score: number | null;
  final_rating: string | null;
}

interface SummaryData {
  key_accomplishments: string | null;
  qualifications: { name: string; date_obtained: string; institution: string }[];
  transfer_requested: boolean;
  transfer_reason: string | null;
  is_probationary: boolean;
  confirmation_due_date: string | null;
  confirmation_plan_of_action: string | null;
}

interface Signoff {
  id: string;
  signoff_role: string;
  signed_at: string;
  signer_name?: string;
}

interface SummarySectionProps {
  appraisalId: string;
  appraisal: AppraisalData;
  canEdit: boolean;
  isHR: boolean;
}

const SaveIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

const CalculatorIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <line x1="8" y1="6" x2="16" y2="6" />
    <line x1="8" y1="10" x2="8" y2="10.01" />
    <line x1="12" y1="10" x2="12" y2="10.01" />
    <line x1="16" y1="10" x2="16" y2="10.01" />
    <line x1="8" y1="14" x2="8" y2="14.01" />
    <line x1="12" y1="14" x2="12" y2="14.01" />
    <line x1="16" y1="14" x2="16" y2="14.01" />
    <line x1="8" y1="18" x2="8" y2="18.01" />
    <line x1="12" y1="18" x2="12" y2="18.01" />
    <line x1="16" y1="18" x2="16" y2="18.01" />
  </svg>
);

const ChartIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

const TrophyIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 12h14" />
    <path d="M12 5l7 7-7 7" />
  </svg>
);

const CheckIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const PenIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </svg>
);

const AlertIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const thStyle: React.CSSProperties = {
  padding: "10px 16px",
  textAlign: "left",
  fontSize: "10.5px",
  fontWeight: 600,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "#646f79",
  background: "#f3f3f3",
  borderBottom: "1px solid #e7e7e7",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: "13.5px",
  borderBottom: "1px solid #e7e7e7",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: "6px",
  border: "1px solid #8b949e",
  fontSize: "13px",
  color: "#0d0d0d",
  background: "white",
  resize: "vertical",
  minHeight: "100px",
  outline: "none",
  fontFamily: "var(--ds-font-sans)",
  transition: "border-color 0.15s, box-shadow 0.15s",
  lineHeight: 1.5,
};

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: "6px",
  border: "1px solid #8b949e",
  fontSize: "13px",
  color: "#0d0d0d",
  background: "white",
  outline: "none",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

export function SummarySection({
  appraisalId,
  appraisal,
  canEdit,
  isHR,
}: SummarySectionProps) {
  const [scores, setScores] = useState<Scores | null>(null);
  const [summaryData, setSummaryData] = useState<SummaryData>({
    key_accomplishments: null,
    qualifications: [],
    transfer_requested: false,
    transfer_reason: null,
    is_probationary: false,
    confirmation_due_date: null,
    confirmation_plan_of_action: null,
  });
  const [signoffs, setSignoffs] = useState<Signoff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    try {
      const { data: scoresData } = await supabase
        .from("appraisal_section_scores")
        .select("*")
        .eq("appraisal_id", appraisalId)
        .single();

      if (scoresData) {
        setScores({
          competency_score: scoresData.competency_score,
          technical_score: scoresData.technical_score,
          productivity_score: scoresData.productivity_score,
          leadership_score: scoresData.leadership_score,
          workplan_score: scoresData.workplan_score,
          total_score: scoresData.total_score,
          final_rating: scoresData.final_rating,
        });
      }

      const { data: summaryRow } = await supabase
        .from("appraisal_summary_data")
        .select("*")
        .eq("appraisal_id", appraisalId)
        .single();

      if (summaryRow) {
        setSummaryData({
          key_accomplishments: summaryRow.key_accomplishments,
          qualifications: (summaryRow.qualifications as SummaryData["qualifications"]) ?? [],
          transfer_requested: summaryRow.transfer_requested ?? false,
          transfer_reason: summaryRow.transfer_reason,
          is_probationary: summaryRow.is_probationary ?? false,
          confirmation_due_date: summaryRow.confirmation_due_date,
          confirmation_plan_of_action: summaryRow.confirmation_plan_of_action,
        });
      }

      const { data: signoffData } = await supabase
        .from("appraisal_signoffs")
        .select("id, signoff_role, signed_at, signed_by")
        .eq("appraisal_id", appraisalId)
        .order("signed_at");

      setSignoffs(
        (signoffData ?? []).map((s) => ({
          id: s.id,
          signoff_role: s.signoff_role,
          signed_at: s.signed_at,
        }))
      );
    } catch (e) {
      if (e instanceof Error && !e.message.includes("PGRST116")) {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [appraisalId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const calculateScores = useCallback(async () => {
    setCalculating(true);
    setError(null);
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/calculate-score`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to calculate scores");
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to calculate scores");
    } finally {
      setCalculating(false);
    }
  }, [appraisalId, loadData]);

  const saveSummary = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    const supabase = createClient();

    try {
      const { data: existing } = await supabase
        .from("appraisal_summary_data")
        .select("id")
        .eq("appraisal_id", appraisalId)
        .single();

      const payload = {
        appraisal_id: appraisalId,
        key_accomplishments: summaryData.key_accomplishments,
        qualifications: summaryData.qualifications,
        transfer_requested: summaryData.transfer_requested,
        transfer_reason: summaryData.transfer_reason,
        is_probationary: summaryData.is_probationary,
        confirmation_due_date: summaryData.confirmation_due_date || null,
        confirmation_plan_of_action: summaryData.confirmation_plan_of_action,
      };

      if (existing) {
        const { error: upErr } = await supabase
          .from("appraisal_summary_data")
          .update(payload)
          .eq("id", existing.id);
        if (upErr) throw new Error(upErr.message);
      } else {
        const { error: insErr } = await supabase
          .from("appraisal_summary_data")
          .insert(payload);
        if (insErr) throw new Error(insErr.message);
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save summary");
    } finally {
      setSaving(false);
    }
  }, [appraisalId, summaryData]);

  const signoffLabels: Record<string, string> = {
    employee_acknowledgement: "Employee",
    manager_signoff: "Manager/Reviewer",
    reviewing_manager_signoff: "GM/HOD",
    hr_finalization: "HR",
  };

  if (loading) {
    return <p style={{ color: "#646f79", padding: "16px 0" }}>Loading summary…</p>;
  }

  const CardWrapper = ({ children, title, subtitle, icon, iconBg, iconColor }: { children: React.ReactNode; title: string; subtitle: string; icon: React.ReactNode; iconBg: string; iconColor: string }) => (
    <div style={{ background: "white", borderRadius: "8px", border: "1px solid #e7e7e7", boxShadow: "none", overflow: "hidden", marginBottom: "20px" }}>
      <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #e7e7e7", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: "32px", height: "32px", borderRadius: "9px", background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", color: iconColor }}>
          {icon}
        </div>
        <div>
          <div style={{ fontFamily: "var(--ds-font-sans)", fontSize: "15px", fontWeight: 600, color: "#0d0d0d", letterSpacing: "-0.01em" }}>{title}</div>
          <div style={{ fontSize: "12px", color: "#646f79", marginTop: "1px" }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ padding: "20px 24px" }}>{children}</div>
    </div>
  );

  return (
    <div>
      {/* Action buttons */}
      {canEdit && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", marginBottom: "20px" }}>
          <button
            onClick={calculateScores}
            disabled={calculating}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              padding: "9px 18px",
              borderRadius: "8px",
              background: "white",
              border: "1px solid #e7e7e7",
              fontSize: "13px",
              fontWeight: 500,
              color: calculating ? "#646f79" : "#646f79",
              cursor: calculating ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
          >
            <CalculatorIcon /> {calculating ? "Calculating…" : "Calculate Scores"}
          </button>
          <button
            onClick={saveSummary}
            disabled={saving}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              padding: "9px 20px",
              borderRadius: "8px",
              background: !saving ? "#0d0e10" : "#e7e7e7",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              color: !saving ? "white" : "#646f79",
              cursor: !saving ? "pointer" : "not-allowed",
              boxShadow: !saving ? "none" : "none",
              transition: "all 0.16s",
            }}
          >
            <SaveIcon /> Save Summary
          </button>
        </div>
      )}

      {/* Alerts */}
      {error && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", borderRadius: "8px", background: "#fef2f2", border: "1px solid #fbd5d5", marginBottom: "20px" }}>
          <span style={{ color: "#b42318", marginTop: "2px" }}><AlertIcon /></span>
          <div>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "#b42318" }}>Error</div>
            <div style={{ fontSize: "13px", color: "#b42318" }}>{error}</div>
          </div>
        </div>
      )}

      {saveSuccess && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", borderRadius: "8px", background: "#ecfdf5", border: "1px solid #bbf0d9", marginBottom: "20px" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "#2e7d4f" }}>Success</div>
            <div style={{ fontSize: "13px", color: "#2e7d4f" }}>Summary saved successfully.</div>
          </div>
        </div>
      )}

      {/* Overall Performance Score */}
      <CardWrapper title="Overall Performance Score" subtitle="Aggregate scores from all assessment sections" icon={<ChartIcon />} iconBg="#f3f3f3" iconColor="#0d0e10">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Section</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Score</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ transition: "background 0.13s" }}>
              <td style={tdStyle}>Core Competencies</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                {scores?.competency_score != null ? (
                  <span style={{ fontFamily: "var(--ds-font-sans)", fontWeight: 600, color: "#0d0d0d" }}>{scores.competency_score.toFixed(1)}</span>
                ) : (
                  <span style={{ color: "#646f79" }}>—</span>
                )}
              </td>
            </tr>
            <tr style={{ transition: "background 0.13s" }}>
              <td style={tdStyle}>Technical Competencies</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                {scores?.technical_score != null ? (
                  <span style={{ fontFamily: "var(--ds-font-sans)", fontWeight: 600, color: "#0d0d0d" }}>{scores.technical_score.toFixed(1)}</span>
                ) : (
                  <span style={{ color: "#646f79" }}>—</span>
                )}
              </td>
            </tr>
            <tr style={{ transition: "background 0.13s" }}>
              <td style={tdStyle}>Productivity</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                {scores?.productivity_score != null ? (
                  <span style={{ fontFamily: "var(--ds-font-sans)", fontWeight: 600, color: "#0d0d0d" }}>{scores.productivity_score.toFixed(1)}</span>
                ) : (
                  <span style={{ color: "#646f79" }}>—</span>
                )}
              </td>
            </tr>
            {appraisal.is_management && (
              <tr style={{ transition: "background 0.13s" }}>
                <td style={tdStyle}>Leadership</td>
                <td style={{ ...tdStyle, textAlign: "right" }}>
                  {scores?.leadership_score != null ? (
                    <span style={{ fontFamily: "var(--ds-font-sans)", fontWeight: 600, color: "#0d0d0d" }}>{scores.leadership_score.toFixed(1)}</span>
                  ) : (
                    <span style={{ color: "#646f79" }}>—</span>
                  )}
                </td>
              </tr>
            )}
            <tr style={{ transition: "background 0.13s" }}>
              <td style={tdStyle}>Workplan</td>
              <td style={{ ...tdStyle, textAlign: "right" }}>
                {scores?.workplan_score != null ? (
                  <span style={{ fontFamily: "var(--ds-font-sans)", fontWeight: 600, color: "#0d0d0d" }}>{scores.workplan_score.toFixed(1)}</span>
                ) : (
                  <span style={{ color: "#646f79" }}>—</span>
                )}
              </td>
            </tr>
            <tr style={{ background: "#f3f3f3", borderTop: "2px solid #e7e7e7" }}>
              <td style={{ ...tdStyle, fontWeight: 600, color: "#0d0d0d", border: "none" }}>Total Score</td>
              <td style={{ ...tdStyle, textAlign: "right", border: "none" }}>
                {scores?.total_score != null ? (
                  <span style={{ fontFamily: "var(--ds-font-sans)", fontSize: "16px", fontWeight: 600, color: "#2e7d4f" }}>{scores.total_score.toFixed(1)}</span>
                ) : (
                  <span style={{ color: "#646f79" }}>—</span>
                )}
              </td>
            </tr>
            <tr style={{ background: "#f3f3f3" }}>
              <td style={{ ...tdStyle, fontWeight: 600, color: "#0d0d0d", border: "none" }}>Final Rating</td>
              <td style={{ ...tdStyle, textAlign: "right", border: "none" }}>
                {scores?.final_rating ? (
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 12px",
                    borderRadius: "4px",
                    background: "#ecfdf5",
                    border: "1px solid #bbf0d9",
                    color: "#2e7d4f",
                    fontFamily: "var(--ds-font-sans)",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}>
                    {scores.final_rating}
                  </span>
                ) : (
                  <span style={{ color: "#646f79" }}>—</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </CardWrapper>

      {/* Key Accomplishments */}
      <CardWrapper title="Key Accomplishments" subtitle="Notable achievements during the appraisal period" icon={<TrophyIcon />} iconBg="#fffbeb" iconColor="#8a5a00">
        {canEdit ? (
          <textarea
            style={textareaStyle}
            value={summaryData.key_accomplishments ?? ""}
            onChange={(e) =>
              setSummaryData((prev) => ({
                ...prev,
                key_accomplishments: e.target.value || null,
              }))
            }
            placeholder="List key accomplishments..."
            onFocus={(e) => { e.target.style.borderColor = "#0d0e10"; e.target.style.boxShadow = "0 0 0 1px var(--ds-focus)"; }}
            onBlur={(e) => { e.target.style.borderColor = "#8b949e"; e.target.style.boxShadow = "none"; }}
          />
        ) : (
          <p style={{ fontSize: "13px", color: "#0d0d0d", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {summaryData.key_accomplishments || "No accomplishments recorded."}
          </p>
        )}
      </CardWrapper>

      {/* Transfer Request */}
      <CardWrapper title="Transfer Request" subtitle="Inter-departmental or intra-divisional transfer request" icon={<ArrowRightIcon />} iconBg="#f1f4f7" iconColor="#3d5a78">
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: summaryData.transfer_requested ? "16px" : 0 }}>
          <Checkbox
            id="transfer-requested"
            checked={summaryData.transfer_requested}
            onCheckedChange={(checked) =>
              canEdit &&
              setSummaryData((prev) => ({
                ...prev,
                transfer_requested: !!checked,
              }))
            }
            disabled={!canEdit}
          />
          <Label htmlFor="transfer-requested" style={{ fontSize: "13px", color: "#0d0d0d" }}>Request transfer</Label>
        </div>
        {summaryData.transfer_requested && (
          <div>
            <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#646f79", marginBottom: "6px" }}>
              Reason for transfer request
            </label>
            {canEdit ? (
              <textarea
                style={textareaStyle}
                value={summaryData.transfer_reason ?? ""}
                onChange={(e) =>
                  setSummaryData((prev) => ({
                    ...prev,
                    transfer_reason: e.target.value || null,
                  }))
                }
                placeholder="Explain the reason..."
                onFocus={(e) => { e.target.style.borderColor = "#0d0e10"; e.target.style.boxShadow = "0 0 0 1px var(--ds-focus)"; }}
                onBlur={(e) => { e.target.style.borderColor = "#8b949e"; e.target.style.boxShadow = "none"; }}
              />
            ) : (
              <p style={{ fontSize: "13px", color: "#0d0d0d" }}>{summaryData.transfer_reason || "—"}</p>
            )}
          </div>
        )}
      </CardWrapper>

      {/* Confirmation Status */}
      <CardWrapper title="Confirmation Status" subtitle="For probationary staff - confirmation due date and plan of action" icon={<CheckIcon />} iconBg="#f3f3f3" iconColor="#0d0e10">
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: summaryData.is_probationary ? "16px" : 0 }}>
          <Checkbox
            id="is-probationary"
            checked={summaryData.is_probationary}
            onCheckedChange={(checked) =>
              canEdit &&
              setSummaryData((prev) => ({
                ...prev,
                is_probationary: !!checked,
              }))
            }
            disabled={!canEdit}
          />
          <Label htmlFor="is-probationary" style={{ fontSize: "13px", color: "#0d0d0d" }}>Probationary staff</Label>
        </div>
        {summaryData.is_probationary && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#646f79", marginBottom: "6px" }}>
                Confirmation due date
              </label>
              {canEdit ? (
                <input
                  type="date"
                  style={inputStyle}
                  value={summaryData.confirmation_due_date ?? ""}
                  onChange={(e) =>
                    setSummaryData((prev) => ({
                      ...prev,
                      confirmation_due_date: e.target.value || null,
                    }))
                  }
                  onFocus={(e) => { e.target.style.borderColor = "#0d0e10"; e.target.style.boxShadow = "0 0 0 1px var(--ds-focus)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "#8b949e"; e.target.style.boxShadow = "none"; }}
                />
              ) : (
                <p style={{ fontSize: "13px", color: "#0d0d0d" }}>{summaryData.confirmation_due_date || "—"}</p>
              )}
            </div>
            <div>
              <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#646f79", marginBottom: "6px" }}>
                Plan of action if not confirmed
              </label>
              {canEdit ? (
                <textarea
                  style={textareaStyle}
                  value={summaryData.confirmation_plan_of_action ?? ""}
                  onChange={(e) =>
                    setSummaryData((prev) => ({
                      ...prev,
                      confirmation_plan_of_action: e.target.value || null,
                    }))
                  }
                  placeholder="Describe the plan..."
                  onFocus={(e) => { e.target.style.borderColor = "#0d0e10"; e.target.style.boxShadow = "0 0 0 1px var(--ds-focus)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "#8b949e"; e.target.style.boxShadow = "none"; }}
                />
              ) : (
                <p style={{ fontSize: "13px", color: "#0d0d0d" }}>{summaryData.confirmation_plan_of_action || "—"}</p>
              )}
            </div>
          </div>
        )}
      </CardWrapper>

      {/* Signatures */}
      <CardWrapper title="Signatures" subtitle="Sign-off status for this appraisal" icon={<PenIcon />} iconBg="#fef2f2" iconColor="#b42318">
        <div>
          {["employee_acknowledgement", "manager_signoff", "reviewing_manager_signoff", "hr_finalization"].map(
            (role, index) => {
              const signoff = signoffs.find((s) => s.signoff_role === role);
              return (
                <div
                  key={role}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 0",
                    borderBottom: index < 3 ? "1px solid #e7e7e7" : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ color: "#646f79" }}><PenIcon /></span>
                    <span style={{ fontSize: "13.5px", fontWeight: 500, color: "#0d0d0d" }}>{signoffLabels[role] ?? role}</span>
                  </div>
                  {signoff ? (
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 12px",
                      borderRadius: "4px",
                      background: "#ecfdf5",
                      border: "1px solid #bbf0d9",
                      color: "#2e7d4f",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}>
                      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#2e7d4f" }} />
                      Signed {new Date(signoff.signed_at).toLocaleDateString()}
                    </span>
                  ) : (
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "4px 12px",
                      borderRadius: "4px",
                      background: "#f3f3f3",
                      border: "1px solid #e7e7e7",
                      color: "#646f79",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}>
                      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#646f79" }} />
                      Pending
                    </span>
                  )}
                </div>
              );
            }
          )}
        </div>
      </CardWrapper>
    </div>
  );
}
