import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import {
  getAppraisalsAll,
  getAppraisalCycleOptions,
} from "@/lib/appraisals-list-data";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReviewTypeBadge } from "@/components/ui/review-type-badge";
import { EmployeeCell } from "@/components/ui/employee-cell";
import { CycleChip } from "@/components/ui/cycle-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { AppraisalsListControls } from "@/components/appraisals-list-controls";

const ListIcon = () => (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const SearchIcon = () => (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return createSupabaseClient(url, key);
}

export default async function AdminAppraisalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  const isHR = user?.roles?.some((r) => r === "hr" || r === "admin") ?? false;
  if (!user || !isHR) {
    redirect("/admin");
  }

  const params = await searchParams;
  const options = {
    search: typeof params.search === "string" ? params.search : undefined,
    status: typeof params.status === "string" ? params.status : undefined,
    cycleId: typeof params.cycleId === "string" ? params.cycleId : undefined,
    page: Math.max(1, Number(params.page) || 1),
    pageSize: Math.min(100, Math.max(10, Number(params.pageSize) || 25)),
  };

  const { items, total } = await getAppraisalsAll(options);
  const cycleOptions = await getAppraisalCycleOptions();
  const supabase = getSupabaseAdmin();

  const { data: activeCycle } = await supabase
    .from("appraisal_cycles")
    .select("id, name")
    .in("status", ["active", "open"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: lastSync } = await supabase
    .from("employee_sync_log")
    .select("new_employee_ids, triggered_at")
    .eq("status", "completed")
    .order("triggered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const newWithoutAppraisal = Array.isArray(lastSync?.new_employee_ids)
    ? lastSync.new_employee_ids
    : [];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Page Header */}
      <PageHeader
        icon={<ListIcon />}
        title="All Appraisals"
        subtitle="View and search all appraisals across the organisation"
      />

      {newWithoutAppraisal.length > 0 && (
        <div
          className="mb-4 flex items-center justify-between rounded-ds-panel border px-4 py-3"
          style={{
            borderColor: "#fbe3a1",
            background: "#fffbeb",
          }}
        >
          <div className="flex items-center gap-2.5">
            <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="#8a5a00" strokeWidth="2">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div>
              <p className="text-[12.5px] font-semibold" style={{ color: "#8a5a00" }}>
                {newWithoutAppraisal.length} employee{newWithoutAppraisal.length > 1 ? "s" : ""} added since cycle started without an appraisal
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: "#8a5a00" }}>
                These employees are in Dynamics but have no appraisal record for {activeCycle?.name ?? "the active cycle"}
              </p>
            </div>
          </div>
          <Link
            href="/admin/appraisals/create-missing"
            className="flex-shrink-0 rounded-[7px] px-4 py-1.5 text-[12px] font-semibold text-white"
            style={{ background: "#8a5a00" }}
          >
            Create appraisals →
          </Link>
        </div>
      )}

      {/* Filters */}
      <div className="animate-fade-up-delay-1">
        <AppraisalsListControls
          total={total}
          cycleOptions={cycleOptions}
          initialSearch={options.search ?? ""}
          initialStatus={options.status ?? ""}
          initialCycleId={options.cycleId ?? ""}
          initialPage={options.page}
          initialPageSize={options.pageSize}
          basePath="/admin/appraisals"
        />
      </div>

      {/* Table */}
      <div className="animate-fade-up-delay-2">
        {items.length === 0 ? (
          <div
            className="rounded-ds-panel bg-white"
            style={{
              boxShadow: "var(--shadow-card)",
              border: "1px solid var(--border-color)",
            }}
          >
            <EmptyState
              icon={<SearchIcon />}
              title="No appraisals found"
              description="Try adjusting your search filters to find what you're looking for."
            />
          </div>
        ) : (
          <div
            className="overflow-hidden rounded-ds-panel bg-white"
            style={{
              boxShadow: "var(--shadow-card)",
              border: "1px solid var(--border-color)",
            }}
          >
            <table className="w-full">
              <thead style={{ backgroundColor: "var(--surface)" }}>
                <tr style={{ borderBottom: "1px solid var(--border-color)" }}>
                  <th className="px-5 py-3 text-left text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">
                    Employee
                  </th>
                  <th className="px-5 py-3 text-left text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">
                    Cycle
                  </th>
                  <th className="px-5 py-3 text-left text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">
                    Type
                  </th>
                  <th className="px-5 py-3 text-left text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">
                    Status
                  </th>
                  <th className="px-5 py-3 text-right text-[10.5px] font-semibold uppercase tracking-wider text-text-muted">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, idx) => (
                  <tr
                    key={row.appraisalId}
                    className="group cursor-pointer transition-colors hover:bg-ds-surface"
                    style={{
                      borderBottom: idx < items.length - 1 ? "1px solid var(--border-color)" : undefined,
                    }}
                  >
                    <td className="px-5 py-3.5">
                      <EmployeeCell name={row.employeeName} />
                    </td>
                    <td className="px-5 py-3.5">
                      <CycleChip year={row.cycleName} />
                    </td>
                    <td className="px-5 py-3.5">
                      <ReviewTypeBadge type={row.reviewType} />
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        href={`/appraisals/${row.appraisalId}`}
                        className="group inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium text-text-secondary transition-all hover:bg-accent hover:text-white"
                        style={{
                          border: "1px solid var(--border-color)",
                        }}
                      >
                        Open
                        <ChevronRightIcon />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
