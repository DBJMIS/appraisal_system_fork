import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { getReportingStructureFromDynamics } from "@/lib/reporting-structure";
import { ProfileHero } from "@/components/profile/ProfileHero";
import { IdentityCard } from "@/components/profile/IdentityCard";
import { DivisionCard } from "@/components/profile/DivisionCard";
import { DirectReports } from "@/components/profile/DirectReports";
import { ReportsToCard } from "@/components/profile/ReportsToCard";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase URL and key required");
  return createClient(url, key);
}

interface CycleAppraisal {
  review_type: string;
  status: string;
  cycle_name: string;
}

async function getActiveCycleAppraisals(employeeId: string): Promise<{
  appraisals: CycleAppraisal[];
  cycleName: string | null;
}> {
  const supabase = getSupabase();
  
  const { data: activeCycle } = await supabase
    .from("appraisal_cycles")
    .select("id, name")
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (!activeCycle) {
    return { appraisals: [], cycleName: null };
  }

  const { data: appraisals } = await supabase
    .from("appraisals")
    .select("review_type, status")
    .eq("employee_id", employeeId)
    .eq("cycle_id", activeCycle.id)
    .eq("is_active", true)
    .eq("review_type", "annual");

  return {
    appraisals: (appraisals || []).map((a) => ({
      review_type: a.review_type,
      status: a.status,
      cycle_name: activeCycle.name,
    })),
    cycleName: activeCycle.name,
  };
}

export default async function ProfilePage() {
  const user = await getCurrentUser();
  
  if (!user) {
    redirect("/login");
  }

  const structure = await getReportingStructureFromDynamics(
    user.employee_id ?? null,
    user.email ?? null
  );

  const employeeId = structure.employee_id;
  const profile = structure.currentUserProfile;

  let cycleData: { appraisals: CycleAppraisal[]; cycleName: string | null } = {
    appraisals: [],
    cycleName: null,
  };

  if (employeeId) {
    cycleData = await getActiveCycleAppraisals(employeeId);
  }

  const manager = structure.managers[0] ?? null;
  const directReports = structure.directReports;
  const isActive = true;

  return (
    <div className="min-h-full -m-6 md:-m-8">
      {/* Hero - full bleed */}
      <ProfileHero
        fullName={user.name || "Unknown User"}
        jobTitle={profile?.job_title ?? null}
        divisionName={profile?.division_name ?? null}
        isActive={isActive}
        directReportsCount={directReports.length}
      />

      {/* Body content */}
      <div
        className="px-6 md:px-8 py-6"
        style={{ backgroundColor: "#f3f3f3" }}
      >
        {/* Row 1: Identity + Division */}
        <div
          className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5 animate-fade-up"
          style={{ animationDelay: "0.10s" }}
        >
          <IdentityCard
            fullName={user.name || "Unknown User"}
            email={user.email ?? null}
            employeeId={employeeId || "Not linked"}
            jobTitle={profile?.job_title ?? null}
          />
          <DivisionCard
            divisionName={profile?.division_name ?? null}
            departmentName={profile?.department_name ?? null}
            divisionHead={profile?.divisionHead ?? null}
            isActive={isActive}
          />
        </div>

        {/* Row 2: Direct Reports + Reports To */}
        <div
          className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5 animate-fade-up"
          style={{ animationDelay: "0.18s" }}
        >
          <DirectReports reports={directReports} />
          <ReportsToCard
            manager={manager}
            cycleAppraisals={cycleData.appraisals}
            activeCycleName={cycleData.cycleName}
          />
        </div>
      </div>
    </div>
  );
}
