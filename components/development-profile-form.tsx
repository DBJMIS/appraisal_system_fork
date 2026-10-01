"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { EqResultsCard } from "@/components/development/eq-results-card";

export interface DevProfileSkill {
  id: string;
  skill: string;
  action: string;
  status: "planned" | "inprog" | "done";
}

export interface DevProfile {
  id?: string;
  employee_id?: string;
  eip_issued?: boolean | null;
  eip_next_fy?: boolean | null;
  eip_set_by?: string | null;
  eip_set_at?: string | null;
  employee_ld_comments?: string | null;
  manager_ld_notes?: string | null;
  manager_notes_by?: string | null;
  manager_notes_at?: string | null;
  skills?: DevProfileSkill[];
  career_role?: string | null;
  career_timeframe?: string | null;
  career_expertise?: string | null;
  career_remarks?: string | null;
  secondment_interest?: boolean | null;
  willing_to_relocate?: boolean | null;
  last_updated_by?: string | null;
  last_updated_at?: string | null;
  created_at?: string | null;
}

export interface DevProfileCycle {
  id: string;
  fiscal_year: string;
  status: string;
  updated_at: string;
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

function YesNoPills({
  value,
  onChange,
  disabled,
}: {
  value: boolean | null | undefined;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2">
      {[true, false].map((opt) => (
        <button
          key={String(opt)}
          type="button"
          disabled={disabled}
          onClick={() => !disabled && onChange(opt)}
          className={cn(
            "px-4 py-1.5 rounded-ds-button border-[1.5px] text-[12px] font-semibold transition-all",
            value === opt ? "bg-ds-text-primary text-white border-ds-text-primary" : "bg-white text-ds-text-secondary border-ds-border",
            disabled && "opacity-60 cursor-not-allowed"
          )}
        >
          {opt ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}

function FieldGroup({
  label,
  questionRef,
  children,
}: {
  label: string;
  questionRef?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted">
        {label}
        {questionRef && <span className="ml-1 text-[#646f79]/80">({questionRef})</span>}
      </p>
      {children}
    </div>
  );
}

const inp =
  "border-[1.5px] border-ds-border rounded-[8px] px-3 py-2 text-[13px] text-ds-text-primary outline-none transition-colors focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10 disabled:bg-ds-surface disabled:text-ds-text-secondary disabled:cursor-not-allowed w-full font-sans";

const STATUS_ORDER: ("planned" | "inprog" | "done")[] = ["planned", "inprog", "done"];
const STATUS_LABELS: Record<string, string> = { planned: "Planned", inprog: "In Progress", done: "Completed" };

export function DevelopmentProfileForm({
  userId,
  initialData,
}: {
  userId: string;
  initialData: {
    profile: DevProfile | null;
    cycles: DevProfileCycle[];
    employee: { full_name: string; division: string };
    isManager: boolean;
    activeAppraisal: { id: string; fiscal_year: string } | null;
    eqResult: {
      id: string;
      taken_at: string;
      sa_total: number;
      me_total: number;
      mo_total: number;
      e_total: number;
      ss_total: number;
      total_score: number;
    } | null;
    eqDraft: {
      responses: Record<string, number> | null;
      last_page: number | null;
      updated_at: string | null;
    } | null;
  };
}) {
  const router = useRouter();
  const { profile, cycles, employee, isManager, activeAppraisal, eqResult, eqDraft } = initialData;
  const isOwner = true;
  const daysSinceEQ = eqResult
    ? Math.floor((Date.now() - new Date(eqResult.taken_at).getTime()) / 86400000)
    : null;
  const retakeAvailable = daysSinceEQ === null || daysSinceEQ > 90;
  const daysUntilRetake = retakeAvailable ? 0 : Math.max(0, 90 - (daysSinceEQ ?? 0));
  const draftAnsweredCount = eqDraft ? Object.keys(eqDraft.responses ?? {}).length : 0;
  const hasDraft = draftAnsweredCount > 0;
  const headerCTA = hasDraft && !eqResult
    ? { href: "/development/eq/take", label: "Continue", style: "primary" as const }
    : eqResult
      ? { href: "/development/eq/take", label: retakeAvailable ? "Retake" : "View results", style: "ghost" as const }
      : { href: "/development/eq/take", label: "Start assessment", style: "primary" as const };

  const [eipIssued, setEipIssued] = useState<boolean>(profile?.eip_issued ?? false);
  const [eipNextFy, setEipNextFy] = useState<boolean>(profile?.eip_next_fy ?? false);
  const [employeeLdComments, setEmployeeLdComments] = useState(profile?.employee_ld_comments ?? "");
  const [managerLdNotes, setManagerLdNotes] = useState(profile?.manager_ld_notes ?? "");
  const [skills, setSkills] = useState<DevProfileSkill[]>(
    Array.isArray(profile?.skills) ? profile.skills : []
  );
  const [careerRole, setCareerRole] = useState(profile?.career_role ?? "");
  const [careerTimeframe, setCareerTimeframe] = useState(profile?.career_timeframe ?? "");
  const [careerExpertise, setCareerExpertise] = useState(profile?.career_expertise ?? "");
  const [careerRemarks, setCareerRemarks] = useState(profile?.career_remarks ?? "");
  const [secondment, setSecondment] = useState<boolean | null>(profile?.secondment_interest ?? null);
  const [relocate, setRelocate] = useState<boolean | null>(profile?.willing_to_relocate ?? null);
  const [lastSaved, setLastSaved] = useState<string | null>(profile?.last_updated_at ?? null);
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [savingManager, setSavingManager] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEipIssued(profile?.eip_issued ?? false);
    setEipNextFy(profile?.eip_next_fy ?? false);
    setEmployeeLdComments(profile?.employee_ld_comments ?? "");
    setManagerLdNotes(profile?.manager_ld_notes ?? "");
    setSkills(Array.isArray(profile?.skills) ? profile.skills : []);
    setCareerRole(profile?.career_role ?? "");
    setCareerTimeframe(profile?.career_timeframe ?? "");
    setCareerExpertise(profile?.career_expertise ?? "");
    setCareerRemarks(profile?.career_remarks ?? "");
    setSecondment(profile?.secondment_interest ?? null);
    setRelocate(profile?.willing_to_relocate ?? null);
    setLastSaved(profile?.last_updated_at ?? null);
  }, [profile]);

  const addSkill = useCallback(() => {
    setSkills((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        skill: "",
        action: "",
        status: "planned" as const,
      },
    ]);
  }, []);

  const updateSkill = useCallback((id: string, field: keyof DevProfileSkill, value: string | DevProfileSkill["status"]) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  }, []);

  const cycleStatus = useCallback((id: string) => {
    setSkills((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const idx = STATUS_ORDER.indexOf(s.status);
        const next = STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
        return { ...s, status: next };
      })
    );
  }, []);

  const removeSkill = useCallback((id: string) => {
    setSkills((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleEmployeeSave = useCallback(async () => {
    setError(null);
    setSavingEmployee(true);
    try {
      const res = await fetch(`/api/development-profile/${userId}/employee`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_ld_comments: employeeLdComments,
          skills,
          career_role: careerRole || null,
          career_timeframe: careerTimeframe || null,
          career_expertise: careerExpertise || null,
          career_remarks: careerRemarks || null,
          secondment_interest: secondment,
          willing_to_relocate: relocate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Save failed");
      setLastSaved(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingEmployee(false);
    }
  }, [
    userId,
    employeeLdComments,
    skills,
    careerRole,
    careerTimeframe,
    careerExpertise,
    careerRemarks,
    secondment,
    relocate,
  ]);

  const handleManagerSave = useCallback(async () => {
    setError(null);
    setSavingManager(true);
    try {
      const res = await fetch(`/api/development-profile/${userId}/manager`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eip_issued: eipIssued,
          eip_next_fy: eipNextFy,
          manager_ld_notes: managerLdNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Save failed");
      setLastSaved(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingManager(false);
    }
  }, [userId, eipIssued, eipNextFy, managerLdNotes]);

  const currentFiscalYear = typeof window !== "undefined" ? new Date().getFullYear() : new Date().getFullYear();

  return (
    <div className="flex flex-col gap-0">
      {activeAppraisal && isOwner && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-[8px] bg-ds-surface border border-ds-border-strong mb-5">
          <span className="w-2 h-2 rounded-full bg-ds-accent animate-pulse flex-shrink-0" />
          <p className="text-[12px] text-ds-info font-medium flex-1">
            <strong>FY {activeAppraisal.fiscal_year} appraisal is active</strong> — Review and update your development goals before submitting your self-assessment.
          </p>
          <Link
            href={`/appraisals/${activeAppraisal.id}?tab=development`}
            className="text-[11px] font-semibold text-ds-info px-3 py-1.5 rounded-ds-button border-[1.5px] border-ds-text-muted bg-white hover:bg-ds-info hover:text-white hover:border-ds-info transition-all"
          >
            Open Appraisal →
          </Link>
        </div>
      )}

      {error && (
        <div className="mb-5 px-4 py-3 rounded-[8px] bg-ds-error-subtle border border-ds-error-border text-[13px] text-ds-error">
          {error}
        </div>
      )}

      {eqResult ? (
        <div className="mb-5">
          <EqResultsCard
            result={eqResult}
            daysUntilRetake={daysUntilRetake}
            onViewFull={() => router.push("/development/eq/take")}
          />
        </div>
      ) : (
        <div className="rounded-ds-panel border border-ds-border bg-white overflow-hidden mb-5">
          <div className="px-5 py-4 bg-ds-surface border-b border-ds-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-[8px] bg-ds-surface border border-ds-border-strong flex items-center justify-center text-ds-accent">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <h2 className="font-sans text-[16px] font-semibold text-ds-text-primary">Emotional intelligence</h2>
                <p className="text-[12px] text-ds-text-secondary mt-0.5">
                  No assessment on record
                </p>
              </div>
            </div>
            {hasDraft && !eqResult ? null : (
              <Link
                href={headerCTA.href}
                className="flex items-center gap-2 px-5 py-2 rounded-[8px] bg-ds-accent text-white font-sans text-[12px] font-semibold hover:bg-ds-accent-hover transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                {headerCTA.label}
              </Link>
            )}
          </div>

          {hasDraft && !eqResult ? (
            <>
              <div className="px-6 py-5 flex items-center gap-4">
                <div className="relative w-12 h-12 shrink-0">
                  <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
                    <circle cx="22" cy="22" r="18" fill="none" stroke="#f3f3f3" strokeWidth="4" />
                    <circle
                      cx="22"
                      cy="22"
                      r="18"
                      fill="none"
                      stroke="#0d0e10"
                      strokeWidth="4"
                      strokeDasharray={`${(draftAnsweredCount / 50) * 113} 113`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-ds-text-primary">
                    {draftAnsweredCount}
                  </span>
                </div>
                <div>
                  <p className="text-[13.5px] font-semibold text-ds-text-primary">Assessment in progress</p>
                  <p className="text-[12px] text-ds-text-secondary mt-0.5">
                    {draftAnsweredCount}/50 questions answered · Page {(eqDraft?.last_page ?? 0) + 1} of 5
                  </p>
                  <p className="text-[11px] text-ds-text-secondary mt-0.5">
                    Last saved{" "}
                    {new Date(eqDraft?.updated_at ?? "").toLocaleDateString("en-JM", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="ml-auto">
                  <Link
                    href="/development/eq/take"
                    className="flex items-center gap-2 px-5 py-2 rounded-[8px] bg-ds-accent text-white font-sans text-[12px] font-semibold hover:bg-ds-accent-hover transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Continue
                  </Link>
                </div>
              </div>

              <div className="px-6 pb-5">
                <div className="h-[4px] bg-ds-surface rounded-full overflow-hidden">
                  <div className="h-full bg-ds-accent rounded-full transition-all" style={{ width: `${(draftAnsweredCount / 50) * 100}%` }} />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-ds-text-secondary">{Math.round((draftAnsweredCount / 50) * 100)}% complete</span>
                  <span className="text-[10px] text-ds-text-secondary">{50 - draftAnsweredCount} remaining</span>
                </div>
              </div>
            </>
          ) : (
            <div className="px-6 py-6 flex items-center gap-4">
              <div className="w-11 h-11 rounded-full bg-ds-surface flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-ds-text-secondary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <p className="text-[13.5px] font-semibold text-ds-text-primary">Discover your emotional intelligence profile</p>
                <p className="text-[12px] text-ds-text-secondary mt-0.5">50 questions · 5 competencies · takes about 10 minutes</p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="rounded-ds-panel border border-ds-border bg-white overflow-hidden mb-5">
        <div className="px-6 py-4 border-b border-ds-border flex items-center gap-3"
          style={{ background: "var(--surface, #f3f3f3)" }}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "#f3f3f3" }}>
            <svg className="w-5 h-5" style={{ color: "#0d0e10" }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="font-display text-[15px] font-semibold text-text-primary">Employee Improvement Plan</h2>
            <p className="text-[12px] text-text-muted mt-0.5">Section C — Learning & Development · FY {currentFiscalYear}/{String(currentFiscalYear + 1).slice(-2)}</p>
          </div>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 gap-7 mb-5">
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted">Has an EIP been issued for FY 25/26?</p>
              <p className="text-[11px] text-ds-text-secondary leading-relaxed">If applicable, please attach documentation.</p>
              <div className="flex gap-2 mt-1 items-center flex-wrap">
                {["Yes", "No"].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    disabled={!isManager}
                    onClick={() => isManager && setEipIssued(opt === "Yes")}
                    className={cn(
                      "px-4 py-1.5 rounded-ds-button border-[1.5px] text-[12px] font-semibold transition-all",
                      (opt === "Yes" ? eipIssued : !eipIssued) ? "bg-ds-accent text-white border-ds-accent" : "bg-white text-ds-text-secondary border-ds-border",
                      !isManager && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    {opt}
                  </button>
                ))}
                {!isManager && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-ds-text-secondary ml-1">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Set by manager
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted">EIP planned for next FY?</p>
              <div className="flex gap-2 mt-1 items-center flex-wrap">
                {["Yes", "No"].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    disabled={!isManager}
                    onClick={() => isManager && setEipNextFy(opt === "Yes")}
                    className={cn(
                      "px-4 py-1.5 rounded-ds-button border-[1.5px] text-[12px] font-semibold transition-all",
                      (opt === "Yes" ? eipNextFy : !eipNextFy) ? "bg-ds-accent text-white border-ds-accent" : "bg-white text-ds-text-secondary border-ds-border",
                      !isManager && "opacity-60 cursor-not-allowed"
                    )}
                  >
                    {opt}
                  </button>
                ))}
                {!isManager && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-ds-text-secondary ml-1">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Set by manager
                  </span>
                )}
              </div>
            </div>
          </div>
          <hr className="border-t border-ds-border my-5" />
          <div className="grid grid-cols-2 gap-5">
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted">Employee — L&D Comments</p>
              <textarea
                value={employeeLdComments}
                onChange={(e) => setEmployeeLdComments(e.target.value)}
                disabled={!isOwner}
                rows={5}
                placeholder="Describe your development priorities and goals..."
                className={cn(
                  "w-full border-[1.5px] border-ds-border rounded-[8px] p-3 font-sans text-[13px] text-ds-text-primary resize-none outline-none transition-colors",
                  isOwner ? "focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10" : "bg-ds-surface text-ds-text-secondary cursor-not-allowed"
                )}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted flex items-center gap-1.5">
                Manager — L&D Notes
                <span className="px-1.5 py-0.5 rounded bg-ds-info-subtle text-ds-info text-[8px] font-semibold">MANAGER ONLY</span>
              </p>
              <textarea
                value={managerLdNotes}
                onChange={(e) => setManagerLdNotes(e.target.value)}
                disabled={!isManager}
                rows={5}
                placeholder={isManager ? "Add your L&D notes and recommendations..." : "Set by manager"}
                className={cn(
                  "w-full border-[1.5px] rounded-[8px] p-3 font-sans text-[13px] text-ds-text-primary resize-none outline-none transition-colors",
                  isManager ? "border-ds-info-border focus:border-ds-info focus:ring-2 focus:ring-[#3d5a78]/10" : "border-ds-border bg-ds-surface text-ds-text-secondary cursor-not-allowed"
                )}
              />
              {managerLdNotes && profile?.manager_notes_at && (
                <p className="text-[10px] text-ds-text-secondary">Updated {formatDate(profile.manager_notes_at)}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-ds-panel border border-ds-border bg-white overflow-hidden mb-5">
        <div className="px-6 py-4 border-b border-ds-border flex items-center justify-between"
          style={{ background: "var(--surface, #f3f3f3)" }}>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "#f3f3f3" }}>
              <svg className="w-5 h-5" style={{ color: "#0d0e10" }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </div>
            <div>
              <h2 className="font-display text-[15px] font-semibold text-text-primary">Skills & Competencies to Enhance</h2>
              <p className="text-[12px] text-text-muted mt-0.5">Track development actions and status</p>
            </div>
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={addSkill}
              className="flex items-center gap-2 px-4 py-2 rounded-[8px] bg-ds-accent text-white font-sans text-[12px] font-semibold hover:bg-ds-accent-hover transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Skill
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          {skills.length === 0 ? (
            <div className="p-10 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-[8px] bg-ds-surface border border-ds-border flex items-center justify-center text-ds-text-secondary mb-3">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <p className="font-sans text-[14px] font-semibold text-ds-text-primary">No skills added yet</p>
              <p className="text-[12px] text-ds-text-secondary mt-1">Click &apos;Add Skill&apos; to start tracking development goals.</p>
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-ds-surface border-b border-ds-border">
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-ds-text-secondary">#</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-ds-text-secondary" style={{ width: "30%" }}>Skill / Competency</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-ds-text-secondary">Development Action / Remarks</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-ds-text-secondary" style={{ width: "11%" }}>Status</th>
                  <th className="px-3 py-2.5 w-10" />
                </tr>
              </thead>
              <tbody>
                {skills.map((skill, index) => (
                  <tr key={skill.id} className="border-b border-ds-border hover:bg-ds-surface transition-colors">
                    <td className="px-3 py-2.5">
                      <span className="w-[22px] h-[22px] rounded-[6px] bg-ds-surface border border-ds-border inline-flex items-center justify-center text-[10px] font-semibold text-ds-text-secondary">
                        {index + 1}
                      </span>
                    </td>
                    <td className="px-3 py-2.5" style={{ width: "30%" }}>
                      <input
                        type="text"
                        value={skill.skill}
                        disabled={!isOwner}
                        onChange={(e) => updateSkill(skill.id, "skill", e.target.value)}
                        placeholder="e.g. Project Management"
                        className="w-full border-none outline-none bg-transparent text-[13px] text-ds-text-primary disabled:text-ds-text-secondary placeholder:text-ds-text-secondary"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="text"
                        value={skill.action}
                        disabled={!isOwner}
                        onChange={(e) => updateSkill(skill.id, "action", e.target.value)}
                        placeholder="Training, certification, or action..."
                        className="w-full border-none outline-none bg-transparent text-[13px] text-ds-text-primary disabled:text-ds-text-secondary placeholder:text-ds-text-secondary"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-center" style={{ width: "11%" }}>
                      <button
                        type="button"
                        disabled={!isOwner}
                        onClick={() => cycleStatus(skill.id)}
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-ds-button border-[1.5px] text-[10px] font-semibold transition-all",
                          skill.status === "planned" && "bg-ds-surface border-ds-text-muted text-ds-info",
                          skill.status === "inprog" && "bg-ds-warning-subtle border-ds-warning-border text-ds-warning",
                          skill.status === "done" && "bg-ds-success-subtle border-ds-success-border text-ds-success",
                          !isOwner && "cursor-default"
                        )}
                      >
                        {STATUS_LABELS[skill.status] ?? skill.status}
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => removeSkill(skill.id)}
                          className="text-ds-text-secondary hover:text-ds-error hover:bg-ds-error-subtle p-1 rounded-[6px] transition-all"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {isOwner && skills.length > 0 && (
            <div className="px-5 py-3 border-t border-ds-border">
              <button type="button" onClick={addSkill} className="text-[12px] font-semibold text-ds-accent hover:underline">
                Add another skill
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-ds-panel border border-ds-border bg-white overflow-hidden mb-5">
        <div className="px-6 py-4 border-b border-ds-border flex items-center gap-3"
          style={{ background: "var(--surface, #f3f3f3)" }}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ background: "#fffbeb" }}>
            <svg className="w-5 h-5" style={{ color: "#8a5a00" }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <div>
            <h2 className="font-display text-[15px] font-semibold text-text-primary">Career Aspirations</h2>
            <p className="text-[12px] text-text-muted mt-0.5">Role, expertise, secondment and relocation</p>
          </div>
        </div>
        <div className="p-5 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Type of role / area interested in" questionRef="Q4">
              <input
                className={inp}
                value={careerRole}
                onChange={(e) => setCareerRole(e.target.value)}
                disabled={!isOwner}
                placeholder="e.g. Senior Analyst, Head of Digital"
              />
            </FieldGroup>
            <FieldGroup label="Timeframe">
              <input
                className={inp}
                value={careerTimeframe}
                onChange={(e) => setCareerTimeframe(e.target.value)}
                disabled={!isOwner}
                placeholder="e.g. Within 2–3 years"
              />
            </FieldGroup>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Main areas of expertise relevant to desired move" questionRef="Q5">
              <input
                className={inp}
                value={careerExpertise}
                onChange={(e) => setCareerExpertise(e.target.value)}
                disabled={!isOwner}
                placeholder="e.g. Digital transformation, Risk management"
              />
            </FieldGroup>
            <FieldGroup label="Remarks">
              <input
                className={inp}
                value={careerRemarks}
                onChange={(e) => setCareerRemarks(e.target.value)}
                disabled={!isOwner}
                placeholder="Additional context..."
              />
            </FieldGroup>
          </div>
          <hr className="border-t border-ds-border" />
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Interested in secondment or loan opportunities?" questionRef="Q6">
              <YesNoPills value={secondment} onChange={(v) => setSecondment(v)} disabled={!isOwner} />
            </FieldGroup>
            <FieldGroup label="Willing to relocate if required?" questionRef="Q7">
              <YesNoPills value={relocate} onChange={(v) => setRelocate(v)} disabled={!isOwner} />
            </FieldGroup>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-3.5 bg-white border-t border-ds-border shadow-[0_-4px_16px_rgba(13,13,13,0.06)]">
        <span className="text-[11px] text-ds-text-secondary flex items-center gap-1.5">
          {lastSaved ? (
            <>
              <svg className="w-3 h-3 text-ds-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Saved {formatDate(lastSaved)}
            </>
          ) : (
            "Unsaved changes"
          )}
        </span>
        <div className="flex gap-3">
          {isManager && (
            <button
              type="button"
              onClick={handleManagerSave}
              disabled={savingManager}
              className="flex items-center gap-2 px-5 py-2 rounded-[8px] bg-ds-info-subtle text-ds-info border border-ds-info-border font-sans text-[12px] font-semibold hover:bg-ds-info-border transition-colors disabled:opacity-60"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              {savingManager ? "Saving…" : "Save Manager Notes"}
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              onClick={handleEmployeeSave}
              disabled={savingEmployee}
              className="inline-flex items-center gap-2 rounded-lg bg-ds-accent px-5 py-2 text-sm font-medium text-white hover:bg-ds-accent-hover transition-colors disabled:opacity-60"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              {savingEmployee ? "Saving…" : "Save Development Profile"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Client wrapper: fetches profile data then renders page header + DevelopmentProfileForm. */
export function DevelopmentProfileLoader({ userId }: { userId: string }) {
  const [data, setData] = useState<{
    profile: DevProfile | null;
    cycles: DevProfileCycle[];
    employee: { full_name: string; division: string };
    isManager: boolean;
    activeAppraisal: { id: string; fiscal_year: string } | null;
    eqResult: {
      id: string;
      taken_at: string;
      sa_total: number;
      me_total: number;
      mo_total: number;
      e_total: number;
      ss_total: number;
      total_score: number;
    } | null;
    eqDraft: {
      responses: Record<string, number> | null;
      last_page: number | null;
      updated_at: string | null;
    } | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/development-profile/${userId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) {
          setErr(json.error);
          return;
        }
        setData({
          profile: json.profile ?? null,
          cycles: Array.isArray(json.cycles) ? json.cycles : [],
          employee: json.employee ?? { full_name: "Unknown", division: "—" },
          isManager: !!json.isManager,
          activeAppraisal: json.activeAppraisal ?? null,
          eqResult: json.eqResult ?? null,
          eqDraft: json.eqDraft ?? null,
        });
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) {
    return <p className="text-[13px] text-ds-text-secondary py-6">Loading development profile…</p>;
  }
  if (err || !data) {
    return (
      <div className="rounded-ds-panel border border-ds-error-border bg-ds-error-subtle px-5 py-4 text-[13px] text-ds-error">
        {err ?? "Failed to load profile"}
      </div>
    );
  }

  const { profile, employee } = data;
  const employeeName = employee.full_name?.trim() || null;

  return (
    <div style={{ animation: "fadeUp 0.4s ease both" }}>
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-start gap-4 mb-6">
          <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-ds-panel"
            style={{ background: "#f3f3f3" }}>
            <span className="text-accent">
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </span>
          </div>
          <div className="pt-0.5">
            <h1 className="text-ds-page-title text-ds-text-primary"
              style={{ letterSpacing: "-0.02em" }}>
              Development Profile
            </h1>
            <p className="mt-0.5 text-[13.5px] text-text-muted">
              {employeeName ?? "Unknown"} · Persistent across all appraisal cycles
            </p>
          </div>
        </div>
        {profile?.last_updated_at && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-ds-badge bg-ds-surface border border-ds-border-strong text-ds-accent text-[11px] font-semibold">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Last updated {formatDate(profile.last_updated_at)}
          </span>
        )}
      </div>
      <DevelopmentProfileForm userId={userId} initialData={data} />
    </div>
  );
}
