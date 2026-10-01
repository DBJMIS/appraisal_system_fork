/**
 * HR/Admin notification operations: the reminder delivery activity list, delivery detail, a
 * regenerated preview, manual retry of a failed reminder, and outstanding appraisal actions with
 * escalation candidates. Server-only; expects the service-role client and an HR/Admin caller
 * (routes enforce requireHrOrAdmin).
 *
 * Reads delivery bookkeeping, names, cycle names and appraisal status only. Never reads or returns
 * scores, ratings, comments, evidence, recommendations, email bodies or provider responses. A retry
 * goes through the same delivery worker as the scheduled job (claim, re-check, render, send) and
 * updates the existing row; it never creates a new one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_TEMPLATES, renderEmail } from "@/lib/email-templates";
import { loadEmailContext } from "@/lib/email-context";
import { statusConfig } from "@/lib/appraisal-status-display";
import { formatMidyearDate } from "@/lib/midyear-config";
import { isAppUserUuid } from "@/lib/notifications/create";
import {
  MAX_DELIVERY_ATTEMPTS,
  REMINDER_UTC_OFFSET_HOURS,
  addDays,
  describeOffset,
  loadEscalationPolicy,
  reminderToday,
} from "@/lib/appraisal-reminder-policy";
import { REMINDER_KINDS, isReminderKind, reminderSkipReason, type ReminderKind } from "@/lib/appraisal-reminder-planner";
import {
  DELIVERY_COLUMNS,
  deliverReminder,
  loadCurrentState,
  loadEmployeeNames,
  loadPlanningData,
  resolveRecipientEmail,
  type DeliveryOutcome,
  type DeliveryRow,
} from "@/lib/appraisal-reminder-delivery";
import {
  DELIVERY_STATUSES,
  DELIVERY_STATUS_DISPLAY,
  deliveryReasonLabel,
  deliverySuccessRate,
  isDeliveryStatus,
  retryBlockReason,
  type DeliveryStatus,
  type RetryBlockCode,
} from "@/lib/reminder-operations-display";
import {
  outstandingAppraisalActions,
  suggestEscalationTarget,
  type ActionDeliveryRecord,
  type EscalationTarget,
  type OutstandingAction,
} from "@/lib/appraisal-outstanding-actions";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 80;
const MAX_SEARCH_EMPLOYEES = 50;
const IN_CHUNK = 150;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RECIPIENT_ROLES = ["employee", "manager"] as const;
type RecipientRole = (typeof RECIPIENT_ROLES)[number];

export interface DeliveryFilters {
  /** undefined = current cycle, null = all cycles. */
  cycleId: string | null | undefined;
  status: DeliveryStatus | null;
  kind: ReminderKind | null;
  role: RecipientRole | null;
  q: string | null;
  from: string | null;
  to: string | null;
  page: number;
  pageSize: number;
}

