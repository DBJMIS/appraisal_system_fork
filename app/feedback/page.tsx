import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { getParticipantFeedbackDashboard } from "@/lib/feedback-dashboard";
import { ensureParticipantIfLeader } from "@/lib/feedback-ensure-participant";
import {
  buildCycleResultsForEmployees,
  formatScoreOutOf10,
  getFeedbackCycleResultsForViewer,
  getParticipantOverallAverageSubmitted,
  getReviewerCompletionByType,
  scoreOutOf10,
  type FeedbackCycleResultRow,
} from "@/lib/feedback-cycle-results";
import { cn } from "@/lib/utils";
import { avatarAccent } from "@/lib/avatar-accent";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase config required");
  return createClient(url, key);
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(date: string | null) {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return date;
  }
}

function RelationshipPill({ type }: { type: string }) {
  const map: Record<string, string> = {
    MANAGER: "bg-ds-warning-subtle border-ds-warning-border text-ds-warning",
    DIRECT_REPORT: "bg-ds-error-subtle border-ds-error-border text-ds-error",
    PEER: "bg-ds-success-subtle border-ds-success-border text-ds-success",
    SELF: "bg-ds-info-subtle border-ds-info-border text-ds-info",
  };
  const label = type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-ds-badge border px-2.5 py-0.5 text-[10px] font-semibold",
        map[type] ?? map.PEER
      )}
    >
      {label}
    </span>
  );
}

function TypeBadgeClosed({ type }: { type: string }) {
  const map: Record<string, string> = {
    ANNUAL: "bg-ds-info-subtle border-ds-info-border text-ds-info",
    MID_YEAR: "bg-ds-warning-subtle border-ds-warning-border text-ds-warning",
    PEER: "bg-ds-surface border-ds-border-strong text-ds-info",
    DIRECT_REPORT: "bg-ds-info-subtle border-ds-info-border text-ds-info",
    MANAGER: "bg-ds-warning-subtle border-ds-warning-border text-ds-warning",
    SELF: "bg-ds-success-subtle border-ds-success-border text-ds-success",
  };
  const label = type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-ds-badge border px-2.5 py-1 text-[10px] font-semibold",
        map[type] ?? map.PEER
      )}
    >
      {label}
    </span>
  );
}

function CycleBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-ds-badge border border-ds-border-strong bg-ds-surface px-2.5 py-1 text-[10px] font-semibold text-ds-info">
      {label}
    </span>
  );
}

function CompletedStatusBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-ds-badge border border-ds-success-border bg-ds-success-subtle px-2.5 py-1 text-[10px] font-semibold text-ds-success">
      <span className="h-[5px] w-[5px] rounded-full bg-ds-mint" />
      Completed
    </span>
  );
}

const ChevronRight = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

type TaskRow = {
  id: string;
  cycleId: string;
  href: string;
  participantName: string;
  participantEmployeeId: string;
  reviewType: string;
  dueDate: string | null;
  reviewerStatus: string;
  savedResponseCount: number;
};

function taskProgressLabel(row: TaskRow): "Pending" | "In_Progress" | "Completed" {
  if (row.reviewerStatus === "Submitted") return "Completed";
  if (row.savedResponseCount > 0) return "In_Progress";
  return "Pending";
}

function MyProgressCell({ row }: { row: TaskRow }) {
  const p = taskProgressLabel(row);
  if (p === "Completed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ds-success">
        <span className="h-1.5 w-1.5 rounded-full bg-ds-mint" />
        Submitted
      </span>
    );
  }
  if (p === "In_Progress") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ds-accent">
        <span className="h-1.5 w-1.5 rounded-full bg-ds-accent" />
        In progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ds-text-secondary">
      <span className="h-1.5 w-1.5 rounded-full bg-ds-border-strong" />
      Not started
    </span>
  );
}

