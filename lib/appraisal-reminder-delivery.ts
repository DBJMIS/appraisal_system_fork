/**
 * Runs scheduled appraisal reminders: plans today's occurrences, records them in
 * appraisal_notification_deliveries (unique per appraisal, recipient and reminder key), then claims
 * and delivers due rows. Server-only; expects the service-role client.
 *
 * Each delivery is claimed (PENDING/FAILED -> SENDING) before anything is sent, eligibility is
 * re-checked against current data, the email is rendered with renderEmail and sent with
 * sendEmailViaGraph, and SENT is recorded only after Graph accepts the message. Failures store a
 * sanitised code and are retried with bounded backoff. A dry run reads only and writes nothing.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmailViaGraph } from "@/lib/email";
import { EMAIL_TEMPLATES, renderEmail } from "@/lib/email-templates";
import { isLocalAppUrl, loadEmailContext, resolveAppBaseUrl } from "@/lib/email-context";
import { sanitizeGraphError } from "@/lib/admin-email-tools";
import { createNotificationForEmployeeId } from "@/lib/notifications/create";
import {
  MAX_DELIVERIES_PER_RUN,
  MAX_DELIVERY_ATTEMPTS,
  RUN_TIME_BUDGET_MS,
  STALE_SENDING_MINUTES,
  describeOffset,
  loadReminderPolicy,
  reminderToday,
  retryDelayMinutes,
  shortOffsetLabel,
  type ReminderPolicy,
} from "@/lib/appraisal-reminder-policy";
import {
  appraisalReminderState,
  isReminderKind,
  occurrenceId,
  reminderSkipReason,
  planAppraisalReminders,
  upcomingAppraisalReminders,
  type PlannedReminder,
  type ReminderKind,
  type ReminderAppraisal,
  type ReminderCycle,
  type ReminderFormalCheckIn,
} from "@/lib/appraisal-reminder-planner";
import { formatMidyearDate } from "@/lib/midyear-config";
import { isPermanentFailure } from "@/lib/reminder-operations-display";

/** Statuses in which an appraisal can still need a reminder; everything else is never loaded. */
const REMINDABLE_APPRAISAL_STATUSES = ["IN_PROGRESS", "SELF_ASSESSMENT", "MANAGER_REVIEW"];
const FORMAL_REVIEW_MODES = ["FORMAL", "FORMAL_SCORED"];
const CYCLE_COLUMNS = "id, status, end_date, midyear_review_enabled, midyear_window_start, midyear_due_date";
const APPRAISAL_COLUMNS = "id, employee_id, manager_employee_id, cycle_id, status";
export const DELIVERY_COLUMNS =
  "id, appraisal_id, recipient_employee_id, recipient_role, notification_kind, reminder_key, offset_days, due_date, status, attempt_count, claim_token, last_attempt_at, in_app_notified_at";

const IN_CHUNK = 150;
const PAGE = 1000;

export interface DeliveryRow {
  id: string;
  appraisal_id: string;
  recipient_employee_id: string;
  recipient_role: string;
  notification_kind: string;
  reminder_key: string;
  offset_days: number | null;
  due_date: string | null;
  status: string;
  attempt_count: number;
  claim_token: string | null;
  last_attempt_at: string | null;
  in_app_notified_at: string | null;
}

export interface DryRunReminder {
  appraisalId: string;
  employeeName: string;
  kind: string;
  kindLabel: string;
  recipientRole: string;
  dueDate: string | null;
  offset: string;
}

export interface ReminderRunSummary {
  dryRun: boolean;
  date: string;
  appraisalsChecked: number;
  remindersPlanned: number;
  created: number;
  alreadyScheduled: number;
  /** Deliveries due to be attempted (new or retries). In a dry run: how many would be attempted. */
  deliveriesDue: number;
  sent: number;
  skipped: number;
  failed: number;
  retriesScheduled: number;
  /** Due deliveries left for the next run because this run reached its time budget. */
  deferred: number;
  warnings: string[];
  /** Informational messages for expected situations (e.g. local testing); not configuration problems. */
  notices: ReminderRunNotice[];
  reminders?: DryRunReminder[];
  /** Dry run only: the soonest reminder after today, if one can be calculated from current data. */
  nextEligibleReminder?: UpcomingReminder | null;
  /** Dry run only: up to UPCOMING_LIMIT next reminders, one per appraisal, soonest first. */
  upcomingReminders?: UpcomingReminder[];
}

