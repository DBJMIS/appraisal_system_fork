"use client";

import { useState, useCallback, useEffect, useId, useRef } from "react";
import { cn } from "@/utils/cn";
import type { ScanReport } from "@/types/evidence";
import {
  EvidenceEmptyState,
  EvidenceScanDetails,
  EvidenceScanSummary,
  EvidenceSourceList,
} from "@/components/appraisal/EvidenceScanResults";

interface EvidenceBuilderProps {
  appraisalId: string;
  employeeId: string;
  reviewStart: string;
  reviewEnd: string;
  status: string;
  onAccept?: (text: string) => void;
}

interface Suggestion {
  id: string;
  achievement_text: string;
  confidence_level: string;
  evidence_summary: string[];
}

type State = "idle" | "loading" | "results" | "empty" | "error";

/** Delay before the scanning helper text switches to the long-running reassurance. */
export const EVIDENCE_SCAN_SLOW_MS = 8000;

/**
 * The scan is a single request with no progress events, so this is always an
 * indeterminate indicator: no percentage, no current value, no simulated steps.
 */
function EvidenceScanProgress({ slow }: { slow: boolean }) {
  return (
    <div
      data-evidence-scanning
      aria-busy="true"
      className="px-5 py-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
    >
      <div className="mx-auto flex max-w-[420px] flex-col items-center text-center">
        <div role="status" aria-live="polite" className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <svg
              data-evidence-spinner
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              className="shrink-0 text-ds-text-secondary motion-safe:animate-spin"
            >
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <p className="text-[13px] font-semibold text-ds-text-primary">Scanning your work activity</p>
          </div>
          <p className="mt-1 text-[12px] text-ds-text-secondary">
            Checking your workplan and connected sources for relevant achievements…
          </p>
        </div>

        <div
          data-evidence-progress
          role="progressbar"
          aria-label="Evidence scan in progress"
          aria-valuetext="Scanning"
          className="relative mt-3 h-1 w-full max-w-[280px] overflow-hidden rounded-full bg-ds-border"
        >
          <div className="h-full w-full origin-left rounded-full bg-ds-text-secondary motion-safe:animate-[indeterminate_1.5s_ease-in-out_infinite] motion-reduce:opacity-40" />
        </div>

        <p
          data-evidence-scan-helper
          aria-live="polite"
          className="mt-2 text-[11px] text-ds-text-secondary transition-opacity duration-150"
        >
          {slow
            ? "Still scanning — this can take a little longer when there is more activity to review."
            : "This may take a moment."}
        </p>
      </div>
    </div>
  );
}

