"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/utils/cn";
import type { ScanReport, ScanSource } from "@/types/evidence";

type SourceKind = "workplan" | "calendar" | "files" | "email" | "other";

export function evidenceSourceKind(name: string): SourceKind {
  const n = name.toLowerCase();
  if (n.includes("appraisal") || n.includes("workplan")) return "workplan";
  if (n.includes("calendar") || n.includes("meeting")) return "calendar";
  if (n.includes("sharepoint") || n.includes("onedrive")) return "files";
  if (n.includes("email") || n.includes("mail")) return "email";
  return "other";
}

const SOURCE_COPY: Record<Exclude<SourceKind, "other">, { label: string; found: string; none: string }> = {
  workplan: {
    label: "workplan",
    found: "Read workplan objectives, tasks and actual entries",
    none: "Read workplan objectives, tasks and actual entries",
  },
  calendar: {
    label: "calendar",
    found: "Relevant calendar activity detected",
    none: "No relevant calendar activity detected",
  },
  files: {
    label: "SharePoint/OneDrive",
    found: "Relevant file activity detected",
    none: "No relevant file activity detected",
  },
  email: {
    label: "sent email",
    found: "Matching sent-email activity detected",
    none: "No matching sent-email activity detected",
  },
};

type Tone = "success" | "muted" | "error";

function sourceStatus(source: ScanSource): { label: string; tone: Tone } {
  if (!source.attempted) return { label: "Not checked", tone: "muted" };
  if (source.status === "error") return { label: "Error", tone: "error" };
  if (source.status === "stub") return { label: "Not connected", tone: "muted" };
  return { label: "Checked", tone: "success" };
}

function sourceExplanation(source: ScanSource): string {
  if (!source.attempted) return "Not checked in this scan";
  if (source.status === "error") return "This source could not be read";
  if (source.status === "stub") return "Not connected yet, so no activity was read";
  const kind = evidenceSourceKind(source.name);
  if (kind === "other") return source.note ?? "";
  return source.collected > 0 ? SOURCE_COPY[kind].found : SOURCE_COPY[kind].none;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function checkedSourcesSentence(report: ScanReport): string {
  const labels = report.sources
    .filter((s) => s.attempted)
    .map((s) => {
      const kind = evidenceSourceKind(s.name);
      return kind === "other" ? s.name : SOURCE_COPY[kind].label;
    });
  return labels.length ? `We checked your ${joinList(labels)} activity.` : "No sources were checked.";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

function SourceIcon({ kind }: { kind: SourceKind }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "workplan":
      return (
        <svg {...common}>
          <rect x="6" y="4" width="12" height="17" rx="2" />
          <path d="M9 4h6v3H9z" />
          <path d="M9 12h6M9 16h4" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      );
    case "files":
      return (
        <svg {...common}>
          <path d="M3.5 7a2 2 0 012-2h4l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2z" />
        </svg>
      );
    case "email":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3.5 6.5l8.5 6 8.5-6" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
        </svg>
      );
  }
}

const TONE_CLASSES: Record<Tone, { badge: string; dot: string }> = {
  success: { badge: "border-ds-success-border bg-ds-success-subtle text-ds-success", dot: "bg-ds-success" },
  muted: { badge: "border-ds-border bg-ds-surface text-ds-text-secondary", dot: "bg-ds-text-secondary" },
  error: { badge: "border-ds-error-border bg-ds-error-subtle text-ds-error", dot: "bg-ds-error" },
};

function Stat({ id, label, value }: { id: string; label: string; value: number }) {
  return (
    <div data-evidence-stat={id} className="rounded-[8px] border border-ds-border bg-ds-surface px-3 py-2">
      <dt className="text-[11px] text-ds-text-secondary">{label}</dt>
      <dd className="mt-0.5 text-[16px] font-semibold leading-tight text-ds-text-primary tabular-nums">{value}</dd>
    </div>
  );
}

export const EVIDENCE_EMPTY_TITLE = "No evidence suggestions found yet";
export const EVIDENCE_EMPTY_BODY =
  "We scanned your connected work sources but did not find strong evidence suggestions for this review period.";

function EmptyHelper() {
  return (
    <ul
      data-evidence-empty-helper
      className="mt-3 space-y-1 rounded-[8px] border border-ds-warning-border bg-ds-warning-subtle px-3 py-2 text-[12px] text-ds-text-secondary"
    >
      <li>You can still add evidence manually.</li>
      <li>Updating Actual YTD entries may improve future scan results.</li>
    </ul>
  );
}

/** Empty outcome when the scan returned no scan report to summarise. */
export function EvidenceEmptyState() {
  return (
    <div data-evidence-empty role="status" className="px-5 py-5">
      <p className="text-[14px] font-semibold text-ds-text-primary">{EVIDENCE_EMPTY_TITLE}</p>
      <p className="mt-0.5 text-[12px] text-ds-text-secondary">{EVIDENCE_EMPTY_BODY}</p>
      <EmptyHelper />
    </div>
  );
}