export interface ReminderRunNotice {
  title: string;
  message: string;
}

export interface UpcomingReminder {
  appraisalId: string;
  employeeName: string;
  reviewType: string;
  kind: ReminderKind;
  label: string;
  recipientRole: string;
  /** ISO date the reminder becomes due. */
  scheduledDate: string;
  scheduledDateLabel: string;
  offsetDays: number | null;
  timing: string;
}

const UPCOMING_LIMIT = 3;

export const LOCAL_TESTING_NOTICE: ReminderRunNotice = {
  title: "Local testing mode",
  message: "Email links point to localhost and will only open correctly on this computer.",
};

export type DeliveryOutcome = "SENT" | "SKIPPED" | "FAILED" | "RETRY" | "NOT_CLAIMED";

const chunks = <T,>(items: T[], size = IN_CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const isDuplicate = (error: { code?: string; message?: string } | null) =>
  Boolean(error) && (error?.code === "23505" || /duplicate key/i.test(error?.message ?? ""));

async function readAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export interface PlanningData {
  cycles: ReminderCycle[];
  appraisals: ReminderAppraisal[];
  formalCheckIns: ReminderFormalCheckIn[];
  existing: Set<string>;
}

export async function loadPlanningData(supabase: SupabaseClient): Promise<PlanningData> {
  const { data: cycleRows, error: cycleErr } = await supabase.from("appraisal_cycles").select(CYCLE_COLUMNS).eq("status", "open");
  if (cycleErr) throw new Error(cycleErr.message);
  const cycles = (cycleRows ?? []) as ReminderCycle[];
  if (cycles.length === 0) return { cycles, appraisals: [], formalCheckIns: [], existing: new Set() };

  const appraisals = await readAll<ReminderAppraisal>((from, to) =>
    supabase
      .from("appraisals")
      .select(APPRAISAL_COLUMNS)
      .in("cycle_id", cycles.map((c) => c.id))
      .in("status", REMINDABLE_APPRAISAL_STATUSES)
      .order("id")
      .range(from, to)
  );

  const formalCheckIns: ReminderFormalCheckIn[] = [];
  const existing = new Set<string>();
  for (const ids of chunks(appraisals.map((a) => a.id))) {
    const { data: formal, error: formalErr } = await supabase
      .from("check_ins")
      .select("appraisal_id, status")
      .in("appraisal_id", ids)
      .in("review_mode", FORMAL_REVIEW_MODES);
    if (formalErr) throw new Error(formalErr.message);
    formalCheckIns.push(...((formal ?? []) as ReminderFormalCheckIn[]));

    const recorded = await readAll<{ appraisal_id: string; recipient_employee_id: string; reminder_key: string }>((from, to) =>
      supabase
        .from("appraisal_notification_deliveries")
        .select("appraisal_id, recipient_employee_id, reminder_key")
        .in("appraisal_id", ids)
        .order("id")
        .range(from, to)
    );
    for (const r of recorded) existing.add(occurrenceId(r.appraisal_id, r.recipient_employee_id, r.reminder_key));
  }

  return { cycles, appraisals, formalCheckIns, existing };
}

async function loadDueDeliveries(supabase: SupabaseClient, nowIso: string): Promise<DeliveryRow[]> {
  const { data: pending, error: pendingErr } = await supabase
    .from("appraisal_notification_deliveries")
    .select(DELIVERY_COLUMNS)
    .eq("status", "PENDING")
    .order("scheduled_for")
    .limit(MAX_DELIVERIES_PER_RUN);
  if (pendingErr) throw new Error(pendingErr.message);
  const { data: retry, error: retryErr } = await supabase
    .from("appraisal_notification_deliveries")
    .select(DELIVERY_COLUMNS)
    .eq("status", "FAILED")
    .lte("next_retry_at", nowIso)
    .lt("attempt_count", MAX_DELIVERY_ATTEMPTS)
    .order("next_retry_at")
    .limit(MAX_DELIVERIES_PER_RUN);
  if (retryErr) throw new Error(retryErr.message);
  return [...((pending ?? []) as DeliveryRow[]), ...((retry ?? []) as DeliveryRow[])].slice(0, MAX_DELIVERIES_PER_RUN);
}

/** Releases deliveries stuck in SENDING by a run that never finished, counting the lost attempt. */
async function recoverStaleSending(supabase: SupabaseClient, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_SENDING_MINUTES * 60_000).toISOString();
  const { data, error } = await supabase
    .from("appraisal_notification_deliveries")
    .select(DELIVERY_COLUMNS)
    .eq("status", "SENDING")
    .lt("last_attempt_at", cutoff)
    .limit(MAX_DELIVERIES_PER_RUN);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as DeliveryRow[]) {
    const attempts = row.attempt_count + 1;
    const delay = retryDelayMinutes(attempts);
    await supabase
      .from("appraisal_notification_deliveries")
      .update({
        status: "FAILED",
        attempt_count: attempts,
        error_code: "INTERRUPTED",
        next_retry_at: delay == null ? null : now.toISOString(),
        claim_token: null,
        updated_at: now.toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "SENDING")
      .eq("attempt_count", row.attempt_count);
  }
}

