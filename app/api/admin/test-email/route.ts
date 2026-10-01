import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireHrOrAdmin } from "@/lib/route-guards";
import { renderEmail } from "@/lib/email-templates";
import { loadEmailContext } from "@/lib/email-context";
import { sendEmailViaGraph } from "@/lib/email";
import { logTestSend, parseId, parseKind, parseTestRecipient, readJsonObject, sanitizeGraphError } from "@/lib/admin-email-tools";

/**
 * POST /api/admin/test-email  { to, kind, appraisalId }
 * Sends one "[TEST]" copy of an appraisal email to an explicit test address on an allowed domain,
 * using the shared renderer and the Microsoft Graph transport directly so the real result is
 * returned. Never falls back to the employee's or manager's address; writes no notification or
 * delivery record. HR/Admin only.
 */
export async function POST(req: NextRequest) {
  const guard = await requireHrOrAdmin();
  if (!guard.ok) return guard.response;
  const { user } = guard;

  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "Invalid request body.", code: "VALIDATION_ERROR" }, { status: 400 });
  const to = parseTestRecipient(body);
  if (!to.ok) {
    return to.config
      ? NextResponse.json({ error: to.error, code: "CONFIG_ERROR" }, { status: 503 })
      : NextResponse.json({ error: to.error, code: "VALIDATION_ERROR" }, { status: 400 });
  }
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
  const log = { actorId: user.id, actorEmail: user.email ?? null, recipient: to.value, kind: kind.value, appraisalId: appraisalId.value };

  let result: { success: boolean; error?: string };
  try {
    result = await sendEmailViaGraph({
      to: to.value,
      subject: `[TEST] ${email.subject}`,
      textContent: email.text,
      htmlContent: email.html,
    });
  } catch {
    logTestSend({ ...log, success: false, errorCode: "GRAPH_UNREACHABLE" });
    return NextResponse.json(
      { ok: false, transport: "graph", error: "Could not reach Microsoft Graph.", code: "GRAPH_UNREACHABLE" },
      { status: 502 }
    );
  }

  if (!result.success) {
    const failure = sanitizeGraphError(result.error);
    logTestSend({ ...log, success: false, errorCode: failure.code });
    return NextResponse.json({ ok: false, transport: "graph", error: failure.message, code: failure.code }, { status: 502 });
  }

  logTestSend({ ...log, success: true });
  return NextResponse.json({
    ok: true,
    transport: "graph",
    ...(loaded.warnings.length ? { warnings: loaded.warnings } : {}),
  });
}
