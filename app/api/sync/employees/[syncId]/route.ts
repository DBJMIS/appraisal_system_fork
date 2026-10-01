import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireHrOrAdmin } from "@/lib/route-guards";
import { parseSyncDetails } from "@/lib/employee-sync-details";

type Ctx = { params: Promise<{ syncId: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => NextResponse.json({ error: "Sync run not found.", code: "NOT_FOUND" }, { status: 404 });

/** GET /api/sync/employees/[syncId] -> one sync run with its stored detail snapshot (HR/Admin only). */
export async function GET(_req: Request, { params }: Ctx) {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;

  const { syncId } = await params;
  if (!UUID_RE.test(String(syncId ?? ""))) return notFound();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Server configuration error.", code: "CONFIG_ERROR" }, { status: 500 });
  }
  const supabase = createClient(url, key);

  const { data, error } = await supabase.from("employee_sync_log").select("*").eq("id", syncId).maybeSingle();
  if (error) {
    console.error("[sync-details] read failed", error.code ?? "", error.message ?? "");
    return NextResponse.json(
      { error: "Could not load sync details. Please try again.", code: "DB_ERROR" },
      { status: 500 }
    );
  }
  if (!data) return notFound();

  const row = data as Record<string, unknown>;
  const details = parseSyncDetails(row.details);
  return NextResponse.json({
    id: row.id,
    triggered_at: row.triggered_at ?? null,
    completed_at: row.completed_at ?? null,
    triggered_by: row.triggered_by === "cron" ? "Auto" : "Manual",
    status: row.status ?? null,
    employees_synced: row.employees_synced ?? null,
    employees_added: row.employees_added ?? null,
    employees_deactivated: row.employees_deactivated ?? null,
    duration_ms: row.duration_ms ?? null,
    details,
    details_recorded: details !== null,
    // False when the employee_sync_log.details column does not exist yet (migration 0069 not applied).
    details_capture_enabled: Object.prototype.hasOwnProperty.call(row, "details"),
  });
}