/** PENDING/FAILED -> SENDING, guarded on the row being unchanged; true only for the run that won. */
async function claimDelivery(supabase: SupabaseClient, row: DeliveryRow, nowIso: string): Promise<string | null> {
  const token = randomUUID();
  const { error } = await supabase
    .from("appraisal_notification_deliveries")
    .update({ status: "SENDING", claim_token: token, last_attempt_at: nowIso, updated_at: nowIso })
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("attempt_count", row.attempt_count);
  if (error) return null;
  const { data } = await supabase.from("appraisal_notification_deliveries").select("claim_token, status").eq("id", row.id).maybeSingle();
  const claimed = data as { claim_token?: string | null; status?: string } | null;
  return claimed?.status === "SENDING" && claimed.claim_token === token ? token : null;
}

async function finishDelivery(supabase: SupabaseClient, id: string, token: string, patch: Record<string, unknown>, nowIso: string) {
  const { error } = await supabase
    .from("appraisal_notification_deliveries")
    .update({ ...patch, claim_token: null, updated_at: nowIso })
    .eq("id", id)
    .eq("claim_token", token);
  if (error) console.error("[appraisal-reminders] delivery update failed", { deliveryId: id });
}

export async function resolveRecipientEmail(supabase: SupabaseClient, employeeId: string): Promise<{ email: string | null; name: string | null }> {
  const { data: employee } = await supabase.from("employees").select("full_name, email").eq("employee_id", employeeId).maybeSingle();
  const e = employee as { full_name?: string | null; email?: string | null } | null;
  let email = e?.email?.trim() || null;
  if (!email) {
    const { data: user } = await supabase.from("app_users").select("email").eq("employee_id", employeeId).limit(1).maybeSingle();
    email = (user as { email?: string | null } | null)?.email?.trim() || null;
  }
  return { email, name: e?.full_name?.trim() || null };
}