function ScoreVisibleCell({
  row,
  weightedOverall,
  drSubmitted,
  drTotal,
}: {
  row: TaskRow;
  weightedOverall: number | null | undefined;
  drSubmitted: number;
  drTotal: number;
}) {
  const t = row.reviewType;
  if (t === "DIRECT_REPORT") {
    const w = weightedOverall;
    const so = scoreOutOf10(w ?? undefined);
    const scorePart = so != null ? `${so.toFixed(1)}/10` : "—";
    return (
      <span className="text-xs text-ds-text-primary">
        {scorePart} · {drSubmitted}/{drTotal} done
      </span>
    );
  }
  if (t === "MANAGER") {
    return <span className="text-xs text-ds-text-secondary">Visible after you submit</span>;
  }
  if (t === "PEER") {
    return <span className="text-xs text-ds-text-secondary">—</span>;
  }
  return <span className="text-xs text-ds-text-secondary">—</span>;
}

function ActionButton({ row }: { row: TaskRow }) {
  const p = taskProgressLabel(row);
  if (p === "Completed") {
    return (
      <Link
        href={row.href}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border bg-white px-4 py-2 text-[11px] font-semibold text-ds-text-secondary transition-colors hover:border-ds-text-primary hover:text-ds-text-primary"
      >
        View
      </Link>
    );
  }
  if (p === "In_Progress") {
    return (
      <Link
        href={row.href}
        className="inline-flex items-center gap-1.5 rounded-lg border-2 border-ds-accent bg-white px-4 py-2 text-[11px] font-semibold text-ds-accent transition-colors hover:bg-ds-success-subtle"
      >
        Continue
        <ChevronRight />
      </Link>
    );
  }
  return (
    <Link
      href={row.href}
      className="inline-flex items-center gap-1.5 rounded-lg bg-ds-accent px-4 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-ds-success"
    >
      Start review
      <ChevronRight />
    </Link>
  );
}