export function EvidenceScanSummary({ report, suggestionCount }: { report: ScanReport; suggestionCount: number }) {
  const headingId = useId();
  const sourcesChecked = report.sources.filter((s) => s.attempted).length;
  const empty = suggestionCount === 0;
  return (
    <section
      data-evidence-summary
      aria-labelledby={headingId}
      className="border-b border-ds-border px-5 py-4"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          aria-hidden="true"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-ds-success-subtle text-ds-success"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <h4 id={headingId} className="text-[13px] font-semibold text-ds-text-primary">
          Scan complete
        </h4>
        <span className="text-[11px] text-ds-text-secondary">
          · <time dateTime={report.generatedAt}>{formatTime(report.generatedAt)}</time>
        </span>
      </div>

      <div {...(empty ? { "data-evidence-empty": true, role: "status" } : {})}>
        <p data-evidence-result className="mt-2 text-[14px] font-semibold text-ds-text-primary">
          {empty ? EVIDENCE_EMPTY_TITLE : `${plural(suggestionCount, "evidence suggestion")} found`}
        </p>
        <p className="mt-0.5 text-[12px] text-ds-text-secondary">
          {empty ? EVIDENCE_EMPTY_BODY : "Review each suggestion below, then accept, edit or discard it."}
        </p>
      </div>

      <dl data-evidence-stats className="mt-3 grid grid-cols-3 gap-2 max-sm:grid-cols-1">
        <Stat id="sources" label="Sources checked" value={sourcesChecked} />
        <Stat id="collected" label="Total items collected" value={report.totalCollected} />
        <Stat id="suggestions" label="Evidence suggestions found" value={suggestionCount} />
      </dl>

      {empty && <EmptyHelper />}
    </section>
  );
}

