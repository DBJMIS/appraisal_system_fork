"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { CheckInResponse, CheckInWithResponses, ObjectiveStatus } from "@/types/checkins";
import { dedupeFiscalYearPrefix, formatCheckInDate, formatCheckInDateTime } from "@/lib/midyear-config";
import { formatMetricTarget } from "@/lib/metric-display";
import { MIDYEAR_SUB_STATUS, midyearReviewTimeline, midyearSubStatusState, openMidyearRevision } from "@/lib/midyear-display";
import { statusToneClasses, type StatusTone } from "@/lib/appraisal-status-display";
import {
  CompactTextarea,
  MIDYEAR_CAPTION,
  MIDYEAR_TABLE,
  MIDYEAR_TABLE_HEAD,
  MidyearActualInput,
  MidyearBlockers,
  MidyearCompetencyList,
  MidyearWorkplanSummary,
  OBJECTIVE_STATUS,
  SegmentedControl,
  StatusTag,
  formatMidyearResult,
  metricKind,
  midyearWorkplanResult,
  ratedCompetencyCount,
  type CompetencyDraft,
  type RatingScale,
} from "./MidyearAssessmentFields";
import { WorkplanStatusSummary, workplanAssessment } from "./WorkplanStatusSummary";

/**
 * Which inputs the current viewer gets. Decided by ActiveCheckInCard from the check-in status and
 * the viewer's role; this component only lays the review out.
 */
export type MidyearWorkspaceView = "EMPLOYEE_EDIT" | "MANAGER_EDIT" | "MANAGER_WAITING" | "READ_ONLY";

export interface MidyearRowDraft {
  employee_status?: ObjectiveStatus | null;
  employee_comment?: string | null;
  employee_actual_raw?: number | null;
  employee_completion_date?: string | null;
  mgr_status_override?: ObjectiveStatus | null;
  mgr_comment?: string | null;
  mgr_actual_raw?: number | null;
  mgr_completion_date?: string | null;
}

