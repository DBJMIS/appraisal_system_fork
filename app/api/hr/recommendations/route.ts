import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireHrOrAdmin } from "@/lib/route-guards";

/**
 * PATCH /api/hr/recommendations
 * Body: { appraisalId: string, hrFinalDecision: string }
 * Updates appraisal_recommendations with HR decision. hr_decided_by from current user.
 * HR or admin only.
 */
export async function PATCH(request: NextRequest) {
  try {
    const guard = await requireHrOrAdmin();
    if (!guard.ok) return guard.response;
    const user = guard.user;

    const body = await request.json();
    const appraisalId = body?.appraisalId;
    const hrFinalDecision =
      typeof body?.hrFinalDecision === "string"
        ? body.hrFinalDecision.trim()
        : null;

    if (!appraisalId) {
      return NextResponse.json(
        { error: "appraisalId is required" },
        { status: 400 }
      );
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
    const now = new Date().toISOString();

    const { data: existing } = await supabase
      .from("appraisal_recommendations")
      .select("appraisal_id")
      .eq("appraisal_id", appraisalId)
      .maybeSingle();

    const payload = {
      hr_final_decision: hrFinalDecision,
      hr_decided_by: user.id,
      hr_decided_at: now,
      updated_at: now,
    };

    if (existing) {
      const { error: updateError } = await supabase
        .from("appraisal_recommendations")
        .update(payload)
        .eq("appraisal_id", appraisalId);

      if (updateError) {
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        );
      }
    } else {
      const { error: insertError } = await supabase
        .from("appraisal_recommendations")
        .insert({
          appraisal_id: appraisalId,
          ...payload,
        });

      if (insertError) {
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
