import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { withRetry } from "@/lib/retry-transient";
import { parseWorkplanDateForDb } from "@/lib/workplan-excel-parse";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";
import { hasOversightReadAccess } from "@/lib/appraisal-oversight";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase URL and service role key required");
  }
  return createClient(url, key);
}

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/appraisals/[id]/workplan - Get workplan for appraisal
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: appraisalId } = await context.params;
    const supabase = getSupabaseAdmin();

    const result = await withRetry(async () => {
      // Verify user can access this appraisal
      const { data: appraisal, error: appErr } = await supabase
        .from("appraisals")
        .select("id, employee_id, manager_employee_id, division_id")
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
      const canAccess =
        user.roles?.some((r) => r === "hr" || r === "admin") ||
        appraisal.employee_id === user.employee_id ||
        managerAccess.hasManagerAccess ||
        (user.roles?.includes("gm") && appraisal.division_id === user.division_id);
      const oversightOnly = !canAccess && (await hasOversightReadAccess(user, appraisal));

      if (!canAccess && !oversightOnly) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Get or create workplan - use select("*") for backward compatibility
      let { data: workplan, error: wpErr } = await supabase
        .from("workplans")
        .select("*")
        .eq("appraisal_id", appraisalId)
        .maybeSingle();

      if (!workplan && oversightOnly) {
        if (wpErr && wpErr.code !== "PGRST116") throw new Error(wpErr.message || "Failed to get workplan");
        return { workplan: null, items: [] };
      }

      // If no workplan found (not an error, just not exists), create one
      if (!workplan) {
        // Check if there was an actual error vs just not found
        if (wpErr && wpErr.code !== "PGRST116") {
          console.error("Get workplan error:", wpErr);
          throw new Error(wpErr.message || "Failed to get workplan");
        }

        // Create workplan
        const { data: newWp, error: createErr } = await supabase
          .from("workplans")
          .insert({ appraisal_id: appraisalId, status: "draft" })
          .select("*")
          .single();

        if (createErr || !newWp) {
          console.error("Create workplan error:", createErr);
          throw new Error(createErr?.message || "Failed to create workplan");
        }
        workplan = newWp;
      }

      // Ensure backward compatibility - add default values for new columns if not present
      const workplanWithDefaults = {
        ...workplan,
        locked_at: workplan.locked_at ?? null,
        submitted_at: workplan.submitted_at ?? null,
        rejection_reason: workplan.rejection_reason ?? null,
      };

      // Get workplan items
      const { data: rawItems, error: itemsErr } = await supabase
        .from("workplan_items")
        .select("*")
        .eq("workplan_id", workplan.id)
        .order("created_at", { ascending: true });

      if (itemsErr) {
        throw new Error(itemsErr.message);
      }

      const items = rawItems ?? [];
      const corpIds = [...new Set(items.map((i: { corporate_objective_id?: string }) => i.corporate_objective_id).filter(Boolean))] as string[];
      const divIds = [...new Set(items.map((i: { divisional_objective_id?: string }) => i.divisional_objective_id).filter(Boolean))] as string[];

      let corpMap: Record<string, { name: string; achieveit_id: string | null }> = {};
      let divMap: Record<string, { name: string; division: string | null; achieveit_id: string | null }> = {};
      if (corpIds.length > 0) {
        const { data: corpRows } = await supabase.from("corporate_objectives").select("id, name, achieveit_id").in("id", corpIds);
        corpMap = (corpRows ?? []).reduce((acc, r) => ({ ...acc, [r.id]: { name: r.name, achieveit_id: r.achieveit_id ?? null } }), {});
      }
      if (divIds.length > 0) {
        const { data: divRows } = await supabase.from("department_objectives").select("id, name, division, achieveit_id").in("id", divIds);
        divMap = (divRows ?? []).reduce((acc, r) => ({ ...acc, [r.id]: { name: r.name, division: r.division ?? null, achieveit_id: r.achieveit_id ?? null } }), {});
      }

      const enrichedItems = items.map((i: Record<string, unknown>) => {
        const out = { ...i };
        const corpId = i.corporate_objective_id as string | undefined;
        const divId = i.divisional_objective_id as string | undefined;
        if (corpId && corpMap[corpId]) {
          (out as Record<string, unknown>).corporate_title = corpMap[corpId].name;
          (out as Record<string, unknown>).corporate_external_id = corpMap[corpId].achieveit_id ?? "";
        }
        if (divId && divMap[divId]) {
          (out as Record<string, unknown>).divisional_title = divMap[divId].name;
          (out as Record<string, unknown>).divisional_external_id = divMap[divId].achieveit_id ?? "";
          (out as Record<string, unknown>).divisional_division = divMap[divId].division ?? undefined;
        }
        return out;
      });

      return { workplan: workplanWithDefaults, items: enrichedItems };
    });

    if (result instanceof NextResponse) return result;
    return NextResponse.json(result);
  } catch (err) {
    console.error("GET workplan error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

const WORKPLAN_LOCKED_STATUSES = new Set(["PENDING_SIGNOFF", "HOD_REVIEW", "HR_REVIEW", "COMPLETE"]);

// POST /api/appraisals/[id]/workplan - Save workplan items
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: appraisalId } = await context.params;
    const body = await req.json();
    const { workplanId, items, idsToDelete } = body as {
      workplanId: string;
      items: Array<{
        id: string;
        corporate_objective?: string;
        division_objective?: string;
        corporate_objective_id?: string | null;
        divisional_objective_id?: string | null;
        individual_objective?: string;
        task?: string;
        major_task?: string;
        output?: string;
        key_output?: string;
        performance_standard?: string;
        weight: number;
        actual_result?: string | number | null;
        points?: number | null;
        metric_type?: "NUMBER" | "DATE" | "PERCENT" | null;
        metric_target?: number | null;
        metric_deadline?: string | null;
        metric_actual_raw?: number | null;
        metric_completion_date?: string | null;
      }>;
      idsToDelete: string[];
    };

    // Points = (actual_result / 100) * weight (1 decimal)
    function calcPoints(weight: number, actualYTD: number | null | undefined): number | null {
      if (actualYTD == null || Number.isNaN(actualYTD)) return null;
      const w = Number(weight) || 0;
      return Math.round((actualYTD / 100) * w * 10) / 10;
    }

    const supabase = getSupabaseAdmin();

    // Verify user can access this appraisal
    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, status")
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
    const canEdit =
      user.roles?.some((r) => r === "hr" || r === "admin") ||
      (!!user.employee_id && appraisal.employee_id === user.employee_id) ||
      managerAccess.hasManagerAccess;

    if (!canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (WORKPLAN_LOCKED_STATUSES.has(String(appraisal.status ?? "").toUpperCase())) {
      return NextResponse.json(
        { error: "The workplan can no longer be changed at this stage.", code: "WORKPLAN_LOCKED" },
        { status: 409 }
      );
    }

    const { data: ownedWorkplan } = await supabase
      .from("workplans")
      .select("id")
      .eq("id", workplanId)
      .eq("appraisal_id", appraisalId)
      .maybeSingle();
    if (!ownedWorkplan) {
      return NextResponse.json({ error: "Workplan not found" }, { status: 404 });
    }

    // Delete removed items
    if (idsToDelete?.length > 0) {
      const { error: delErr } = await supabase
        .from("workplan_items")
        .delete()
        .eq("workplan_id", workplanId)
        .in("id", idsToDelete);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }
    }

    // Upsert items (DBJ schema: major_task, key_output, actual_result numeric, points computed)
    for (const item of items ?? []) {
      const weight = Number(item.weight) || 0;
      const actualYTD =
        typeof item.actual_result === "number"
          ? item.actual_result
          : item.actual_result != null && String(item.actual_result).trim() !== ""
            ? Number(item.actual_result)
            : null;
      const points = calcPoints(weight, actualYTD);
      const majorTask =
        item.major_task ?? item.task ?? "";
      const keyOutput =
        item.key_output ?? item.output ?? "";
      const metricType = item.metric_type && ["NUMBER", "DATE", "PERCENT"].includes(item.metric_type) ? item.metric_type : "PERCENT";
      const metricDeadline =
        item.metric_deadline != null && String(item.metric_deadline).trim() !== ""
          ? parseWorkplanDateForDb(item.metric_deadline)
          : null;
      const metricCompletionDate =
        item.metric_completion_date != null && String(item.metric_completion_date).trim() !== ""
          ? parseWorkplanDateForDb(item.metric_completion_date)
          : null;
      const payload = {
        workplan_id: workplanId,
        corporate_objective: item.corporate_objective ?? "",
        division_objective: item.division_objective ?? "",
        corporate_objective_id: item.corporate_objective_id ?? null,
        divisional_objective_id: item.divisional_objective_id ?? null,
        individual_objective: item.individual_objective ?? "",
        major_task: majorTask.trim(),
        key_output: keyOutput.trim(),
        performance_standard: item.performance_standard ?? "",
        weight,
        actual_result: actualYTD,
        points,
        metric_type: metricType,
        metric_target: item.metric_target != null ? Number(item.metric_target) : null,
        metric_deadline: metricDeadline,
        metric_actual_raw: item.metric_actual_raw != null ? Number(item.metric_actual_raw) : null,
        metric_completion_date: metricCompletionDate,
      };

      if (item.id.startsWith("new-")) {
        const { error: insErr } = await supabase
          .from("workplan_items")
          .insert(payload);
        if (insErr) {
          return NextResponse.json({ error: insErr.message }, { status: 500 });
        }
      } else {
        const { error: upErr } = await supabase
          .from("workplan_items")
          .update(payload)
          .eq("id", item.id)
          .eq("workplan_id", workplanId);
        if (upErr) {
          return NextResponse.json({ error: upErr.message }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("POST workplan error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
