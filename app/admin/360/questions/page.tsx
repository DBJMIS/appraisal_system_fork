"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type ReviewerType = "SELF" | "MANAGER" | "PEER" | "DIRECT_REPORT";

type QuestionRow = {
  id: string;
  reviewer_type: ReviewerType;
  competency_group: string;
  question_text: string;
  sort_order: number;
};

type ScaleRow = {
  id: string;
  value: number;
  label: string;
  sort_order: number;
};

const TABS: ReviewerType[] = ["SELF", "MANAGER", "PEER", "DIRECT_REPORT"];

function prettyType(type: ReviewerType) {
  return type === "DIRECT_REPORT" ? "DIRECT REPORT" : type;
}

export default function Admin360QuestionBankPage() {
  const [activeType, setActiveType] = useState<ReviewerType>("SELF");
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [scale, setScale] = useState<ScaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [draftText, setDraftText] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addCategoryMode, setAddCategoryMode] = useState<"existing" | "new">("existing");
  const [addCategory, setAddCategory] = useState("");
  const [addNewCategory, setAddNewCategory] = useState("");
  const [addQuestionText, setAddQuestionText] = useState("");

  const [draggingId, setDraggingId] = useState<string | null>(null);

  const load = async (reviewerType: ReviewerType) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback/questions?reviewer_type=${reviewerType}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to load question bank");
        setQuestions([]);
        return;
      }
      setQuestions(Array.isArray(data.questions) ? data.questions : []);
      setScale(Array.isArray(data.scale) ? data.scale : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load question bank");
      setQuestions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(activeType);
  }, [activeType]);

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const categories = useMemo(() => {
    return [...new Set(questions.map((q) => q.competency_group))].sort((a, b) => a.localeCompare(b));
  }, [questions]);

  const grouped = useMemo(() => {
    const map = new Map<string, QuestionRow[]>();
    for (const q of [...questions].sort((a, b) => a.sort_order - b.sort_order || a.question_text.localeCompare(b.question_text))) {
      const list = map.get(q.competency_group) ?? [];
      list.push(q);
      map.set(q.competency_group, list);
    }
    return [...map.entries()];
  }, [questions]);

  const onSaveInline = async (id: string) => {
    const question_text = (draftText[id] ?? "").trim();
    if (!question_text) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback/questions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to save question");
        return;
      }
      setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, question_text } : q)));
      setEditingId(null);
      showSuccess("Question updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save question");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback/questions/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to delete question");
        return;
      }
      setQuestions((prev) => prev.filter((q) => q.id !== id));
      showSuccess("Question deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete question");
    } finally {
      setSaving(false);
    }
  };

  const onCreate = async () => {
    const competency_group = (addCategoryMode === "new" ? addNewCategory : addCategory).trim();
    const question_text = addQuestionText.trim();
    if (!competency_group || !question_text) {
      setError("Category and question text are required.");
      return;
    }

    const currentInCategory = questions.filter((q) => q.competency_group === competency_group);
    const nextSort = (currentInCategory.reduce((m, q) => Math.max(m, Number(q.sort_order) || 0), 0) || 0) + 1;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/feedback/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewer_type: activeType,
          competency_group,
          question_text,
          sort_order: nextSort,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to create question");
        return;
      }
      if (data.question) setQuestions((prev) => [...prev, data.question]);
      setShowAddModal(false);
      setAddCategoryMode("existing");
      setAddCategory("");
      setAddNewCategory("");
      setAddQuestionText("");
      showSuccess("Question added.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create question");
    } finally {
      setSaving(false);
    }
  };

  const reorderWithinCategory = async (category: string, sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const list = questions
      .filter((q) => q.competency_group === category)
      .sort((a, b) => a.sort_order - b.sort_order);
    const from = list.findIndex((q) => q.id === sourceId);
    const to = list.findIndex((q) => q.id === targetId);
    if (from < 0 || to < 0) return;

    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    const updates = next.map((q, i) => ({ id: q.id, sort_order: i + 1 }));

    setQuestions((prev) =>
      prev.map((q) => {
        const found = updates.find((u) => u.id === q.id);
        return found ? { ...q, sort_order: found.sort_order } : q;
      })
    );

    for (const u of updates) {
      await fetch(`/api/admin/feedback/questions/${u.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort_order: u.sort_order }),
      });
    }
  };

  return (
    <div className="min-h-screen bg-ds-surface">
      <div className="mx-auto max-w-7xl px-5 pb-12 pt-8 sm:px-6 lg:px-8">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-ds-page-title text-ds-text-primary">360 Question Bank</h1>
            <p className="mt-1 text-[13px] text-ds-text-secondary">Manage feedback questions by reviewer type</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin"
              className="rounded-lg border border-ds-border bg-white px-3 py-2 text-xs font-semibold text-ds-text-secondary hover:bg-ds-surface"
            >
              Back to HR Administration
            </Link>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="rounded-lg bg-ds-accent px-3 py-2 text-xs font-semibold text-white hover:bg-ds-accent-hover"
            >
              + Add question
            </button>
          </div>
        </div>

        {error && <div className="mb-4 rounded-lg border border-ds-error-border bg-ds-error-subtle px-4 py-3 text-sm text-ds-error">{error}</div>}
        {success && <div className="mb-4 rounded-lg border border-ds-success-border bg-ds-success-subtle px-4 py-3 text-sm text-ds-success">{success}</div>}

        <div className="mb-4 rounded-ds-panel border border-ds-border bg-white p-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ds-text-secondary">Rating scale</p>
          <div className="flex flex-wrap gap-2">
            {scale.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center rounded-ds-badge border border-ds-surface-hover bg-ds-surface px-3 py-1 text-xs font-semibold text-ds-info"
              >
                {s.value} {s.label}
              </span>
            ))}
            {scale.length === 0 && <span className="text-xs text-ds-text-secondary">No rating scale configured.</span>}
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveType(t)}
              className={cn(
                "rounded-ds-badge border px-3 py-1.5 text-xs font-semibold",
                activeType === t
                  ? "border-ds-accent bg-ds-success-subtle text-ds-success"
                  : "border-ds-border bg-white text-ds-text-secondary hover:bg-ds-surface"
              )}
            >
              {prettyType(t)}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="rounded-ds-panel border border-ds-border bg-white p-4 text-sm text-ds-text-secondary">Loading questions…</div>
          ) : grouped.length === 0 ? (
            <div className="rounded-ds-panel border border-ds-border bg-white p-6 text-sm text-ds-text-secondary">
              No questions for this reviewer type.
            </div>
          ) : (
            grouped.map(([category, list]) => (
              <section key={category} className="rounded-ds-panel border border-ds-border bg-white">
                <div className="flex items-center justify-between border-b border-ds-surface px-4 py-3">
                  <h2 className="text-sm font-semibold text-ds-text-primary">Category: {category}</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddModal(true);
                      setAddCategoryMode("existing");
                      setAddCategory(category);
                    }}
                    className="text-xs font-semibold text-ds-accent hover:text-ds-accent-hover"
                  >
                    + Add to category
                  </button>
                </div>
                <div className="divide-y divide-ds-surface">
                  {list.map((q) => {
                    const isEditing = editingId === q.id;
                    return (
                      <div
                        key={q.id}
                        draggable
                        onDragStart={() => setDraggingId(q.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (!draggingId) return;
                          void reorderWithinCategory(category, draggingId, q.id);
                          setDraggingId(null);
                        }}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ds-text-secondary">#{q.sort_order}</div>
                          {isEditing ? (
                            <input
                              value={draftText[q.id] ?? q.question_text}
                              onChange={(e) => setDraftText((prev) => ({ ...prev, [q.id]: e.target.value }))}
                              className="w-full rounded-lg border border-ds-border px-3 py-2 text-sm text-ds-text-primary"
                            />
                          ) : (
                            <p className="text-sm text-ds-text-primary">{q.question_text}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => void onSaveInline(q.id)}
                                className="rounded-lg bg-ds-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-ds-accent-hover disabled:opacity-60"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(null);
                                  setDraftText((prev) => ({ ...prev, [q.id]: q.question_text }));
                                }}
                                className="rounded-lg border border-ds-border bg-white px-3 py-1.5 text-xs font-semibold text-ds-text-secondary"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(q.id);
                                  setDraftText((prev) => ({ ...prev, [q.id]: q.question_text }));
                                }}
                                className="rounded-lg border border-ds-border bg-white px-3 py-1.5 text-xs font-semibold text-ds-text-secondary"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => void onDelete(q.id)}
                                className="rounded-lg border border-ds-error-border bg-ds-error-subtle px-3 py-1.5 text-xs font-semibold text-ds-error disabled:opacity-60"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={() => setShowAddModal(false)}>
            <div className="w-full max-w-lg rounded-ds-panel border border-ds-border bg-white p-5 shadow-ds-popover" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base font-semibold text-ds-text-primary">Add question</h3>
              <p className="mt-1 text-xs text-ds-text-secondary">Reviewer type is locked to {prettyType(activeType)}.</p>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ds-text-secondary">Category mode</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAddCategoryMode("existing")}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-semibold",
                        addCategoryMode === "existing"
                          ? "border-ds-accent bg-ds-success-subtle text-ds-success"
                          : "border-ds-border bg-white text-ds-text-secondary"
                      )}
                    >
                      Existing
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddCategoryMode("new")}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-semibold",
                        addCategoryMode === "new"
                          ? "border-ds-accent bg-ds-success-subtle text-ds-success"
                          : "border-ds-border bg-white text-ds-text-secondary"
                      )}
                    >
                      New category
                    </button>
                  </div>
                </div>

                {addCategoryMode === "existing" ? (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ds-text-secondary">Category</label>
                    <select
                      value={addCategory}
                      onChange={(e) => setAddCategory(e.target.value)}
                      className="w-full rounded-lg border border-ds-border px-3 py-2 text-sm"
                    >
                      <option value="">Select category…</option>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ds-text-secondary">New category</label>
                    <input
                      value={addNewCategory}
                      onChange={(e) => setAddNewCategory(e.target.value)}
                      placeholder="e.g. Reliability"
                      className="w-full rounded-lg border border-ds-border px-3 py-2 text-sm"
                    />
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-semibold text-ds-text-secondary">Question text</label>
                  <textarea
                    value={addQuestionText}
                    onChange={(e) => setAddQuestionText(e.target.value)}
                    rows={4}
                    className="w-full rounded-lg border border-ds-border px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-ds-border bg-white px-3 py-2 text-xs font-semibold text-ds-text-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void onCreate()}
                  disabled={saving}
                  className="rounded-lg bg-ds-accent px-3 py-2 text-xs font-semibold text-white hover:bg-ds-accent-hover disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Add question"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
