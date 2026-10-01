import { NextRequest, NextResponse } from "next/server";
import { generateRecommendation } from "@/lib/recommendation-engine";
import { requireHrOrAdmin } from "@/lib/route-guards";

/**
 * POST /api/appraisals/[id]/recommendation
 * Generates system recommendation from appraisal score and recommendation_rules.
 * Does not modify manager override; idempotent. HR or admin only.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireHrOrAdmin();
    if (!guard.ok) return guard.response;

    const { id: appraisalId } = await params;
    if (!appraisalId) {
      return NextResponse.json(
        { error: "Appraisal id is required" },
        { status: 400 }
      );
    }

    const result = await generateRecommendation(appraisalId);

    return NextResponse.json({
      appraisalId: result.appraisalId,
      recommendation: result.recommendation,
      status: result.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Recommendation failed";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
