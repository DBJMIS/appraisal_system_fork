"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { avatarAccent } from "@/lib/avatar-accent";

interface PendingWorkplan {
  workplan_id: string;
  appraisal_id: string;
  workplan_status: string;
  submitted_at: string;
  employee_id: string;
  employee_name: string;
  job_title: string;
  division_id: string;
  division_name: string;
  manager_employee_id: string;
  manager_name: string;
  cycle_id: string;
  fiscal_year: string;
  cycle_name: string;
  review_type: string;
  item_count: number;
  total_weight: number;
}

interface WorkplanApprovalListProps {
  initialPending: PendingWorkplan[];
}

const CheckIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const XIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const EyeIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const AlertIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const ClipboardIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
  </svg>
);

function getInitials(name: string): string {
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
}

function formatReviewType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function WorkplanApprovalList({ initialPending }: WorkplanApprovalListProps) {
  const [pending, setPending] = useState<PendingWorkplan[]>(initialPending);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const approveWorkplan = useCallback(async (appraisalId: string) => {
    setLoading(appraisalId);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/workplan/approve`, {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to approve workplan");
      }

      setSuccess("Workplan approved and locked.");
      setPending(prev => prev.filter(p => p.appraisal_id !== appraisalId));
      setTimeout(() => setSuccess(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve workplan");
    } finally {
      setLoading(null);
    }
  }, []);

  const rejectWorkplan = useCallback(async () => {
    if (!rejectModalOpen || !rejectReason.trim()) return;
    setLoading(rejectModalOpen);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/appraisals/${rejectModalOpen}/workplan/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to return workplan");
      }

      setSuccess("Workplan returned to employee for revision.");
      setPending(prev => prev.filter(p => p.appraisal_id !== rejectModalOpen));
      setRejectModalOpen(null);
      setRejectReason("");
      setTimeout(() => setSuccess(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to return workplan");
    } finally {
      setLoading(null);
    }
  }, [rejectModalOpen, rejectReason]);

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
    whiteSpace: "nowrap",
  };

  const tdStyle: React.CSSProperties = {
    padding: "14px 16px",
    fontSize: "13.5px",
    verticalAlign: "middle",
    borderBottom: "1px solid #e7e7e7",
  };

  return (
    <div>
      {/* Alerts */}
      {error && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", borderRadius: "8px", background: "#fef2f2", border: "1px solid #fbd5d5", marginBottom: "16px" }}>
          <span style={{ color: "#b42318", marginTop: "2px" }}><AlertIcon /></span>
          <div>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "#b42318" }}>Error</div>
            <div style={{ fontSize: "13px", color: "#b42318" }}>{error}</div>
          </div>
        </div>
      )}

      {success && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", borderRadius: "8px", background: "#ecfdf5", border: "1px solid #bbf0d9", marginBottom: "16px" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "#2e7d4f" }}>Success</div>
            <div style={{ fontSize: "13px", color: "#2e7d4f" }}>{success}</div>
          </div>
        </div>
      )}

      {/* List */}
      <div
        style={{
          background: "white",
          borderRadius: "8px",
          border: "1px solid #e7e7e7",
          boxShadow: "none",
          overflow: "hidden",
        }}
      >
        {/* Card header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #e7e7e7", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "9px", background: "#f3f3f3", display: "flex", alignItems: "center", justifyContent: "center", color: "#0d0e10" }}>
            <ClipboardIcon />
          </div>
          <div>
            <div style={{ fontFamily: "var(--ds-font-sans)", fontSize: "15px", fontWeight: 600, color: "#0d0d0d", letterSpacing: "-0.01em" }}>
              Pending Approvals
            </div>
            <div style={{ fontSize: "12px", color: "#646f79", marginTop: "1px" }}>
              Review workplans submitted by your direct reports
            </div>
          </div>
        </div>

        {pending.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center" }}>
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "#ecfdf5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                color: "#2e7d4f",
              }}
            >
              <svg style={{ width: 28, height: 28 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div style={{ fontFamily: "var(--ds-font-sans)", fontSize: "15px", fontWeight: 600, color: "#0d0d0d", marginBottom: "6px" }}>
              All caught up!
            </div>
            <p style={{ color: "#646f79", fontSize: "13px", maxWidth: "280px", margin: "0 auto", lineHeight: 1.5 }}>
              No workplans are currently awaiting your approval. Check back later.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Employee</th>
                  <th style={thStyle}>Division</th>
                  <th style={thStyle}>Cycle</th>
                  <th style={thStyle}>Review Type</th>
                  <th style={thStyle}>Objectives</th>
                  <th style={thStyle}>Submitted</th>
                  <th style={{ ...thStyle, width: "220px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((item) => (
                  <tr
                    key={item.workplan_id}
                    style={{ transition: "background 0.13s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f3f3"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div
                          style={{
                            width: "34px",
                            height: "34px",
                            borderRadius: "50%",
                            ...avatarAccent(item.employee_name).style,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontFamily: "var(--ds-font-sans)",
                            fontSize: "12px",
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          {getInitials(item.employee_name)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500, color: "#0d0d0d" }}>{item.employee_name}</div>
                          <div style={{ fontSize: "11.5px", color: "#646f79" }}>{item.job_title}</div>
                        </div>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: "#646f79" }}>{item.division_name || "—"}</span>
                    </td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "4px 12px",
                          borderRadius: "4px",
                          background: "#f3f3f3",
                          border: "1px solid #d0d4d8",
                          fontFamily: "var(--ds-font-sans)",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#3d5a78",
                        }}
                      >
                        {item.fiscal_year}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: "#646f79" }}>{formatReviewType(item.review_type)}</span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "28px",
                            height: "28px",
                            borderRadius: "8px",
                            background: "#f3f3f3",
                            border: "1px solid #d0d4d8",
                            color: "#3d5a78",
                            fontFamily: "var(--ds-font-sans)",
                            fontSize: "12px",
                            fontWeight: 600,
                          }}
                        >
                          {item.item_count}
                        </span>
                        <span style={{ fontSize: "12px", color: "#646f79" }}>
                          ({item.total_weight}% weight)
                        </span>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: "#646f79", fontSize: "13px" }}>{formatDate(item.submitted_at)}</span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <Link
                          href={`/appraisals/${item.appraisal_id}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "7px 14px",
                            borderRadius: "8px",
                            background: "white",
                            border: "1px solid #e7e7e7",
                            fontSize: "12.5px",
                            fontWeight: 500,
                            color: "#646f79",
                            textDecoration: "none",
                            cursor: "pointer",
                            transition: "all 0.15s",
                          }}
                        >
                          <EyeIcon /> View
                        </Link>
                        <button
                          onClick={() => approveWorkplan(item.appraisal_id)}
                          disabled={loading === item.appraisal_id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "7px 14px",
                            borderRadius: "8px",
                            background: loading === item.appraisal_id ? "#e7e7e7" : "#0d0e10",
                            border: "none",
                            fontSize: "12.5px",
                            fontWeight: 600,
                            color: loading === item.appraisal_id ? "#646f79" : "white",
                            cursor: loading === item.appraisal_id ? "not-allowed" : "pointer",
                            boxShadow: loading === item.appraisal_id ? "none" : "none",
                            transition: "all 0.15s",
                          }}
                        >
                          <CheckIcon /> Approve
                        </button>
                        <button
                          onClick={() => setRejectModalOpen(item.appraisal_id)}
                          disabled={loading === item.appraisal_id}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "7px 14px",
                            borderRadius: "8px",
                            background: "#fef2f2",
                            border: "1px solid #fbd5d5",
                            fontSize: "12.5px",
                            fontWeight: 500,
                            color: "#b42318",
                            cursor: loading === item.appraisal_id ? "not-allowed" : "pointer",
                            transition: "all 0.15s",
                            opacity: loading === item.appraisal_id ? 0.5 : 1,
                          }}
                        >
                          <XIcon /> Return
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {rejectModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: "8px", width: "100%", maxWidth: "480px", boxShadow: "var(--ds-shadow-dialog)" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #e7e7e7" }}>
              <h3 style={{ fontFamily: "var(--ds-font-sans)", fontSize: "18px", fontWeight: 600, color: "#0d0d0d", margin: 0 }}>Return Workplan for Revision</h3>
              <p style={{ fontSize: "13px", color: "#646f79", marginTop: "4px", marginBottom: 0 }}>Please provide feedback for the employee</p>
            </div>
            <div style={{ padding: "20px 24px" }}>
              <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#646f79", marginBottom: "8px" }}>
                Feedback / Reason for Revision
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain what needs to be changed..."
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: "8px",
                  border: "1px solid #e7e7e7",
                  fontSize: "13.5px",
                  color: "#0d0d0d",
                  background: "#f3f3f3",
                  resize: "vertical",
                  minHeight: "100px",
                  outline: "none",
                  fontFamily: "var(--ds-font-sans)",
                  lineHeight: 1.6,
                }}
              />
            </div>
            <div style={{ padding: "16px 24px", borderTop: "1px solid #e7e7e7", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                onClick={() => { setRejectModalOpen(null); setRejectReason(""); }}
                style={{
                  padding: "9px 20px",
                  borderRadius: "8px",
                  background: "white",
                  border: "1px solid #e7e7e7",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#646f79",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={rejectWorkplan}
                disabled={!rejectReason.trim() || loading === rejectModalOpen}
                style={{
                  padding: "9px 20px",
                  borderRadius: "8px",
                  background: rejectReason.trim() && loading !== rejectModalOpen ? "#b42318" : "#e7e7e7",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: rejectReason.trim() && loading !== rejectModalOpen ? "white" : "#646f79",
                  cursor: rejectReason.trim() && loading !== rejectModalOpen ? "pointer" : "not-allowed",
                }}
              >
                {loading === rejectModalOpen ? "Returning…" : "Return to Employee"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
