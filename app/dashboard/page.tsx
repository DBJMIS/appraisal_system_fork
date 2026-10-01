import { getCurrentUser } from "@/lib/auth";
import { fetchEmployeeDashboardStrip } from "@/lib/dashboard-employee-strip";
import { fetchHrDashboardStats } from "@/lib/dashboard-hr-stats";
import { fetchManagerDashboardStats } from "@/lib/dashboard-manager-stats";
import { getReportingStructureFromDynamics } from "@/lib/reporting-structure";
import { DashboardDbjClient } from "@/components/dashboard/dashboard-dbj-client";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const employeeId = user?.employee_id ?? null;

  const isHR = Boolean(user?.roles?.some((r) => r === "hr" || r === "admin"));

  const dynamicsStructure = user
    ? await getReportingStructureFromDynamics(user.employee_id ?? null, user.email ?? null)
    : null;
  const isManager = (dynamicsStructure?.directReports?.length ?? 0) > 0;
  const isBoth = isHR && isManager;

  const strip = user ? await fetchEmployeeDashboardStrip(user, employeeId) : null;

  let hrStats = null;
  if (isHR) {
    try {
      hrStats = await fetchHrDashboardStats();
    } catch {
      hrStats = null;
    }
  }

  let managerStats = null;
  if (isManager && user) {
    try {
      managerStats = await fetchManagerDashboardStats(user, dynamicsStructure);
    } catch {
      managerStats = null;
    }
  }

  const emptyStrip = {
    full_name: user?.name ?? null,
    appraisal_id: null,
    status: "DRAFT",
    stageIndex: 0,
    stageLabel: "—",
    latestScore: null,
    ratingLabel: null,
    recent_scores: [],
    feedback_pending_count: 0,
    development_profile_percent: 0,
  };

  return (
    <div className="space-y-4 pb-8">
      <DashboardDbjClient
        strip={strip ?? emptyStrip}
        isHR={isHR}
        isManager={isManager}
        isBoth={isBoth}
        hrStats={hrStats}
        managerStats={managerStats}
      />

      {!employeeId && user && (
        <div
          className="mx-auto max-w-7xl rounded-ds-panel px-6 py-4"
          style={{
            backgroundColor: "#fffbeb",
            border: "1px solid #fbe3a1",
          }}
        >
          <p className="text-sm text-ds-warning">
            Your profile is not linked to an employee record. Connect your account in HR Administration to see
            your full appraisal data here.
          </p>
        </div>
      )}
    </div>
  );
}
