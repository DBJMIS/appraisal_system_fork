import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireHrOrAdmin } from "@/lib/route-guards";
import { EMAIL_KINDS, EMAIL_TEMPLATES, renderEmail } from "@/lib/email-templates";
import { loadEmailContext, resolveAppBaseUrl } from "@/lib/email-context";
import { parseId, parseKind, readJsonObject } from "@/lib/admin-email-tools";
import { statusConfig } from "@/lib/appraisal-status-display";

/**
 * GET /api/admin/email-preview?cycleId=...
 * Notification types, the appraisals in a cycle (for the picker) and the app URL status. HR/Admin only.
 */
export async function GET(req: NextRequest) {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;

  const kinds = EMAIL_KINDS.map((kind) => ({
    kind,
    label: EMAIL_TEMPLATES[kind].label,
    recipientRole: EMAIL_TEMPLATES[kind].recipientRole,
  }));
  const app = resolveAppBaseUrl();
  const appUrl = { configured: !!app.url, warning: app.warning };

  const rawCycleId = req.nextUrl.searchParams.get("cycleId");
  if (!rawCycleId) return NextResponse.json({ kinds, appraisals: [], appUrl });
  const cycleId = parseId(rawCycleId, "a cycle");
  if (!cycleId.ok) return NextResponse.json({ error: cycleId.error, code: "VALIDATION_ERROR" }, { status: 400 });

  const supabase = createClient();
  const { data: rows, error } = await supabase
    .from("appraisals")
    .select("id, employee_id, status")
    .eq("cycle_id", cycleId.value);
  if (error) {
    console.error("[email-preview] appraisal list failed", error.message);
    return NextResponse.json({ error: "Could not load appraisals.", code: "DB_ERROR" }, { status: 500 });
  }
  const list = (rows ?? []) as { id: string; employee_id: string; status?: string | null }[];
  const ids = [...new Set(list.map((a) => a.employee_id).filter(Boolean))];
  const { data: people, error: peopleErr } = ids.length
    ? await supabase.from("employees").select("employee_id, full_name").in("employee_id", ids)
    : { data: [], error: null };
  if (peopleErr) {
    console.error("[email-preview] employee names failed", peopleErr.message);
    return NextResponse.json({ error: "Could not load appraisals.", code: "DB_ERROR" }, { status: 500 });
  }
  const names = new Map(((people ?? []) as { employee_id: string; full_name?: string | null }[]).map((p) => [p.employee_id, p.full_name]));
  const appraisals = list
    .map((a) => {
      const name = names.get(a.employee_id)?.trim() || a.employee_id;
      const status = a.status ? statusConfig[a.status]?.label ?? a.status : null;
      return { id: a.id, label: status ? `${name} · ${status}` : name };
    })
    .sort((x, y) => x.label.localeCompare(y.label));

  return NextResponse.json({ kinds, appraisals, appUrl });
}

/**
 * POST /api/admin/email-preview  { kind, appraisalId }
 * Renders an appraisal email with the shared template renderer. Render only: sends nothing, writes
 * nothing (no in-app notification, no delivery record, no workflow change). HR/Admin only.
 */
export async function POST(req: NextRequest) {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;

  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "Invalid request body.", code: "VALIDATION_ERROR" }, { status: 400 });
  const kind = parseKind(body.kind);
  if (!kind.ok) return NextResponse.json({ error: kind.error, code: "VALIDATION_ERROR" }, { status: 400 });
  const appraisalId = parseId(body.appraisalId, "an appraisal");
  if (!appraisalId.ok) return NextResponse.json({ error: appraisalId.error, code: "VALIDATION_ERROR" }, { status: 400 });

  const loaded = await loadEmailContext(createClient(), appraisalId.value, kind.value);
  if (!loaded.ok) {
    return loaded.reason === "NOT_FOUND"
      ? NextResponse.json({ error: "Appraisal not found.", code: "NOT_FOUND" }, { status: 404 })
      : NextResponse.json({ error: "Could not load the appraisal.", code: "DB_ERROR" }, { status: 500 });
  }

  const email = renderEmail(kind.value, loaded.context);
  return NextResponse.json({
    subject: email.subject,
    text: email.text,
    html: email.html,
    recipientRole: loaded.recipientRole,
    warnings: loaded.warnings,
  });
}