const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-[#0d0e10]/30 focus-visible:ring-offset-1";

export const MIDYEAR_BUTTON = {
  primary: `inline-flex h-8 w-full items-center justify-center gap-2 rounded-[8px] bg-ds-accent px-4 text-[12px] font-semibold text-white transition-colors hover:bg-ds-accent-hover disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto ${FOCUS_RING}`,
  secondary: `inline-flex h-8 w-full items-center justify-center gap-2 rounded-[8px] border border-ds-border bg-white px-3.5 text-[12px] font-semibold text-ds-text-primary transition-colors hover:border-ds-text-primary disabled:opacity-50 sm:w-auto ${FOCUS_RING}`,
  danger: `inline-flex h-8 w-full items-center justify-center gap-2 rounded-[8px] border border-ds-error-border bg-white px-3.5 text-[12px] font-semibold text-ds-error transition-colors hover:bg-ds-error-subtle disabled:opacity-50 sm:w-auto ${FOCUS_RING}`,
  disabled:
    "inline-flex h-8 w-full cursor-not-allowed items-center justify-center rounded-[8px] border border-ds-border bg-ds-surface px-3.5 text-[12px] font-semibold text-ds-text-muted sm:w-auto",
  quiet: `inline-flex h-8 w-full items-center justify-center rounded-[8px] px-3 text-[12px] font-medium text-ds-text-secondary transition-colors hover:bg-ds-surface hover:text-ds-text-primary sm:w-auto ${FOCUS_RING}`,
} as const;

const formatDay = formatCheckInDate;

function Sep() {
  return (
    <span aria-hidden className="text-ds-border-strong">
      ·
    </span>
  );
}

function headerDetail(view: MidyearWorkspaceView, checkIn: CheckInWithResponses, employeeName: string) {
  switch (view) {
    case "EMPLOYEE_EDIT":
      return "Your manager is waiting for your input";
    case "MANAGER_WAITING":
      return `Awaiting employee input from ${employeeName}`;
    case "MANAGER_EDIT": {
      if (checkIn.status === "MANAGER_REVIEWED") return "You can still revise your review until it is completed";
      const on = formatDay(checkIn.employee_submitted_at);
      return on ? `Submitted by ${employeeName} on ${on}` : `Submitted by ${employeeName}`;
    }
    default:
      return checkIn.status === "OPEN"
        ? "Awaiting employee input"
        : checkIn.status === "EMPLOYEE_SUBMITTED"
          ? "Awaiting manager review"
          : "Manager reviewed — awaiting completion";
  }
}

function MidyearWorkspaceHeader({
  checkIn,
  view,
  employeeName,
}: {
  checkIn: CheckInWithResponses;
  view: MidyearWorkspaceView;
  employeeName: string;
}) {
  const sub = MIDYEAR_SUB_STATUS[midyearSubStatusState(checkIn)];
  const tone = statusToneClasses[sub.tone];
  const due = formatDay(checkIn.due_date);
  const revising = openMidyearRevision(checkIn) != null;
  return (
    <header
      data-midyear-header
      className="flex flex-col gap-2 border-b border-ds-border pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
    >
      <div className="min-w-0">
        <h3 className="break-words text-[15px] font-semibold leading-5 text-ds-text-primary">{dedupeFiscalYearPrefix(checkIn.title)}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-ds-text-secondary">
          <span data-midyear-header-mode>{checkIn.review_mode === "FORMAL_SCORED" ? "Formal · Scored" : "Formal"}</span>
          {due && (
            <>
              <Sep />
              <span data-midyear-header-due>Due {due}</span>
            </>
          )}
          <Sep />
          <span data-midyear-header-detail>{headerDetail(view, checkIn, employeeName)}</span>
        </p>
        <MidyearReviewTimes checkIn={checkIn} className="mt-0.5" />
      </div>
      <span
        data-midyear-header-status
        className={`inline-flex flex-shrink-0 items-center gap-1.5 self-start rounded-ds-badge border px-2 py-0.5 text-[11px] font-medium ${tone.badge}`}
      >
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        {revising ? "Revision in progress" : sub.label}
      </span>
    </header>
  );
}

/** Manager submission, last revision and completion times; renders nothing before the manager submits. */
export function MidyearReviewTimes({ checkIn, className = "" }: { checkIn: CheckInWithResponses; className?: string }) {
  const timeline = midyearReviewTimeline(checkIn);
  if (!timeline) return null;
  const items = [
    ["submitted", "Manager review submitted", timeline.managerSubmittedAt],
    ["revised", "Last revised", timeline.lastRevisedAt],
    ["completed", timeline.revisedCompletion ? "Revised review completed" : "Completed", timeline.completedAt],
  ].filter((item): item is [string, string, string] => item[2] != null);
  return (
    <p data-midyear-times className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-ds-text-muted ${className}`}>
      {items.map(([key, label, at], i) => (
        <Fragment key={key}>
          {i > 0 && <Sep />}
          <span data-midyear-time={key}>
            {label}: <time dateTime={at}>{formatCheckInDateTime(at)}</time>
          </span>
        </Fragment>
      ))}
    </p>
  );
}

function MidyearRevisionNotice({ checkIn, view }: { checkIn: CheckInWithResponses; view: MidyearWorkspaceView }) {
  const revision = openMidyearRevision(checkIn);
  if (!revision) return null;
  const on = formatDay(revision.reopened_at);
  return (
    <div
      data-midyear-revision-notice
      role="status"
      className="space-y-0.5 rounded-[8px] border border-ds-warning-border bg-ds-warning-subtle px-3 py-2 text-[12px] leading-[18px] text-ds-text-primary"
    >
      <p className="font-semibold">
        Mid-Year Review · Revision in progress{" "}
        <span data-midyear-revision-number className="font-normal text-ds-text-secondary">
          (revision {revision.revision_number})
        </span>
      </p>
      <p data-midyear-revision-reopened-by className="text-ds-text-secondary">
        Reopened by {revision.reopened_by_name ?? "HR"}
        {on ? ` on ${on}` : ""}
      </p>
      <p data-midyear-revision-reason className="whitespace-pre-wrap break-words">
        <span className="font-medium">Reason: </span>
        {revision.reopen_reason}
      </p>
      <p className="text-ds-text-secondary">
        {view === "MANAGER_EDIT"
          ? "Update your assessment and submit the manager review again. The employee's submitted inputs are unchanged."
          : "The employee's submitted inputs are unchanged. A new Mid-Year score is recorded when the revised review is completed."}
      </p>
    </div>
  );
}

function MidyearSection({
  id,
  title,
  description,
  meta,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section data-midyear-workspace-section={id} aria-labelledby={`midyear-${id}-title`} className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-0.5">
        <div className="min-w-0">
          <h4 id={`midyear-${id}-title`} className="text-[13px] font-semibold leading-5 text-ds-text-primary">
            {title}
          </h4>
          {description && <p className="text-[12px] leading-[18px] text-ds-text-secondary">{description}</p>}
        </div>
        {meta && <span className="text-[11px] tabular-nums text-ds-text-muted">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

/** Breakpoint at which a table layout replaces the stacked rows. */
interface Breakpoint {
  stackOnly: string;
  tableOnly: string;
}
const XL: Breakpoint = { stackOnly: "xl:hidden", tableOnly: "hidden xl:block" };
const MD: Breakpoint = { stackOnly: "md:hidden", tableOnly: "hidden md:block" };

const targetOf = (response: CheckInResponse) => (response.workplan_item ? formatMetricTarget(response.workplan_item) : null);

function ObjectiveCell({ response, bp, className = "" }: { response: CheckInResponse; bp: Breakpoint; className?: string }) {
  const wp = response.workplan_item;
  const detail = [wp?.key_output, wp?.performance_standard]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" · ");
  const target = targetOf(response);
  const weight = response.weight_snapshot ?? wp?.weight;
  return (
    <div data-midyear-objective className={`min-w-0 ${className}`}>
      <p className="break-words text-[12px] font-semibold leading-[18px] text-ds-text-primary">{wp?.major_task ?? "Objective"}</p>
      {detail && (
        <p title={detail} className="mt-0.5 line-clamp-2 break-words text-[11px] leading-4 text-ds-text-secondary">
          {detail}
        </p>
      )}
      <dl data-midyear-objective-meta className="mt-0.5 text-[11px] leading-4 text-ds-text-muted">
        <div data-midyear-target-stacked className={bp.stackOnly}>
          <dt className="inline">Target: </dt>
          <dd className={`inline font-semibold tabular-nums ${target ? "text-ds-text-primary" : ""}`}>{target ?? "—"}</dd>
        </div>
        {weight != null && (
          <div data-midyear-weight>
            <dt className="inline">Weight: </dt>
            <dd className="inline tabular-nums">{weight}%</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** Target as its own column once the table layout applies; stacked rows show it in the objective cell. */
function TargetCell({
  response,
  bp,
  compact = false,
  className = "",
}: {
  response: CheckInResponse;
  bp: Breakpoint;
  /** Read-only rows align with text, not with h-7 inputs. */
  compact?: boolean;
  className?: string;
}) {
  const target = targetOf(response);
  return (
    <div data-midyear-target className={`min-w-0 ${bp.tableOnly} ${className}`}>
      <span
        className={`inline-flex items-center break-words font-semibold tabular-nums ${
          compact ? "text-[12px] leading-[18px]" : "min-h-7 text-[13px]"
        } ${target ? "text-ds-text-primary" : "text-ds-text-muted"}`}
      >
        {target ?? "—"}
      </span>
    </div>
  );
}

/** Table cell with a caption that only shows once rows stack. */
function Cell({ caption, captionClass, children, className = "" }: { caption: string; captionClass: string; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className={`${MIDYEAR_CAPTION} mb-1 ${captionClass}`}>{caption}</p>
      {children}
    </div>
  );
}

function EmployeeLine({ children, attr }: { children: ReactNode; attr?: string }) {
  return (
    <div
      {...(attr ? { [attr]: "" } : {})}
      className="mb-1 flex min-h-[18px] flex-wrap items-center gap-x-1 text-[11px] leading-[18px] text-ds-text-secondary"
    >
      <span className="font-medium text-ds-text-muted">Employee</span>
      {children}
    </div>
  );
}

function ResultValue({ value }: { value: number | null }) {
  return (
    <span
      data-midyear-result
      className={`inline-flex h-7 items-center text-[13px] font-semibold tabular-nums ${value == null ? "text-ds-text-muted" : "text-ds-text-primary"}`}
    >
      {formatMidyearResult(value)}
    </span>
  );
}

const EMPLOYEE_TRACKING = (["ON_TRACK", "AT_RISK", "BEHIND", "COMPLETE"] as const).map((s) => ({
  value: s as ObjectiveStatus | null,
  ...OBJECTIVE_STATUS[s],
}));

const MANAGER_TRACKING: Array<{ value: ObjectiveStatus | null; label: string; tone: StatusTone }> = [
  { value: null, label: "Agree", tone: "success" },
  { value: "AT_RISK", ...OBJECTIVE_STATUS.AT_RISK },
  { value: "BEHIND", ...OBJECTIVE_STATUS.BEHIND },
];

type TableMode = "employee" | "manager" | "readonly";

const WORKPLAN_GRID = {
  employee: {
    row: "xl:grid xl:grid-cols-[minmax(0,1.5fr)_84px_236px_150px_60px_minmax(0,1.3fr)] xl:items-start xl:gap-3",
    head: "hidden xl:grid xl:grid-cols-[minmax(0,1.5fr)_84px_236px_150px_60px_minmax(0,1.3fr)] xl:gap-3",
    columns: ["Objective", "Target", "Tracking", "Mid-Year Actual", "Result", "Comment"],
  },
  manager: {
    row: "xl:grid xl:grid-cols-[minmax(0,1.3fr)_84px_200px_150px_84px_minmax(0,1.5fr)] xl:items-start xl:gap-3",
    head: "hidden xl:grid xl:grid-cols-[minmax(0,1.3fr)_84px_200px_150px_84px_minmax(0,1.5fr)] xl:gap-3",
    columns: ["Objective", "Target", "Tracking", "Mid-Year Actual", "Result", "Comment"],
  },
  readonlyBoth: {
    row: "md:grid md:grid-cols-[minmax(0,1.2fr)_84px_minmax(0,1fr)_minmax(0,1fr)] md:items-start md:gap-4",
    head: "hidden md:grid md:grid-cols-[minmax(0,1.2fr)_84px_minmax(0,1fr)_minmax(0,1fr)] md:gap-4",
    columns: ["Objective", "Target", "Employee", "Manager"],
  },
  readonlyEmployee: {
    row: "md:grid md:grid-cols-[minmax(0,1.2fr)_84px_minmax(0,2fr)] md:items-start md:gap-4",
    head: "hidden md:grid md:grid-cols-[minmax(0,1.2fr)_84px_minmax(0,2fr)] md:gap-4",
    columns: ["Objective", "Target", "Employee"],
  },
} as const;

function PartyCell({ response, party }: { response: CheckInResponse; party: "employee" | "manager" }) {
  const wp = response.workplan_item;
  const employee = party === "employee";
  const comment = employee ? response.employee_comment : response.mgr_comment;
  // An Agreed objective saved without a manager value is scored on the employee's result; show that.
  const agreedWithEmployee =
    !employee &&
    response.mgr_status_override == null &&
    response.mgr_actual_raw == null &&
    response.mgr_completion_date == null &&
    (response.employee_actual_raw != null || response.employee_completion_date != null);
  const useEmployee = employee || agreedWithEmployee;
  return (
    <div data-midyear-party={party} className="min-w-0">
      <p className={`${MIDYEAR_CAPTION} mb-1 md:hidden`}>{employee ? "Employee" : "Manager"}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusTag status={employee ? response.employee_status : response.mgr_status_override} agreed={!employee} />
        {wp && (
          <MidyearWorkplanSummary
            source={wp}
            actual={useEmployee ? response.employee_actual_raw : response.mgr_actual_raw}
            completionDate={useEmployee ? response.employee_completion_date : response.mgr_completion_date}
            result={useEmployee ? response.employee_result : response.mgr_result}
          />
        )}
        {agreedWithEmployee && (
          <span data-midyear-agreed-fallback className="text-[11px] text-ds-text-muted">
            (employee&apos;s value)
          </span>
        )}
      </div>
      {comment && <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-[18px] text-ds-text-primary">{comment}</p>}
    </div>
  );
}

/**
 * One compact row per objective. Desktop is a table; below the breakpoint each row stacks as
 * Objective → Tracking → Actual + Result → Comment.
 */
export function MidyearWorkplanTable({
  responses,
  mode,
  getDraft,
  onDraftChange,
  showEmployee = true,
  showManager = false,
}: {
  responses: CheckInResponse[];
  mode: TableMode;
  getDraft?: (r: CheckInResponse) => MidyearRowDraft;
  onDraftChange?: (workplanItemId: string, patch: MidyearRowDraft) => void;
  showEmployee?: boolean;
  showManager?: boolean;
}) {
  const grid =
    mode === "readonly" ? (showEmployee && showManager ? WORKPLAN_GRID.readonlyBoth : WORKPLAN_GRID.readonlyEmployee) : WORKPLAN_GRID[mode];
  const stackCaption = mode === "readonly" ? "md:hidden" : "xl:hidden";
  return (
    <div data-midyear-workplan-table={mode} className={MIDYEAR_TABLE}>
      <div data-midyear-grid-head className={`${MIDYEAR_TABLE_HEAD} rounded-t-[8px] ${grid.head}`}>
        {grid.columns.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      {responses.length === 0 && <p className="px-3 py-3 text-[12px] text-ds-text-muted">No workplan objectives.</p>}
      <div className="divide-y divide-ds-border">
        {responses.map((r) => {
          const wp = r.workplan_item;
          const rowClass = `flex flex-col gap-2.5 px-3 py-2.5 ${grid.row}`;

          if (mode === "readonly") {
            return (
              <div key={r.id} data-midyear-workplan-row={r.workplan_item_id} className={rowClass}>
                <ObjectiveCell response={r} bp={MD} />
                <TargetCell response={r} bp={MD} compact />
                {!showEmployee ? (
                  <p className="text-[12px] leading-[18px] text-ds-text-muted">Awaiting employee input</p>
                ) : (
                  <>
                    <PartyCell response={r} party="employee" />
                    {showManager && <PartyCell response={r} party="manager" />}
                  </>
                )}
              </div>
            );
          }

          const d = getDraft?.(r) ?? {};
          const change = (patch: MidyearRowDraft) => onDraftChange?.(r.workplan_item_id, patch);
          const label = wp?.major_task ?? "Objective";

          if (mode === "employee") {
            const result = wp
              ? midyearWorkplanResult("employee", wp, {
                  actual_raw: d.employee_actual_raw ?? null,
                  completion_date: d.employee_completion_date ?? null,
                })
              : null;
            return (
              <div key={r.id} data-midyear-workplan-row={r.workplan_item_id} className={rowClass}>
                <ObjectiveCell response={r} bp={XL} className="xl:pt-1" />
                <TargetCell response={r} bp={XL} className="xl:pt-px" />
                <Cell caption="Tracking" captionClass={stackCaption} className="max-w-[360px] xl:max-w-none">
                  <SegmentedControl
                    label={`${label} tracking`}
                    options={EMPLOYEE_TRACKING}
                    value={d.employee_status ?? null}
                    onChange={(v) => change({ employee_status: v })}
                  />
                </Cell>
                <div className="flex items-start gap-6 xl:contents">
                  <Cell caption="Mid-Year Actual" captionClass={stackCaption} className="xl:pt-px">
                    {wp ? (
                      <MidyearActualInput
                        owner="employee"
                        source={wp}
                        label={label}
                        value={{ actual_raw: d.employee_actual_raw ?? null, completion_date: d.employee_completion_date ?? null }}
                        onChange={(v) => change({ employee_actual_raw: v.actual_raw, employee_completion_date: v.completion_date })}
                      />
                    ) : (
                      <span className="text-[12px] text-ds-text-muted">—</span>
                    )}
                  </Cell>
                  <Cell caption="Result" captionClass={stackCaption} className="xl:pt-px">
                    <ResultValue value={result} />
                  </Cell>
                </div>
                <Cell caption="Comment" captionClass={stackCaption} className="xl:pt-px">
                  <CompactTextarea
                    aria-label={`${label} comment`}
                    value={d.employee_comment ?? ""}
                    onChange={(e) => change({ employee_comment: e.target.value || null })}
                    placeholder="Progress, blockers or context"
                  />
                </Cell>
              </div>
            );
          }

          const kind = wp ? metricKind(wp) : null;
          const employeeActual =
            kind === "DATE"
              ? formatDay(r.employee_completion_date) ?? "—"
              : r.employee_actual_raw != null
                ? `${r.employee_actual_raw}${kind === "PERCENT" ? "%" : ""}`
                : "—";
          const managerResult = wp
            ? midyearWorkplanResult("manager", wp, {
                actual_raw: d.mgr_actual_raw ?? null,
                completion_date: d.mgr_completion_date ?? null,
              })
            : null;
          return (
            <div key={r.id} data-midyear-workplan-row={r.workplan_item_id} className={rowClass}>
              <ObjectiveCell response={r} bp={XL} />
              {/* Offset by the employee line so Target sits level with the manager's Actual and Result. */}
              <TargetCell response={r} bp={XL} className="xl:pt-[22px]" />
              <Cell caption="Tracking" captionClass={stackCaption} className="max-w-[360px] xl:max-w-none">
                <EmployeeLine attr="data-midyear-employee-status">
                  <StatusTag status={r.employee_status} />
                </EmployeeLine>
                <SegmentedControl
                  label={`${label} manager tracking`}
                  options={MANAGER_TRACKING}
                  value={d.mgr_status_override ?? null}
                  onChange={(v) =>
                    change(
                      // Agree with no manager value of their own falls back to the employee's value.
                      v === null && d.mgr_actual_raw == null && d.mgr_completion_date == null
                        ? { mgr_status_override: v, mgr_actual_raw: undefined, mgr_completion_date: undefined }
                        : { mgr_status_override: v }
                    )
                  }
                />
              </Cell>
              <div className="flex items-start gap-6 xl:contents">
                <Cell caption="Mid-Year Actual" captionClass={stackCaption}>
                  <EmployeeLine attr="data-midyear-employee-actual">
                    <span className="tabular-nums text-ds-text-primary">{employeeActual}</span>
                  </EmployeeLine>
                  {wp ? (
                    <MidyearActualInput
                      owner="manager"
                      source={wp}
                      label={`${label} manager`}
                      value={{ actual_raw: d.mgr_actual_raw ?? null, completion_date: d.mgr_completion_date ?? null }}
                      onChange={(v) => change({ mgr_actual_raw: v.actual_raw, mgr_completion_date: v.completion_date })}
                    />
                  ) : (
                    <span className="text-[12px] text-ds-text-muted">—</span>
                  )}
                </Cell>
                <Cell caption="Result" captionClass={stackCaption}>
                  <EmployeeLine attr="data-midyear-employee-result">
                    <span className="tabular-nums text-ds-text-primary">{formatMidyearResult(r.employee_result)}</span>
                  </EmployeeLine>
                  <ResultValue value={managerResult} />
                </Cell>
              </div>
              <Cell caption="Comment" captionClass={stackCaption}>
                <div data-midyear-employee-comment className="mb-1 text-[11px] leading-[18px] text-ds-text-secondary">
                  <span className="mr-1 font-medium text-ds-text-muted">Employee</span>
                  {r.employee_comment ? (
                    <span className="whitespace-pre-wrap break-words text-ds-text-primary">{r.employee_comment}</span>
                  ) : (
                    <span>No comment</span>
                  )}
                </div>
                <CompactTextarea
                  aria-label={`${label} manager comment`}
                  value={d.mgr_comment ?? ""}
                  onChange={(e) => change({ mgr_comment: e.target.value || null })}
                  placeholder="Add your comments or guidance"
                />
              </Cell>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function lastSavedText(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "Last saved just now";
  if (minutes < 60) return `Last saved ${minutes} min ago`;
  return `Last saved at ${new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Relative time of the last successful draft save in this session; refreshes every 30 seconds. */
export function MidyearLastSaved({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [at]);
  return (
    <span data-midyear-last-saved className="px-1 text-center text-[11px] text-ds-text-muted sm:text-left">
      {lastSavedText(at, Math.max(now, at))}
    </span>
  );
}

/** Pinned to the bottom of the scrolling page while the review is on screen; stacks on mobile. */
export function MidyearActionBar({
  left,
  right,
  status,
  note,
}: {
  left?: ReactNode;
  right?: ReactNode;
  status?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div data-midyear-action-bar className="sticky bottom-0 z-20 border-t border-ds-border bg-white py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:gap-3">
          {left}
          {note}
          {status}
        </div>
        {right && <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">{right}</div>}
      </div>
    </div>
  );
}

export function MidyearReviewWorkspace({
  checkIn,
  view,
  employeeName,
  locked,
  getDraft,
  onDraftChange,
  competencyDrafts,
  onCompetencyChange,
  ratingScale,
  managerOverallNotes,
  onManagerOverallNotesChange,
  blockers,
  actions,
  lastSavedAt = null,
}: {
  checkIn: CheckInWithResponses;
  view: MidyearWorkspaceView;
  employeeName: string;
  locked: boolean;
  getDraft: (r: CheckInResponse) => MidyearRowDraft;
  onDraftChange: (workplanItemId: string, patch: MidyearRowDraft) => void;
  competencyDrafts: Record<string, CompetencyDraft>;
  onCompetencyChange: (id: string, next: CompetencyDraft) => void;
  ratingScale?: RatingScale;
  managerOverallNotes: string;
  onManagerOverallNotesChange: (value: string) => void;
  /** Stage blockers for the viewer's next action; null when there is no action to gate. */
  blockers: { title: string; items: string[]; ready?: string } | null;
  actions: { left?: ReactNode; right?: ReactNode } | null;
  /** Epoch ms of the last successful draft save in this session. */
  lastSavedAt?: number | null;
}) {
  const status = checkIn.status as string;
  const responses = checkIn.responses ?? [];
  const ratings = checkIn.competency_ratings ?? [];
  const readOnly = view === "READ_ONLY";
  // Employee values stay hidden from others until the employee submits.
  const showEmployee = view !== "MANAGER_WAITING" && status !== "OPEN";
  const showManager = status === "MANAGER_REVIEWED";
  const tableMode: TableMode = view === "EMPLOYEE_EDIT" ? "employee" : view === "MANAGER_EDIT" ? "manager" : "readonly";
  const competencyOwner = view === "EMPLOYEE_EDIT" ? "employee" : view === "MANAGER_EDIT" ? "manager" : null;
  const showCompetencies = ratings.length > 0 && (competencyOwner !== null || (readOnly && showEmployee));
  const rated = competencyOwner ? ratedCompetencyCount(ratings, competencyDrafts, competencyOwner) : 0;

  // Same values the rows show: drafts while editing, saved values otherwise; manager stages use the
  // manager's tracking (Agree = the employee's). Results use the live completeness calculation.
  const managerStage = view === "MANAGER_EDIT" || showManager;
  const summaryVisible = view === "EMPLOYEE_EDIT" || showEmployee;
  const summaryRows = responses.map((r) => {
    const v = tableMode === "readonly" ? r : { ...r, ...getDraft(r) };
    const wp = r.workplan_item ?? {};
    const live = (owner: "employee" | "manager") =>
      owner === "employee"
        ? midyearWorkplanResult(owner, wp, { actual_raw: v.employee_actual_raw ?? null, completion_date: v.employee_completion_date ?? null })
        : midyearWorkplanResult(owner, wp, { actual_raw: v.mgr_actual_raw ?? null, completion_date: v.mgr_completion_date ?? null });
    return {
      status: managerStage ? v.mgr_status_override ?? v.employee_status : v.employee_status,
      result: {
        weight_snapshot: r.weight_snapshot,
        employee_result: tableMode === "employee" ? live("employee") : r.employee_result,
        mgr_result: tableMode === "manager" ? live("manager") : r.mgr_result,
      },
    };
  });

  const workplanDescription =
    view === "EMPLOYEE_EDIT"
      ? "Assess progress against the approved workplan as at the Mid-Year Review."
      : view === "MANAGER_EDIT"
        ? "Review the employee's self-assessment and record your Mid-Year assessment for each objective."
        : "Progress against the approved workplan as at the Mid-Year Review.";

  const barStatus = blockers ? (
    blockers.items.length > 0 ? (
      <MidyearBlockers title={blockers.title} blockers={blockers.items} />
    ) : (
      <span data-midyear-ready className="inline-flex items-center gap-1.5 px-1 text-[12px] font-medium text-ds-success">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ds-mint" />
        {blockers.ready ?? "All required items saved"}
      </span>
    )
  ) : null;

  return (
    <div
      data-midyear-workspace={view}
      {...(readOnly ? { "data-midyear-readonly": "" } : {})}
      className="space-y-5 bg-white"
    >
      <MidyearWorkspaceHeader checkIn={checkIn} view={view} employeeName={employeeName} />
      <MidyearRevisionNotice checkIn={checkIn} view={view} />

      {locked && (
        <p data-midyear-locked className="rounded-[8px] border border-ds-border bg-ds-surface px-3 py-2 text-[12px] text-ds-text-secondary">
          This Mid-Year Review is read-only because the appraisal is no longer In progress.
        </p>
      )}
      {view === "EMPLOYEE_EDIT" && checkIn.note_to_employee && (
        <p
          data-midyear-note
          className="whitespace-pre-wrap rounded-[8px] border border-ds-lavender-border bg-ds-lavender-subtle px-3 py-2 text-[12px] leading-[18px] text-ds-text-primary"
        >
          <span className="font-semibold text-ds-lavender-text">Note from your manager: </span>
          {checkIn.note_to_employee}
        </p>
      )}

      <MidyearSection id="workplan" title="Workplan Progress" description={workplanDescription}>
        <WorkplanStatusSummary
          statuses={summaryRows.map((s) => s.status)}
          assessment={summaryVisible ? workplanAssessment(summaryRows.map((s) => s.result), managerStage ? "manager" : "employee") : null}
          pendingNote={summaryVisible ? null : "Objective statuses appear once the employee submits."}
        />
        <MidyearWorkplanTable
          responses={responses}
          mode={tableMode}
          getDraft={getDraft}
          onDraftChange={onDraftChange}
          showEmployee={showEmployee}
          showManager={showManager}
        />
      </MidyearSection>

      {showCompetencies && (
        <MidyearSection
          id="competencies"
          title={view === "EMPLOYEE_EDIT" ? "Competency Self-Assessment" : view === "MANAGER_EDIT" ? "Competency Assessment" : "Competencies"}
          description={
            view === "EMPLOYEE_EDIT"
              ? "Rate each competency on the rating scale. Comments are optional."
              : view === "MANAGER_EDIT"
                ? "The employee's self-rating is shown beside each competency."
                : undefined
          }
          meta={
            competencyOwner
              ? `${rated}/${ratings.length} rated`
              : `${ratings.length} ${ratings.length === 1 ? "competency" : "competencies"}`
          }
        >
          <MidyearCompetencyList
            ratings={ratings}
            editable={competencyOwner}
            drafts={competencyDrafts}
            onChange={onCompetencyChange}
            ratingScale={ratingScale}
          />
        </MidyearSection>
      )}

      {view === "MANAGER_EDIT" && (
        <MidyearSection id="overall-notes" title="Overall notes for employee">
          <CompactTextarea
            aria-label="Overall notes for employee"
            minRows={2}
            value={managerOverallNotes}
            onChange={(e) => onManagerOverallNotesChange(e.target.value)}
            placeholder="Summary comments visible to the employee after you complete this review"
          />
        </MidyearSection>
      )}
      {readOnly && showManager && checkIn.manager_overall_notes && (
        <MidyearSection id="overall-notes" title="Manager overall notes">
          <p className="whitespace-pre-wrap rounded-[8px] border border-ds-border px-3 py-2 text-[12px] leading-[18px] text-ds-text-primary">
            {checkIn.manager_overall_notes}
          </p>
        </MidyearSection>
      )}

      {actions && (actions.left || actions.right) && (
        <MidyearActionBar
          left={actions.left}
          right={actions.right}
          status={barStatus}
          note={lastSavedAt != null ? <MidyearLastSaved at={lastSavedAt} /> : undefined}
        />
      )}
    </div>
  );
}