export function EvidenceBuilder({
  appraisalId,
  employeeId,
  reviewStart,
  reviewEnd,
  status,
  onAccept,
}: EvidenceBuilderProps) {
  const [state, setState] = useState<State>("idle");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const suggestionsRef = useRef<Suggestion[]>([]);
  const suggestionsHeadingId = useId();
  const [scanFoundCount, setScanFoundCount] = useState(0);
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
  const [diagnosis, setDiagnosis] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slowScan, setSlowScan] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status !== "SELF_ASSESSMENT" || !appraisalId || !employeeId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/evidence/suggestions?appraisalId=${encodeURIComponent(appraisalId)}&employeeId=${encodeURIComponent(employeeId)}`
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        const list = (data.suggestions ?? []) as Suggestion[];
        setSuggestions(list);
        if (list.length > 0) setState("results");
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, appraisalId, employeeId]);

  useEffect(() => {
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  useEffect(() => {
    if (state !== "loading") {
      setSlowScan(false);
      return;
    }
    const timer = setTimeout(() => setSlowScan(true), EVIDENCE_SCAN_SLOW_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const generate = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/evidence/generate-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          appraisalId,
          reviewStart,
          reviewEnd,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate");
      const newList = (data.suggestions ?? []) as Suggestion[];
      const byId = new Map(suggestionsRef.current.map((s) => [s.id, s]));
      for (const s of newList) byId.set(s.id, s);
      const merged = [...byId.values()];
      setSuggestions(merged);
      setScanFoundCount(merged.length);
      setScanReport(data.scanReport ?? null);
      setDiagnosis(data.diagnosis ?? null);
      setState(merged.length > 0 ? "results" : "empty");
    } catch {
      setState("error");
    }
  }, [employeeId, appraisalId, reviewStart, reviewEnd]);

  const updateStatus = useCallback(
    async (id: string, newStatus: "accepted" | "edited" | "rejected", editedText?: string) => {
      const s = suggestions.find((x) => x.id === id);
      if (!s) return;
      try {
        const res = await fetch(`/api/evidence/suggestions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: newStatus,
            edited_text: newStatus === "edited" ? editedText : undefined,
          }),
        });
        if (!res.ok) throw new Error("Failed");
        setSuggestions((prev) => prev.filter((x) => x.id !== id));
        if (newStatus === "accepted" || newStatus === "edited") {
          const text = newStatus === "edited" && editedText ? editedText : s.achievement_text;
          onAccept?.(text);
          try {
            await fetch(`/api/appraisals/${appraisalId}/summary/append-achievement`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text }),
            });
          } catch {
            // append API may not exist yet; onAccept still fired
          }
        }
      } catch {
        setError("Failed to update");
      }
    },
    [suggestions, onAccept, appraisalId]
  );

  if (status !== "SELF_ASSESSMENT") return null;

  const scanComplete = state === "results" || state === "empty";

  return (
    <div
      className="mb-6 overflow-hidden rounded-ds-panel border border-ds-border bg-white"
      style={{ boxShadow: "none" }}
    >
      <div
        className="flex items-start justify-between gap-4 border-b border-ds-border px-5 py-4"
        style={{ background: "#f3f3f3" }}
      >
        <div>
          <h3 className="font-sans text-[15px] font-semibold text-ds-text-primary">AI Evidence Builder</h3>
          <p className="mt-0.5 text-[12px] text-ds-text-secondary">
            Automatically detect achievements from your work activity during this review period.
          </p>
        </div>
        {state === "idle" && (
          <button
            type="button"
            onClick={generate}
            className="shrink-0 rounded-[8px] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:opacity-90"
            style={{ background: "#0d0e10" }}
          >
            Generate
          </button>
        )}
      </div>

      {error && (
        <div className="border-b border-ds-warning-border bg-ds-warning-subtle px-5 py-3 text-[13px] text-ds-warning">
          {error}
        </div>
      )}

      {state === "loading" && <EvidenceScanProgress slow={slowScan} />}

      {state === "error" && (
        <div
          data-evidence-scan-error
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150"
        >
          <div className="flex items-center gap-2 text-[13px] text-ds-error">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            We couldn&apos;t complete the evidence scan.
          </div>
          <button
            type="button"
            data-evidence-retry
            onClick={generate}
            className="shrink-0 rounded-[8px] border border-ds-border bg-white px-3 py-1.5 text-[12px] font-semibold text-ds-text-primary transition-colors duration-150 hover:border-ds-text-primary"
          >
            Try again
          </button>
        </div>
      )}

      {scanComplete && scanReport && (
        <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
          <EvidenceScanSummary report={scanReport} suggestionCount={scanFoundCount} />
        </div>
      )}

      {state === "empty" && !error && !scanReport && <EvidenceEmptyState />}

      {state === "results" && suggestions.length > 0 && (
        <section
          data-evidence-results
          aria-labelledby={scanReport ? suggestionsHeadingId : undefined}
          className="border-b border-ds-border p-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
        >
          {scanReport && (
            <h4 id={suggestionsHeadingId} className="mb-3 px-1 text-[13px] font-semibold text-ds-text-primary">
              Suggested evidence
            </h4>
          )}
          {suggestions.map((s) => {
            const editing = editingId === s.id;
            const showEvidence = expandedId === s.id;
            const handleAccept = (text: string, kind: "accepted" | "edited") => {
              setSaving(true);
              updateStatus(s.id, kind, kind === "edited" ? text : undefined)
                .then(() => { if (kind === "edited") { setEditingId(null); setEditText(""); } })
                .finally(() => setSaving(false));
            };
            const handleDiscard = () => {
              setSaving(true);
              updateStatus(s.id, "rejected").finally(() => setSaving(false));
            };
            return (
              <div
                key={s.id}
                className="bg-white border border-ds-border rounded-ds-panel overflow-hidden mb-3"
              >
                <div
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 border-b border-ds-border",
                    s.confidence_level === "high" && "bg-ds-success-subtle",
                    s.confidence_level === "medium" && "bg-ds-warning-subtle",
                    s.confidence_level === "low" && "bg-ds-surface"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-ds-badge text-[10px] font-semibold border",
                      s.confidence_level === "high" && "bg-ds-success-subtle border-ds-success-border text-ds-success",
                      s.confidence_level === "medium" && "bg-ds-warning-subtle border-ds-warning-border text-ds-warning",
                      s.confidence_level === "low" && "bg-ds-surface border-ds-border text-ds-text-secondary"
                    )}
                  >
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        s.confidence_level === "high" && "bg-ds-success",
                        s.confidence_level === "medium" && "bg-ds-warning",
                        s.confidence_level === "low" && "bg-ds-text-secondary"
                      )}
                    />
                    {s.confidence_level.charAt(0).toUpperCase() + s.confidence_level.slice(1)} confidence
                  </span>
                </div>

                <div className="px-4 py-4">
                  {editing ? (
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      className="w-full text-[13px] text-ds-text-primary leading-relaxed border border-ds-border rounded-[8px] p-3 outline-none focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10 resize-none mb-3"
                    />
                  ) : (
                    <p className="text-[13px] font-medium text-ds-text-primary leading-relaxed mb-3">
                      {s.achievement_text}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => setExpandedId(showEvidence ? null : s.id)}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ds-accent hover:text-ds-info transition-colors mb-2"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {showEvidence ? (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </>
                      ) : (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                    {showEvidence ? "Hide evidence" : "View evidence"}
                  </button>

                  {showEvidence && (
                    <ul className="mb-4 space-y-1.5 pl-1">
                      {(s.evidence_summary as string[]).map((bullet, i) => (
                        <li key={i} className="flex items-start gap-2 text-[11px] text-ds-text-secondary">
                          <span className="w-1.5 h-1.5 rounded-full bg-ds-text-secondary flex-shrink-0 mt-[5px]" />
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex items-center gap-2 pt-3 border-t border-ds-border">
                    {editing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleAccept(editText, "edited")}
                          disabled={saving}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] bg-ds-accent text-white text-[11px] font-semibold hover:bg-ds-accent-hover transition-colors disabled:opacity-50"
                        >
                          {saving ? "Saving…" : "Save & accept"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingId(null); setEditText(""); }}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] border border-ds-border text-[11px] font-semibold text-ds-text-secondary hover:border-ds-text-primary hover:text-ds-text-primary transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleAccept(s.achievement_text, "accepted")}
                          disabled={saving}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] bg-ds-accent text-white text-[11px] font-semibold hover:bg-ds-accent-hover transition-colors disabled:opacity-50"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingId(s.id); setEditText(s.achievement_text); }}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] border border-ds-border text-[11px] font-semibold text-ds-text-secondary hover:border-ds-text-primary hover:text-ds-text-primary transition-colors"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={handleDiscard}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] border border-ds-error-border text-[11px] font-semibold text-ds-error hover:bg-ds-error-subtle transition-colors ml-auto"
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                          Discard
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {scanComplete && scanReport && <EvidenceSourceList report={scanReport} />}

      {scanComplete && (scanReport || diagnosis) && process.env.NEXT_PUBLIC_EVIDENCE_DEBUG === "true" && (
        <EvidenceScanDetails report={scanReport} diagnosis={diagnosis} />
      )}

    </div>
  );
}
