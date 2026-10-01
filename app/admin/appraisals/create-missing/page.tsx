import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { CreateMissingClient } from "./create-missing-client";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return createSupabaseClient(url, key);
}

export default async function CreateMissingAppraisalsPage() {
  const user = await getCurrentUser();
  const isHR = user?.roles?.some((r) => r === "hr" || r === "admin") ?? false;
  if (!user || !isHR) redirect("/admin");

  const supabase = getSupabaseAdmin();
  const { data: lastSync } = await supabase
    .from("employee_sync_log")
    .select("new_employee_ids, triggered_at")
    .eq("status", "completed")
    .order("triggered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const employeeIds = Array.isArray(lastSync?.new_employee_ids) ? lastSync.new_employee_ids : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-ds-page-title text-ds-text-primary">Create Missing Appraisals</h1>
      <p className="text-[13px] text-ds-text-secondary">
        Creates annual draft appraisals for employees flagged by the latest sync run.
      </p>
      <CreateMissingClient employeeIds={employeeIds} />
      <Link href="/admin/appraisals" className="inline-block text-[13px] text-ds-accent">
        ← Back to all appraisals
      </Link>
    </div>
  );
}
