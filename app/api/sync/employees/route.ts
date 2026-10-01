import { NextRequest, NextResponse } from "next/server";
import type { AxiosResponse } from "axios";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { createDataverseApiClient } from "@/lib/dynamics-sync";
import type { EmployeeSyncDetails, SyncDetailPerson } from "@/lib/employee-sync-details";

type DynamicsEmployeeRow = {
  xrm1_employeeid?: string | null;
  _xrm1_employee_user_id_value?: string | null;
  xrm1_fullname?: string | null;
  emailaddress?: string | null;
  _xrm1_employee_department_id_value?: string | null;
  statecode?: number | null;
  xrm1_employee_type?: number | null;
};

/** OData envelope for paged xrm1_employees queries. */
type XrmEmployeeODataPage = {
  value?: DynamicsEmployeeRow[];
  "@odata.nextLink"?: string;
};

type EmployeeUpsertRow = {
  employee_id: string;
  full_name: string | null;
  email: string | null;
  division_id: string | null;
  is_active: boolean;
};

function normalizeRole(r: string): string {
  return String(r ?? "").trim().toLowerCase();
}

function hasHrOrAdminRole(roles: string[] | undefined): boolean {
  if (!Array.isArray(roles) || roles.length === 0) return false;
  return roles.some((r) => {
    const n = normalizeRole(r);
    return n === "hr" || n === "admin";
  });
}

function sanitizeEmail(v: string | null | undefined): string | null {
  const out = String(v ?? "").trim().toLowerCase();
  return out || null;
}

function isDbjEmail(v: string | null | undefined): boolean {
  const em = sanitizeEmail(v);
  return !!em && em.endsWith("@dbankjm.com");
}

function isTruthyActive(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const n = v.trim().toLowerCase();
    return n === "true" || n === "1" || n === "active";
  }
  return false;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Sync failed";
}

