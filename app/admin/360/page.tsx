"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AssignReviewerModal } from "@/components/feedback/AssignReviewerModal";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { avatarAccent } from "@/lib/avatar-accent";

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

const SearchIcon = () => (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

interface FeedbackCycle {
  id: string;
  cycle_name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  linked_appraisal_cycle_id: string;
  peer_feedback_visible_to_reviewee?: boolean;
  direct_report_feedback_visible_to_reviewee?: boolean;
  /** From GET /api/admin/feedback/cycles — used only to disable "Initialize 360" after seeding */
  participant_count?: number;
}

interface ParticipantResult {
  employee_id: string;
  full_name: string;
  self: { count: number; avg: number; comments: string[] } | null;
  peer: { count: number; avg: number; comments: string[] } | null;
  direct_report: { count: number; avg: number; comments: string[] } | null;
}

interface CycleResults {
  cycle: { id: string; cycle_name: string; status: string };
  results: ParticipantResult[];
}

interface AssignmentReviewer {
  id: string;
  reviewer_employee_id: string;
  reviewer_name: string;
  reviewer_type: string;
  status: string;
}

interface ParticipantAssignment {
  participant_employee_id: string;
  participant_name: string;
  participant_department_name?: string;
  participant_job_title?: string;
  reviewers: AssignmentReviewer[];
}

interface CycleAssignments {
  cycle: { id: string; cycle_name: string; status: string; end_date?: string | null };
  participants: ParticipantAssignment[];
}

interface EligibleEmployee {
  employee_id: string;
  full_name: string | null;
  email?: string | null;
  job_title?: string | null;
  department_name?: string | null;
}

function getInitials(name: string, fallbackId?: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (name.length >= 2) return name.slice(0, 2).toUpperCase();
  return (fallbackId ?? "?").slice(0, 2).toUpperCase();
}

function formatDueDate(date: string | null | undefined): string {
  if (!date) return "—";
  try {
    const d = new Date(date);
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

/** Status pill: Completed=green, In Progress=blue, Pending=amber, Not Started/else=grey; Active=green, Closed=grey */
function statusPillStyle(status: string, isCycle = false): React.CSSProperties {
  const s = (status || "").toLowerCase();
  if (isCycle) {
    if (s === "active") return { background: "#ecfdf5", color: "#2e7d4f", border: "1px solid #bbf0d9" };
    return { background: "#f3f3f3", color: "#646f79", border: "1px solid #e7e7e7" };
  }
  if (s === "completed") return { background: "#ecfdf5", color: "#2e7d4f", border: "1px solid #bbf0d9" };
  if (s === "in progress") return { background: "#f5f3ff", color: "#6d28d9", border: "1px solid #e2d9fd" };
  if (s === "pending") return { background: "#fffbeb", color: "#8a5a00", border: "1px solid #fbe3a1" };
  return { background: "#f3f3f3", color: "#646f79", border: "1px solid #e7e7e7" };
}

function typePillStyle(type: string): React.CSSProperties {
  const t = (type || "").toUpperCase();
  if (t === "SELF") return { background: "#f3f3f3", color: "#2b2d31", border: "1px solid #e7e7e7" };
  if (t === "PEER") return { background: "#f3f3f3", color: "#2b2d31", border: "1px solid #e7e7e7" };
  if (t === "DIRECT_REPORT") return { background: "#f3f3f3", color: "#2b2d31", border: "1px solid #e7e7e7" };
  if (t === "MANAGER") return { background: "#f3f3f3", color: "#2b2d31", border: "1px solid #e7e7e7" };
  return { background: "#f3f3f3", color: "#646f79", border: "1px solid #e7e7e7" };
}

function reviewerChipColor(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "completed") return "#2e7d4f";
  if (s === "in progress") return "#0d0e10";
  if (s === "pending") return "#8a5a00";
  return "#646f79";
}


/** Row-level aggregate from reviewer rows */
function aggregateParticipantStatus(p: ParticipantAssignment): "Completed" | "In Progress" | "Pending" {
  const reviewers = p.reviewers ?? [];
  if (reviewers.length === 0) return "Pending";
  const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ");
  const isDone = (r: AssignmentReviewer) => {
    const t = norm(r.status);
    return t === "completed" || t === "submitted";
  };
  const isInProgress = (r: AssignmentReviewer) => {
    const t = norm(r.status);
    return t === "in progress" || t === "in_progress";
  };
  if (reviewers.every(isDone)) return "Completed";
  if (reviewers.some(isDone) || reviewers.some(isInProgress)) return "In Progress";
  return "Pending";
}

function ParticipantRowStatusPill({ status }: { status: "Completed" | "In Progress" | "Pending" }) {
  const cfg =
    status === "Completed"
      ? { dot: "bg-ds-mint", cls: "bg-ds-success-subtle text-ds-success" }
      : status === "In Progress"
        ? { dot: "bg-ds-lavender", cls: "bg-ds-lavender-subtle text-ds-lavender-text" }
        : { dot: "bg-ds-amber", cls: "bg-ds-warning-subtle text-ds-warning" };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-ds-badge px-2.5 py-0.5 text-xs font-semibold",
        cfg.cls
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cfg.dot)} />
      {status}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = (status || "").toUpperCase().replace(/\s+/g, "_");
  const map: Record<string, { label: string; className: string }> = {
    SUBMITTED: { label: "Submitted", className: "bg-ds-success-subtle border-ds-success-border text-ds-success" },
    IN_PROGRESS: { label: "In progress", className: "bg-ds-lavender-subtle border-ds-lavender-border text-ds-lavender-text" },
    COMPLETED: { label: "Completed", className: "bg-ds-success-subtle border-ds-success-border text-ds-success" },
    PENDING: { label: "Pending", className: "bg-ds-surface border-ds-border text-ds-text-secondary" },
    NOT_STARTED: { label: "Not started", className: "bg-ds-surface border-ds-border text-ds-text-secondary" },
  };
  const s = map[normalized] ?? map.PENDING;
  return (
    <span className={cn("inline-flex items-center px-2.5 py-1 rounded-ds-badge border text-[10px] font-semibold", s.className)}>
      {s.label}
    </span>
  );
}