export async function loadCurrentState(supabase: SupabaseClient, appraisalId: string, today: string) {
  const { data: appraisal, error } = await supabase.from("appraisals").select(APPRAISAL_COLUMNS).eq("id", appraisalId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!appraisal) return null;
  const a = appraisal as ReminderAppraisal;
  const [{ data: cycle, error: cycleErr }, { data: formal, error: formalErr }] = await Promise.all([
    a.cycle_id
      ? supabase.from("appraisal_cycles").select(CYCLE_COLUMNS).eq("id", a.cycle_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("check_ins").select("appraisal_id, status").eq("appraisal_id", a.id).in("review_mode", FORMAL_REVIEW_MODES),
  ]);
  if (cycleErr || formalErr) throw new Error((cycleErr ?? formalErr)!.message);
  return {
    appraisal: a,
    state: appraisalReminderState(a, (cycle as ReminderCycle | null) ?? null, (formal ?? []) as ReminderFormalCheckIn[], today),
  };
}

export async function deliverReminder(supabase: SupabaseClient, row: DeliveryRow, now: Date): Promise<DeliveryOutcome> {
  const nowIso = now.toISOString();
  const today = reminderToday(now);
  const token = await claimDelivery(supabase, row, nowIso);
  if (!token) return "NOT_CLAIMED";
  const attempts = row.attempt_count + 1;

  const fail = async (code: string, permanent = false): Promise<DeliveryOutcome> => {
    const delay = permanent ? null : retryDelayMinutes(attempts);
    await finishDelivery(
      supabase,
      row.id,
      token,
      {
        status: "FAILED",
        attempt_count: attempts,
        error_code: code,
        next_retry_at: delay == null ? null : new Date(now.getTime() + delay * 60_000).toISOString(),
      },
      nowIso
    );
    console.warn("[appraisal-reminders] delivery failed", { deliveryId: row.id, code, attempt: attempts, willRetry: delay != null });
    return delay == null ? "FAILED" : "RETRY";
  };
  const skip = async (code: string): Promise<DeliveryOutcome> => {
    await finishDelivery(supabase, row.id, token, { status: "SKIPPED", error_code: code, next_retry_at: null }, nowIso);
    return "SKIPPED";
  };

  try {
    const kind = row.notification_kind;
    if (!isReminderKind(kind)) return await skip("UNSUPPORTED_KIND");

    const current = await loadCurrentState(supabase, row.appraisal_id, today);
    if (!current) return await skip("APPRAISAL_NOT_FOUND");
    const skipReason = reminderSkipReason(row, current.appraisal, current.state);
    if (skipReason) return await skip(skipReason);

    const loaded = await loadEmailContext(supabase, row.appraisal_id, kind);
    if (!loaded.ok) return await fail(loaded.reason === "NOT_FOUND" ? "APPRAISAL_NOT_FOUND" : "CONTEXT_UNAVAILABLE");
    const context = { ...loaded.context, isOverdue: (row.offset_days ?? 0) > 0 };
    const email = renderEmail(kind, context);

    if (!row.in_app_notified_at) {
      await createNotificationForEmployeeId(row.recipient_employee_id, {
        type: "appraisal.reminder",
        title: email.subject,
        body: EMAIL_TEMPLATES[kind].content(context).body[0] ?? email.subject,
        link: `/appraisals/${row.appraisal_id}`,
        metadata: { appraisal_id: row.appraisal_id, kind, reminder_key: row.reminder_key, delivery_id: row.id },
      });
      await supabase
        .from("appraisal_notification_deliveries")
        .update({ in_app_notified_at: nowIso, updated_at: nowIso })
        .eq("id", row.id)
        .eq("claim_token", token);
    }

    const recipient = await resolveRecipientEmail(supabase, row.recipient_employee_id);
    if (!recipient.email) return await skip("NO_RECIPIENT_EMAIL");

    const result = await sendEmailViaGraph({
      to: recipient.email,
      toName: recipient.name ?? undefined,
      subject: email.subject,
      textContent: email.text,
      htmlContent: email.html,
    });
    if (!result.success) {
      const { code } = sanitizeGraphError(result.error);
      await supabase.from("appraisal_notification_deliveries").update({ recipient_email: recipient.email }).eq("id", row.id).eq("claim_token", token);
      return await fail(code, isPermanentFailure(code));
    }

    await finishDelivery(
      supabase,
      row.id,
      token,
      {
        status: "SENT",
        attempt_count: attempts,
        sent_at: nowIso,
        recipient_email: recipient.email,
        error_code: null,
        next_retry_at: null,
      },
      nowIso
    );
    return "SENT";
  } catch {
    return fail("PROCESSING_ERROR");
  }
}

export async function loadEmployeeNames(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const part of chunks([...new Set(ids)])) {
    const { data } = await supabase.from("employees").select("employee_id, full_name").in("employee_id", part);
    for (const p of (data ?? []) as { employee_id: string; full_name?: string | null }[]) {
      if (p.full_name?.trim()) names.set(p.employee_id, p.full_name.trim());
    }
  }
  return names;
}

function dryRunRows(planned: PlannedReminder[], names: Map<string, string>): DryRunReminder[] {
  return planned.map((p) => ({
    appraisalId: p.appraisalId,
    employeeName: names.get(p.employeeId) ?? "Employee",
    kind: p.kind,
    kindLabel: EMAIL_TEMPLATES[p.kind].label,
    recipientRole: p.recipientRole,
    dueDate: formatMidyearDate(p.dueDate),
    offset: describeOffset(p.offsetDays),
  }));
}

const reviewTypeOf = (kind: ReminderKind) => (kind.startsWith("MIDYEAR") ? "Mid-Year Review" : "Final Review");

