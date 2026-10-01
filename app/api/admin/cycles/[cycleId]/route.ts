import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import {
  hasMidyearFields,
  LOCKED_CYCLE_STATUSES,
  parseMidyearFields,
  resolveMidyearChange,
  type MidyearCycleFields,
} from "@/lib/midyear-config";
import {
  changedCycleReminderFields,
  hasCycleReminderFields,
  parseCycleReminderFields,
  reminderSettingsWriteError,
  type CycleReminderFields,
} from "@/lib/appraisal-reminder-policy";

/**
 * PATCH /api/admin/cycles/[cycleId]
 * Partial update of a cycle: status, the Mid-Year settings
 * (midyear_review_enabled, midyear_scoring_enabled, midyear_window_start, midyear_due_date)
 * and/or the reminder settings (reminder_days_before, overdue_reminder_days, final_review_notice_days).
 * Only fields present in the body change; reminder settings are written only when they differ from
 * what the cycle uses now. Uses service role to bypass RLS.
 * Requires current user to have hr or admin role.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.roles?.length) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const isAdmin = user.roles.some((r) => r === "hr" || r === "admin");
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { cycleId } = await params;
    if (!cycleId) {
      return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const status = typeof body.status === "string" ? body.status.trim() : null;
    const parsed = parseMidyearFields(body);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const changesMidyear = hasMidyearFields(parsed.fields);
    const reminders = parseCycleReminderFields(body);
    if (reminders.error) {
      return NextResponse.json({ error: reminders.error }, { status: 400 });
    }
    const sendsReminders = hasCycleReminderFields(reminders.fields);
    if (!status && !changesMidyear && !sendsReminders) {
      return NextResponse.json({ error: "status is required" }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    const supabase = createClient(url, key);

    const update: Record<string, unknown> = {};
    if (status) update.status = status;

    let reminderUpdate: CycleReminderFields = {};
    if (changesMidyear || sendsReminders) {
      const { data: cycle, error: cycleErr } = await supabase
        .from("appraisal_cycles")
        .select("*")
        .eq("id", cycleId)
        .maybeSingle();
      if (cycleErr) {
        return NextResponse.json({ error: cycleErr.message }, { status: 500 });
      }
      if (!cycle) {
        return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
      }
      const locked = LOCKED_CYCLE_STATUSES.includes(String(cycle.status));
      if (changesMidyear) {
        if (locked) {
          return NextResponse.json(
            { error: `Mid-Year settings cannot be changed on a ${cycle.status} cycle.` },
            { status: 409 }
          );
        }
        const midyear = resolveMidyearChange(cycle as Partial<MidyearCycleFields>, parsed.fields);
        if (midyear.error) {
          return NextResponse.json({ error: midyear.error }, { status: 400 });
        }
        Object.assign(update, midyear.update);
      }
      reminderUpdate = changedCycleReminderFields(cycle as CycleReminderFields, reminders.fields);
      if (hasCycleReminderFields(reminderUpdate) && locked) {
        return NextResponse.json(
          { error: `Reminder settings cannot be changed on a ${cycle.status} cycle.` },
          { status: 409 }
        );
      }
      Object.assign(update, reminderUpdate);
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ ok: true });
    }

    const { error } = await supabase
      .from("appraisal_cycles")
      .update(update)
      .eq("id", cycleId);

    if (error) {
      const message = hasCycleReminderFields(reminderUpdate) ? reminderSettingsWriteError(error) ?? error.message : error.message;
      return NextResponse.json({ error: message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
