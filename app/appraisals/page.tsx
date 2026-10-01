import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getAppraisalsListForUser } from "@/lib/appraisals-list-data";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReviewTypeBadge } from "@/components/ui/review-type-badge";
import { EmployeeCell } from "@/components/ui/employee-cell";
import { CycleChip } from "@/components/ui/cycle-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { TeamAppraisalRowGroup, type TeamAppraisalRow } from "@/components/appraisal/TeamAppraisalRows";

const DocumentIcon = () => (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

const UsersIcon = () => (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const DocumentEmptyIcon = () => (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

interface AppraisalTableProps {
  section: "mine" | "team";
  rows: Array<
    TeamAppraisalRow & {
      isDelegated?: boolean;
      delegatedByName?: string | null;
    }
  >;
}

function AppraisalTable({ rows, section }: AppraisalTableProps) {
  return (
    <div
      className="overflow-hidden rounded-ds-panel bg-white"
      style={{
        boxShadow: "var(--shadow-card)",
        border: "1px solid var(--border-color)",
      }}
    >
      <table className="w-full table-fixed">
        <colgroup>
          <col style={{ width: "28%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
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
          {section === "team" && rows.map((row, idx) => (
            <TeamAppraisalRowGroup key={row.appraisalId} row={row} first={idx === 0} />
          ))}
          {section === "mine" && rows.map((row, idx) => (
            <tr
              key={row.appraisalId}
              className="group cursor-pointer transition-colors hover:bg-ds-surface"
              style={{
                borderBottom: idx < rows.length - 1 ? "1px solid var(--border-color)" : undefined,
              }}
            >
              <td className="px-5 py-3.5">
                <div>
                  <EmployeeCell name={row.employeeName} />
                </div>
              </td>
              <td className="px-5 py-3.5">
                <CycleChip year={row.cycleName} />
              </td>
              <td className="px-5 py-3.5">
                <ReviewTypeBadge type={row.reviewType} />
              </td>
              <td className="px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <StatusBadge status={row.status} />
                  {row.isDelegated && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-ds-badge border border-ds-lavender-border bg-ds-lavender-subtle px-2 py-0.5 text-[10px] font-semibold text-ds-lavender-text"
                      title={`Delegated by ${row.delegatedByName ?? "manager"}`}
                    >
                      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ds-lavender" />
                      Delegated
                    </span>
                  )}
                </div>
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
  );
}

export default async function AppraisalsPage() {
  const user = await getCurrentUser();
  const isHR = user?.roles?.some((r) => r === "hr" || r === "admin") ?? false;

  const { myAppraisals, reportsAppraisals } = await getAppraisalsListForUser(user);

  const hasReports = reportsAppraisals.length > 0;
  const hasOwn = myAppraisals.length > 0;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      {/* Page Header */}
      <PageHeader
        icon={<DocumentIcon />}
        title="My Appraisals"
        subtitle="View and manage your appraisals and your team's appraisals"
      />

      {/* My Appraisals Section */}
      <div className="animate-fade-up-delay-1 space-y-4">
        <SectionHeader
          icon={<DocumentIcon />}
          title="My Appraisals"
          subtitle="Your own performance appraisals"
          count={myAppraisals.length}
          variant="blue"
        />
        
        {hasOwn ? (
          <AppraisalTable section="mine" rows={myAppraisals} />
        ) : (
          <div
            className="rounded-ds-panel bg-white"
            style={{
              boxShadow: "var(--shadow-card)",
              border: "1px solid var(--border-color)",
            }}
          >
            <EmptyState
              icon={<DocumentEmptyIcon />}
              title="No appraisals found"
              description="You don't have any appraisals yet. They will appear here once a cycle is opened."
            />
          </div>
        )}
      </div>

      {/* Team Appraisals Section */}
      {hasReports && (
        <div className="animate-fade-up-delay-2 space-y-4">
          <SectionHeader
            icon={<UsersIcon />}
            title="My Team's Appraisals"
            subtitle="Appraisals for people who report to you"
            count={reportsAppraisals.length}
            variant="violet"
          />
          
          <AppraisalTable section="team" rows={reportsAppraisals} />
        </div>
      )}

      {/* HR Hint */}
      {!hasOwn && !hasReports && isHR && (
        <div
          className="rounded-ds-panel px-6 py-4"
          style={{
            backgroundColor: "var(--surface-2)",
            border: "1px solid var(--border-color)",
          }}
        >
          <p className="text-sm text-text-muted">
            To view all appraisals across the organisation, go to{" "}
            <Link href="/admin/appraisals" className="font-medium text-accent underline">
              HR Administration → All Appraisals
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}