/** Average of available 1–5 type means (self, peer, direct_report, manager); null if none. */
function aggregateScoreFromResultRow(row: FeedbackCycleResultRow): number | null {
  const parts: number[] = [];
  if (row.self?.avg != null) parts.push(row.self.avg);
  if (row.peer?.avg != null) parts.push(row.peer.avg);
  if (row.direct_report?.avg != null) parts.push(row.direct_report.avg);
  if (row.manager?.avg != null) parts.push(row.manager.avg);
  if (parts.length === 0) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

function BreakdownCell({
  label,
  entry,
  completion,
}: {
  label: string;
  entry: { avg: number } | null | undefined;
  completion: { total: number; submitted: number };
}) {
  const scoreLabel = formatScoreOutOf10(entry?.avg ?? null);
  const pct = completion.total > 0 ? (completion.submitted / completion.total) * 100 : 0;
  return (
    <div className="rounded-ds-panel border border-ds-surface bg-ds-surface p-3">
      <p className="mb-1 text-[10px] font-medium text-ds-text-secondary">{label}</p>
      <p className="text-sm font-semibold text-ds-text-primary">{scoreLabel}</p>
      <p className="mt-0.5 text-[10px] text-ds-text-secondary">
        {completion.submitted}/{completion.total} submitted
      </p>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-ds-border">
        <div className="h-full rounded-full bg-ds-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface FeedbackCycle {
  id: string;
  cycle_name: string;
  end_date: string | null;
  status: string;
}

interface ClosedCycleRow {
  id: string;
  name: string;
  cycleLabel: string;
  type: string;
  closedDate: string | null;
}

export default async function FeedbackPage() {
  const user = await getCurrentUser();
  if (!user?.id) {
    return (
      <div className="w-full bg-ds-surface px-7 py-6">
        <div className="rounded-ds-panel border border-ds-border bg-white p-5">
          <p className="text-sm text-ds-text-secondary">Please sign in to view 360 Feedback.</p>
        </div>
      </div>
    );
  }

  const supabase = getSupabase();
  const { data: cycles, error } = await supabase
    .from("feedback_cycle")
    .select("id, cycle_name, description, linked_appraisal_cycle_id, start_date, end_date, status, created_at")
    .order("end_date", { ascending: false });

  const allCycles = (cycles ?? []) as FeedbackCycle[];
  const activeCycles = allCycles.filter((c) => c.status === "Active");
  if (user.employee_id) {
    for (const c of activeCycles) {
      await ensureParticipantIfLeader(c.id, user.employee_id, user.email);
    }
  }

  const participantCycles = await getParticipantFeedbackDashboard(user.employee_id ?? null);
  const participantClosed = participantCycles.filter((c) => c.status === "Closed");
  const draftCycles = allCycles.filter((c) => c.status === "Draft");

  const employeeId = user.employee_id;
  const activeCycleIds = activeCycles.map((c) => c.id);

  /** All assignments (including completed) for tasks table + team detection */
  let allTaskRows: TaskRow[] = [];
  const responseCountByReviewer = new Map<string, number>();

  if (employeeId && activeCycleIds.length > 0) {
    const { data: myReviewerRows } = await supabase
      .from("feedback_reviewer")
      .select("id, cycle_id, participant_employee_id, reviewer_type, status")
      .eq("reviewer_employee_id", employeeId)
      .in("cycle_id", activeCycleIds);

    if (myReviewerRows?.length) {
      const cycleIds = [...new Set(myReviewerRows.map((r) => r.cycle_id))];
      const participantIds = [...new Set(myReviewerRows.map((r) => r.participant_employee_id))];
      const reviewerRowIds = myReviewerRows.map((r) => r.id);

      const [{ data: cycleRows }, { data: employees }, { data: respRows }] = await Promise.all([
        supabase.from("feedback_cycle").select("id, cycle_name, end_date").in("id", cycleIds),
        supabase.from("employees").select("employee_id, full_name").in("employee_id", participantIds),
        supabase.from("feedback_response").select("reviewer_id").in("reviewer_id", reviewerRowIds),
      ]);

      for (const x of respRows ?? []) {
        const id = x.reviewer_id as string;
        responseCountByReviewer.set(id, (responseCountByReviewer.get(id) ?? 0) + 1);
      }

      const cycleById = new Map((cycleRows ?? []).map((c) => [c.id, c]));
      const empById = new Map((employees ?? []).map((e) => [e.employee_id, e]));

      allTaskRows = myReviewerRows.map((r) => {
        const cycle = cycleById.get(r.cycle_id);
        const emp = empById.get(r.participant_employee_id);
        return {
          id: r.id,
          cycleId: r.cycle_id,
          href: `/feedback/cycles/${r.cycle_id}/review/${r.id}`,
          participantName: emp?.full_name ?? r.participant_employee_id,
          participantEmployeeId: r.participant_employee_id,
          reviewType: (r.reviewer_type as string) ?? "—",
          dueDate: cycle?.end_date ?? null,
          reviewerStatus: String(r.status ?? "Pending"),
          savedResponseCount: responseCountByReviewer.get(r.id) ?? 0,
        };
      });

      const order = (t: string) => (t === "MANAGER" ? 0 : t === "DIRECT_REPORT" ? 1 : t === "PEER" ? 2 : 9);
      allTaskRows.sort((a, b) => {
        if (a.cycleId !== b.cycleId) return a.cycleId.localeCompare(b.cycleId);
        const d = order(a.reviewType) - order(b.reviewType);
        if (d !== 0) return d;
        return a.participantName.localeCompare(b.participantName);
      });
    }
  }

  /** Hero: SELF row per active cycle where user participates */
  type HeroBlock = {
    cycle: FeedbackCycle;
    selfHref: string;
    overallAvg: number | null;
    completionByType: Awaited<ReturnType<typeof getReviewerCompletionByType>>;
    resultSelf: FeedbackCycleResultRow | null;
    submittedRatio: number;
  };

  const heroBlocks: HeroBlock[] = [];
  if (employeeId) {
    for (const cycle of activeCycles) {
      const { data: selfRow } = await supabase
        .from("feedback_reviewer")
        .select("id")
        .eq("cycle_id", cycle.id)
        .eq("participant_employee_id", employeeId)
        .eq("reviewer_type", "SELF")
        .maybeSingle();

      if (!selfRow?.id) continue;

      const [overallAvg, completionByType, resultsPayload] = await Promise.all([
        getParticipantOverallAverageSubmitted(supabase, cycle.id, employeeId),
        getReviewerCompletionByType(supabase, cycle.id, employeeId),
        getFeedbackCycleResultsForViewer(supabase, cycle.id, employeeId),
      ]);

      const resultSelf = resultsPayload?.results.find((r) => r.employee_id === employeeId) ?? null;

      const { data: allRev } = await supabase
        .from("feedback_reviewer")
        .select("status")
        .eq("cycle_id", cycle.id)
        .eq("participant_employee_id", employeeId);

      const totalR = (allRev ?? []).length;
      const subR = (allRev ?? []).filter((x) => x.status === "Submitted").length;
      const submittedRatio = totalR > 0 ? subR / totalR : 0;

      heroBlocks.push({
        cycle,
        selfHref: `/feedback/cycles/${cycle.id}/review/${selfRow.id}`,
        overallAvg,
        completionByType,
        resultSelf,
        submittedRatio,
      });
    }
  }

  const closedCycles: ClosedCycleRow[] = participantClosed.map((c) => ({
    id: c.cycle_id,
    name: c.cycle_name,
    cycleLabel: c.cycle_name,
    type: "ANNUAL",
    closedDate: c.end_date,
  }));

  /** Preload results + completion per cycle for task table */
  const resultsByCycleId = new Map<string, Awaited<ReturnType<typeof getFeedbackCycleResultsForViewer>>>();
  const completionByParticipant = new Map<string, Awaited<ReturnType<typeof getReviewerCompletionByType>>>();

  if (employeeId) {
    for (const c of activeCycles) {
      const payload = await getFeedbackCycleResultsForViewer(supabase, c.id, employeeId);
      resultsByCycleId.set(c.id, payload);
      const pids = new Set<string>();
      for (const r of allTaskRows) {
        if (r.cycleId === c.id) pids.add(r.participantEmployeeId);
      }
      for (const pid of pids) {
        const key = `${c.id}:${pid}`;
        completionByParticipant.set(key, await getReviewerCompletionByType(supabase, c.id, pid));
      }
    }
  }

  /**
   * Team rows per cycle: your team = participants you are assigned to review as MANAGER.
   */
  type TeamRow = {
    cycleId: string;
    employeeId: string;
    name: string;
    /** 1–5 aggregate from result buckets; null if no submitted scores yet */
    aggregateAvg1to5: number | null;
    submitted: number;
    total: number;
    status: "Completed" | "In_progress" | "Pending";
    riskKind: "low_response" | "done" | "on_track";
  };

  const teamByCycle = new Map<string, TeamRow[]>();
  if (employeeId) {
    for (const c of activeCycles) {
      const { data: managerRows } = await supabase
        .from("feedback_reviewer")
        .select("participant_employee_id, status")
        .eq("cycle_id", c.id)
        .eq("reviewer_employee_id", employeeId)
        .eq("reviewer_type", "MANAGER");

      const teamMemberIds = [
        ...new Set((managerRows ?? []).map((r) => r.participant_employee_id as string)),
      ];
      if (teamMemberIds.length === 0) continue;

      const teamPayload = await buildCycleResultsForEmployees(supabase, c.id, teamMemberIds);
      const resultByEmp = new Map(teamPayload.results.map((r) => [r.employee_id, r]));

      const { data: revRows } = await supabase
        .from("feedback_reviewer")
        .select("participant_employee_id, status")
        .eq("cycle_id", c.id)
        .in("participant_employee_id", teamMemberIds);

      const revStats = new Map<string, { total: number; submitted: number }>();
      for (const pid of teamMemberIds) {
        revStats.set(pid, { total: 0, submitted: 0 });
      }
      for (const r of revRows ?? []) {
        const pid = r.participant_employee_id as string;
        const s = revStats.get(pid);
        if (!s) continue;
        s.total += 1;
        if (r.status === "Submitted") s.submitted += 1;
      }

      const { data: emps } = await supabase
        .from("employees")
        .select("employee_id, full_name")
        .in("employee_id", teamMemberIds);

      const empMap = new Map((emps ?? []).map((e) => [e.employee_id, e]));

      const rows: TeamRow[] = [];
      for (const pid of teamMemberIds) {
        const st = revStats.get(pid) ?? { total: 0, submitted: 0 };
        const { total, submitted } = st;
        let status: TeamRow["status"] = "Pending";
        if (total > 0 && submitted >= total) status = "Completed";
        else if (submitted > 0) status = "In_progress";

        const ratio = total > 0 ? submitted / total : 0;
        let riskKind: TeamRow["riskKind"] = "on_track";
        if (c.status === "Active" && total > 0 && ratio < 0.4) riskKind = "low_response";
        else if (total > 0 && submitted === total) riskKind = "done";

        const res = resultByEmp.get(pid);
        const aggregateAvg1to5 = res ? aggregateScoreFromResultRow(res) : null;

        const emp = empMap.get(pid);
        rows.push({
          cycleId: c.id,
          employeeId: pid,
          name: emp?.full_name ?? pid,
          aggregateAvg1to5,
          submitted,
          total,
          status,
          riskKind,
        });
      }
      rows.sort((a, b) => a.name.localeCompare(b.name));
      teamByCycle.set(c.id, rows);
    }
  }

  const teamMemberIds = [
    ...new Set([...teamByCycle.values()].flatMap((rows) => rows.map((r) => r.employeeId))),
  ];

  const overallOutOf10 = (avg: number | null) => {
    if (avg == null) return "—";
    const s = scoreOutOf10(avg);
    return s != null ? `${s.toFixed(1)}/10` : "—";
  };

  return (
    <div className="min-h-screen w-full bg-ds-surface px-7 py-6">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-ds-text-primary">My 360 reviews</h1>
        <p className="mt-1 text-sm text-ds-text-secondary">
          Complete feedback assigned to you and track your own review progress
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-ds-panel border border-ds-error-border bg-ds-error-subtle px-5 py-4 text-sm text-ds-error">
          {error.message}
        </div>
      )}

      {/* Section 1 — Your review hero */}
      {heroBlocks.map((h) => {
        const rs = h.resultSelf;
        const canViewFull = h.submittedRatio >= 0.5;
        return (
          <div
            key={h.cycle.id}
            className="mb-8 rounded-ds-panel border border-ds-border bg-white p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ds-text-secondary">Your review</p>
                <h2 className="mt-1 text-lg font-semibold text-ds-text-primary">{h.cycle.cycle_name}</h2>
                <p className="mt-1 text-sm text-ds-text-secondary">Due {formatDate(h.cycle.end_date)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-ds-text-secondary">Overall (submitted items)</p>
                <p className="text-xl font-semibold text-ds-text-primary">{overallOutOf10(h.overallAvg)}</p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <BreakdownCell
                label="Manager"
                entry={rs?.manager ?? null}
                completion={h.completionByType.MANAGER}
              />
              <BreakdownCell
                label="Peers"
                entry={rs?.peer ?? null}
                completion={h.completionByType.PEER}
              />
              <BreakdownCell
                label="Direct reports"
                entry={rs?.direct_report ?? null}
                completion={h.completionByType.DIRECT_REPORT}
              />
              <BreakdownCell
                label="Self"
                entry={rs?.self ?? null}
                completion={h.completionByType.SELF}
              />
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={h.selfHref}
                className="rounded-lg bg-ds-accent px-4 py-2 text-sm font-medium text-white hover:bg-ds-success"
              >
                View self-assessment
              </Link>
              {canViewFull ? (
                <Link
                  href={`/feedback/cycles/${h.cycle.id}/report`}
                  className="rounded-lg border border-ds-border bg-white px-4 py-2 text-sm font-medium text-ds-text-primary hover:border-ds-text-primary"
                >
                  View full results
                </Link>
              ) : (
                <span
                  className="cursor-not-allowed rounded-lg border border-ds-border bg-ds-surface px-4 py-2 text-sm font-medium text-ds-text-secondary"
                  title="Available when at least half of reviewers have submitted"
                >
                  View full results
                </span>
              )}
            </div>
          </div>
        );
      })}

      {/* Section 2 — Reviews to complete (per cycle) */}
      {activeCycles.map((cycle) => {
        const tasks = allTaskRows.filter((r) => r.cycleId === cycle.id && r.reviewType !== "SELF");
        if (tasks.length === 0) return null;

        const pendingCount = tasks.filter((t) => taskProgressLabel(t) !== "Completed").length;
        const total = tasks.length;
        const completed = tasks.filter((t) => taskProgressLabel(t) === "Completed").length;
        const payload = resultsByCycleId.get(cycle.id);
        const weightedMap = payload?.weighted_overall ?? {};

        return (
          <div key={`tasks-${cycle.id}`} className="mb-8">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ds-text-primary">Reviews I need to complete</span>
                <span className="rounded-ds-badge border border-ds-border bg-white px-2 py-0.5 text-xs text-ds-text-secondary">
                  {pendingCount} pending
                </span>
              </div>
              <span className="text-xs text-ds-text-secondary">
                {cycle.cycle_name} · Due {formatDate(cycle.end_date)}
              </span>
            </div>

            <div className="overflow-hidden rounded-ds-panel border border-ds-border bg-white">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-ds-surface">
                    {["Employee", "Relationship", "Score visible", "My progress", "Action"].map((col) => (
                      <th
                        key={col}
                        className="border-b border-ds-surface px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ds-text-secondary"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((row, idx) => {
                    const compKey = `${cycle.id}:${row.participantEmployeeId}`;
                    const comp = completionByParticipant.get(compKey);
                    const drSubmitted = comp
                      ? comp.MANAGER.submitted +
                        comp.PEER.submitted +
                        comp.DIRECT_REPORT.submitted +
                        comp.SELF.submitted
                      : 0;
                    const drTotal = comp
                      ? comp.MANAGER.total + comp.PEER.total + comp.DIRECT_REPORT.total + comp.SELF.total
                      : 0;

                    return (
                      <tr
                        key={row.id}
                        className="border-b border-ds-surface transition-colors hover:bg-ds-surface"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                              style={avatarAccent(row.participantName).style}
                            >
                              {getInitials(row.participantName)}
                            </div>
                            <p className="text-[12px] font-semibold text-ds-text-primary">{row.participantName}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <RelationshipPill type={row.reviewType} />
                        </td>
                        <td className="px-4 py-3">
                          <ScoreVisibleCell
                            row={row}
                            weightedOverall={weightedMap[row.participantEmployeeId] ?? null}
                            drSubmitted={drSubmitted}
                            drTotal={drTotal}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <MyProgressCell row={row} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ActionButton row={row} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex gap-5 border-t border-ds-surface bg-ds-surface px-4 py-2.5 text-xs text-ds-text-secondary">
                <span>
                  Assigned: <strong className="text-ds-text-primary">{total}</strong>
                </span>
                <span>
                  Completed: <strong className="text-ds-success">{completed}</strong>
                </span>
                <span>
                  Remaining: <strong className="text-ds-warning">{total - completed}</strong>
                </span>
              </div>
            </div>
          </div>
        );
      })}

      {employeeId &&
        activeCycles.length > 0 &&
        allTaskRows.filter((r) => r.reviewType !== "SELF").length === 0 &&
        heroBlocks.length === 0 && (
          <div className="mb-8 rounded-ds-panel border border-ds-border bg-white p-8 text-center text-sm text-ds-text-secondary">
            No active review tasks in your current cycles.
          </div>
        )}

      {/* Section 3 — Team (only when current user manages someone in the cycle as above) */}
      {teamMemberIds.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-ds-text-primary">Your team&apos;s reviews</h3>
            <p className="mb-3 mt-1 text-xs text-ds-text-secondary">
              People you manage — their 360 progress
            </p>
            {[...teamByCycle.entries()].map(([cycleId, teamRows]) => {
              if (teamRows.length === 0) return null;
              const cycle = activeCycles.find((c) => c.id === cycleId);
              return (
                <div key={cycleId} className="mb-6 last:mb-0">
                  {activeCycles.length > 1 && cycle && (
                    <p className="mb-2 text-xs text-ds-text-secondary">{cycle.cycle_name}</p>
                  )}
                  <div className="overflow-hidden rounded-ds-panel border border-ds-border bg-white">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-ds-surface">
                          {["Employee", "Score so far", "Reviewer progress", "Reviewers", "Status", "Risk"].map((h) => (
                            <th
                              key={h}
                              className="border-b border-ds-surface px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ds-text-secondary"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {teamRows.map((tr, idx) => {
                          const pct = tr.total > 0 ? (tr.submitted / tr.total) * 100 : 0;
                          const s10 =
                            tr.aggregateAvg1to5 != null ? scoreOutOf10(tr.aggregateAvg1to5) : null;
                          const scoreLabel = s10 != null ? `${s10.toFixed(1)}/10` : "—";
                          return (
                            <tr
                              key={tr.employeeId}
                              className="border-b border-ds-surface transition-colors hover:bg-ds-surface"
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <div
                                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                                    style={avatarAccent(tr.name).style}
                                  >
                                    {getInitials(tr.name)}
                                  </div>
                                  <p className="text-[12px] font-semibold text-ds-text-primary">{tr.name}</p>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-xs font-medium text-ds-text-primary">{scoreLabel}</td>
                              <td className="px-4 py-3">
                                <div className="flex max-w-[140px] items-center gap-2">
                                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ds-border">
                                    <div
                                      className="h-full rounded-full bg-ds-accent"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-xs text-ds-text-secondary">
                                {tr.submitted}/{tr.total}
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className={cn(
                                    "rounded-ds-badge border px-2 py-0.5 text-[10px] font-semibold",
                                    tr.status === "Completed" &&
                                      "border-ds-success-border bg-ds-success-subtle text-ds-success",
                                    tr.status === "In_progress" && "border-ds-info-border bg-ds-info-subtle text-ds-info",
                                    tr.status === "Pending" && "border-ds-warning-border bg-ds-warning-subtle text-ds-warning"
                                  )}
                                >
                                  {tr.status === "In_progress"
                                    ? "In progress"
                                    : tr.status === "Completed"
                                      ? "Completed"
                                      : "Pending"}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {tr.riskKind === "low_response" ? (
                                  <span className="text-xs text-ds-warning">⚠ Low response</span>
                                ) : tr.riskKind === "done" ? (
                                  <span className="text-xs font-medium text-ds-success">Done</span>
                                ) : (
                                  <span className="text-xs text-ds-text-secondary">On track</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      {/* Completed cycles */}
      <div className="mb-8">
        <h3 className="mb-3 text-sm font-semibold text-ds-text-primary">Completed cycles</h3>
        <p className="mb-3 text-xs text-ds-text-secondary">Your closed feedback reports</p>
        <div className="overflow-hidden rounded-ds-panel border border-ds-border bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-ds-surface">
                {["Cycle", "Period", "Type", "Closed", "Status", ""].map((h) => (
                  <th
                    key={h}
                    className="border-b border-ds-surface px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ds-text-secondary"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {closedCycles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-ds-text-secondary">
                    No completed cycles yet — reports will appear here once cycles close
                  </td>
                </tr>
              ) : (
                closedCycles.map((cycle) => (
                  <tr
                    key={cycle.id}
                    className="border-b border-ds-surface transition-colors hover:bg-ds-surface"
                  >
                    <td className="px-4 py-3">
                      <p className="text-[12px] font-semibold text-ds-text-primary">{cycle.name}</p>
                    </td>
                    <td className="px-4 py-3">
                      <CycleBadge label={cycle.cycleLabel} />
                    </td>
                    <td className="px-4 py-3">
                      <TypeBadgeClosed type={cycle.type} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[12px] text-ds-text-secondary">{formatDate(cycle.closedDate)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <CompletedStatusBadge />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/feedback/cycles/${cycle.id}/report`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border px-3 py-1.5 text-[11px] font-semibold text-ds-text-secondary transition-colors hover:border-ds-text-primary hover:text-ds-text-primary"
                      >
                        View report
                        <ChevronRight />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {draftCycles.length > 0 && (
        <p className="text-sm text-ds-text-secondary">
          {draftCycles.length} draft cycle(s) will appear here once activated by HR.
        </p>
      )}
    </div>
  );
}
