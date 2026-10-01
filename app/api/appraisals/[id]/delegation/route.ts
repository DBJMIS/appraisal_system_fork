import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase config");
  return createClient(url, key);
}

function isUuidLike(value: string | null | undefined): value is string {
  if (!value) return false;
  // Accept GUIDs from Dynamics/Dataverse even if they don't match strict UUIDv1-5 bit patterns.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function getAppraisalForDelegation(supabase: ReturnType<typeof getSupabaseAdmin>, appraisalId: string) {
  const { data: appraisal, error: appErr } = await supabase
    .from("appraisals")
    .select("id, employee_id, manager_employee_id")
    .eq("id", appraisalId)
    .single();
  if (appErr || !appraisal) return null;
  return appraisal;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id || !user.employee_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await params;
    const supabase = getSupabaseAdmin();
    const appraisal = await getAppraisalForDelegation(supabase, appraisalId);
    if (!appraisal) return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });

    const access = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId: user.employee_id,
    });

    if (!access.isPrimaryManager && !access.isDelegated) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: delegation } = await supabase
      .from("appraisal_delegations")
      .select("id, delegated_to, delegated_to_name, created_at")
      .eq("appraisal_id", appraisalId)
      .maybeSingle();

    return NextResponse.json({ delegation: delegation ?? null, isDelegated: access.isDelegated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const raw = await req.json().catch(() => ({}));

    const user = await getCurrentUser();
    if (!user?.id || !user.employee_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await params;
    const body = raw as { delegated_to?: unknown; delegated_to_name?: unknown };
    const delegatedTo = typeof body?.delegated_to === "string" ? body.delegated_to.trim() : "";
    const delegatedToName = typeof body?.delegated_to_name === "string" ? body.delegated_to_name.trim() : "";
    if (!delegatedTo?.trim() || !delegatedToName?.trim() || !isUuidLike(delegatedTo)) {
      return NextResponse.json({ error: "delegated_to and delegated_to_name are required" }, { status: 400 });
    }
    if (delegatedTo === user.employee_id) {
      return NextResponse.json({ error: "Cannot delegate to yourself" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const appraisal = await getAppraisalForDelegation(supabase, appraisalId);
    if (!appraisal) return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    if (delegatedTo === appraisal.employee_id) {
      return NextResponse.json({ error: "Cannot delegate to the appraisee" }, { status: 400 });
    }

    const access = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId: user.employee_id,
    });
    if (!access.isPrimaryManager) {
      return NextResponse.json({ error: "Only the primary manager can manage delegation" }, { status: 403 });
    }

    const { data: delegation, error } = await supabase
      .from("appraisal_delegations")
      .upsert(
        {
          appraisal_id: appraisalId,
          delegated_by: user.employee_id,
          delegated_to: delegatedTo,
          delegated_to_name: delegatedToName,
        },
        { onConflict: "appraisal_id" }
      )
      .select("id, delegated_to, delegated_to_name, created_at")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ delegation });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id || !user.employee_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await params;
    const supabase = getSupabaseAdmin();
    const appraisal = await getAppraisalForDelegation(supabase, appraisalId);
    if (!appraisal) return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });

    const access = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId: user.employee_id,
    });
    if (!access.isPrimaryManager) {
      return NextResponse.json({ error: "Only the primary manager can manage delegation" }, { status: 403 });
    }

    const { error } = await supabase
      .from("appraisal_delegations")
      .delete()
      .eq("appraisal_id", appraisalId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