function parsePositiveInt(raw: string | null, fallback: number, max: number): number | null {
  if (raw == null || raw === "") return fallback;
  if (!/^\d{1,6}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? Math.min(n, max) : null;
}

function parseIsoDate(raw: string | null): Parsed<string | null> {
  if (!raw) return { ok: true, value: null };
  if (!ISO_DATE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) return { ok: false, error: "Dates must be in YYYY-MM-DD format." };
  return { ok: true, value: raw };
}

export function parsePagination(params: URLSearchParams): Parsed<{ page: number; pageSize: number }> {
  const page = parsePositiveInt(params.get("page"), 1, 100_000);
  const pageSize = parsePositiveInt(params.get("pageSize"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  if (page == null || pageSize == null) return { ok: false, error: "Invalid page or page size." };
  return { ok: true, value: { page, pageSize } };
}

export function parseDeliveryFilters(params: URLSearchParams): Parsed<DeliveryFilters> {
  const rawCycle = params.get("cycleId");
  let cycleId: DeliveryFilters["cycleId"];
  if (rawCycle === "all") cycleId = null;
  else if (rawCycle) {
    if (!ID_PATTERN.test(rawCycle)) return { ok: false, error: "Invalid cycle." };
    cycleId = rawCycle;
  }

  const rawStatus = params.get("status");
  if (rawStatus && !isDeliveryStatus(rawStatus)) return { ok: false, error: "Invalid status." };
  const rawKind = params.get("kind");
  if (rawKind && !isReminderKind(rawKind)) return { ok: false, error: "Invalid reminder type." };
  const rawRole = params.get("role");
  if (rawRole && !(RECIPIENT_ROLES as readonly string[]).includes(rawRole)) return { ok: false, error: "Invalid recipient role." };

  const from = parseIsoDate(params.get("from"));
  if (!from.ok) return from;
  const to = parseIsoDate(params.get("to"));
  if (!to.ok) return to;
  if (from.value && to.value && from.value > to.value) return { ok: false, error: "The start date must be on or before the end date." };

  const paging = parsePagination(params);
  if (!paging.ok) return paging;

  const q = (params.get("q") ?? "").trim().slice(0, MAX_SEARCH_LENGTH) || null;
  return {
    ok: true,
    value: {
      cycleId,
      status: (rawStatus as DeliveryStatus) || null,
      kind: (rawKind as ReminderKind) || null,
      role: (rawRole as RecipientRole) || null,
      q,
      from: from.value,
      to: to.value,
      ...paging.value,
    },
  };
}

/** Start of a Jamaica-local calendar day as a UTC timestamp. */
const localDayStartUtc = (isoDate: string) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) - REMINDER_UTC_OFFSET_HOURS * 3_600_000).toISOString();

interface ResolvedFilters {
  cycleId: string | null;
  status: DeliveryStatus | null;
  kind: ReminderKind | null;
  role: RecipientRole | null;
  appraisalIds: string[] | null;
  fromTs: string | null;
  toTs: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- shared filters for differently-typed supabase-js builders */
function applyDeliveryFilters(query: any, f: ResolvedFilters, includeStatus: boolean): any {
  let q = query;
  if (f.cycleId) q = q.eq("cycle_id", f.cycleId);
  if (includeStatus && f.status) q = q.eq("status", f.status);
  if (f.kind) q = q.eq("notification_kind", f.kind);
  if (f.role) q = q.eq("recipient_role", f.role);
  if (f.appraisalIds) q = q.in("appraisal_id", f.appraisalIds);
  if (f.fromTs) q = q.gte("updated_at", f.fromTs);
  if (f.toTs) q = q.lt("updated_at", f.toTs);
  return q;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const chunks = <T,>(items: T[], size = IN_CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const kindLabel = (kind: string) => (isReminderKind(kind) ? EMAIL_TEMPLATES[kind].label : "Reminder");
const statusDisplay = (status: string) =>
  isDeliveryStatus(status) ? DELIVERY_STATUS_DISPLAY[status] : { label: status, tone: "muted" as const };

export interface CycleOption {
  id: string;
  name: string;
  status: string | null;
}

/** All cycles (for the filter) and the current one: the open cycle ending last, else the latest. */
export async function loadCycleOptions(supabase: SupabaseClient): Promise<{ cycles: CycleOption[]; currentCycleId: string | null }> {
  const { data, error } = await supabase.from("appraisal_cycles").select("id, name, status, end_date").order("end_date", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; name?: string | null; status?: string | null }[];
  const cycles = rows.map((c) => ({ id: c.id, name: c.name?.trim() || "Unnamed cycle", status: c.status ?? null }));
  const open = cycles.find((c) => String(c.status ?? "").toLowerCase() === "open");
  return { cycles, currentCycleId: (open ?? cycles[0])?.id ?? null };
}

/** Appraisal ids whose employee name matches the search, optionally within a cycle. */
async function searchAppraisalIds(supabase: SupabaseClient, q: string, cycleId: string | null): Promise<string[]> {
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { data: people, error } = await supabase
    .from("employees")
    .select("employee_id")
    .ilike("full_name", pattern)
    .limit(MAX_SEARCH_EMPLOYEES);
  if (error) throw new Error(error.message);
  const employeeIds = ((people ?? []) as { employee_id: string }[]).map((p) => p.employee_id);
  if (employeeIds.length === 0) return [];
  let query = supabase.from("appraisals").select("id").in("employee_id", employeeIds);
  if (cycleId) query = query.eq("cycle_id", cycleId);
  const { data: appraisals, error: appraisalErr } = await query;
  if (appraisalErr) throw new Error(appraisalErr.message);
  return ((appraisals ?? []) as { id: string }[]).map((a) => a.id);
}

async function loadAppraisalEmployees(supabase: SupabaseClient, appraisalIds: string[]): Promise<Map<string, string>> {
  const byAppraisal = new Map<string, string>();
  for (const part of chunks([...new Set(appraisalIds)])) {
    const { data, error } = await supabase.from("appraisals").select("id, employee_id").in("id", part);
    if (error) throw new Error(error.message);
    for (const a of (data ?? []) as { id: string; employee_id: string }[]) byAppraisal.set(a.id, a.employee_id);
  }
  return byAppraisal;
}

const LIST_COLUMNS =
  "id, appraisal_id, cycle_id, recipient_employee_id, recipient_email, recipient_role, notification_kind, due_date, status, attempt_count, error_code, updated_at";

interface ListRow {
  id: string;
  appraisal_id: string;
  cycle_id: string | null;
  recipient_employee_id: string;
  recipient_email: string | null;
  recipient_role: string;
  notification_kind: string;
  due_date: string | null;
  status: string;
  attempt_count: number;
  error_code: string | null;
  updated_at: string;
}

export interface DeliveryListItem {
  id: string;
  appraisalId: string;
  activityAt: string;
  employeeName: string;
  kind: string;
  kindLabel: string;
  recipientRole: string;
  recipientName: string;
  recipientEmail: string | null;
  dueDate: string | null;
  dueDateLabel: string | null;
  status: string;
  statusLabel: string;
  statusTone: string;
  attemptCount: number;
  /** Sanitised machine code (e.g. GRAPH_503, NO_LONGER_REQUIRED); never a raw provider message. */
  errorCode: string | null;
  reason: string | null;
}

export interface DeliveryMetrics {
  sent: number;
  failed: number;
  pending: number;
  sending: number;
  skipped: number;
  /** sent / (sent + failed); null when nothing was attempted. */
  successRate: number | null;
}

export interface DeliveryListResult {
  items: DeliveryListItem[];
  total: number;
  page: number;
  pageSize: number;
  metrics: DeliveryMetrics;
  cycles: CycleOption[];
  cycleId: string | null;
  reminderKinds: { kind: ReminderKind; label: string }[];
}

const emptyMetrics = (): DeliveryMetrics => ({ sent: 0, failed: 0, pending: 0, sending: 0, skipped: 0, successRate: null });

export async function listReminderDeliveries(supabase: SupabaseClient, filters: DeliveryFilters): Promise<DeliveryListResult> {
  const { cycles, currentCycleId } = await loadCycleOptions(supabase);
  const cycleId = filters.cycleId === undefined ? currentCycleId : filters.cycleId;
  const base = {
    page: filters.page,
    pageSize: filters.pageSize,
    cycles,
    cycleId,
    reminderKinds: REMINDER_KINDS.map((kind) => ({ kind, label: EMAIL_TEMPLATES[kind].label })),
  };

  const appraisalIds = filters.q ? await searchAppraisalIds(supabase, filters.q, cycleId) : null;
  if (appraisalIds && appraisalIds.length === 0) return { ...base, items: [], total: 0, metrics: emptyMetrics() };

  const resolved: ResolvedFilters = {
    cycleId,
    status: filters.status,
    kind: filters.kind,
    role: filters.role,
    appraisalIds,
    fromTs: filters.from ? localDayStartUtc(filters.from) : null,
    toTs: filters.to ? localDayStartUtc(addDays(filters.to, 1)) : null,
  };

  const offset = (filters.page - 1) * filters.pageSize;
  const listQuery = applyDeliveryFilters(
    supabase.from("appraisal_notification_deliveries").select(LIST_COLUMNS, { count: "exact" }),
    resolved,
    true
  )
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true })
    .range(offset, offset + filters.pageSize - 1);
  const { data, error, count } = (await listQuery) as { data: ListRow[] | null; error: { message: string } | null; count: number | null };
  if (error) throw new Error(error.message);

  const counts = await Promise.all(
    DELIVERY_STATUSES.map(async (status) => {
      const { count: n, error: countErr } = (await applyDeliveryFilters(
        supabase.from("appraisal_notification_deliveries").select("id", { count: "exact", head: true }),
        resolved,
        false
      ).eq("status", status)) as { count: number | null; error: { message: string } | null };
      if (countErr) throw new Error(countErr.message);
      return [status, n ?? 0] as const;
    })
  );
  const byStatus = Object.fromEntries(counts) as Record<DeliveryStatus, number>;
  const metrics: DeliveryMetrics = {
    sent: byStatus.SENT,
    failed: byStatus.FAILED,
    pending: byStatus.PENDING,
    sending: byStatus.SENDING,
    skipped: byStatus.SKIPPED,
    successRate: deliverySuccessRate(byStatus.SENT, byStatus.FAILED),
  };

  const rows = data ?? [];
  const employeeByAppraisal = await loadAppraisalEmployees(supabase, rows.map((r) => r.appraisal_id));
  const names = await loadEmployeeNames(supabase, [...employeeByAppraisal.values(), ...rows.map((r) => r.recipient_employee_id)]);

  const items = rows.map((r): DeliveryListItem => {
    const employeeId = employeeByAppraisal.get(r.appraisal_id);
    const display = statusDisplay(r.status);
    return {
      id: r.id,
      appraisalId: r.appraisal_id,
      activityAt: r.updated_at,
      employeeName: (employeeId && names.get(employeeId)) || "Employee",
      kind: r.notification_kind,
      kindLabel: kindLabel(r.notification_kind),
      recipientRole: r.recipient_role,
      recipientName: names.get(r.recipient_employee_id) ?? (r.recipient_role === "manager" ? "Manager" : "Employee"),
      recipientEmail: r.recipient_email,
      dueDate: r.due_date,
      dueDateLabel: formatMidyearDate(r.due_date),
      status: r.status,
      statusLabel: display.label,
      statusTone: display.tone,
      attemptCount: r.attempt_count,
      errorCode: r.error_code,
      reason: deliveryReasonLabel(r.error_code),
    };
  });

  return { ...base, items, total: count ?? items.length, metrics };
}

const DETAIL_COLUMNS =
  "id, appraisal_id, cycle_id, recipient_employee_id, recipient_email, recipient_role, notification_kind, reminder_key, offset_days, due_date, scheduled_for, status, attempt_count, last_attempt_at, sent_at, next_retry_at, error_code, created_at, updated_at";

interface DetailRow {
  id: string;
  appraisal_id: string;
  cycle_id: string | null;
  recipient_employee_id: string;
  recipient_email: string | null;
  recipient_role: string;
  notification_kind: string;
  reminder_key: string;
  offset_days: number | null;
  due_date: string | null;
  scheduled_for: string | null;
  status: string;
  attempt_count: number;
  last_attempt_at: string | null;
  sent_at: string | null;
  next_retry_at: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryDetail {
  id: string;
  appraisal: { id: string; employeeName: string; cycleName: string | null; statusLabel: string | null };
  kind: string;
  kindLabel: string;
  recipientRole: string;
  recipientName: string;
  /** Address the reminder was (or will be) sent to: the recorded one, else the current address. */
  recipientEmail: string | null;
  recipientEmailSource: "recorded" | "current" | null;
  scheduledFor: string | null;
  dueDate: string | null;
  timing: string;
  status: string;
  statusLabel: string;
  statusTone: string;
  attemptCount: number;
  maxAttempts: number;
  /** Known only when a single attempt has been made; null with firstAttemptRecorded=false otherwise. */
  firstAttemptAt: string | null;
  firstAttemptRecorded: boolean;
  lastAttemptAt: string | null;
  sentAt: string | null;
  nextRetryAt: string | null;
  errorCode: string | null;
  reason: string | null;
  createdAt: string;
  /** Whether the reminder would still be sent if delivered now, and if not, why. */
  stillRequired: boolean;
  currentStateReason: string | null;
  retry: { allowed: boolean; blockCode: RetryBlockCode | null; message: string | null };
}

async function loadDetailRow(supabase: SupabaseClient, id: string): Promise<DetailRow | null> {
  const { data, error } = await supabase.from("appraisal_notification_deliveries").select(DETAIL_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DetailRow | null) ?? null;
}

/** Null when the reminder would still be sent now; otherwise the machine-safe skip code. */
async function currentSkipCode(supabase: SupabaseClient, row: Pick<DetailRow, "appraisal_id" | "notification_kind" | "recipient_employee_id" | "due_date">, today: string) {
  if (!isReminderKind(row.notification_kind)) return "UNSUPPORTED_KIND";
  const current = await loadCurrentState(supabase, row.appraisal_id, today);
  if (!current) return "APPRAISAL_NOT_FOUND";
  return reminderSkipReason(row, current.appraisal, current.state);
}

function firstAttempt(row: Pick<DetailRow, "status" | "attempt_count" | "last_attempt_at">) {
  const attemptsMade = row.attempt_count + (row.status === "SENDING" ? 1 : 0);
  if (attemptsMade === 0) return { firstAttemptAt: null, firstAttemptRecorded: true };
  if (attemptsMade === 1) return { firstAttemptAt: row.last_attempt_at, firstAttemptRecorded: true };
  return { firstAttemptAt: null, firstAttemptRecorded: false };
}

export async function getDeliveryDetail(supabase: SupabaseClient, id: string, now: Date = new Date()): Promise<DeliveryDetail | null> {
  const row = await loadDetailRow(supabase, id);
  if (!row) return null;
  const today = reminderToday(now);

  const [{ data: appraisal }, skipCode, recipient] = await Promise.all([
    supabase.from("appraisals").select("id, employee_id, status, cycle_id").eq("id", row.appraisal_id).maybeSingle(),
    currentSkipCode(supabase, row, today),
    resolveRecipientEmail(supabase, row.recipient_employee_id),
  ]);
  const a = appraisal as { id: string; employee_id: string; status?: string | null; cycle_id?: string | null } | null;
  const cycleId = row.cycle_id ?? a?.cycle_id ?? null;
  const { data: cycle } = cycleId
    ? await supabase.from("appraisal_cycles").select("name").eq("id", cycleId).maybeSingle()
    : { data: null };
  const names = await loadEmployeeNames(supabase, [a?.employee_id ?? "", row.recipient_employee_id].filter(Boolean));

  const recipientEmail = row.recipient_email ?? recipient.email;
  const block = retryBlockReason({
    status: row.status,
    attemptCount: row.attempt_count,
    errorCode: row.error_code,
    hasRecipientEmail: Boolean(recipient.email),
    stillRequired: skipCode === null,
  });
  const display = statusDisplay(row.status);

  return {
    id: row.id,
    appraisal: {
      id: row.appraisal_id,
      employeeName: (a && names.get(a.employee_id)) || "Employee",
      cycleName: (cycle as { name?: string | null } | null)?.name?.trim() || null,
      statusLabel: a?.status ? statusConfig[a.status]?.label ?? a.status : null,
    },
    kind: row.notification_kind,
    kindLabel: kindLabel(row.notification_kind),
    recipientRole: row.recipient_role,
    recipientName: names.get(row.recipient_employee_id) ?? recipient.name ?? (row.recipient_role === "manager" ? "Manager" : "Employee"),
    recipientEmail,
    recipientEmailSource: row.recipient_email ? "recorded" : recipient.email ? "current" : null,
    scheduledFor: row.scheduled_for,
    dueDate: row.due_date,
    timing: describeOffset(row.offset_days),
    status: row.status,
    statusLabel: display.label,
    statusTone: display.tone,
    attemptCount: row.attempt_count,
    maxAttempts: MAX_DELIVERY_ATTEMPTS,
    ...firstAttempt(row),
    lastAttemptAt: row.last_attempt_at,
    sentAt: row.sent_at,
    nextRetryAt: row.status === "FAILED" ? row.next_retry_at : null,
    errorCode: row.error_code,
    reason: deliveryReasonLabel(row.error_code),
    createdAt: row.created_at,
    stillRequired: skipCode === null,
    currentStateReason: deliveryReasonLabel(skipCode),
    retry: { allowed: block === null, blockCode: block?.code ?? null, message: block?.message ?? null },
  };
}

export const PREVIEW_NOTICE = "Preview reflects the appraisal's current state.";

export type DeliveryPreviewResult =
  | {
      ok: true;
      subject: string;
      html: string;
      text: string;
      notice: string;
      /** True when the reminder would no longer be sent as recorded (step done, deadline or recipient changed). */
      stateChanged: boolean;
      stateChangeReason: string | null;
      warnings: string[];
    }
  | { ok: false; status: 404 | 422 | 500; code: string; error: string };

/** Regenerates the reminder email from current data with the shared renderer. Nothing is stored or sent. */
export async function previewDelivery(supabase: SupabaseClient, id: string, now: Date = new Date()): Promise<DeliveryPreviewResult> {
  const row = await loadDetailRow(supabase, id);
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", error: "Reminder not found." };
  const kind = row.notification_kind;
  if (!isReminderKind(kind)) return { ok: false, status: 422, code: "UNSUPPORTED_KIND", error: "This reminder type can no longer be previewed." };

  const loaded = await loadEmailContext(supabase, row.appraisal_id, kind);
  if (!loaded.ok) {
    return loaded.reason === "NOT_FOUND"
      ? { ok: false, status: 404, code: "NOT_FOUND", error: "The appraisal no longer exists." }
      : { ok: false, status: 500, code: "DB_ERROR", error: "Could not load the appraisal." };
  }
  const skipCode = await currentSkipCode(supabase, row, reminderToday(now));
  const email = renderEmail(kind, { ...loaded.context, isOverdue: (row.offset_days ?? 0) > 0 });
  return {
    ok: true,
    subject: email.subject,
    html: email.html,
    text: email.text,
    notice: PREVIEW_NOTICE,
    stateChanged: skipCode !== null,
    stateChangeReason: deliveryReasonLabel(skipCode),
    warnings: loaded.warnings,
  };
}

const RETRY_COLUMNS = `${DELIVERY_COLUMNS}, error_code`;

export type RetryResult =
  | {
      ok: true;
      deliveryId: string;
      previousStatus: string;
      status: string;
      statusLabel: string;
      attemptCount: number;
      outcome: DeliveryOutcome;
      reason: string | null;
    }
  | { ok: false; status: 404 | 409; code: string; error: string };

/**
 * Manually retries one FAILED reminder through the scheduled-job worker. Blocked (no override) when
 * already sent, not failed, permanently rejected, out of attempts, or the recipient has no email.
 * The worker re-checks the appraisal: if the step is done the row becomes SKIPPED instead.
 */
export async function retryDelivery(
  supabase: SupabaseClient,
  id: string,
  actor: { id: string },
  now: Date = new Date()
): Promise<RetryResult> {
  const { data, error } = await supabase.from("appraisal_notification_deliveries").select(RETRY_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as (DeliveryRow & { error_code: string | null }) | null;
  if (!row) return { ok: false, status: 404, code: "NOT_FOUND", error: "Reminder not found." };

  const skipCode = await currentSkipCode(supabase, row, reminderToday(now));
  const stillRequired = skipCode === null;
  const hasRecipientEmail = stillRequired ? Boolean((await resolveRecipientEmail(supabase, row.recipient_employee_id)).email) : true;
  const block = retryBlockReason({
    status: row.status,
    attemptCount: row.attempt_count,
    errorCode: row.error_code,
    hasRecipientEmail,
    stillRequired: true,
  });
  if (block) return { ok: false, status: 409, code: block.code, error: block.message };

  const outcome = await deliverReminder(supabase, row, now);
  if (outcome === "NOT_CLAIMED") {
    return { ok: false, status: 409, code: "IN_PROGRESS", error: "This reminder is already being processed. Refresh to see its latest status." };
  }

  const { data: after } = await supabase
    .from("appraisal_notification_deliveries")
    .select("status, attempt_count, error_code")
    .eq("id", id)
    .maybeSingle();
  const result = (after as { status: string; attempt_count: number; error_code: string | null } | null) ?? {
    status: row.status,
    attempt_count: row.attempt_count,
    error_code: row.error_code,
  };

  await recordRetryAudit(supabase, {
    actorId: actor.id,
    deliveryId: row.id,
    appraisalId: row.appraisal_id,
    kind: row.notification_kind,
    previousStatus: row.status,
    resultingStatus: result.status,
    attemptCount: result.attempt_count,
    errorCode: result.error_code,
    at: now.toISOString(),
  });

  return {
    ok: true,
    deliveryId: row.id,
    previousStatus: row.status,
    status: result.status,
    statusLabel: statusDisplay(result.status).label,
    attemptCount: result.attempt_count,
    outcome,
    reason: deliveryReasonLabel(result.error_code),
  };
}

/** Audit row plus a structured log line; no email content. A failed audit write never blocks the retry. */
async function recordRetryAudit(
  supabase: SupabaseClient,
  e: {
    actorId: string;
    deliveryId: string;
    appraisalId: string;
    kind: string;
    previousStatus: string;
    resultingStatus: string;
    attemptCount: number;
    errorCode: string | null;
    at: string;
  }
) {
  const from = statusDisplay(e.previousStatus).label;
  const to = statusDisplay(e.resultingStatus).label;
  try {
    const { error } = await supabase.from("appraisal_audit").insert({
      appraisal_id: e.appraisalId,
      action_type: "reminder_retry",
      actor_id: isAppUserUuid(e.actorId) ? e.actorId : null,
      acted_at: e.at,
      summary: `Reminder delivery retried manually (${from} to ${to})`,
      detail: {
        delivery_id: e.deliveryId,
        notification_kind: e.kind,
        previous_status: e.previousStatus,
        resulting_status: e.resultingStatus,
        attempt_count: e.attemptCount,
        error_code: e.errorCode,
      },
    });
    if (error) console.error("[reminder-operations] retry audit insert failed", { deliveryId: e.deliveryId });
  } catch {
    console.error("[reminder-operations] retry audit insert failed", { deliveryId: e.deliveryId });
  }
  console.info(
    JSON.stringify({
      event: "appraisal_reminder_retry",
      actor_id: e.actorId,
      delivery_id: e.deliveryId,
      previous_status: e.previousStatus,
      resulting_status: e.resultingStatus,
      at: e.at,
    })
  );
}

export interface OutstandingActionItem {
  appraisalId: string;
  employeeName: string;
  reviewStage: string;
  requiredAction: string;
  responsibleRole: string;
  responsibleName: string | null;
  dueDate: string;
  dueDateLabel: string | null;
  daysOverdue: number;
  lastReminderSentAt: string | null;
  escalationCandidate: boolean;
  escalationKey: string;
  escalationTarget: (EscalationTarget & { name: string | null }) | null;
}

export interface OutstandingActionsResult {
  items: OutstandingActionItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: { overdue: number; employeeActions: number; managerActions: number; escalationCandidates: number };
  escalationDaysOverdue: number;
  warnings: string[];
  cycles: CycleOption[];
  cycleId: string | null;
}

async function loadActionDeliveries(supabase: SupabaseClient, appraisalIds: string[]): Promise<ActionDeliveryRecord[]> {
  const out: ActionDeliveryRecord[] = [];
  for (const part of chunks(appraisalIds)) {
    const { data, error } = await supabase
      .from("appraisal_notification_deliveries")
      .select("appraisal_id, recipient_employee_id, notification_kind, due_date, offset_days, status, attempt_count, sent_at")
      .in("appraisal_id", part);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as ActionDeliveryRecord[]));
  }
  return out;
}

async function loadPrimaryManagers(supabase: SupabaseClient, employeeIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const part of chunks([...new Set(employeeIds)])) {
    const { data, error } = await supabase
      .from("reporting_lines")
      .select("employee_id, manager_employee_id")
      .in("employee_id", part)
      .eq("is_primary", true);
    if (error) throw new Error(error.message);
    for (const l of (data ?? []) as { employee_id: string; manager_employee_id: string | null }[]) {
      if (!l.manager_employee_id) continue;
      map.set(l.employee_id, [...(map.get(l.employee_id) ?? []), l.manager_employee_id]);
    }
  }
  return map;
}

/**
 * Overdue steps on open cycles, from the same state rules the reminder planner uses, with the last
 * reminder sent and escalation candidates. Read-only; nothing is emailed.
 */
export async function listOutstandingActions(
  supabase: SupabaseClient,
  options: {
    cycleId?: string | null;
    candidatesOnly?: boolean;
    page: number;
    pageSize: number;
    now?: Date;
    env?: Record<string, string | undefined>;
  }
): Promise<OutstandingActionsResult> {
  const now = options.now ?? new Date();
  const escalation = loadEscalationPolicy(options.env);
  const { cycles, currentCycleId } = await loadCycleOptions(supabase);
  const cycleId = options.cycleId === undefined ? currentCycleId : options.cycleId;

  const data = await loadPlanningData(supabase);
  const appraisals = cycleId ? data.appraisals.filter((a) => a.cycle_id === cycleId) : data.appraisals;
  const deliveries = await loadActionDeliveries(supabase, appraisals.map((a) => a.id));
  const all = outstandingAppraisalActions(
    { today: reminderToday(now), cycles: data.cycles, appraisals, formalCheckIns: data.formalCheckIns },
    deliveries,
    escalation.daysOverdue
  );

  const summary = {
    overdue: all.length,
    employeeActions: all.filter((a) => a.responsibleRole === "employee").length,
    managerActions: all.filter((a) => a.responsibleRole === "manager").length,
    escalationCandidates: all.filter((a) => a.escalationCandidate).length,
  };
  const filtered = options.candidatesOnly ? all.filter((a) => a.escalationCandidate) : all;
  const offset = (options.page - 1) * options.pageSize;
  const pageActions = filtered.slice(offset, offset + options.pageSize);

  const managerByAppraisal = new Map(appraisals.map((a) => [a.id, a.manager_employee_id]));
  const escalatingManagers = pageActions
    .filter((a) => a.escalationCandidate && a.responsibleRole === "manager" && a.responsibleEmployeeId)
    .map((a) => a.responsibleEmployeeId as string);
  const primaryManagers = escalatingManagers.length ? await loadPrimaryManagers(supabase, escalatingManagers) : new Map<string, string[]>();

  const targets = new Map<OutstandingAction, EscalationTarget>();
  for (const a of pageActions) {
    if (a.escalationCandidate) targets.set(a, suggestEscalationTarget(a, managerByAppraisal.get(a.appraisalId) ?? null, primaryManagers));
  }
  const names = await loadEmployeeNames(
    supabase,
    [
      ...pageActions.map((a) => a.employeeId),
      ...pageActions.map((a) => a.responsibleEmployeeId ?? ""),
      ...[...targets.values()].map((t) => t.employeeId ?? ""),
    ].filter(Boolean)
  );

  const items = pageActions.map((a): OutstandingActionItem => {
    const target = targets.get(a);
    return {
      appraisalId: a.appraisalId,
      employeeName: names.get(a.employeeId) ?? "Employee",
      reviewStage: a.reviewStage,
      requiredAction: a.requiredAction,
      responsibleRole: a.responsibleRole,
      responsibleName: a.responsibleEmployeeId ? names.get(a.responsibleEmployeeId) ?? null : null,
      dueDate: a.dueDate,
      dueDateLabel: formatMidyearDate(a.dueDate),
      daysOverdue: a.daysOverdue,
      lastReminderSentAt: a.lastReminderSentAt,
      escalationCandidate: a.escalationCandidate,
      escalationKey: a.escalationKey,
      escalationTarget: target ? { ...target, name: target.employeeId ? names.get(target.employeeId) ?? null : null } : null,
    };
  });

  return {
    items,
    total: filtered.length,
    page: options.page,
    pageSize: options.pageSize,
    summary,
    escalationDaysOverdue: escalation.daysOverdue,
    warnings: escalation.warnings,
    cycles: cycles.filter((c) => data.cycles.some((open) => open.id === c.id)),
    cycleId,
  };
}
