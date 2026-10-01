import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { hasOversightReadAccess } from "@/lib/appraisal-oversight";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase config");
  return createClient(url, key);
}

type Ctx = { params: Promise<{ id: string }> };

/** GET — evidence count per workplan item for one appraisal. Same visibility as the evidence list. */
export async function GET(_req: NextRequest, context: Ctx) {
  try {
    const user = await getCurrentUser();
    const isHrOrAdmin = user?.roles?.some((r) => r === "hr" || r === "admin") ?? false;
    if (!user?.employee_id && !isHrOrAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: appraisalId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, division_id")
      .eq("id", appraisalId)
      .maybeSingle();
    if (!appraisal) return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });

    const employeeId = user?.employee_id ?? null;
    const allowed =
      isHrOrAdmin ||
      (!!employeeId && (appraisal.employee_id === employeeId || appraisal.manager_employee_id === employeeId)) ||
      (!!user?.roles?.includes("gm") && user?.division_id != null && appraisal.division_id === user.division_id);
    if (!allowed && !(await hasOversightReadAccess(user, appraisal))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: rows, error } = await supabase
      .from("workplan_item_evidence")
      .select("workplan_item_id")
      .eq("appraisal_id", appraisalId);
    if (error) {
      console.error("[evidence-counts]", { appraisalId, code: error.code });
      return NextResponse.json({ error: "Could not load evidence counts" }, { status: 500 });
    }

    const counts: Record<string, number> = {};
    for (const row of (rows ?? []) as Array<{ workplan_item_id: string }>) {
      counts[row.workplan_item_id] = (counts[row.workplan_item_id] ?? 0) + 1;
    }
    return NextResponse.json({ counts });
  } catch (err) {
    console.error("[evidence-counts]", err);
    return NextResponse.json({ error: "Could not load evidence counts" }, { status: 500 });
  }
}
