import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireHrOrAdmin } from "@/lib/route-guards";
import { listReminderDeliveries, parseDeliveryFilters } from "@/lib/reminder-operations";

/**
 * GET /api/admin/reminder-deliveries?cycleId=&status=&kind=&role=&q=&from=&to=&page=&pageSize=
 * Reminder delivery activity with summary metrics. Filtering and pagination are server-side
 * (default 25 per page, at most 100). cycleId defaults to the current cycle; "all" lists every
 * cycle. Delivery bookkeeping only: no message content, scores or provider responses. HR/Admin only.
 */
export async function GET(req: NextRequest) {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;

  const filters = parseDeliveryFilters(req.nextUrl.searchParams);
  if (!filters.ok) return NextResponse.json({ error: filters.error, code: "VALIDATION_ERROR" }, { status: 400 });

  try {
    return NextResponse.json(await listReminderDeliveries(createClient(), filters.value));
  } catch (err) {
    console.error("[reminder-deliveries] list failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not load reminder activity.", code: "DB_ERROR" }, { status: 500 });
  }
}
