"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import type { CheckInCompetencyRating, ObjectiveStatus } from "@/types/checkins";
import { statusToneClasses, type StatusTone } from "@/lib/appraisal-status-display";
import { formatMidyearDate } from "@/lib/midyear-config";
import {
  COMPETENCY_SECTIONS,
  RATING_CODES,
  midyearEmployeeResult,
  midyearManagerResult,
  type AssessmentOwner,
  type CompetencySection,
  type WorkplanMetricSource,
} from "@/lib/midyear-assessment";

const SECTION_LABELS: Record<CompetencySection, string> = {
  CORE: "Core Competencies",
  PRODUCTIVITY: "Productivity",
  TECHNICAL: "Technical",
  LEADERSHIP: "Leadership",
};

/** Small column caption; the desktop grids show a header row instead. */
export const MIDYEAR_CAPTION = "text-[10px] font-medium uppercase tracking-[.06em] text-ds-text-muted";
export const MIDYEAR_CONTROL =
  "h-7 rounded-[6px] border border-ds-border bg-white px-2 text-[12px] text-ds-text-primary outline-none transition-colors focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10";
export const MIDYEAR_TABLE = "rounded-[8px] border border-ds-border bg-white";
export const MIDYEAR_TABLE_HEAD =
  "border-b border-ds-border bg-ds-surface px-3 py-1.5 text-[11px] font-medium text-ds-text-secondary";

export interface WorkplanActualDraft {
  actual_raw: number | null;
  completion_date: string | null;
}

export type RatingScale = Array<{ code: string; label: string }>;

export function metricKind(source: WorkplanMetricSource): "NUMBER" | "DATE" | "PERCENT" {
  const t = (source.metric_type ?? "").toUpperCase();
  return t === "NUMBER" || t === "DATE" ? t : "PERCENT";
}

export function midyearWorkplanResult(owner: AssessmentOwner, source: WorkplanMetricSource, value: WorkplanActualDraft) {
  return owner === "employee" ? midyearEmployeeResult(source, value) : midyearManagerResult(source, value);
}

export const formatMidyearResult = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100) / 100}%`);

/** Textarea that starts at `minRows` and grows with its content up to `maxHeight`. */
export function CompactTextarea({
  minRows = 1,
  maxHeight = 160,
  className = "",
  value,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; maxHeight?: number; value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight is 0 while hidden (and in jsdom); keep the rows-based height then.
    if (el.scrollHeight === 0) {
      el.style.removeProperty("height");
      return;
    }
    el.style.height = `${Math.min(el.scrollHeight + 2, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight + 2 > maxHeight ? "auto" : "hidden";
  }, [value, maxHeight]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      className={`block w-full resize-none rounded-[6px] border border-ds-border bg-white px-2 py-[4px] text-[12px] leading-[18px] text-ds-text-primary outline-none transition-colors placeholder:text-ds-text-muted focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10 ${className}`}
      {...rest}
    />
  );
}

export const OBJECTIVE_STATUS: Record<ObjectiveStatus, { label: string; tone: StatusTone }> = {
  ON_TRACK: { label: "On track", tone: "success" },
  AT_RISK: { label: "At risk", tone: "warning" },
  BEHIND: { label: "Behind", tone: "attention" },
  COMPLETE: { label: "Complete", tone: "success" },
};

/** Read-only tracking status; `null` renders the manager's implicit agreement when `agreed` is set. */
export function StatusTag({ status, agreed = false }: { status: ObjectiveStatus | null | undefined; agreed?: boolean }) {
  const cfg = status ? OBJECTIVE_STATUS[status] : agreed ? { label: "Agreed", tone: "success" as StatusTone } : null;
  if (!cfg) return <span className="text-[11px] text-ds-text-muted">No status</span>;
  return (
    <span
      data-midyear-status-tag
      className={`inline-flex items-center rounded-ds-badge border px-1.5 py-px text-[10px] font-medium leading-4 ${statusToneClasses[cfg.tone].badge}`}
    >
      {cfg.label}
    </span>
  );
}

const SEGMENT_SELECTED: Partial<Record<StatusTone, string>> = {
  success: "bg-ds-success-subtle text-ds-success ring-1 ring-inset ring-ds-success-border",
  warning: "bg-ds-warning-subtle text-ds-warning ring-1 ring-inset ring-ds-warning-border",
  attention: "bg-ds-error-subtle text-ds-error ring-1 ring-inset ring-ds-error-border",
};

