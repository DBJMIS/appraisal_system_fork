import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireHrOrAdmin } from "@/lib/route-guards";
import { parseId } from "@/lib/admin-email-tools";
import { previewDelivery } from "@/lib/reminder-operations";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/reminder-deliveries/[id]/preview
 * Regenerates the reminder email from the appraisal's current state with the shared renderer.
 * Email bodies are never stored, so this is not the message originally sent. Sends and writes
 * nothing. HR/Admin only.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  if (!parseId(id, "a reminder").ok) {
    return NextResponse.json({ error: "Reminder not found.", code: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const result = await previewDelivery(createClient(), id);
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    const { ok: _ok, ...preview } = result;
    return NextResponse.json(preview);
  } catch (err) {
    console.error("[reminder-deliveries] preview failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not generate the preview.", code: "DB_ERROR" }, { status: 500 });
  }
}
