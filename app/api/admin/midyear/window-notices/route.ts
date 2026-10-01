import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { sendMidyearWindowNotices } from "@/lib/midyear-notifications";

function hasHrOrAdminRole(roles: string[] | undefined): boolean {
  if (!Array.isArray(roles)) return false;
  return roles.some((r) => {
    const n = String(r ?? "").trim().toLowerCase();
    return n === "hr" || n === "admin";
  });
}

/**
 * POST /api/admin/midyear/window-notices
 * Sends "Mid-Year Review is now open" notices to managers (HR/Admin, or cron with x-cron-secret).
 * Safe to call repeatedly: each manager is notified once per appraisal.
 * Body (optional): { cycle_id }
 */
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get("x-cron-secret");
  const isCron = !!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;
  if (!isCron) {
    const user = await getCurrentUser();
    if (!hasHrOrAdminRole(user?.roles)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as { cycle_id?: unknown };
  const cycleId = typeof body.cycle_id === "string" && body.cycle_id.trim() ? body.cycle_id.trim() : null;

  try {
    const summary = await sendMidyearWindowNotices(createClient(), {
      today: new Date().toISOString().slice(0, 10),
      cycleId,
    });
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("[midyear window-notices] failed:", err);
    return NextResponse.json({ error: "Failed to send Mid-Year window notices" }, { status: 500 });
  }
}
