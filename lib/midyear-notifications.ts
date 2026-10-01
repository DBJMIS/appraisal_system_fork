/**
 * Formal Mid-Year Review notifications (in-app + email). Informal check-ins keep their existing
 * notifications in the check-in routes. Server-only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/notifications";
import { createNotificationForEmployeeId } from "@/lib/notifications/create";
import { LOCKED_CYCLE_STATUSES, fiscalYearLabel, formatMidyearDate } from "@/lib/midyear-config";
import { midyearMessages, type MidyearMessage } from "@/lib/midyear-messages";

export { midyearMessages };
export type { MidyearMessage, MidyearNoticeKind } from "@/lib/midyear-messages";

function portalUrl(appraisalId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const path = `/appraisals/${appraisalId}`;
  return base ? `${base}${path}` : path;
}

interface AppraisalParties {
  employee_id: string;
  manager_employee_id: string | null;
  cycle_id?: string | null;
}

interface Party {
  employeeId: string;
  name: string;
  email: string | null;
}

interface NoticeContext {
  fiscalYear: string | null;
  dueDate: string | null;
  employee: Party;
  manager: Party | null;
}

async function loadContext(supabase: SupabaseClient, appraisal: AppraisalParties): Promise<NoticeContext> {
  const ids = [appraisal.employee_id, appraisal.manager_employee_id].filter(Boolean) as string[];
  const [{ data: people }, { data: cycle }] = await Promise.all([
    supabase.from("employees").select("employee_id, full_name, email").in("employee_id", ids),
    appraisal.cycle_id
      ? supabase.from("appraisal_cycles").select("fiscal_year, midyear_due_date").eq("id", appraisal.cycle_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const byId = new Map(
    ((people ?? []) as { employee_id: string; full_name?: string | null; email?: string | null }[]).map((p) => [p.employee_id, p])
  );
  const party = async (employeeId: string, fallbackName: string): Promise<Party> => {
    const row = byId.get(employeeId);
    let email = row?.email ?? null;
    if (!email) {
      const { data: appUser } = await supabase.from("app_users").select("email").eq("employee_id", employeeId).limit(1).maybeSingle();
      email = (appUser as { email?: string | null } | null)?.email ?? null;
    }
    return { employeeId, name: row?.full_name ?? fallbackName, email };
  };
  const c = cycle as { fiscal_year?: string | null; midyear_due_date?: string | null } | null;
  return {
    fiscalYear: fiscalYearLabel(c?.fiscal_year),
    dueDate: formatMidyearDate(c?.midyear_due_date ?? null),
    employee: await party(appraisal.employee_id, "Employee"),
    manager: appraisal.manager_employee_id ? await party(appraisal.manager_employee_id, "Manager") : null,
  };
}

/** In-app + email to one party. Each channel is independent and non-blocking. */
async function deliver(
  to: Party,
  message: MidyearMessage,
  meta: { appraisalId: string; checkInId?: string | null; greeting?: boolean }
): Promise<void> {
  try {
    await createNotificationForEmployeeId(to.employeeId, {
      type:
        message.kind === "midyear_submitted"
          ? "checkin.completed"
          : message.kind === "midyear_completed" || message.kind === "midyear_revision_completed"
            ? "system.announcement"
            : "checkin.requested",
      title: message.title,
      body: message.body,
      link: `/appraisals/${meta.appraisalId}`,
      metadata: { appraisal_id: meta.appraisalId, check_in_id: meta.checkInId ?? null, kind: message.kind },
    });
  } catch (err) {
    console.error("[midyear-notifications] in-app notification failed:", err);
  }
  if (!to.email) return;
  try {
    await sendEmail({
      to: to.email,
      subject: message.subject,
      bodyText: [
        ...(meta.greeting === false ? [] : [`Hello ${to.name},`]),
        message.body,
        `Open the appraisal portal: ${portalUrl(meta.appraisalId)}`,
      ].join("\n\n"),
    });
  } catch (err) {
    console.error("[midyear-notifications] email failed:", err);
  }
}

type NotifyParams = { appraisalId: string; checkInId: string; appraisal: AppraisalParties };

/** Manager initiated the formal review → employee. */
export async function notifyMidyearReady(supabase: SupabaseClient, p: NotifyParams): Promise<void> {
  try {
    const ctx = await loadContext(supabase, p.appraisal);
    await deliver(ctx.employee, midyearMessages.ready({ fiscalYear: ctx.fiscalYear }), p);
  } catch (err) {
    console.error("[midyear-notifications] ready notice failed:", err);
  }
}

/** Employee submitted → manager. */
export async function notifyMidyearSubmitted(supabase: SupabaseClient, p: NotifyParams): Promise<void> {
  try {
    const ctx = await loadContext(supabase, p.appraisal);
    if (!ctx.manager) return;
    await deliver(ctx.manager, midyearMessages.submitted({ fiscalYear: ctx.fiscalYear, employeeName: ctx.employee.name }), p);
  } catch (err) {
    console.error("[midyear-notifications] submitted notice failed:", err);
  }
}

/** Review completed → employee. */
export async function notifyMidyearCompleted(supabase: SupabaseClient, p: NotifyParams): Promise<void> {
  try {
    const ctx = await loadContext(supabase, p.appraisal);
    await deliver(ctx.employee, midyearMessages.completed({ fiscalYear: ctx.fiscalYear }), p);
  } catch (err) {
    console.error("[midyear-notifications] completed notice failed:", err);
  }
}

