import { NextResponse } from "next/server";

/**
 * PATCH /api/appraisals/[id]/status
 * Retired: status changes must go through the dedicated workflow routes
 * (submit-for-approval, approve, start-self-assessment, submit-self-assessment,
 * recall, signoff/*, dispute, complete).
 */
export async function PATCH() {
  return NextResponse.json(
    { error: "This endpoint has been retired", code: "GONE" },
    { status: 410 }
  );
}
