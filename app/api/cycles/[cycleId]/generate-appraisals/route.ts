import { NextRequest, NextResponse } from "next/server";
import { generateAppraisalsForCycle } from "@/lib/appraisal-generator";
import { requireHrOrAdmin } from "@/lib/route-guards";

/**
 * POST /api/cycles/[cycleId]/generate-appraisals
 * Creates draft appraisal records for all active employees in the cycle.
 * HR or admin only.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  try {
    const guard = await requireHrOrAdmin();
    if (!guard.ok) return guard.response;

    const { cycleId } = await params;
    if (!cycleId) {
      return NextResponse.json(
        { error: "cycleId is required" },
        { status: 400 }
      );
    }

    const result = await generateAppraisalsForCycle(cycleId);

    return NextResponse.json({
      cycle: result.cycleName,
      appraisals_created: result.appraisalsCreated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generate failed";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
