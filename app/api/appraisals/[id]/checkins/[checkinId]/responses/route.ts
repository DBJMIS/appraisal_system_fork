import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";
import { isFormalReviewMode } from "@/lib/midyear-config";
import { MIDYEAR_APPRAISAL_STATUS, MIDYEAR_LOCKED_MESSAGE } from "@/lib/midyear-lifecycle";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase URL and service role key required");
  return createClient(url, key);
}

type RouteContext = { params: Promise<{ id: string; checkinId: string }> };

function canAccessAppraisal(
  user: { roles?: string[]; employee_id?: string | null; division_id?: string | null },
  appraisal: { employee_id: string; manager_employee_id: string | null; division_id?: string | null },
  hasManagerAccess: boolean
) {
  return (
    user.roles?.some((r) => r === "hr" || r === "admin") ||
    appraisal.employee_id === user.employee_id ||
    hasManagerAccess ||
    (user.roles?.includes("gm") && appraisal.division_id === user.division_id)
  );
}

// PATCH — update individual response items (draft only; no status change)
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId, checkinId } = await context.params;
    const body = await req.json().catch(() => []);
    const items = Array.isArray(body) ? body : [];

    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, division_id, status")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    const managerAccess = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId: user.employee_id ?? null,
    });
    if (!canAccessAppraisal(user, appraisal, managerAccess.hasManagerAccess)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: checkIn, error: ciErr } = await supabase
      .from("check_ins")
      .select("*")
      .eq("id", checkinId)
      .eq("appraisal_id", appraisalId)
      .single();

    if (ciErr || !checkIn) {
      return NextResponse.json({ error: "Check-in not found" }, { status: 404 });
    }

    if ((checkIn.status as string) !== "OPEN") {
      return NextResponse.json({ error: "Only draft (OPEN) check-ins can have responses updated via this endpoint" }, { status: 400 });
    }

    if (isFormalReviewMode((checkIn as { review_mode?: string | null }).review_mode)) {
      if ((appraisal as { status?: string }).status !== MIDYEAR_APPRAISAL_STATUS) {
        return NextResponse.json({ error: MIDYEAR_LOCKED_MESSAGE }, { status: 409 });
      }
      if (appraisal.employee_id !== user.employee_id) {
        return NextResponse.json({ error: "Only the employee can enter the employee portion of the Mid-Year Review." }, { status: 403 });
      }
    } else if (appraisal.employee_id !== user.employee_id && !user.roles?.some((r) => r === "hr" || r === "admin")) {
      // Same rule as EMPLOYEE_SAVE_DRAFT: these are the employee's fields.
      return NextResponse.json({ error: "Only the employee or HR can update check-in responses." }, { status: 403 });
    }

    const now = new Date().toISOString();

    for (const item of items) {
      const { workplan_item_id, employee_status, progress_pct, employee_comment } = item as {
        workplan_item_id?: string;
        employee_status?: string | null;
        progress_pct?: number | null;
        employee_comment?: string | null;
      };
      if (!workplan_item_id) continue;

      const payload: Record<string, unknown> = {
        updated_at: now,
      };
      if (employee_status !== undefined) payload.employee_status = employee_status ?? null;
      if (progress_pct !== undefined) payload.progress_pct = progress_pct == null ? null : Math.min(100, Math.max(0, Number(progress_pct)));
      if (employee_comment !== undefined) payload.employee_comment = employee_comment ?? null;
      if (payload.employee_status !== undefined || payload.employee_comment !== undefined || payload.progress_pct !== undefined) {
        payload.employee_updated_at = now;
      }

      await supabase
        .from("check_in_responses")
        .update(payload)
        .eq("check_in_id", checkinId)
        .eq("workplan_item_id", workplan_item_id);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
