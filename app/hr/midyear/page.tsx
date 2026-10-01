import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMidyearReportData, MIDYEAR_COMPLETION_STATES, type MidyearReportData } from "@/lib/midyear-report-data";
import { formatScore, formatScoreChange } from "@/lib/score-comparison";

interface PageProps {
  searchParams: Promise<{ cycle?: string }>;
}

const STATE_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started",
  OPEN: "Awaiting employee",
  EMPLOYEE_SUBMITTED: "Awaiting manager review",
  MANAGER_REVIEWED: "Manager reviewed",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled (not restarted)",
};

const th = "border-b border-ds-border bg-ds-surface px-3 py-2 text-left text-xs font-medium text-ds-text-secondary";
const td = "border-b border-ds-border px-3 py-2 text-[13px] tabular-nums";

export default async function MidyearReportPage({ searchParams }: PageProps) {
  const user = await getCurrentUser();
  if (!user?.roles?.some((r) => r === "hr" || r === "admin")) redirect("/dashboard");

  const params = await searchParams;
  const cycleId = params.cycle || null;
  const supabase = createClient();

  const { data: cycleRows } = await supabase
    .from("appraisal_cycles")
    .select("id, name")
    .eq("midyear_review_enabled", true)
    .order("end_date", { ascending: false });
  const cycles = (cycleRows ?? []) as { id: string; name: string }[];

  let data: MidyearReportData | null = null;
  let loadError: string | null = null;
  try {
    data = await getMidyearReportData(supabase, { cycleId });
  } catch (err) {
    console.error("[hr/midyear] report failed:", err);
    loadError = "Mid-Year reporting is unavailable. The Mid-Year database changes may not be applied yet.";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-ds-page-title text-ds-text-primary">Mid-Year Review report</h1>
          <p className="text-muted-foreground">
            Mid-Year completion, Mid-Year scores and change to the Final score. Mid-Year scores are reported separately and never
            included in official (Final) results.
          </p>
        </div>
        <form method="get" className="flex items-end gap-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">Cycle</span>
            <select
              name="cycle"
              defaultValue={cycleId ?? ""}
              className="flex h-9 min-w-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All Mid-Year cycles</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="h-9 rounded-md border border-input px-3 text-sm">
            Apply
          </button>
        </form>
      </div>

      {loadError && <p className="text-[13px] text-ds-error">{loadError}</p>}

      {data && (
        <>
          <section className="rounded-ds-panel border border-ds-border bg-ds-background">
            <h2 className="px-4 pt-3 text-[13px] font-semibold text-ds-text-primary">Completion status · {data.appraisalCount} appraisals</h2>
            <table className="mt-2 w-full border-collapse">
              <tbody>
                {MIDYEAR_COMPLETION_STATES.map((s) => (
                  <tr key={s}>
                    <td className={td}>{STATE_LABELS[s]}</td>
                    <td className={`${td} text-right`}>{data!.completion[s]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-ds-panel border border-ds-border bg-ds-background">
            <h2 className="px-4 pt-3 text-[13px] font-semibold text-ds-text-primary">
              Mid-Year score distribution · {data.scoredCount} scored
              {data.meanMidyear !== null ? ` · mean ${formatScore(data.meanMidyear)}` : ""}
            </h2>
            <table className="mt-2 w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Score band</th>
                  <th className={`${th} text-right`}>Appraisals</th>
                </tr>
              </thead>
              <tbody>
                {data.distribution.map((b) => (
                  <tr key={b.band}>
                    <td className={td}>{b.band}</td>
                    <td className={`${td} text-right`}>{b.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-ds-panel border border-ds-border bg-ds-background">
            <h2 className="px-4 pt-3 text-[13px] font-semibold text-ds-text-primary">
              Mid-Year vs Final · {data.change.rows.length} appraisals with both · improved {data.change.improved} · declined{" "}
              {data.change.declined} · unchanged {data.change.unchanged}
              {data.change.meanChange !== null ? ` · mean change ${formatScoreChange(data.change.meanChange)}` : ""}
            </h2>
            {data.change.rows.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ds-text-secondary">No appraisal has both a Mid-Year and a Final score yet.</p>
            ) : (
              <table className="mt-2 w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th}>Employee</th>
                    <th className={th}>Division</th>
                    <th className={`${th} text-right`}>Mid-Year</th>
                    <th className={`${th} text-right`}>Final (official)</th>
                    <th className={`${th} text-right`}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {data.change.rows.map((r) => (
                    <tr key={r.appraisalId}>
                      <td className={td}>{r.employeeName}</td>
                      <td className={td}>{r.divisionName ?? "—"}</td>
                      <td className={`${td} text-right`}>{formatScore(r.midyear)}</td>
                      <td className={`${td} text-right`}>{formatScore(r.final)}</td>
                      <td className={`${td} text-right`}>{formatScoreChange(r.change)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
