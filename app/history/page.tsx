import { getCurrentUser } from "@/lib/auth";
import { getPerformanceHistory } from "@/lib/history-data";
import { PerformanceHistoryView } from "@/components/performance-history-view";

export default async function PerformanceHistoryPage() {
  const user = await getCurrentUser();
  const employeeId = user?.employee_id ?? null;
  const items = await getPerformanceHistory(employeeId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-ds-page-title text-ds-text-primary">
          Performance History
        </h1>
        <p className="text-muted-foreground">
          View your past appraisal cycles, scores, and outcomes.
        </p>
      </div>
      <PerformanceHistoryView items={items} />
      {!employeeId && (
        <div className="rounded-lg border border-ds-warning-border bg-ds-warning-subtle dark:border-amber-900 dark:bg-amber-950/30 p-4">
          <p className="text-sm text-ds-warning dark:text-amber-200">
            Your profile is not linked to an employee record. Connect your
            account to see your performance history here.
          </p>
        </div>
      )}
    </div>
  );
}
