import { getCurrentUser } from "@/lib/auth";
import { DevelopmentProfileLoader } from "@/components/development-profile-form";

export default async function DevelopmentPage() {
  const user = await getCurrentUser();
  const employeeId = user?.employee_id ?? null;
  const hasEmployeeLink = !!employeeId;

  return (
    <div style={{ animation: "fadeUp 0.4s ease both" }}>
      {!user ? (
        <div className="rounded-ds-panel border border-ds-border bg-white p-6">
          <p className="text-[13px] text-ds-text-secondary m-0">
            Please sign in to view your development profile.
          </p>
        </div>
      ) : !hasEmployeeLink ? (
        <div className="rounded-ds-panel border border-ds-border bg-white p-6">
          <p className="text-[13px] text-ds-text-secondary m-0">
            Your profile is not linked to an employee record. Connect your account in HR
            Administration to manage your development profile.
          </p>
        </div>
      ) : (
        <DevelopmentProfileLoader userId={employeeId!} />
      )}
    </div>
  );
}