function upcomingRow(p: PlannedReminder, names: Map<string, string>): UpcomingReminder {
  return {
    appraisalId: p.appraisalId,
    employeeName: names.get(p.employeeId) ?? "Employee",
    reviewType: reviewTypeOf(p.kind),
    kind: p.kind,
    label: EMAIL_TEMPLATES[p.kind].label,
    recipientRole: p.recipientRole,
    scheduledDate: p.scheduledFor,
    scheduledDateLabel: formatMidyearDate(p.scheduledFor) ?? p.scheduledFor,
    offsetDays: p.offsetDays,
    timing: shortOffsetLabel(p.offsetDays),
  };
}

export async function runAppraisalReminders(
  supabase: SupabaseClient,
  options: { now?: Date; dryRun?: boolean; policy?: ReminderPolicy; timeBudgetMs?: number } = {}
): Promise<ReminderRunSummary> {
  const startedAt = Date.now();
  const budgetMs = options.timeBudgetMs ?? RUN_TIME_BUDGET_MS;
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const today = reminderToday(now);
  const loadedPolicy = options.policy ? { ...options.policy, warnings: [] } : loadReminderPolicy();
  const warnings = [...loadedPolicy.warnings];
  const notices: ReminderRunNotice[] = [];
  const app = resolveAppBaseUrl();
  if (isLocalAppUrl(app.url) && process.env.NODE_ENV !== "production") notices.push(LOCAL_TESTING_NOTICE);
  else if (app.warning) warnings.push(app.warning);

  const data = await loadPlanningData(supabase);
  const planInput = {
    today,
    policy: loadedPolicy,
    cycles: data.cycles,
    appraisals: data.appraisals,
    formalCheckIns: data.formalCheckIns,
    existing: data.existing,
  };
  const planned = planAppraisalReminders(planInput);

  const summary: ReminderRunSummary = {
    dryRun: Boolean(options.dryRun),
    date: today,
    appraisalsChecked: data.appraisals.length,
    remindersPlanned: planned.length,
    created: 0,
    alreadyScheduled: 0,
    deliveriesDue: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    retriesScheduled: 0,
    deferred: 0,
    warnings,
    notices,
  };

  if (options.dryRun) {
    const upcoming = upcomingAppraisalReminders(planInput, UPCOMING_LIMIT);
    const names = await loadEmployeeNames(supabase, [...planned, ...upcoming].map((p) => p.employeeId));
    summary.reminders = dryRunRows(planned, names);
    summary.upcomingReminders = upcoming.map((p) => upcomingRow(p, names));
    summary.nextEligibleReminder = summary.upcomingReminders[0] ?? null;
    summary.deliveriesDue = planned.length + (await loadDueDeliveries(supabase, nowIso)).length;
    return summary;
  }

  for (const p of planned) {
    const { error } = await supabase.from("appraisal_notification_deliveries").insert({
      appraisal_id: p.appraisalId,
      cycle_id: p.cycleId,
      recipient_employee_id: p.recipientEmployeeId,
      recipient_role: p.recipientRole,
      notification_kind: p.kind,
      reminder_key: p.reminderKey,
      offset_days: p.offsetDays,
      due_date: p.dueDate,
      scheduled_for: p.scheduledFor,
      status: "PENDING",
      attempt_count: 0,
    });
    if (!error) summary.created++;
    else if (isDuplicate(error)) summary.alreadyScheduled++;
    else throw new Error(error.message);
  }

  await recoverStaleSending(supabase, now);
  const due = await loadDueDeliveries(supabase, nowIso);
  summary.deliveriesDue = due.length;
  for (const [i, row] of due.entries()) {
    if (Date.now() - startedAt > budgetMs) {
      summary.deferred = due.length - i;
      break;
    }
    const outcome = await deliverReminder(supabase, row, now);
    if (outcome === "SENT") summary.sent++;
    else if (outcome === "SKIPPED") summary.skipped++;
    else if (outcome === "FAILED") summary.failed++;
    else if (outcome === "RETRY") {
      summary.failed++;
      summary.retriesScheduled++;
    }
  }

  console.info("[appraisal-reminders] run complete", {
    date: summary.date,
    appraisalsChecked: summary.appraisalsChecked,
    created: summary.created,
    alreadyScheduled: summary.alreadyScheduled,
    sent: summary.sent,
    skipped: summary.skipped,
    failed: summary.failed,
    retriesScheduled: summary.retriesScheduled,
    deferred: summary.deferred,
  });
  return summary;
}
