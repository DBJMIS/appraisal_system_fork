import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireHrOrAdmin } from "@/lib/route-guards";
import { listOutstandingActions, parsePagination } from "@/lib/reminder-operations";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * GET /api/admin/outstanding-appraisal-actions?cycleId=&candidatesOnly=1&page=&pageSize=
 * Overdue appraisal steps on open cycles (same rules as the reminder planner), the last reminder
 * sent for each, and escalation candidates with a suggested follow-up owner. Read-only; nothing is
 * emailed. No scores, comments or evidence. HR/Admin only.
 */
export async function GET(req: NextRequest) {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;

  const params = req.nextUrl.searchParams;
  const rawCycle = params.get("cycleId");
  if (rawCycle && rawCycle !== "all" && !ID_PATTERN.test(rawCycle)) {
    return NextResponse.json({ error: "Invalid cycle.", code: "VALIDATION_ERROR" }, { status: 400 });
  }
  const paging = parsePagination(params);
  if (!paging.ok) return NextResponse.json({ error: paging.error, code: "VALIDATION_ERROR" }, { status: 400 });

  try {
    const result = await listOutstandingActions(createClient(), {
      cycleId: rawCycle === "all" ? null : rawCycle || undefined,
      candidatesOnly: params.get("candidatesOnly") === "1",
      ...paging.value,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[outstanding-actions] list failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not load outstanding actions.", code: "DB_ERROR" }, { status: 500 });
  }
}
