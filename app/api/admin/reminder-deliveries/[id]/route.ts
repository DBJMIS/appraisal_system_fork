import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireHrOrAdmin } from "@/lib/route-guards";
import { parseId } from "@/lib/admin-email-tools";
import { getDeliveryDetail } from "@/lib/reminder-operations";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "Reminder not found.", code: "NOT_FOUND" }, { status: 404 });

/**
 * GET /api/admin/reminder-deliveries/[id]
 * One reminder delivery: recipient, timing, attempts, sanitised error or skip reason, whether it
 * would still be sent now and whether it can be retried. No message content. HR/Admin only.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!parseId(id, "a reminder").ok) return notFound();

  try {
    const detail = await getDeliveryDetail(createClient(), id);
    return detail ? NextResponse.json(detail) : notFound();
  } catch (err) {
    console.error("[reminder-deliveries] detail failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not load the reminder.", code: "DB_ERROR" }, { status: 500 });
  }
}