/** Completed review reopened for revision → manager and employee, with the reason. */
export async function notifyMidyearReopened(supabase: SupabaseClient, p: NotifyParams & { reason: string }): Promise<void> {
  try {
    const ctx = await loadContext(supabase, p.appraisal);
    const base = { fiscalYear: ctx.fiscalYear, reason: p.reason, employeeName: ctx.employee.name };
    if (ctx.manager) await deliver(ctx.manager, midyearMessages.reopened({ ...base, audience: "manager" }), p);
    await deliver(ctx.employee, midyearMessages.reopened({ ...base, audience: "employee" }), p);
  } catch (err) {
    console.error("[midyear-notifications] reopened notice failed:", err);
  }
}

/** Revised review completed → employee. */
export async function notifyMidyearRevisionCompleted(supabase: SupabaseClient, p: NotifyParams): Promise<void> {
  try {
    const ctx = await loadContext(supabase, p.appraisal);
    await deliver(ctx.employee, midyearMessages.revisionCompleted({ fiscalYear: ctx.fiscalYear }), p);
  } catch (err) {
    console.error("[midyear-notifications] revision completed notice failed:", err);
  }
}

// ── Window-open notices ──────────────────────────────────────────────────────

export interface WindowNoticeSummary {
  openCycles: number;
  eligible: number;
  sent: number;
  alreadyNotified: number;
  failed: number;
}

const isDuplicate = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "23505" || /duplicate key|unique/i.test(e.message ?? ""));

/**
 * Tells each manager, once per appraisal, that the Mid-Year Review window is open. Eligible appraisals
 * are IN_PROGRESS in a cycle whose window has opened and not passed its due date, with no formal review
 * yet. The midyear_window_notices ledger (unique per appraisal and recipient) is claimed before sending,
 * so repeated or concurrent runs never notify twice.
 */
export async function sendMidyearWindowNotices(
  supabase: SupabaseClient,
  opts: { today: string; cycleId?: string | null }
): Promise<WindowNoticeSummary> {
  const summary: WindowNoticeSummary = { openCycles: 0, eligible: 0, sent: 0, alreadyNotified: 0, failed: 0 };

  let cycleQuery = supabase
    .from("appraisal_cycles")
    .select("id, status, midyear_review_enabled, midyear_window_start, midyear_due_date")
    .eq("midyear_review_enabled", true);
  if (opts.cycleId) cycleQuery = cycleQuery.eq("id", opts.cycleId);
  const { data: cycles, error: cycleErr } = await cycleQuery;
  if (cycleErr) throw new Error(cycleErr.message);

  const openCycleIds = ((cycles ?? []) as {
    id: string;
    status?: string | null;
    midyear_window_start?: string | null;
    midyear_due_date?: string | null;
  }[])
    .filter(
      (c) =>
        !LOCKED_CYCLE_STATUSES.includes(String(c.status ?? "").toLowerCase()) &&
        !!c.midyear_window_start &&
        c.midyear_window_start <= opts.today &&
        (!c.midyear_due_date || opts.today <= c.midyear_due_date)
    )
    .map((c) => c.id);
  summary.openCycles = openCycleIds.length;
  if (openCycleIds.length === 0) return summary;

  const { data: appraisals, error: appErr } = await supabase
    .from("appraisals")
    .select("id, employee_id, manager_employee_id, cycle_id, status")
    .in("cycle_id", openCycleIds)
    .eq("status", "IN_PROGRESS");
  if (appErr) throw new Error(appErr.message);
  const candidates = ((appraisals ?? []) as (AppraisalParties & { id: string })[]).filter((a) => !!a.manager_employee_id);
  if (candidates.length === 0) return summary;
  const ids = candidates.map((a) => a.id);

  const [{ data: formal, error: formalErr }, { data: ledger, error: ledgerErr }] = await Promise.all([
    supabase.from("check_ins").select("appraisal_id, status").in("appraisal_id", ids).in("review_mode", ["FORMAL", "FORMAL_SCORED"]),
    supabase.from("midyear_window_notices").select("appraisal_id, recipient_employee_id").in("appraisal_id", ids),
  ]);
  if (formalErr) throw new Error(formalErr.message);
  if (ledgerErr) throw new Error(ledgerErr.message);
  const started = new Set(
    ((formal ?? []) as { appraisal_id: string; status: string }[]).filter((f) => f.status !== "CANCELLED").map((f) => f.appraisal_id)
  );
  const notified = new Set(
    ((ledger ?? []) as { appraisal_id: string; recipient_employee_id: string }[]).map((l) => `${l.appraisal_id}|${l.recipient_employee_id}`)
  );

  for (const a of candidates) {
    if (started.has(a.id)) continue;
    summary.eligible++;
    const recipient = a.manager_employee_id as string;
    if (notified.has(`${a.id}|${recipient}`)) {
      summary.alreadyNotified++;
      continue;
    }
    const { error: claimErr } = await supabase
      .from("midyear_window_notices")
      .insert({ appraisal_id: a.id, cycle_id: a.cycle_id ?? null, recipient_employee_id: recipient });
    if (claimErr) {
      if (isDuplicate(claimErr)) summary.alreadyNotified++;
      else summary.failed++;
      continue;
    }
    try {
      const ctx = await loadContext(supabase, a);
      if (ctx.manager) {
        await deliver(
          ctx.manager,
          midyearMessages.windowOpen({ fiscalYear: ctx.fiscalYear, employeeName: ctx.employee.name, dueDate: ctx.dueDate }),
          { appraisalId: a.id }
        );
      }
      summary.sent++;
    } catch (err) {
      console.error("[midyear-notifications] window notice failed:", err);
      summary.failed++;
    }
  }
  return summary;
}
