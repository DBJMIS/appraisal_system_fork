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

/**
 * PATCH /api/admin/cycles/[cycleId]
 * Partial update of a cycle: status and/or the Mid-Year settings
 * (midyear_review_enabled, midyear_scoring_enabled, midyear_window_start, midyear_due_date).
 * Only fields present in the body change. Uses service role to bypass RLS.
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
    if (!status && !changesMidyear) {
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

    if (changesMidyear) {
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
      if (LOCKED_CYCLE_STATUSES.includes(String(cycle.status))) {
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

    const { error } = await supabase
      .from("appraisal_cycles")
      .update(update)
      .eq("id", cycleId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
