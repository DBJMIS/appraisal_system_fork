"use client";

import { useEffect, useState } from "react";
import { useAdminPanel } from "../AdminPanelContext";
import {
  CardWrapper,
  Feedback360Icon,
  thStyle,
  tdStyle,
} from "../admin-shared";

export interface FeedbackQuestionRow {
  id: string;
  reviewer_type: "SELF" | "MANAGER" | "PEER" | "DIRECT_REPORT";
  competency_group: string;
  question_text: string;
  sort_order: number;
}

export function VisibilityTab() {
  const { feedbackCycles, handleVisibilityChange } = useAdminPanel();

  const [questions, setQuestions] = useState<FeedbackQuestionRow[]>([]);
  const [activeReviewerType, setActiveReviewerType] = useState<
    "SELF" | "MANAGER" | "PEER" | "DIRECT_REPORT"
  >("SELF");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  const activeCycleId =
    feedbackCycles.find((c) => c.status === "Active")?.id ?? feedbackCycles[0]?.id ?? null;

  useEffect(() => {
    if (!activeCycleId) {
      setQuestions([]);
      return;
    }
    fetch(`/api/admin/feedback/questions?cycle_id=${activeCycleId}`)
      .then((r) => r.json())
      .then((d) => setQuestions(d.questions ?? []))
      .catch(() => setQuestions([]));
  }, [activeCycleId]);

  return (
    <>
      <CardWrapper
        title="360 settings"
        subtitle="Control whether the person being reviewed can see peer and direct report feedback in their report"
        icon={<Feedback360Icon />}
        iconBg="#f1f4f7"
        iconColor="#3d5a78"
        delay="0.32s"
      >
        {feedbackCycles.length === 0 ? (
          <p style={{ padding: "20px 24px", color: "#646f79" }}>
            No 360 feedback cycles yet. Create an appraisal cycle to generate a linked 360 cycle.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Cycle</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Peer visible to reviewee</th>
                <th style={thStyle}>Direct reports visible to reviewee</th>
              </tr>
            </thead>
            <tbody>
              {feedbackCycles.map((c) => (
                <tr
                  key={c.id}
                  style={{ transition: "background 0.13s" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#f3f3f3";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <td style={{ ...tdStyle, fontWeight: 600, color: "#0d0d0d" }}>{c.cycle_name}</td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        display: "inline-flex",
                        padding: "3px 10px",
                        borderRadius: "4px",
                        fontSize: "11.5px",
                        fontWeight: 600,
                        background: c.status === "Active" ? "#ecfdf5" : "#f3f3f3",
                        color: c.status === "Active" ? "#2e7d4f" : "#646f79",
                        border: `1px solid ${c.status === "Active" ? "#bbf0d9" : "#e7e7e7"}`,
                      }}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <label
                      style={{ display: "inline-flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
                    >
                      <input
                        type="checkbox"
                        checked={c.peer_feedback_visible_to_reviewee !== false}
                        onChange={(e) =>
                          handleVisibilityChange(c.id, "peer_feedback_visible_to_reviewee", e.target.checked)
                        }
                        style={{ width: "16px", height: "16px" }}
                      />
                      <span style={{ fontSize: "13px" }}>Show to reviewee</span>
                    </label>
                  </td>
                  <td style={tdStyle}>
                    <label
                      style={{ display: "inline-flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
                    >
                      <input
                        type="checkbox"
                        checked={c.direct_report_feedback_visible_to_reviewee !== false}
                        onChange={(e) =>
                          handleVisibilityChange(
                            c.id,
                            "direct_report_feedback_visible_to_reviewee",
                            e.target.checked
                          )
                        }
                        style={{ width: "16px", height: "16px" }}
                      />
                      <span style={{ fontSize: "13px" }}>Show to reviewee</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardWrapper>

      {activeCycleId && (
        <div className="mt-6 overflow-hidden rounded-ds-panel border border-ds-border bg-white">
          <div className="flex items-center justify-between border-b border-ds-border px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ds-surface">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#0d0e10" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="6" />
                  <path d="M6 6.5a2 2 0 1 1 2 2v1" />
                  <circle cx="8" cy="12" r=".5" fill="#0d0e10" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-ds-text-primary">Question bank</p>
                <p className="text-xs text-ds-text-secondary">Manage 360 feedback questions by reviewer type</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-ds-border bg-ds-surface px-6 py-3">
            <span className="text-xs text-ds-text-secondary">Rating scale:</span>
            {[
              { val: 1, label: "Strongly disagree" },
              { val: 2, label: "Disagree" },
              { val: 3, label: "Neutral" },
              { val: 4, label: "Agree" },
              { val: 5, label: "Strongly agree" },
            ].map((s) => (
              <span
                key={s.val}
                className="inline-flex items-center gap-1 rounded-ds-badge border border-ds-border bg-white px-2 py-0.5 text-xs text-ds-text-secondary"
              >
                <strong className="text-ds-text-primary">{s.val}</strong> {s.label}
              </span>
            ))}
          </div>

          <div className="flex gap-2 border-b border-ds-border px-6 pb-0 pt-4">
            {(["SELF", "MANAGER", "PEER", "DIRECT_REPORT"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setActiveReviewerType(type)}
                className={`rounded-t-lg border-b-2 px-4 py-2 text-xs font-medium transition-colors ${
                  activeReviewerType === type
                    ? "border-ds-accent text-ds-accent"
                    : "border-transparent text-ds-text-secondary hover:text-ds-text-secondary"
                }`}
              >
                {type === "DIRECT_REPORT" ? "Direct report" : type.charAt(0) + type.slice(1).toLowerCase()}
                <span className="ml-1.5 rounded-ds-badge bg-ds-surface px-1.5 py-0.5 text-[10px] text-ds-text-secondary">
                  {questions.filter((q) => q.reviewer_type === type).length}
                </span>
              </button>
            ))}
          </div>

          <div className="space-y-5 px-6 py-4">
            {(() => {
              const filtered = questions.filter((q) => q.reviewer_type === activeReviewerType);
              const groups = [...new Set(filtered.map((q) => q.competency_group))];

              if (!filtered.length) {
                return (
                  <p className="py-4 text-center text-sm text-ds-text-secondary">
                    No questions yet for this reviewer type.
                  </p>
                );
              }

              return groups.map((group) => (
                <div key={group}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ds-text-primary">{group}</p>
                  <div className="space-y-1">
                    {filtered
                      .filter((q) => q.competency_group === group)
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((q, i) => (
                        <div
                          key={q.id}
                          className="group flex items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 hover:border-ds-border hover:bg-ds-surface"
                        >
                          <span className="mt-0.5 w-4 flex-shrink-0 font-mono text-xs text-ds-border-strong">
                            {i + 1}
                          </span>
                          {editingId === q.id ? (
                            <div className="flex flex-1 flex-wrap items-center gap-2">
                              <input
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                className="min-w-[12rem] flex-1 rounded-lg border border-ds-accent px-3 py-1.5 text-sm focus:outline-none"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={async () => {
                                  setSaving(true);
                                  try {
                                    const res = await fetch(`/api/admin/feedback/questions/${q.id}`, {
                                      method: "PUT",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ question_text: editText }),
                                    });
                                    if (!res.ok) {
                                      const err = await res.json().catch(() => ({}));
                                      throw new Error(err.error || "Save failed");
                                    }
                                    setQuestions((prev) =>
                                      prev.map((p) => (p.id === q.id ? { ...p, question_text: editText } : p))
                                    );
                                    setEditingId(null);
                                  } catch {
                                    // keep editing open on error
                                  } finally {
                                    setSaving(false);
                                  }
                                }}
                                className="rounded-lg bg-ds-accent px-3 py-1.5 text-xs font-medium text-white"
                              >
                                {saving ? "Saving…" : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="px-2 py-1.5 text-xs text-ds-text-secondary"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="flex-1 text-sm text-ds-text-primary">{q.question_text}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(q.id);
                                  setEditText(q.question_text);
                                }}
                                className="rounded px-2 py-0.5 text-xs text-ds-text-secondary opacity-0 transition-opacity hover:text-ds-accent group-hover:opacity-100"
                              >
                                Edit
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}
    </>
  );
}