/** Compact single-choice control; the selected segment carries the status tone. */
export function SegmentedControl<T extends string | null>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string; tone: StatusTone }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-midyear-segmented
      className="flex w-full rounded-[6px] border border-ds-border bg-white p-0.5"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.label}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            className={`h-6 min-w-0 flex-1 whitespace-nowrap rounded-[4px] px-1.5 text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#0d0e10]/30 ${
              selected
                ? `font-semibold ${SEGMENT_SELECTED[o.tone] ?? "bg-ds-text-primary text-white"}`
                : "font-medium text-ds-text-secondary hover:bg-ds-surface hover:text-ds-text-primary"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Actual value or completion date for one objective, sized for a table cell. */
export function MidyearActualInput({
  owner,
  source,
  value,
  onChange,
  label,
}: {
  owner: AssessmentOwner;
  source: WorkplanMetricSource;
  value: WorkplanActualDraft;
  onChange: (value: WorkplanActualDraft) => void;
  label: string;
}) {
  const kind = metricKind(source);
  return (
    <div data-midyear-workplan-input={owner} className="flex items-center gap-1.5">
      {kind === "DATE" ? (
        <input
          type="date"
          data-midyear-completion-date
          aria-label={`${label} completion date`}
          value={value.completion_date ?? ""}
          onChange={(e) => onChange({ ...value, completion_date: e.target.value || null })}
          className={`${MIDYEAR_CONTROL} w-full max-w-[140px]`}
        />
      ) : (
        <>
          <input
            type="number"
            inputMode="decimal"
            data-midyear-actual
            aria-label={`${label} actual ${kind === "PERCENT" ? "percentage" : "value"}`}
            min={0}
            max={kind === "PERCENT" ? 100 : undefined}
            value={value.actual_raw ?? ""}
            onChange={(e) => onChange({ ...value, actual_raw: e.target.value === "" ? null : Number(e.target.value) })}
            className={`${MIDYEAR_CONTROL} w-[72px] text-right tabular-nums`}
          />
          <span className="whitespace-nowrap text-[12px] text-ds-text-secondary">
            {kind === "PERCENT" ? "%" : source.metric_target != null ? `/ ${source.metric_target}` : ""}
          </span>
        </>
      )}
    </div>
  );
}

/** Read-only actual and result for one party. */
export function MidyearWorkplanSummary({
  source,
  actual,
  completionDate,
  result,
}: {
  source: WorkplanMetricSource;
  actual: number | null | undefined;
  completionDate: string | null | undefined;
  result: number | null | undefined;
}) {
  const kind = metricKind(source);
  const shown = kind === "DATE" ? formatMidyearDate(completionDate) ?? "—" : actual ?? "—";
  return (
    <span data-midyear-summary className="text-[12px] tabular-nums text-ds-text-primary">
      {kind === "DATE" ? "Completed" : "Actual"}: {shown} · Result: {formatMidyearResult(result)}
    </span>
  );
}

export interface CompetencyDraft {
  rating?: string | null;
  comment?: string | null;
}

const OWNER_FIELDS = {
  employee: { rating: "employee_rating_code", comment: "employee_comment" },
  manager: { rating: "manager_rating_code", comment: "manager_comment" },
} as const;

function currentValue(row: CheckInCompetencyRating, owner: AssessmentOwner, draft: CompetencyDraft | undefined) {
  const f = OWNER_FIELDS[owner];
  return {
    rating: draft && "rating" in draft ? draft.rating ?? null : row[f.rating],
    comment: draft && "comment" in draft ? draft.comment ?? null : row[f.comment],
  };
}

/** Request payload for the owner's competency inputs. */
export function competencyPayload(
  ratings: CheckInCompetencyRating[],
  drafts: Record<string, CompetencyDraft>,
  owner: AssessmentOwner
) {
  const f = OWNER_FIELDS[owner];
  return ratings.map((row) => {
    const v = currentValue(row, owner, drafts[row.id]);
    return { id: row.id, [f.rating]: v.rating, [f.comment]: v.comment };
  });
}

/** How many competencies currently carry a rating from `owner` (including unsaved edits). */
export function ratedCompetencyCount(
  ratings: CheckInCompetencyRating[],
  drafts: Record<string, CompetencyDraft>,
  owner: AssessmentOwner
) {
  return ratings.filter((row) => currentValue(row, owner, drafts[row.id]).rating).length;
}

function ratingText(code: string | null, scale?: RatingScale) {
  if (!code) return "—";
  const label = scale?.find((s) => s.code === code)?.label;
  return label ? `${code} · ${label}` : `${code}/10`;
}

function RatingValue({
  party,
  code,
  comment,
  scale,
  captionClass,
}: {
  party: AssessmentOwner;
  code: string | null;
  comment: string | null;
  scale?: RatingScale;
  captionClass: string;
}) {
  return (
    <div
      {...(party === "employee" ? { "data-midyear-employee-rating": "" } : { "data-midyear-manager-rating": "" })}
      className="min-w-0 text-[12px] leading-[18px]"
    >
      <span className={`${MIDYEAR_CAPTION} mr-1.5 ${captionClass}`}>{party === "employee" ? "Employee" : "Manager"}</span>
      <span className={code ? "text-ds-text-primary" : "text-ds-text-muted"}>{ratingText(code, scale)}</span>
      {comment && <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-ds-text-secondary">{comment}</p>}
    </div>
  );
}

type GridMode = "employee" | "manager" | "readonly";

interface GridClasses {
  row: string;
  head: string;
  columns: string[];
  /** Name cell: stacks name + weight on narrow screens, name only once the grid applies. */
  name: string;
  mobileOnly: string;
  desktopOnly: string;
  cellPad: string;
}

const MD_BREAK = { mobileOnly: "md:hidden", desktopOnly: "hidden md:block", name: "md:block md:pt-[5px]", cellPad: "md:pt-[5px]" };
const LG_BREAK = { mobileOnly: "lg:hidden", desktopOnly: "hidden lg:block", name: "lg:block lg:pt-[5px]", cellPad: "lg:pt-[5px]" };

const COMPETENCY_GRID: Record<GridMode, GridClasses> = {
  employee: {
    row: "md:grid md:grid-cols-[minmax(0,1.3fr)_56px_200px_minmax(0,1.7fr)] md:items-start md:gap-3",
    head: "hidden md:grid md:grid-cols-[minmax(0,1.3fr)_56px_200px_minmax(0,1.7fr)] md:gap-3",
    columns: ["Competency", "Weight", "Rating", "Comment"],
    ...MD_BREAK,
  },
  manager: {
    row: "lg:grid lg:grid-cols-[minmax(0,1.2fr)_56px_minmax(0,1fr)_200px_minmax(0,1.4fr)] lg:items-start lg:gap-3",
    head: "hidden lg:grid lg:grid-cols-[minmax(0,1.2fr)_56px_minmax(0,1fr)_200px_minmax(0,1.4fr)] lg:gap-3",
    columns: ["Competency", "Weight", "Employee", "Your rating", "Comment"],
    ...LG_BREAK,
  },
  readonly: {
    row: "md:grid md:grid-cols-[minmax(0,1.3fr)_56px_minmax(0,1fr)_minmax(0,1fr)] md:items-start md:gap-3",
    head: "hidden md:grid md:grid-cols-[minmax(0,1.3fr)_56px_minmax(0,1fr)_minmax(0,1fr)] md:gap-3",
    columns: ["Competency", "Weight", "Employee", "Manager"],
    ...MD_BREAK,
  },
};

/**
 * Mid-Year competency ratings as one grid grouped by section. `editable` is the party entering
 * values; null renders everything read-only.
 */
export function MidyearCompetencyList({
  ratings,
  editable,
  drafts = {},
  onChange,
  ratingScale,
}: {
  ratings: CheckInCompetencyRating[];
  editable: AssessmentOwner | null;
  drafts?: Record<string, CompetencyDraft>;
  onChange?: (id: string, patch: CompetencyDraft) => void;
  ratingScale?: RatingScale;
}) {
  if (ratings.length === 0) return null;
  const options = ratingScale?.length ? ratingScale : RATING_CODES.map((code) => ({ code, label: "" }));
  const mode: GridMode = editable ?? "readonly";
  const grid = COMPETENCY_GRID[mode];
  return (
    <div data-midyear-competencies data-midyear-competency-grid={mode} className={MIDYEAR_TABLE}>
      <div data-midyear-grid-head className={`${MIDYEAR_TABLE_HEAD} rounded-t-[8px] ${grid.head}`}>
        {grid.columns.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="divide-y divide-ds-border">
        {COMPETENCY_SECTIONS.map((section) => {
          const rows = ratings
            .filter((r) => r.section === section)
            .sort((a, b) => a.display_order - b.display_order);
          if (rows.length === 0) return null;
          return (
            <div key={section} data-midyear-competency-section={section}>
              <p className="bg-ds-surface px-3 py-1 text-[11px] font-semibold text-ds-text-primary">{SECTION_LABELS[section]}</p>
              <div className="divide-y divide-ds-border border-t border-ds-border">
                {rows.map((row) => (
                  <CompetencyRow
                    key={row.id}
                    row={row}
                    grid={grid}
                    editable={editable}
                    drafts={drafts}
                    onChange={onChange}
                    options={options}
                    ratingScale={ratingScale}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompetencyRow({
  row,
  grid,
  editable,
  drafts,
  onChange,
  options,
  ratingScale,
}: {
  row: CheckInCompetencyRating;
  grid: GridClasses;
  editable: AssessmentOwner | null;
  drafts: Record<string, CompetencyDraft>;
  onChange?: (id: string, patch: CompetencyDraft) => void;
  options: RatingScale;
  ratingScale?: RatingScale;
}) {
  const mine = editable ? currentValue(row, editable, drafts[row.id]) : null;
  return (
    <div data-midyear-competency={row.id} className={`flex flex-col gap-1.5 px-3 py-2 ${grid.row}`}>
      <div className={`flex min-w-0 items-baseline justify-between gap-2 ${grid.name}`}>
        <span className="break-words text-[12px] font-medium leading-[18px] text-ds-text-primary">{row.name_snapshot}</span>
        <span className={`flex-shrink-0 text-[11px] tabular-nums text-ds-text-secondary ${grid.mobileOnly}`}>
          {row.weight_snapshot}%
        </span>
      </div>
      <span className={`pt-[5px] text-[12px] leading-[18px] tabular-nums text-ds-text-secondary ${grid.desktopOnly}`}>
        {row.weight_snapshot}%
      </span>
      {editable !== "employee" && (
        <div className={grid.cellPad}>
          <RatingValue
            party="employee"
            code={row.employee_rating_code}
            comment={row.employee_comment}
            scale={ratingScale}
            captionClass={grid.mobileOnly}
          />
        </div>
      )}
      {editable === null && (
        <div className={grid.cellPad}>
          <RatingValue
            party="manager"
            code={row.manager_rating_code}
            comment={row.manager_comment}
            scale={ratingScale}
            captionClass={grid.mobileOnly}
          />
        </div>
      )}
      {editable && mine && (
        <>
          <select
            data-midyear-rating={row.id}
            aria-label={`${row.name_snapshot} rating`}
            value={mine.rating ?? ""}
            onChange={(e) => onChange?.(row.id, { ...drafts[row.id], rating: e.target.value || null })}
            className={`${MIDYEAR_CONTROL} w-full`}
          >
            <option value="">Select rating</option>
            {options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label ? `${o.code} · ${o.label}` : o.code}
              </option>
            ))}
          </select>
          <CompactTextarea
            data-midyear-comment={row.id}
            aria-label={`${row.name_snapshot} comment`}
            value={mine.comment ?? ""}
            onChange={(e) => onChange?.(row.id, { ...drafts[row.id], comment: e.target.value || null })}
            placeholder="Optional comment"
          />
        </>
      )}
    </div>
  );
}

/** "N requirements remaining" with the full list on expand; renders nothing when nothing blocks. */
export function MidyearBlockers({ title, blockers }: { title: string; blockers: string[] }) {
  if (blockers.length === 0) return null;
  return (
    <details data-midyear-blockers className="group min-w-0 text-[12px]">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-[6px] px-1 py-0.5 font-medium text-ds-warning outline-none hover:bg-ds-warning-subtle focus-visible:ring-2 focus-visible:ring-[#0d0e10]/30 [&::-webkit-details-marker]:hidden">
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ds-amber" aria-hidden />
        <span data-midyear-blocker-count>
          {blockers.length} {blockers.length === 1 ? "requirement" : "requirements"} remaining
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="transition-transform group-open:rotate-180"
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>
      <div className="mt-1 max-w-[560px] px-1">
        <p className="mb-0.5 text-[11px] text-ds-text-secondary">{title}</p>
        <ul className="space-y-px">
          {blockers.map((b) => (
            <li
              key={b}
              data-midyear-blocker
              className="relative pl-3 text-[11px] leading-4 text-ds-text-primary before:absolute before:left-0.5 before:text-ds-text-muted before:content-['•']"
            >
              {b}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
