import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";

const BUCKET = "workplan-evidence";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase config");
  return createClient(url, key);
}

function canAccessAppraisal(
  user: { roles?: string[]; employee_id?: string | null; division_id?: string | null },
  appraisal: { employee_id: string; manager_employee_id: string | null; division_id?: string | null }
) {
  return (
    user.roles?.some((r) => r === "hr" || r === "admin") ||
    appraisal.employee_id === user.employee_id ||
    appraisal.manager_employee_id === user.employee_id ||
    (user.roles?.includes("gm") && user.division_id != null && appraisal.division_id === user.division_id)
  );
}

type Ctx = { params: Promise<{ id: string; itemId: string; evidenceId: string }> };

/** DELETE — remove an evidence item. Only the user who uploaded it can delete. */
export async function DELETE(_req: NextRequest, context: Ctx) {
  try {
    const user = await getCurrentUser();
    if (!user?.employee_id && !user?.roles?.some((r) => r === "hr" || r === "admin"))
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId, evidenceId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, status, employee_id, manager_employee_id, division_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal)
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    if (!canAccessAppraisal(user, appraisal))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: row, error: fetchErr } = await supabase
      .from("workplan_item_evidence")
      .select("id, storage_path, storage_bucket, uploaded_by")
      .eq("id", evidenceId)
      .eq("appraisal_id", appraisalId)
      .single();

    if (fetchErr || !row)
      return NextResponse.json({ error: "Evidence not found" }, { status: 404 });

    const uploadedBy = (row as { uploaded_by?: string | null }).uploaded_by;
    if (uploadedBy !== user.employee_id)
      return NextResponse.json({ error: "Only the person who added this evidence can delete it" }, { status: 403 });

    const storagePath = row.storage_path as string | null;
    if (row.storage_bucket === BUCKET && storagePath?.startsWith(`${appraisalId}/`)) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
    }

    const { error: delErr } = await supabase
      .from("workplan_item_evidence")
      .delete()
      .eq("id", evidenceId);

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