function scoreBarColor(score: number): string {
  if (score >= 4) return "#2e7d4f";
  if (score >= 3) return "#0d0e10";
  return "#8a5a00";
}

const thStyle: React.CSSProperties = {
  padding: "10px 16px",
  textAlign: "left",
  fontSize: "10.5px",
  fontWeight: 600,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "#646f79",
  background: "#f3f3f3",
  borderBottom: "1px solid #e7e7e7",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: "13.5px",
  verticalAlign: "middle",
  borderBottom: "1px solid #e7e7e7",
};

export default function Admin360Page() {
  const [cycles, setCycles] = useState<FeedbackCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resultsCycleId, setResultsCycleId] = useState<string | null>(null);
  const [resultsData, setResultsData] = useState<CycleResults | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [assignmentsCycleId, setAssignmentsCycleId] = useState<string | null>(null);
  const [assignmentsData, setAssignmentsData] = useState<CycleAssignments | null>(null);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);

  /** Detail modal: one participant in one cycle for results + reviewers + add/remove */
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailCycleId, setDetailCycleId] = useState<string | null>(null);
  const [detailParticipant, setDetailParticipant] = useState<ParticipantAssignment | null>(null);
  const [detailResults, setDetailResults] = useState<CycleResults | null>(null);
  const [detailResultsLoading, setDetailResultsLoading] = useState(false);
  /** Which cycle is expanded to show participants table (overview) */
  const [participantsOverviewCycleId, setParticipantsOverviewCycleId] = useState<string | null>(null);
  const [participantsOverviewData, setParticipantsOverviewData] = useState<CycleAssignments | null>(null);
  const [participantsOverviewLoading, setParticipantsOverviewLoading] = useState(false);

  /** Per-cycle assignments + results cache (flat tables load all cycles) */
  const [cycleDataCache, setCycleDataCache] = useState<Record<string, { assignments: CycleAssignments; results: CycleResults | null }>>({});
  const [cycleDataLoading, setCycleDataLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  /** Assign reviewer modal: participant + cycle when opened from a row */
  const [assignTarget, setAssignTarget] = useState<{ participant: ParticipantAssignment; cycleId: string } | null>(null);

  /** Add reviewer from the detail modal (participant is fixed) */
  const [modalAddReviewerEmployeeId, setModalAddReviewerEmployeeId] = useState("");
  const [modalAddReviewerType, setModalAddReviewerType] = useState<"PEER" | "DIRECT_REPORT" | "MANAGER">("PEER");
  const [modalAddSubmitting, setModalAddSubmitting] = useState(false);

  /** Eligible employees for reviewer lookup (detail modal) */
  const [modalEligibleEmployees, setModalEligibleEmployees] = useState<EligibleEmployee[]>([]);
  const [modalEligibleLoading, setModalEligibleLoading] = useState(false);

  /** Close cycle / reopen / remove response in progress */
  const [closeCycleLoading, setCloseCycleLoading] = useState<string | null>(null);
  /** Initialize / re-seed 360 participants for one cycle */
  const [seed360Loading, setSeed360Loading] = useState<string | null>(null);
  const [reopenLoading, setReopenLoading] = useState<string | null>(null);
  const [removeResponseLoading, setRemoveResponseLoading] = useState<string | null>(null);

  const loadCycles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/feedback/cycles");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to load 360 cycles");
        setCycles([]);
        return;
      }
      setCycles(
        Array.isArray(data)
          ? data.map((row: FeedbackCycle) => ({
              ...row,
              participant_count:
                typeof row.participant_count === "number" ? row.participant_count : 0,
            }))
          : []
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setCycles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCycles();
  }, [loadCycles]);

  /** Flat tables: prefetch assignments + results for every cycle (no expand step). */
  useEffect(() => {
    if (loading || cycles.length === 0) return;
    for (const c of cycles) {
      void loadCycleData(c.id, false);
    }
    // Intentionally depend on loading + cycles list only to avoid refetch loops when cache updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, cycles]);

  /** Fetch eligible reviewers for modal when participant and type are set */
  useEffect(() => {
    if (!detailOpen || !detailParticipant) {
      setModalEligibleEmployees([]);
      return;
    }
    setModalEligibleLoading(true);
    const params = new URLSearchParams({
      participant_employee_id: detailParticipant.participant_employee_id,
      reviewer_type: modalAddReviewerType,
    });
    fetch(`/api/admin/feedback/eligible-reviewers?${params}`)
      .then((r) => r.json().catch(() => ({})))
      .then((data) => setModalEligibleEmployees(Array.isArray(data.employees) ? data.employees : []))
      .finally(() => setModalEligibleLoading(false));
  }, [detailOpen, detailParticipant?.participant_employee_id, modalAddReviewerType]);

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setError(null);
    setTimeout(() => setSuccess(null), 3000);
  };

  const loadResults = async (cycleId: string) => {
    if (resultsCycleId === cycleId && resultsData) {
      setResultsCycleId(null);
      setResultsData(null);
      return;
    }
    setResultsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback/cycles/${cycleId}/results`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to load results");
        return;
      }
      setResultsCycleId(cycleId);
      setResultsData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load results");
    } finally {
      setResultsLoading(false);
    }
  };

  const loadAssignments = async (cycleId: string) => {
    if (assignmentsCycleId === cycleId && assignmentsData) {
      setAssignmentsCycleId(null);
      setAssignmentsData(null);
      return;
    }
    setAssignmentsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback/cycles/${cycleId}/assignments`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to load assignments");
        return;
      }
      setAssignmentsCycleId(cycleId);
      setAssignmentsData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assignments");
    } finally {
      setAssignmentsLoading(false);
    }
  };

  /** Load participants for overview (reviewee + status + reviewers); used for "View participants" */
  const loadParticipantsOverview = async (cycleId: string) => {
    if (participantsOverviewCycleId === cycleId && participantsOverviewData) {
      setParticipantsOverviewCycleId(null);
      setParticipantsOverviewData(null);
      return;
    }
    setParticipantsOverviewLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback/cycles/${cycleId}/assignments`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to load participants");
        return;
      }
      setParticipantsOverviewCycleId(cycleId);
      setParticipantsOverviewData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load participants");
    } finally {
      setParticipantsOverviewLoading(false);
    }
  };

  /** Load assignments + results for a cycle and cache; used when expanding a cycle card */
  const loadCycleData = useCallback(async (cycleId: string, force = false) => {
    if (!force && cycleDataCache[cycleId]) return;
    setCycleDataLoading(cycleId);
    setError(null);
    try {
      const [assignRes, resultsRes] = await Promise.all([
        fetch(`/api/admin/feedback/cycles/${cycleId}/assignments`),
        fetch(`/api/admin/feedback/cycles/${cycleId}/results`),
      ]);
      const assignments = await assignRes.json().catch(() => ({}));
      const results = await resultsRes.json().catch(() => ({}));
      if (!assignRes.ok || !assignments.participants) {
        setError(assignments.error ?? "Failed to load cycle data");
        return;
      }
      setCycleDataCache((prev) => ({
        ...prev,
        [cycleId]: {
          assignments,
          results: results.results ? results : null,
        },
      }));
      setAssignmentsCycleId(cycleId);
      setAssignmentsData(assignments);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cycle data");
    } finally {
      setCycleDataLoading(null);
    }
  }, [cycleDataCache]);

  const openDetailModal = (cycleId: string, participant: ParticipantAssignment) => {
    setDetailCycleId(cycleId);
    setDetailParticipant(participant);
    setDetailResults(null);
    setDetailOpen(true);
    setDetailResultsLoading(true);
    setError(null);
    fetch(`/api/admin/feedback/cycles/${cycleId}/results`)
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (data.cycle && data.results) {
          setDetailResults(data);
        }
      })
      .catch(() => {})
      .finally(() => setDetailResultsLoading(false));
  };

  const closeDetailModal = () => {
    setDetailOpen(false);
    setDetailCycleId(null);
    setDetailParticipant(null);
    setDetailResults(null);
  };

  const removeReviewer = async (cycleId: string, reviewerId: string) => {
    setError(null);
    const res = await fetch(`/api/admin/feedback/cycles/${cycleId}/reviewers/${reviewerId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to remove reviewer");
      return;
    }
    showSuccess("Reviewer removed.");
    if (assignmentsCycleId === cycleId && assignmentsData) {
      loadAssignments(cycleId);
    }
    // Refresh participants overview and detail modal if showing this cycle
    const refetch = () =>
      fetch(`/api/admin/feedback/cycles/${cycleId}/assignments`)
        .then((r) => r.json().catch(() => ({})))
        .then((refetched) => {
          if (!refetched.participants) return;
          if (detailCycleId === cycleId && detailParticipant) {
            const next = refetched.participants.find(
              (p: ParticipantAssignment) => p.participant_employee_id === detailParticipant.participant_employee_id
            );
            if (next) setDetailParticipant(next);
          }
          if (participantsOverviewCycleId === cycleId) {
            setParticipantsOverviewData((prev) => (prev ? { ...prev, participants: refetched.participants } : null));
          }
          setCycleDataCache((prev) => {
            const cur = prev[cycleId];
            if (!cur) return prev;
            return { ...prev, [cycleId]: { ...cur, assignments: { ...cur.assignments, participants: refetched.participants } } };
          });
        });
    refetch();
  };

  const handleInitializeCycle = async (cycleId: string) => {
    setError(null);
    setSeed360Loading(cycleId);
    try {
      const res = await fetch(
        `/api/admin/feedback/cycles/${cycleId}/activate?reseed=true`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to initialize cycle");
        return;
      }
      const created = typeof data.participantsCreated === "number" ? data.participantsCreated : 0;
      const count = typeof data.participantCount === "number" ? data.participantCount : 0;
      if (created > 0) {
        showSuccess(`${created} manager(s) added as participants.`);
      } else if (count > 0) {
        showSuccess(`Cycle now has ${count} participant(s).`);
      } else {
        setError("No managers found to seed from appraisals.");
      }
      setCycleDataCache((prev) => {
        const next = { ...prev };
        delete next[cycleId];
        return next;
      });
      await loadCycles();
      await loadCycleData(cycleId, true);
    } finally {
      setSeed360Loading(null);
    }
  };

  const closeCycle = async (cycleId: string) => {
    setError(null);
    setCloseCycleLoading(cycleId);
    try {
      const res = await fetch(`/api/admin/feedback/cycles/${cycleId}/close`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to close cycle");
        return;
      }
      showSuccess("Cycle closed.");
      loadCycles();
      setCycleDataCache((prev) => {
        const next = { ...prev };
        delete next[cycleId];
        return next;
      });
    } finally {
      setCloseCycleLoading(null);
    }
  };

  const reopenReviewer = async (cycleId: string, reviewerId: string) => {
    setError(null);
    setReopenLoading(reviewerId);
    try {
      const res = await fetch(`/api/admin/feedback/cycles/${cycleId}/reviewers/${reviewerId}/reopen`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to reopen");
        return;
      }
      showSuccess("Review reopened.");
      const refetched = await fetch(`/api/admin/feedback/cycles/${cycleId}/assignments`).then((r) => r.json().catch(() => ({})));
      if (refetched.participants && detailCycleId === cycleId && detailParticipant) {
        const next = refetched.participants.find(
          (p: ParticipantAssignment) => p.participant_employee_id === detailParticipant.participant_employee_id
        );
        if (next) setDetailParticipant(next);
      }
      setCycleDataCache((prev) => {
        const cur = prev[cycleId];
        if (!cur) return prev;
        return { ...prev, [cycleId]: { ...cur, assignments: { ...cur.assignments, participants: refetched.participants } } };
      });
    } finally {
      setReopenLoading(null);
    }
  };

  const removeResponse = async (cycleId: string, reviewerId: string) => {
    setError(null);
    setRemoveResponseLoading(reviewerId);
    try {
      const res = await fetch(`/api/admin/feedback/cycles/${cycleId}/reviewers/${reviewerId}/remove-response`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to remove response");
        return;
      }
      showSuccess("Response removed.");
      const refetched = await fetch(`/api/admin/feedback/cycles/${cycleId}/assignments`).then((r) => r.json().catch(() => ({})));
      if (refetched.participants && detailCycleId === cycleId && detailParticipant) {
        const next = refetched.participants.find(
          (p: ParticipantAssignment) => p.participant_employee_id === detailParticipant.participant_employee_id
        );
        if (next) setDetailParticipant(next);
      }
      setCycleDataCache((prev) => {
        const cur = prev[cycleId];
        if (!cur) return prev;
        return { ...prev, [cycleId]: { ...cur, assignments: { ...cur.assignments, participants: refetched.participants } } };
      });
    } finally {
      setRemoveResponseLoading(null);
    }
  };

  const addReviewerInModal = async () => {
    if (!detailCycleId || !detailParticipant || !modalAddReviewerEmployeeId.trim()) {
      setError("Select a reviewer.");
      return;
    }
    setError(null);
    setModalAddSubmitting(true);
    try {
      const res = await fetch(`/api/admin/feedback/cycles/${detailCycleId}/reviewers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participant_employee_id: detailParticipant.participant_employee_id,
          reviewer_employee_id: modalAddReviewerEmployeeId.trim(),
          reviewer_type: modalAddReviewerType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to add reviewer");
        return;
      }
      showSuccess("Reviewer added.");
      setModalAddReviewerEmployeeId("");
      const refetched = await fetch(`/api/admin/feedback/cycles/${detailCycleId}/assignments`).then((r) => r.json().catch(() => ({})));
      if (refetched.participants && detailParticipant) {
        const next = refetched.participants.find(
          (p: ParticipantAssignment) => p.participant_employee_id === detailParticipant.participant_employee_id
        );
        if (next) setDetailParticipant(next);
      }
      if (participantsOverviewCycleId === detailCycleId) {
        setParticipantsOverviewData((prev) => (prev ? { ...prev, participants: refetched.participants } : null));
      }
      setCycleDataCache((prev) => {
        const cur = prev[detailCycleId];
        if (!cur) return prev;
        return { ...prev, [detailCycleId]: { ...cur, assignments: { ...cur.assignments, participants: refetched.participants } } };
      });
      if (assignmentsCycleId === detailCycleId) {
        loadAssignments(detailCycleId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add reviewer");
    } finally {
      setModalAddSubmitting(false);
    }
  };

  const refetchCycleAssignments = useCallback((cycleId: string) => {
    fetch(`/api/admin/feedback/cycles/${cycleId}/assignments`)
      .then((r) => r.json().catch(() => ({})))
      .then((refetched) => {
        if (!refetched.participants) return;
        setCycleDataCache((prev) => {
          const cur = prev[cycleId];
          if (!cur) return prev;
          return { ...prev, [cycleId]: { ...cur, assignments: { ...cur.assignments, participants: refetched.participants } } };
        });
        if (participantsOverviewCycleId === cycleId) {
          setParticipantsOverviewData((prev) => (prev ? { ...prev, participants: refetched.participants } : null));
        }
        if (assignmentsCycleId === cycleId) {
          setAssignmentsData((prev) => (prev ? { ...prev, participants: refetched.participants } : null));
        }
      });
  }, [participantsOverviewCycleId, assignmentsCycleId]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={<ListIcon />}
        title="360 Feedback Reviews"
        subtitle="Track and manage multi-rater feedback cycles"
      />

      <div className="animate-fade-up-delay-1 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        <div className="relative w-full min-w-[260px] max-w-[320px] sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-text-secondary" aria-hidden />
          <input
            type="search"
            placeholder="Search participants by name or department..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-ds-panel border border-ds-border bg-white py-2.5 pl-10 pr-4 text-sm text-ds-text-primary outline-none transition focus:border-ds-success focus:ring-2 focus:ring-[#2e7d4f]/20"
          />
        </div>
      </div>

      {error && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
            padding: "14px 16px",
            borderRadius: "8px",
            background: "#fef2f2",
            border: "1px solid #fbd5d5",
            marginBottom: 0,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "#b42318" }}>Error</div>
            <div style={{ fontSize: "13px", color: "#b42318" }}>{error}</div>
          </div>
        </div>
      )}
      {success && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
            padding: "14px 16px",
            borderRadius: "8px",
            background: "#ecfdf5",
            border: "1px solid #bbf0d9",
            marginBottom: 0,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "#2e7d4f" }}>Success</div>
            <div style={{ fontSize: "13px", color: "#2e7d4f" }}>{success}</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="animate-fade-up-delay-2 flex flex-col gap-6">
            {[1, 2].map((card) => (
              <div key={card} className="overflow-hidden rounded-ds-panel border border-ds-border bg-white">
                <div className="h-16 animate-pulse bg-ds-border" />
                <div className="flex flex-col gap-2 p-5">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-14 animate-pulse rounded-lg bg-ds-border" />
                  ))}
                </div>
              </div>
            ))}
        </div>
        ) : cycles.length === 0 ? (
          <div className="animate-fade-up-delay-2">
            <div
              className="rounded-ds-panel bg-white"
              style={{
                boxShadow: "var(--shadow-card)",
                border: "1px solid var(--border-color)",
              }}
            >
              <EmptyState
                icon={<SearchIcon />}
                title="No 360 cycles yet"
                description="Create a feedback cycle to get started."
              />
            </div>
          </div>
      ) : (
        <div className="animate-fade-up-delay-2 flex flex-col gap-6">
            {cycles.map((c) => {
              const cached = cycleDataCache[c.id];
              const assignments = cached?.assignments;
              const results = cached?.results;
              const isCardLoading = cycleDataLoading === c.id || !cached;
              const participantCount = assignments?.participants?.length ?? 0;
              const allReviewers = assignments?.participants?.flatMap((p) => p.reviewers) ?? [];
              const completed = allReviewers.filter((r) => (r.status || "").toLowerCase() === "completed").length;
              const inProgress = allReviewers.filter((r) => (r.status || "").toLowerCase() === "in progress").length;
              const pending = allReviewers.filter((r) => (r.status || "").toLowerCase() === "pending").length;
              const notStarted = Math.max(0, allReviewers.length - completed - inProgress - pending);
              const q = searchQuery.trim().toLowerCase();
              const filteredParticipants =
                assignments?.participants.filter((p) => {
                  if (!q) return true;
                  const name = (p.participant_name ?? "").toLowerCase();
                  const dept = (p.participant_department_name ?? "").toLowerCase();
                  return name.includes(q) || dept.includes(q);
                }) ?? [];

              const hasParticipants = (c.participant_count ?? 0) > 0;

              return (
                <div
                  key={c.id}
                  className="overflow-hidden rounded-ds-panel border border-ds-border bg-white"
                >
                  <div className="flex flex-col gap-3 border-b border-ds-border bg-ds-surface px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold text-ds-text-primary">
                          <span className="mr-1 text-ds-success">●</span>
                          {c.cycle_name}
                        </span>
                        {c.status === "Active" ? (
                          <span className="inline-flex items-center gap-1.5 rounded-ds-badge bg-ds-success-subtle px-2 py-0.5 text-xs font-semibold text-ds-success">
                            <span className="h-1.5 w-1.5 rounded-full bg-ds-mint" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-ds-badge bg-ds-surface px-2 py-0.5 text-xs font-semibold text-ds-text-secondary">
                            {c.status}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ds-text-secondary">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          Due {formatDueDate(c.end_date)}
                        </span>
                        {assignments != null && (
                          <span className="text-ds-text-secondary">
                            · {participantCount} participant{participantCount !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      {!isCardLoading && assignments != null && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-ds-badge bg-ds-surface px-2 py-0.5 text-xs font-semibold text-ds-accent-hover">
                            {completed} completed
                          </span>
                          <span className="rounded-ds-badge bg-ds-surface-hover px-2 py-0.5 text-xs font-semibold text-ds-accent">
                            {inProgress} in progress
                          </span>
                          <span className="rounded-ds-badge bg-ds-warning-subtle px-2 py-0.5 text-xs font-semibold text-ds-warning">
                            {pending + notStarted} pending
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {c.status !== "Closed" &&
                        (seed360Loading === c.id ? (
                          <div className="flex flex-col items-end gap-1.5">
                            <button
                              type="button"
                              disabled
                              className="flex h-8 cursor-not-allowed items-center gap-2 rounded-lg border border-ds-accent bg-white px-3 text-xs font-medium text-ds-accent opacity-80"
                              aria-busy
                            >
                              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8v8z"
                                />
                              </svg>
                              Initializing…
                            </button>
                            <div className="h-1 w-[140px] overflow-hidden rounded-full bg-ds-border">
                              <div className="h-full w-full rounded-full bg-ds-accent animate-[indeterminate_1.5s_ease-in-out_infinite]" />
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleInitializeCycle(c.id)}
                            title={
                              hasParticipants
                                ? "Replace participants from managers in appraisals"
                                : "Seed participants from managers in appraisals"
                            }
                            className={cn(
                              "rounded-lg px-3 py-2 text-xs font-semibold transition",
                              hasParticipants
                                ? "border-2 border-ds-success bg-white text-ds-success hover:bg-ds-success hover:text-white"
                                : "bg-ds-success text-white hover:bg-ds-success"
                            )}
                          >
                            {hasParticipants ? "Re-seed participants" : "Initialize 360"}
                          </button>
                        ))}
                      {c.status === "Active" && (
                        <button
                          type="button"
                          onClick={() => closeCycle(c.id)}
                          disabled={closeCycleLoading === c.id}
                          className="rounded-lg border border-ds-border bg-white px-3 py-2 text-xs font-semibold text-ds-text-primary transition hover:bg-ds-surface disabled:opacity-50"
                        >
                          {closeCycleLoading === c.id ? "Closing…" : "Close cycle"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    {isCardLoading ? (
                      <div className="flex flex-col gap-2 p-5">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="h-14 animate-pulse rounded-lg bg-ds-border" />
                        ))}
                      </div>
                    ) : filteredParticipants.length === 0 ? (
                      <p className="py-10 text-center text-sm text-ds-text-secondary">
                        {searchQuery.trim() ? "No participants match your search." : "No participants in this cycle yet."}
                      </p>
                    ) : (
                      <table className="w-full min-w-[720px] border-collapse">
                        <thead>
                          <tr className="bg-ds-surface">
                            {(
                              [
                                ["participant", "Participant"],
                                ["reviewers", "Reviewers"],
                                ["self", "Self score"],
                                ["peer", "Peer avg"],
                                ["status", "Status"],
                                ["actions", "Actions"],
                              ] as const
                            ).map(([key, label]) => (
                              <th
                                key={key}
                                className={cn(
                                  "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ds-text-secondary",
                                  key === "actions" && "text-right"
                                )}
                              >
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredParticipants.map((p, rowIdx) => {
                            const resultRow = results?.results?.find((r) => r.employee_id === p.participant_employee_id);
                            const selfScore = resultRow?.self?.avg;
                            const peerScore = resultRow?.peer?.avg;
                            const rowStatus = aggregateParticipantStatus(p);
                            const showAssign = c.status === "Active";
                            return (
                              <tr
                                key={p.participant_employee_id}
                                className={cn(
                                  "h-14 border-b border-ds-surface transition-colors hover:bg-ds-info-subtle",
                                  rowIdx % 2 === 0 ? "bg-white" : "bg-ds-surface"
                                )}
                              >
                                <td className="px-4 py-2 align-middle">
                                  <div className="flex items-center gap-3">
                                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold ${avatarAccent(p.participant_name || p.participant_employee_id).className}`}>
                                      {getInitials(p.participant_name, p.participant_employee_id)}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium text-ds-text-primary">{p.participant_name}</p>
                                      <p className="truncate text-[11px] text-ds-text-secondary">
                                        {p.participant_department_name ?? "—"}
                                      </p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-2 align-middle">
                                  {p.reviewers.length === 0 ? (
                                    <span className="text-sm text-ds-text-secondary">—</span>
                                  ) : (
                                    <div className="flex items-center">
                                      {p.reviewers.slice(0, 3).map((r, i) => (
                                        <div
                                          key={r.id}
                                          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold"
                                          style={{
                                            background: avatarAccent(r.reviewer_name || r.reviewer_employee_id).style.background,
                                            color: avatarAccent(r.reviewer_name || r.reviewer_employee_id).style.color,
                                            marginLeft: i === 0 ? 0 : -8,
                                            zIndex: 3 - i,
                                          }}
                                          title={r.reviewer_name}
                                        >
                                          {getInitials(r.reviewer_name, r.reviewer_employee_id)}
                                        </div>
                                      ))}
                                      {p.reviewers.length > 3 && (
                                        <span className="ml-1 rounded-ds-badge bg-ds-surface px-2 py-0.5 text-xs font-medium text-ds-text-secondary">
                                          +{p.reviewers.length - 3}
                                        </span>
                                      )}
                                      <span className="ml-2 text-xs text-ds-text-secondary">{p.reviewers.length} people</span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-2 align-middle">
                                  {selfScore != null ? (
                                    <span className="text-[15px] font-semibold text-ds-text-primary">
                                      {selfScore.toFixed(1)}
                                      <span className="text-[11px] font-normal text-ds-text-secondary"> /10</span>
                                    </span>
                                  ) : (
                                    <span className="text-sm text-ds-text-secondary">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 align-middle">
                                  {peerScore != null ? (
                                    <span className="text-[15px] font-semibold text-ds-text-primary">
                                      {peerScore.toFixed(1)}
                                      <span className="text-[11px] font-normal text-ds-text-secondary"> /10</span>
                                    </span>
                                  ) : (
                                    <span className="text-sm text-ds-text-secondary">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-2 align-middle">
                                  <ParticipantRowStatusPill status={rowStatus} />
                                </td>
                                <td className="px-4 py-2 align-middle text-right">
                                  <div className="flex flex-wrap items-center justify-end gap-1">
                                    {showAssign && (
                                      <button
                                        type="button"
                                        onClick={() => setAssignTarget({ participant: p, cycleId: c.id })}
                                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ds-success transition hover:bg-ds-success-subtle"
                                      >
                                        + Assign reviewer
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => openDetailModal(c.id, p)}
                                      className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-ds-text-secondary transition hover:bg-ds-surface"
                                    >
                                      Details
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      <AssignReviewerModal
        isOpen={!!assignTarget}
        onClose={() => setAssignTarget(null)}
        participant={assignTarget ? assignTarget.participant : null}
        cycleId={assignTarget?.cycleId ?? ""}
        cycleLabel={assignTarget ? cycles.find((x) => x.id === assignTarget.cycleId)?.cycle_name ?? "" : ""}
        onSuccess={() => {
          if (assignTarget) {
            showSuccess("Reviewer added.");
            refetchCycleAssignments(assignTarget.cycleId);
            setAssignTarget(null);
          }
        }}
      />

      {/* Detail modal: one reviewee in one cycle — results + reviewers + add/remove; portaled to body so overlay covers entire screen */}
      {detailOpen && detailCycleId && detailParticipant && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="detail-modal-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(13,13,13,0.35)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            padding: "24px",
            boxSizing: "border-box",
          }}
          onClick={(e) => e.target === e.currentTarget && closeDetailModal()}
        >
          <div
            style={{
              background: "white",
              borderRadius: "8px",
              border: "1px solid #e7e7e7",
              boxShadow: "var(--ds-shadow-dialog)",
              maxWidth: "700px",
              width: "100%",
              maxHeight: "90vh",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sticky header */}
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 1,
                background: "white",
                padding: "20px 24px",
                borderBottom: "1px solid #e7e7e7",
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "16px", minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "50%",
                    ...avatarAccent(detailParticipant.participant_name || detailParticipant.participant_employee_id).style,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "16px",
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {getInitials(detailParticipant.participant_name, detailParticipant.participant_employee_id)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <h2 id="detail-modal-title" className="font-display" style={{ fontSize: "18px", fontWeight: 600, color: "#0d0d0d", margin: 0 }}>
                    {detailParticipant.participant_name}
                  </h2>
                  <p style={{ fontSize: "13px", color: "#646f79", marginTop: "2px" }}>
                    {[detailParticipant.participant_job_title, detailParticipant.participant_department_name].filter(Boolean).join(" · ") || "—"}
                  </p>
                  <p style={{ fontSize: "12px", color: "#646f79", marginTop: "6px" }}>
                    {cycles.find((c) => c.id === detailCycleId)?.cycle_name ?? ""}
                    {cycles.find((c) => c.id === detailCycleId)?.status && (
                      <span
                        style={{
                          marginLeft: "8px",
                          display: "inline-flex",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontSize: "10.5px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          ...statusPillStyle(cycles.find((c) => c.id === detailCycleId)!.status, true),
                        }}
                      >
                        {cycles.find((c) => c.id === detailCycleId)?.status}
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDetailModal}
                aria-label="Close"
                style={{
                  padding: "8px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  background: "transparent",
                  color: "#646f79",
                  border: "none",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#f3f3f3";
                  e.currentTarget.style.color = "#0d0d0d";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#646f79";
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: "20px 24px", overflow: "auto", flex: 1 }}>
              {/* Results: three score cards */}
              <h3
                className="font-display"
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "#646f79",
                  marginBottom: "10px",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Results
              </h3>
              {detailResultsLoading ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "24px" }}>
                  {[1, 2, 3].map((i) => (
                    <div key={i} style={{ height: "80px", borderRadius: "8px", background: "#f3f3f3" }} />
                  ))}
                </div>
              ) : detailResults ? (
                (() => {
                  const resultRow = detailResults.results.find((r) => r.employee_id === detailParticipant.participant_employee_id);
                  const selfVal = resultRow?.self?.avg;
                  const peerVal = resultRow?.peer?.avg;
                  const directVal = resultRow?.direct_report?.avg;
                  const cards = [
                    { label: "Self", value: selfVal, empty: selfVal == null },
                    { label: "Peer avg", value: peerVal, empty: peerVal == null },
                    { label: "Direct reports avg", value: directVal, empty: directVal == null },
                  ];
                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "24px" }}>
                      {cards.map((card) => (
                        <div
                          key={card.label}
                          style={{
                            padding: "14px 16px",
                            borderRadius: "8px",
                            background: card.empty ? "#f3f3f3" : "white",
                            border: "1px solid #e7e7e7",
                            opacity: card.empty ? 0.85 : 1,
                          }}
                        >
                          <div style={{ fontSize: "10px", fontWeight: 600, color: "#646f79", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
                            {card.label}
                          </div>
                          {card.empty ? (
                            <span style={{ fontSize: "15px", color: "#646f79" }}>—</span>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <div style={{ width: "48px", height: "6px", borderRadius: "3px", background: "#e7e7e7", overflow: "hidden" }}>
                                <div
                                  style={{
                                    width: `${((card.value ?? 0) / 5) * 100}%`,
                                    height: "100%",
                                    background: scoreBarColor(card.value ?? 0),
                                    borderRadius: "3px",
                                  }}
                                />
                              </div>
                              <span style={{ fontWeight: 600, fontSize: "15px" }}>{(card.value ?? 0).toFixed(1)}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "24px" }}>
                  {["Self", "Peer avg", "Direct reports avg"].map((label) => (
                    <div key={label} style={{ padding: "14px 16px", borderRadius: "8px", background: "#f3f3f3", border: "1px solid #e7e7e7" }}>
                      <div style={{ fontSize: "10px", fontWeight: 600, color: "#646f79", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>{label}</div>
                      <span style={{ fontSize: "15px", color: "#646f79" }}>—</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Reviewers */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
                <h3
                  className="font-display"
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "#646f79",
                    margin: 0,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  Reviewers
                </h3>
                {detailParticipant.reviewers.length > 0 && (
                  <span style={{ fontSize: "12px", color: "#646f79" }}>
                    {detailParticipant.reviewers.filter((r) => (r.status || "").toLowerCase() === "completed").length}/{detailParticipant.reviewers.length} completed
                  </span>
                )}
              </div>
              {cycles.find((c) => c.id === detailCycleId)?.status === "Active" && (
                <div style={{ marginBottom: "16px", padding: "14px", background: "#f3f3f3", borderRadius: "8px", border: "1px solid #e7e7e7" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "flex-end" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", color: "#646f79", marginBottom: "4px" }}>Employee ID</label>
                      <select
                        value={modalAddReviewerEmployeeId}
                        onChange={(e) => setModalAddReviewerEmployeeId(e.target.value)}
                        disabled={modalEligibleLoading}
                        style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #e7e7e7", fontSize: "13px", minWidth: "200px" }}
                      >
                        <option value="">{modalEligibleLoading ? "Loading…" : "Select reviewer…"}</option>
                        {modalEligibleEmployees.map((emp) => (
                          <option key={emp.employee_id} value={emp.employee_id}>
                            {emp.full_name ?? emp.employee_id} {emp.department_name ? ` · ${emp.department_name}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "11px", color: "#646f79", marginBottom: "4px" }}>Type</label>
                      <select
                        value={modalAddReviewerType}
                        onChange={(e) => {
                          setModalAddReviewerType(e.target.value as "PEER" | "DIRECT_REPORT" | "MANAGER");
                          setModalAddReviewerEmployeeId("");
                        }}
                        style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #e7e7e7", fontSize: "13px" }}
                      >
                        <option value="PEER">Peer</option>
                        <option value="DIRECT_REPORT">Direct Report</option>
                        <option value="MANAGER">Manager</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={addReviewerInModal}
                      disabled={modalAddSubmitting}
                      style={{
                        padding: "6px 14px",
                        borderRadius: "6px",
                        fontSize: "13px",
                        fontWeight: 500,
                        cursor: modalAddSubmitting ? "not-allowed" : "pointer",
                        background: "#3d5a78",
                        color: "white",
                        border: "none",
                      }}
                    >
                      {modalAddSubmitting ? "Adding…" : "Add"}
                    </button>
                  </div>
                </div>
              )}
              <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e7e7e7", borderRadius: "8px", overflow: "hidden" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Reviewer</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Status</th>
                    <th style={{ ...thStyle, width: "140px" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {detailParticipant.reviewers.map((r) => (
                    <tr key={r.id}>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <div
                            style={{
                              width: "32px",
                              height: "32px",
                              borderRadius: "50%",
                              ...avatarAccent(r.reviewer_name || r.reviewer_employee_id).style,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "11px",
                              fontWeight: 600,
                            }}
                          >
                            {getInitials(r.reviewer_name, r.reviewer_employee_id)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 500 }}>{r.reviewer_name}</div>
                            <div style={{ fontSize: "11px", color: "#646f79" }}>{r.reviewer_employee_id}</div>
                          </div>
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: "inline-flex",
                            padding: "3px 8px",
                            borderRadius: "4px",
                            fontSize: "10.5px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            ...typePillStyle(r.reviewer_type),
                          }}
                        >
                          {r.reviewer_type === "DIRECT_REPORT" ? "Direct Report" : r.reviewer_type === "MANAGER" ? "Manager" : r.reviewer_type}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: "inline-flex",
                            padding: "3px 8px",
                            borderRadius: "4px",
                            fontSize: "10.5px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            ...statusPillStyle(r.status),
                          }}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                          {r.reviewer_type !== "SELF" && (
                            <>
                              {(r.status || "").toLowerCase() === "submitted" && cycles.find((x) => x.id === detailCycleId)?.status === "Active" && (
                                <button
                                  type="button"
                                  onClick={() => reopenReviewer(detailCycleId, r.id)}
                                  disabled={reopenLoading === r.id}
                                  style={{
                                    padding: 0,
                                    fontSize: "11px",
                                    fontWeight: 500,
                                    cursor: reopenLoading === r.id ? "not-allowed" : "pointer",
                                    background: "none",
                                    color: "#0d0e10",
                                    border: "none",
                                  }}
                                >
                                  {reopenLoading === r.id ? "…" : "Reopen"}
                                </button>
                              )}
                              {(r.status || "").toLowerCase() === "submitted" && (
                                <button
                                  type="button"
                                  onClick={() => removeResponse(detailCycleId, r.id)}
                                  disabled={removeResponseLoading === r.id}
                                  style={{
                                    padding: 0,
                                    fontSize: "11px",
                                    fontWeight: 500,
                                    cursor: removeResponseLoading === r.id ? "not-allowed" : "pointer",
                                    background: "none",
                                    color: "#8a5a00",
                                    border: "none",
                                  }}
                                >
                                  {removeResponseLoading === r.id ? "…" : "Remove response"}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => removeReviewer(detailCycleId, r.id)}
                                style={{
                                  padding: 0,
                                  fontSize: "12px",
                                  fontWeight: 500,
                                  cursor: "pointer",
                                  background: "none",
                                  color: "#b42318",
                                  border: "none",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.color = "#b42318";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.color = "#b42318";
                                }}
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detailParticipant.reviewers.length === 0 && (
                <p style={{ textAlign: "center", fontSize: "13px", color: "#646f79", padding: "16px 0" }}>No reviewers assigned.</p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
