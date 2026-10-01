import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { transitionStatus } from "@/lib/appraisal-workflow";
import { allowAppraisalTestBypass } from "@/lib/appraisal-test-bypass";
import { isAppraisalStatus } from "@/types/appraisal";
import { midyearSelfAssessmentBlocker } from "@/lib/midyear-lifecycle";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase config");
  return createClient(url, key);
}

/**
 * POST: Move appraisal from IN_PROGRESS to SELF_ASSESSMENT (employee explicitly starts self-assessment).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, status, employee_id, cycle_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    const status = appraisal.status as string;
    if (!isAppraisalStatus(status) || status !== "IN_PROGRESS") {
      return NextResponse.json(
        { error: "Appraisal must be in In progress to start self-assessment" },
        { status: 400 }
      );
    }

    if (!allowAppraisalTestBypass() && appraisal.employee_id !== user.employee_id) {
      return NextResponse.json(
        { error: "Only the employee can start self-assessment" },
        { status: 403 }
      );
    }

    const midyearBlocker = await midyearSelfAssessmentBlocker(supabase, appraisal);
    if (midyearBlocker) {
      return NextResponse.json({ error: midyearBlocker }, { status: 409 });
    }

    const transErr = await transitionStatus(
      supabase,
      appraisalId,
      "SELF_ASSESSMENT",
      user.id,
      "Start self-assessment"
    );

    if (transErr.error) {
      return NextResponse.json({ error: transErr.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, status: "SELF_ASSESSMENT" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