export function EvidenceSourceList({ report }: { report: ScanReport }) {
  const headingId = useId();
  return (
    <section data-evidence-sources aria-labelledby={headingId} className="border-b border-ds-border px-5 py-4">
      <h4 id={headingId} className="text-[13px] font-semibold text-ds-text-primary">
        Sources checked
      </h4>
      <p className="mt-0.5 text-[12px] text-ds-text-secondary">{checkedSourcesSentence(report)}</p>
      <ul className="mt-3 divide-y divide-ds-border overflow-hidden rounded-[8px] border border-ds-border">
        {report.sources.map((source) => {
          const kind = evidenceSourceKind(source.name);
          const status = sourceStatus(source);
          const count = source.attempted ? `${plural(source.collected, "item")} found` : "Not checked";
          return (
            <li
              key={source.name}
              data-evidence-source={kind}
              aria-label={`${source.name}: ${status.label}, ${count}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-white px-3 py-2.5"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-ds-surface text-ds-text-secondary"
              >
                <SourceIcon kind={kind} />
              </span>
              <div className="min-w-0 flex-1">
                <p data-source-name className="text-[13px] font-medium text-ds-text-primary">
                  {source.name}
                </p>
                <p data-source-explanation className="text-[12px] text-ds-text-secondary">
                  {sourceExplanation(source)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 max-sm:w-full max-sm:pl-11">
                <span
                  data-source-status={status.tone}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-ds-badge border px-2 py-0.5 text-[11px] font-semibold",
                    TONE_CLASSES[status.tone].badge
                  )}
                >
                  <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", TONE_CLASSES[status.tone].dot)} />
                  {status.label}
                </span>
                <span
                  data-source-count
                  className="min-w-[96px] text-right text-[12px] font-semibold text-ds-text-primary tabular-nums max-sm:text-left"
                >
                  {count}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type StatValue = string | number | null | undefined;

const fmt = (v: StatValue) => (v == null ? "—" : String(v));

function StatGroup({ id, title, stats, children }: { id: string; title: string; stats: Array<[string, StatValue]>; children?: ReactNode }) {
  return (
    <div data-diagnostic-group={id}>
      <h5 className="text-[11px] font-semibold uppercase tracking-[.06em] text-ds-text-secondary">{title}</h5>
      <dl className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div
            key={label}
            data-diagnostic-stat={label}
            className="flex items-baseline justify-between gap-2 rounded-[6px] border border-ds-border bg-white px-2.5 py-1.5"
          >
            <dt className="text-[11px] text-ds-text-secondary">{label}</dt>
            <dd className="text-[12px] font-semibold text-ds-text-primary tabular-nums">{fmt(value)}</dd>
          </div>
        ))}
      </dl>
      {children}
    </div>
  );
}

type Diagnosis = Record<string, unknown>;

type AppraisalDiag = {
  workplanItemsConsidered?: number;
  rowsWithActualResult?: number;
  rowsTaskOnly?: number;
  stored?: number;
  activityDateRange?: string;
};
type CalendarDiag = { graphEventsReturned?: number; stored?: number; dropped?: Record<string, number> };
type SharePointDiag = { oneDrive?: { raw?: number; stored?: number }; sharePoint?: { raw?: number; stored?: number } };
type ClusteringDiag = {
  itemsInWindow?: number;
  rawClusterCount?: number;
  qualifyingClusterCount?: number;
  disqualified?: Array<{ topic: string; itemCount: number; score: number; reason: string }>;
};

export function EvidenceScanDetails({ report, diagnosis }: { report: ScanReport | null; diagnosis: Diagnosis | null }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const appraisal = diagnosis?.appraisal as AppraisalDiag | undefined;
  const calendar = diagnosis?.calendar as CalendarDiag | undefined;
  const sharePoint = diagnosis?.sharePoint as SharePointDiag | undefined;
  const clustering = diagnosis?.clustering as ClusteringDiag | undefined;
  const dropped = calendar?.dropped ? Object.entries(calendar.dropped).filter(([, v]) => v > 0) : [];

  return (
    <section data-evidence-details className="bg-ds-surface px-5 py-3">
      <h4>
        <button
          type="button"
          data-evidence-details-toggle
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ds-text-secondary transition-colors duration-150 hover:text-ds-text-primary"
        >
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={cn("transition-transform duration-150", open && "rotate-90")}
          >
            <polyline points="9 6 15 12 9 18" />
          </svg>
          Technical details
        </button>
      </h4>

      {open && (
        <div id={panelId} data-evidence-details-panel className="mt-3 space-y-4 pb-1">
          {report && (
            <div data-diagnostic-group="sources">
              <h5 className="text-[11px] font-semibold uppercase tracking-[.06em] text-ds-text-secondary">
                Sources checked · {formatTime(report.generatedAt)}
              </h5>
              <p className="mt-0.5 text-[11px] text-ds-text-secondary">
                {report.totalCollected} total items collected
              </p>
              <dl className="mt-1.5 divide-y divide-ds-border overflow-hidden rounded-[6px] border border-ds-border bg-white">
                {report.sources.map((source) => (
                  <div key={source.name} data-diagnostic-source={source.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2.5 py-1.5">
                    <dt className="text-[12px] font-medium text-ds-text-primary">{source.name}</dt>
                    <dd className="text-[11px] text-ds-text-secondary">
                      {source.status} · {source.attempted ? `${source.collected} item${source.collected !== 1 ? "s" : ""}` : "Not attempted"}
                      {source.note ? ` · ${source.note}` : ""}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {appraisal && (
            <StatGroup
              id="appraisal"
              title="Appraisal collector"
              stats={[
                ["Workplan items", appraisal.workplanItemsConsidered],
                ["With actual result", appraisal.rowsWithActualResult],
                ["Task only", appraisal.rowsTaskOnly],
                ["Stored", appraisal.stored],
              ]}
            >
              {appraisal.activityDateRange && (
                <p className="mt-1 text-[11px] text-ds-text-secondary">Dates: {appraisal.activityDateRange}</p>
              )}
            </StatGroup>
          )}

          {calendar && (
            <StatGroup
              id="calendar"
              title="Calendar collector"
              stats={[
                ["From Graph", calendar.graphEventsReturned],
                ["Stored", calendar.stored],
                ...dropped.map(([k, v]) => [`Dropped: ${k}`, v] as [string, StatValue]),
              ]}
            />
          )}

          {sharePoint && (
            <StatGroup
              id="sharePoint"
              title="SharePoint / OneDrive collector"
              stats={[
                ["OneDrive raw", sharePoint.oneDrive?.raw ?? 0],
                ["OneDrive stored", sharePoint.oneDrive?.stored ?? 0],
                ["SharePoint raw", sharePoint.sharePoint?.raw ?? 0],
                ["SharePoint stored", sharePoint.sharePoint?.stored ?? 0],
              ]}
            />
          )}

          {clustering && (
            <StatGroup
              id="clustering"
              title="Clustering engine"
              stats={[
                ["In window", clustering.itemsInWindow],
                ["Raw clusters", clustering.rawClusterCount],
                ["Qualifying", clustering.qualifyingClusterCount],
              ]}
            >
              {(clustering.disqualified?.length ?? 0) > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {clustering.disqualified!.map((d, i) => (
                    <li
                      key={i}
                      data-diagnostic-disqualified
                      className="flex flex-wrap items-center gap-x-2 rounded-[6px] border border-ds-border bg-white px-2.5 py-1.5 text-[11px] text-ds-text-secondary"
                    >
                      <span className="max-w-[200px] truncate font-medium text-ds-text-primary">&quot;{d.topic}&quot;</span>
                      <span>
                        {d.itemCount} items · score {d.score} · {d.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </StatGroup>
          )}
        </div>
      )}
    </section>
  );
}
