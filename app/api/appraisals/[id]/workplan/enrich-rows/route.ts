import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import type { ColumnMapping } from "../analyse-columns/route";
import { enrichRowsWithAI } from "@/lib/workplan-excel-parse";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase config required");
  return createClient(url, key);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await context.params;
    const body = await req.json();
    const { rows = [], mappings = [] } = body as {
      rows?: Record<string, unknown>[];
      mappings?: ColumnMapping[];
    };

    const supabase = getSupabaseAdmin();
    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, division_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });

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
    if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const rowList = Array.isArray(rows) ? rows : [];
    const mappingList = Array.isArray(mappings) ? mappings : [];
    const enriched = await enrichRowsWithAI(rowList, mappingList);

    return NextResponse.json({ rows: enriched });
  } catch (err) {
    console.error("[workplan/enrich-rows]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