/**
 * POST /api/sync/employees
 * Manual (HR/Admin) or cron-triggered sync from Dynamics xrm1_employees.
 */
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get("x-cron-secret");
  const isCron = !!process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;
  const triggeredBy = isCron ? "cron" : "manual";
  const startTime = Date.now();
  const supabase = createClient();

  if (!isCron) {
    const user = await getCurrentUser();
    if (!hasHrOrAdminRole(user?.roles)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let logRow: { id?: string } | null = null;
  try {
    const inserted = await supabase
      .from("employee_sync_log")
      .insert({ triggered_by: triggeredBy, status: "running" })
      .select("id")
      .single();
    logRow = (inserted.data as { id?: string } | null) ?? null;
  } catch {
    // If migration is not applied yet, continue sync without log persistence.
    logRow = null;
  }
  const logId = logRow?.id as string | undefined;

  try {
    const client = await createDataverseApiClient();
    const allEmployees: DynamicsEmployeeRow[] = [];
    let nextUrl: string | null =
      `/xrm1_employees` +
      `?$select=xrm1_employeeid,_xrm1_employee_user_id_value,xrm1_fullname,emailaddress,_xrm1_employee_department_id_value,statecode,xrm1_employee_type` +
      `&$filter=statecode eq 0` +
      `&$top=500`;

    while (nextUrl) {
      const res: AxiosResponse<XrmEmployeeODataPage> = await client.get<XrmEmployeeODataPage>(
        nextUrl.startsWith("http") ? nextUrl : nextUrl
      );
      const page = res.data?.value ?? [];
      allEmployees.push(...page);
      const nextPageUrl: string | null = res.data?.["@odata.nextLink"] ?? null;
      nextUrl = nextPageUrl ? nextPageUrl.replace(/^.*\/api\/data\/v[\d.]+/, "") : null;
    }
    console.log(`[sync] fetched ${allEmployees.length} active employees from xrm1_employees`);

    const { data: existingBefore } = await supabase
      .from("employees")
      .select("employee_id, is_active, full_name");

    const preSyncNames = new Map<string, string | null>(
      (existingBefore ?? []).map((e) => {
        const r = e as { employee_id?: string; full_name?: string | null };
        return [String(r.employee_id ?? ""), r.full_name ?? null];
      })
    );

    const existingActiveIds = new Set(
      (existingBefore ?? [])
        .filter((e) => isTruthyActive((e as { is_active?: unknown }).is_active))
        .map((e) => String((e as { employee_id?: string }).employee_id ?? ""))
        .filter(Boolean)
    );
    const existingAllIds = new Set(
      (existingBefore ?? [])
        .map((e) => String((e as { employee_id?: string }).employee_id ?? ""))
        .filter(Boolean)
    );

    const rows: EmployeeUpsertRow[] = allEmployees
      .filter((e) => {
        const email = sanitizeEmail(e.emailaddress);
        return !!email && email.endsWith("@dbankjm.com");
      })
      .map((e) => ({
        // Appraisals reference employees.employee_id using the Dynamics *systemuser* id
        // (_xrm1_employee_user_id_value). See lib/appraisal-generator.ts.
        employee_id: String(e._xrm1_employee_user_id_value ?? "").trim(),
        full_name: String(e.xrm1_fullname ?? "").trim() || null,
        email: sanitizeEmail(e.emailaddress),
        division_id: e._xrm1_employee_department_id_value ? String(e._xrm1_employee_department_id_value) : null,
        is_active: true,
      }))
      .filter((r) => !!r.employee_id);

    console.log(`[sync] after @dbankjm.com filter: ${rows.length} employees`);

    const skipped: EmployeeSyncDetails["skipped"] = [];
    const emailSeen = new Map<string, EmployeeUpsertRow>();
    for (const row of rows) {
      const emailKey = sanitizeEmail(row.email);
      if (!emailKey) continue;
      const existing = emailSeen.get(emailKey);
      if (!existing) {
        emailSeen.set(emailKey, row);
        continue;
      }
      skipped.push({ employee_id: row.employee_id, full_name: row.full_name, reason: "duplicate_email" });
      console.warn(
        `[sync] duplicate email skipped: ${row.email} — keeping ${existing.employee_id}, skipping ${row.employee_id}`
      );
    }
    const deduplicatedRows = Array.from(emailSeen.values());
    console.log(
      `[sync] after dedup: ${deduplicatedRows.length} unique employees (${rows.length - deduplicatedRows.length} duplicates removed)`
    );

    const syncedEmployeeIds = new Set<string>();
    const syncedNames = new Map<string, string | null>();
    const addedPeople: SyncDetailPerson[] = [];
    const rekeyedFromIds = new Set<string>();

    if (deduplicatedRows.length > 0) {
      for (const row of deduplicatedRows) {
        const { error } = await supabase.from("employees").upsert(row, { onConflict: "employee_id" });
        if (!error) {
          syncedEmployeeIds.add(row.employee_id);
          syncedNames.set(row.employee_id, row.full_name);
          if (!existingAllIds.has(row.employee_id)) {
            addedPeople.push({ employee_id: row.employee_id, full_name: row.full_name });
          }
          continue;
        }

        if (error.message.includes("employees_email_key") || error.message.toLowerCase().includes("email")) {
          console.warn(
            `[sync] email conflict for ${row.email} — updating existing record without changing employee_id`
          );
          const { data: existingByEmail } = await supabase
            .from("employees")
            .select("employee_id")
            .ilike("email", row.email ?? "")
            .maybeSingle();
          const existingEmployeeId = String(existingByEmail?.employee_id ?? "").trim();

          // Only re-key employee_id when it is safe (no appraisals depend on the old id).
          // This prevents FK violations like appraisals_employee_id_fkey.
          let canRekeyEmployeeId = false;
          if (existingEmployeeId) {
            const { count: appraisalCount } = await supabase
              .from("appraisals")
              .select("id", { count: "exact", head: true })
              .eq("employee_id", existingEmployeeId);
            canRekeyEmployeeId = (appraisalCount ?? 0) === 0;
          }

          const { error: updateErr } = await supabase
            .from("employees")
            .update({
              ...(canRekeyEmployeeId ? { employee_id: row.employee_id } : {}),
              full_name: row.full_name,
              division_id: row.division_id,
              is_active: row.is_active,
            })
            .ilike("email", row.email ?? "");
          if (updateErr) throw new Error(updateErr.message);
          const syncedId = canRekeyEmployeeId ? row.employee_id : existingEmployeeId;
          syncedEmployeeIds.add(syncedId);
          syncedNames.set(syncedId, row.full_name);
          const rekeyed = canRekeyEmployeeId && existingEmployeeId !== row.employee_id;
          if (rekeyed) rekeyedFromIds.add(existingEmployeeId);
          skipped.push({
            employee_id: row.employee_id,
            full_name: row.full_name,
            reason: rekeyed ? "rekeyed" : "email_conflict",
          });
          continue;
        }

        throw new Error(error.message);
      }
    }

    const fetchedIds = syncedEmployeeIds;
    if (fetchedIds.size === 0 && existingActiveIds.size > 0) {
      throw new Error("Dynamics returned no employees to sync. No employees were deactivated.");
    }
    const toDeactivate = Array.from(existingActiveIds).filter((id) => !fetchedIds.has(id));
    if (toDeactivate.length > 0) {
      const { error: deactivateErr } = await supabase
        .from("employees")
        .update({ is_active: false })
        .in("employee_id", toDeactivate);
      if (deactivateErr) throw new Error(deactivateErr.message);
    }

    const { data: activeCycle } = await supabase
      .from("appraisal_cycles")
      .select("id, created_at")
      .in("status", ["active", "open"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let newEmployeeIds: string[] = [];
    if (activeCycle?.id) {
      const { data: existingAppraisals } = await supabase
        .from("appraisals")
        .select("employee_id")
        .eq("cycle_id", activeCycle.id)
        .neq("status", "CANCELLED");
      const appraisalEmployeeIds = new Set((existingAppraisals ?? []).map((a) => String(a.employee_id)));
      newEmployeeIds = deduplicatedRows
        .map((r) => r.employee_id)
        .filter((id) => !appraisalEmployeeIds.has(id));
    }

    const employeesAdded = deduplicatedRows.filter((r) => !existingAllIds.has(r.employee_id)).length;
    const duration = Date.now() - startTime;

    const dynamicsNames = new Map(deduplicatedRows.map((r) => [r.employee_id, r.full_name]));
    const details: EmployeeSyncDetails = {
      added: addedPeople,
      reactivated: Array.from(syncedEmployeeIds)
        .filter((id) => !!id && existingAllIds.has(id) && !existingActiveIds.has(id))
        .map((id) => ({ employee_id: id, full_name: syncedNames.get(id) ?? preSyncNames.get(id) ?? null })),
      // A re-keyed employee's old id appears in toDeactivate but the row itself was kept active under its new id.
      deactivated: toDeactivate
        .filter((id) => !rekeyedFromIds.has(id))
        .map((id) => ({ employee_id: id, full_name: preSyncNames.get(id) ?? null, reason: "not_in_active_dynamics_sync" })),
      no_appraisal: newEmployeeIds.map((id) => ({ employee_id: id, full_name: dynamicsNames.get(id) ?? null })),
      skipped,
    };

    if (logId) {
      const completion = {
        status: "completed",
        completed_at: new Date().toISOString(),
        employees_synced: deduplicatedRows.length,
        employees_added: employeesAdded,
        employees_deactivated: toDeactivate.length,
        new_employee_ids: newEmployeeIds,
        duration_ms: duration,
      };
      try {
        const { error: logErr } = await supabase
          .from("employee_sync_log")
          .update({ ...completion, details })
          .eq("id", logId);
        if (logErr) {
          // details column not yet migrated: still record the completed aggregate row.
          console.warn("[sync] could not store sync details:", logErr.code ?? "", logErr.message ?? "");
          await supabase.from("employee_sync_log").update(completion).eq("id", logId);
        }
      } catch {
        // No-op: sync itself already succeeded.
      }
    }

    return NextResponse.json({
      ok: true,
      employees_synced: deduplicatedRows.length,
      employees_added: employeesAdded,
      employees_deactivated: toDeactivate.length,
      new_without_appraisal: newEmployeeIds.length,
      duration_ms: duration,
    });
  } catch (err: unknown) {
    if (logId) {
      try {
        await supabase
          .from("employee_sync_log")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: errorMessage(err),
            duration_ms: Date.now() - startTime,
          })
          .eq("id", logId);
      } catch {
        // no-op
      }
    }
    console.error("[sync] employee sync failed:", err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/** GET /api/sync/employees -> recent sync log (HR/Admin only). */
export async function GET() {
  const user = await getCurrentUser();
  if (!hasHrOrAdminRole(user?.roles)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient();
  try {
    const { data, error } = await supabase
      .from("employee_sync_log")
      .select("*")
      .order("triggered_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return NextResponse.json({ log: data ?? [] });
  } catch {
    return NextResponse.json({ log: [] });
  }
}
