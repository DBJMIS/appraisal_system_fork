/**
 * Loads the context an appraisal email template needs. Server-only. Reads names, cycle details,
 * status and the configured due date; never reads email addresses or scores, so preview and test
 * sends cannot pick up a real recipient or leak appraisal results.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fiscalYearLabel, formatMidyearDate } from "@/lib/midyear-config";
import { statusConfig } from "@/lib/appraisal-status-display";
import { EMAIL_TEMPLATES, type EmailContext, type EmailKind, type EmailRecipientRole } from "@/lib/email-templates";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

/**
 * Application base URL for email links, from NEXT_PUBLIC_APP_URL (the variable existing notification
 * emails use). Missing or non-absolute values yield no URL plus a warning instead of a relative link.
 */
export function resolveAppBaseUrl(raw: string | undefined = process.env.NEXT_PUBLIC_APP_URL): {
  url: string | null;
  warning: string | null;
} {
  const value = (raw ?? "").trim();
  if (!value) {
    return {
      url: null,
      warning: "NEXT_PUBLIC_APP_URL is not set, so this email has no link. Configure the application URL before sending real notifications.",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { url: null, warning: "NEXT_PUBLIC_APP_URL is not a valid absolute URL, so this email has no link." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { url: null, warning: "NEXT_PUBLIC_APP_URL must start with https:// or http://, so this email has no link." };
  }
  const url = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
  if (LOCAL_HOSTS.has(parsed.hostname)) {
    return { url, warning: `NEXT_PUBLIC_APP_URL points to a local address (${parsed.host}); links will not work for recipients.` };
  }
  return { url, warning: null };
}

/** True when an (already resolved) app URL points at this machine, e.g. during local development. */
export function isLocalAppUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export type LoadEmailContextResult =
  | { ok: true; context: EmailContext; recipientRole: EmailRecipientRole; warnings: string[] }
  | { ok: false; reason: "NOT_FOUND" | "DB_ERROR" };

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export async function loadEmailContext(
  supabase: SupabaseClient,
  appraisalId: string,
  kind: EmailKind
): Promise<LoadEmailContextResult> {
  const template = EMAIL_TEMPLATES[kind];

  const { data: appraisal, error: appErr } = await supabase
    .from("appraisals")
    .select("id, employee_id, manager_employee_id, cycle_id, review_type, status")
    .eq("id", appraisalId)
    .maybeSingle();
  if (appErr) {
    console.error("[email-context] appraisal read failed", appErr.message);
    return { ok: false, reason: "DB_ERROR" };
  }
  if (!appraisal) return { ok: false, reason: "NOT_FOUND" };
  const a = appraisal as {
    id: string;
    employee_id: string;
    manager_employee_id: string | null;
    cycle_id: string | null;
    review_type?: string | null;
    status?: string | null;
  };

  const ids = [a.employee_id, a.manager_employee_id].filter(Boolean) as string[];
  const [{ data: people, error: peopleErr }, { data: cycle, error: cycleErr }] = await Promise.all([
    supabase.from("employees").select("employee_id, full_name").in("employee_id", ids),
    a.cycle_id
      ? supabase.from("appraisal_cycles").select("name, fiscal_year, end_date, midyear_due_date").eq("id", a.cycle_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (peopleErr || cycleErr) {
    console.error("[email-context] context read failed", peopleErr?.message ?? cycleErr?.message ?? "");
    return { ok: false, reason: "DB_ERROR" };
  }

  const names = new Map(
    ((people ?? []) as { employee_id: string; full_name?: string | null }[]).map((p) => [p.employee_id, p.full_name?.trim() || null])
  );
  const c = cycle as { name?: string | null; fiscal_year?: string | null; end_date?: string | null; midyear_due_date?: string | null } | null;
  const rawDue = template.dueDateSource === "midyear" ? c?.midyear_due_date : c?.end_date;
  const app = resolveAppBaseUrl();
  const status = a.status ?? null;

  const context: EmailContext = {
    appraisalId: a.id,
    employeeName: names.get(a.employee_id) ?? "Employee",
    managerName: a.manager_employee_id ? names.get(a.manager_employee_id) ?? null : null,
    cycleName: c?.name?.trim() || null,
    fiscalYear: fiscalYearLabel(c?.fiscal_year),
    reviewType: a.review_type ? titleCase(a.review_type) : null,
    status: status ? statusConfig[status]?.label ?? status : null,
    dueDate: formatMidyearDate(rawDue ?? null),
    appUrl: app.url,
  };

  const warnings: string[] = [];
  if (app.warning) warnings.push(app.warning);
  if (!context.dueDate) {
    warnings.push(
      template.dueDateSource === "midyear"
        ? "This cycle has no Mid-Year due date configured, so the email omits the due date."
        : "This cycle has no end date configured, so the email omits the due date."
    );
  }
  if (template.recipientRole === "manager" && !a.manager_employee_id) {
    warnings.push("This appraisal has no manager assigned, so a real notification of this type would have no recipient.");
  }

  return { ok: true, context, recipientRole: template.recipientRole, warnings };
}
