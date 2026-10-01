import { NextResponse } from "next/server";

/**
 * POST /api/workplans/copy-previous
 * Retired. Do not re-enable without employee/manager relationship, appraisal
 * status and target-workplan ownership checks.
 */
export async function POST() {
  return NextResponse.json(
    { error: "This endpoint has been retired", code: "GONE" },
    { status: 410 }
  );
}
