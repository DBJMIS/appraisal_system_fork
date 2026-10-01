import Link from "next/link";
import { notFound } from "next/navigation";
import { Users, UserCircle, ArrowLeft, Building2, UserCog } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCurrentUser, isPlaceholderUser } from "@/lib/auth";
import { getReportingStructureFromDynamics } from "@/lib/reporting-structure";
import { ExpandableDirectReports } from "@/components/ExpandableDirectReports";

export default async function ReportingTestPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const user = await getCurrentUser();
  const structure = await getReportingStructureFromDynamics(user?.employee_id ?? null, user?.email ?? null);
  const employeeId = structure.employee_id;
  const isPlaceholder = user && isPlaceholderUser(user);
  const profile = structure.currentUserProfile;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-ds-page-title text-ds-text-primary">
          Reporting structure (HR test)
        </h1>
        <p className="text-muted-foreground">
          Your position, division, manager, direct reports, and division head from Dynamics 365 HR (
          <code className="rounded bg-muted px-1">xrm1_employee</code> entity).
        </p>
        {isPlaceholder && (
          <p className="mt-2 text-sm text-ds-warning dark:text-amber-400">
            Set <code className="rounded bg-muted px-1">SEED_USER_EMAIL</code> in .env to your work email to pull your data from HR, or sign in with Microsoft.
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <UserCog className="h-4 w-4 text-muted-foreground" />
            Current user
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p>
            <span className="text-muted-foreground">Email:</span> {user?.email ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Name:</span> {user?.name ?? "—"}
          </p>
          <p>
            <span className="text-muted-foreground">Employee ID (xrm1_employeeid):</span>{" "}
            {employeeId ?? (
              <span className="text-ds-warning">Not found in Dynamics (xrm1_employee by user/email)</span>
            )}
          </p>
          {profile && (
            <>
              <p>
                <span className="text-muted-foreground">Job title:</span> {profile.job_title ?? "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Division:</span> {profile.division_name ?? profile.division_id ?? "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Department:</span> {profile.department_name ?? profile.department_id ?? "—"}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {profile && (profile.division_name ?? profile.division_id ?? profile.divisionHead) && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Your division</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p>
              <span className="text-muted-foreground">Division:</span> {profile.division_name ?? profile.division_id ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Division / department head:</span>{" "}
              {profile.divisionHead ? (
                <span className="inline-flex flex-col">
                  <span className="font-medium">{profile.divisionHead.full_name ?? profile.divisionHead.employee_id}</span>
                  {profile.divisionHead.job_title && (
                    <span className="text-muted-foreground text-sm">{profile.divisionHead.job_title}</span>
                  )}
                  {profile.divisionHead.email && (
                    <span className="text-muted-foreground text-xs">{profile.divisionHead.email}</span>
                  )}
                </span>
              ) : (
                "—"
              )}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">People reporting to you</CardTitle>
          </CardHeader>
          <CardContent>
            {!employeeId ? (
              <p className="text-sm text-muted-foreground">
                Link your account to an employee_id to see direct reports.
              </p>
            ) : structure.directReports.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No direct reports in <code>xrm1_employee</code> where{" "}
                <code>_xrm1_manager_employee_id_value</code> = your xrm1_employeeid.
              </p>
            ) : (
              <ExpandableDirectReports directReports={structure.directReports} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <UserCircle className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Who you report to</CardTitle>
          </CardHeader>
          <CardContent>
            {!employeeId ? (
              <p className="text-sm text-muted-foreground">
                Link your account to an employee_id to see your manager(s).
              </p>
            ) : structure.managers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No manager in <code>xrm1_employee</code> (your{" "}
                <code>_xrm1_manager_employee_id_value</code> is empty).
              </p>
            ) : (
              <ul className="space-y-2">
                {structure.managers.map((p) => (
                  <li
                    key={p.employee_id}
                    className="flex flex-col rounded-md border bg-muted/30 p-2 text-sm"
                  >
                    <span className="font-medium">{p.full_name ?? p.employee_id}</span>
                    {p.job_title && (
                      <span className="text-muted-foreground">{p.job_title}</span>
                    )}
                    {p.email && (
                      <span className="text-muted-foreground text-xs">{p.email}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
