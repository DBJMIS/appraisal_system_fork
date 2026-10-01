import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getManagerReviewList } from "@/lib/manager-reviews-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronRight } from "lucide-react";

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Draft",
    self_submitted: "Self submitted",
    manager_in_review: "In review",
    manager_completed: "Manager completed",
    employee_acknowledged: "Acknowledged",
    hr_in_review: "HR review",
    closed: "Closed",
  };
  return labels[status] ?? status;
}

export default async function ManagerReviewsListPage() {
  const user = await getCurrentUser();
  const managerEmployeeId = user?.employee_id ?? null;
  const items = await getManagerReviewList(managerEmployeeId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-ds-page-title text-ds-text-primary">
          Team Reviews
        </h1>
        <p className="text-muted-foreground">
          Review and complete appraisals for employees who report to you.
        </p>
      </div>

      {!managerEmployeeId ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Your profile is not linked to a manager employee record. Connect
              your account to see team members who report to you.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Appraisals to review</CardTitle>
            <p className="text-sm text-muted-foreground">
              Employees assigned to you via reporting lines. Click Action to
              complete your review.
            </p>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No appraisals to review at the moment.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee Name</TableHead>
                      <TableHead>Cycle</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-[100px]">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((row) => (
                      <TableRow key={row.appraisalId}>
                        <TableCell className="font-medium">
                          {row.employeeName}
                        </TableCell>
                        <TableCell>{row.cycleName}</TableCell>
                        <TableCell>{statusLabel(row.status)}</TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" asChild>
                            <Link
                              href={`/manager/reviews/${row.appraisalId}`}
                              className="flex items-center gap-1"
                            >
                              Review
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
