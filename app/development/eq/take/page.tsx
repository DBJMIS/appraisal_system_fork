"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { COMPETENCY_LABELS, SCALE_LABELS, calculateTotals, type EQQuestion } from "@/lib/eq-questions";

const PAGES = 5;
const PER_PAGE = 10;

export default function EQTakePage() {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [responses, setResponses] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [questions, setQuestions] = useState<EQQuestion[]>([]);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const saveTimer = useRef<NodeJS.Timeout>();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/development/eq")
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error ?? "Failed to load EQ questions");
        }
        return res.json();
      })
      .then((d) => {
        if (!cancelled) {
          if (Array.isArray(d.questions)) setQuestions(d.questions);
          if (d.draft) {
            setResponses(d.draft.responses ?? {});
            setPage(d.draft.last_page ?? 0);
          }
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load EQ questions");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDraft(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loadingDraft) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/development/eq", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses, last_page: page }),
      });
    }, 1000);
    return () => clearTimeout(saveTimer.current);
  }, [responses, page, loadingDraft]);

  const pageQs = questions.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const pageAnswered = pageQs.filter((q) => responses[q.id]).length;
  const totalAnswered = Object.keys(responses).length;
  const pageComplete = pageAnswered === PER_PAGE;
  const isLast = page === PAGES - 1;

  async function handleSubmit() {
    if (totalAnswered < 50) return;
    setSubmitting(true);
    try {
      const totals = calculateTotals(responses, questions);
      const res = await fetch("/api/development/eq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sa_total: totals.SA,
          me_total: totals.ME,
          mo_total: totals.MO,
          e_total: totals.E,
          ss_total: totals.SS,
          responses,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error);
      }
      router.push("/development");
    } catch (e: any) {
      setError(e.message ?? "Submission failed. Please try again.");
      setSubmitting(false);
    }
  }

  if (loadingDraft) {
    return (
      <main className="flex-1 overflow-auto p-6 md:p-8" style={{ backgroundColor: "var(--surface)" }}>
        <div className="mx-auto max-w-3xl pt-20 flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-ds-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-[13px] text-ds-text-secondary">Loading your progress...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-auto p-6 md:p-8" style={{ backgroundColor: "var(--surface)" }}>
      <div className="space-y-5">
        <Link
          href="/development"
          className="inline-flex items-center gap-1.5 text-[13px] text-ds-text-secondary hover:text-ds-text-primary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Development Profile
        </Link>

        <div className="flex items-start gap-4">
          <div
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-ds-panel"
            style={{ background: "#f3f3f3" }}
          >
            <svg className="h-6 w-6 text-ds-accent" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="pt-0.5">
            <h1 className="text-ds-page-title text-ds-text-primary">EQ Assessment</h1>
            <p className="text-[13px] text-ds-text-secondary mt-1">
              {totalAnswered}/50 answered · Page {page + 1} of {PAGES}
            </p>
          </div>
        </div>

        <div className="rounded-ds-panel border border-ds-border bg-white overflow-hidden">
          <div className="px-6 py-3 bg-ds-surface border-b border-ds-border flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">Scale:</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className="text-[11px] text-ds-text-secondary">
                <strong className="text-ds-text-primary font-semibold">{n}</strong> = {SCALE_LABELS[n]}
              </span>
            ))}
          </div>

          <div className="px-6 pt-4 pb-2">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">Overall progress</span>
              <span className="text-[11px] font-semibold text-ds-text-primary">{totalAnswered}/50</span>
            </div>
            <div className="h-[4px] bg-ds-surface rounded-full overflow-hidden">
              <div className="h-full bg-ds-accent rounded-full transition-all" style={{ width: `${(totalAnswered / 50) * 100}%` }} />
            </div>
          </div>

          <div className="divide-y divide-ds-surface px-6">
            {pageQs.map((q) => (
              <div key={q.id} className="py-4">
                <div className="flex items-start gap-3 mb-3">
                  <span className="text-[11px] text-ds-border-strong font-mono mt-0.5 w-5 shrink-0 text-right">{q.id}</span>
                  <p className="text-[13.5px] text-ds-text-primary leading-relaxed flex-1">{q.text}</p>
                  <span
                    title={COMPETENCY_LABELS[q.competency]}
                    className="text-[9px] font-semibold uppercase tracking-wider text-ds-text-secondary shrink-0 mt-0.5 w-5 text-right"
                  >
                    {q.competency}
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-8">
                  {[1, 2, 3, 4, 5].map((val) => (
                    <button
                      key={val}
                      onClick={() => setResponses((prev) => ({ ...prev, [q.id]: val }))}
                      className={`w-9 h-9 rounded-full border-2 text-[12px] font-semibold transition-all ${
                        responses[q.id] === val
                          ? "bg-ds-accent border-ds-accent text-white"
                          : "border-ds-border text-ds-text-secondary hover:border-ds-accent hover:text-ds-accent bg-white"
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                  {responses[q.id] && <span className="text-[11px] text-ds-text-secondary ml-1">{SCALE_LABELS[responses[q.id]]}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="px-6 py-4 bg-ds-surface border-t border-ds-border flex items-center justify-between">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[8px] border border-ds-border text-[12px] font-semibold text-ds-text-secondary hover:text-ds-text-primary hover:border-ds-text-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-white"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Previous
            </button>

            <span className="text-[10px] text-ds-text-secondary">{totalAnswered > 0 ? "Progress saved automatically" : ""}</span>

            <div className="flex gap-1.5 items-center">
              {Array.from({ length: PAGES }).map((_, i) => (
                <div
                  key={i}
                  className={`rounded-full transition-all ${
                    i < page ? "w-5 h-1.5 bg-ds-accent" : i === page ? "w-5 h-1.5 bg-ds-text-primary" : "w-1.5 h-1.5 bg-ds-border"
                  }`}
                />
              ))}
            </div>

            {!isLast ? (
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!pageComplete}
                className={`flex items-center gap-1.5 px-5 py-2 rounded-[8px] text-[12px] font-sans font-semibold transition-colors ${
                  pageComplete ? "bg-ds-accent text-white hover:bg-ds-accent-hover" : "bg-ds-border text-ds-text-secondary cursor-not-allowed"
                }`}
              >
                Next
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={totalAnswered < 50 || submitting}
                className={`flex items-center gap-2 px-5 py-2 rounded-[8px] text-[12px] font-sans font-semibold transition-colors ${
                  totalAnswered === 50 && !submitting
                    ? "bg-ds-accent text-white hover:bg-ds-accent-hover"
                    : "bg-ds-border text-ds-text-secondary cursor-not-allowed"
                }`}
              >
                {submitting ? "Submitting…" : "Submit assessment"}
              </button>
            )}
          </div>

          {error && <p className="px-6 pb-4 text-[12px] text-ds-error text-center">{error}</p>}
        </div>
      </div>
    </main>
  );
}
