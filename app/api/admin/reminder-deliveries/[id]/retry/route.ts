import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireHrOrAdmin } from "@/lib/route-guards";
import { parseId } from "@/lib/admin-email-tools";
import { retryDelivery } from "@/lib/reminder-operations";

export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/reminder-deliveries/[id]/retry
 * Retries one FAILED reminder through the scheduled delivery worker, on the same row and
 * idempotency key. Re-checks the appraisal first; a reminder that is no longer needed becomes
 * SKIPPED. Refused (409) when already sent, not failed, permanently rejected, out of attempts or
 * missing a recipient email; there is no override. Audited. HR/Admin only.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!parseId(id, "a reminder").ok) {
    return NextResponse.json({ error: "Reminder not found.", code: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const result = await retryDelivery(createClient(), id, { id: guard.user.id });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    const { ok: _ok, ...body } = result;
    return NextResponse.json(body);
  } catch (err) {
    console.error("[reminder-deliveries] retry failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not retry the reminder.", code: "RETRY_FAILED" }, { status: 500 });
  }
}
