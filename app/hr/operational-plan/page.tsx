"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle, Loader2, History, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Cycle {
  id: string;
  cycle_year: string;
  label: string;
  is_active: boolean;
  uploaded_at: string;
  total_corp: number;
  total_dept: number;
  achieveit_plan_id?: string | null;
}

type UploadState = "idle" | "uploading" | "success" | "error";

interface UploadResult {
  corporate_objectives: number;
  department_objectives: number;
}

interface SyncResult {
  corporate_count: number;
  divisional_count: number;
  total_fetched: number;
  planId: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-JM", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function OperationalPlanPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [cycleYear, setCycleYear] = useState("2025/2026");
  const [label, setLabel] = useState("2025/2026 Operational Plan");
  const [setActive, setSetActive] = useState(true);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [dragging, setDragging] = useState(false);

  const [syncPlanId, setSyncPlanId] = useState("");
  const [syncCycleYear, setSyncCycleYear] = useState("2025/2026");
  const [syncLabel, setSyncLabel] = useState("2025/2026 Operational Plan");
  const [syncSetAsActive, setSyncSetAsActive] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncPlanIdError, setSyncPlanIdError] = useState<string | null>(null);

  const loadCycles = useCallback(async () => {
    const res = await fetch("/api/operational-plan/cycles");
    if (!res.ok) return;
    const data = await res.json();
    const list = Array.isArray(data) ? data : [];
    setCycles(list);
    setSyncPlanId((prev) => {
      if (prev) return prev;
      const last = list.find((c: Cycle) => c.achieveit_plan_id);
      return last?.achieveit_plan_id ?? "";
    });
  }, []);

  useEffect(() => {
    loadCycles();
  }, [loadCycles]);

  const handleFile = (f: File) => {
    if (f.name.endsWith(".xlsx")) setFile(f);
  };

  const handleCycleYearChange = (v: string) => {
    setCycleYear(v);
    setLabel(`${v} Operational Plan`);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploadState("uploading");
    setErrorMsg(null);
    setResult(null);

    const form = new FormData();
    form.append("file", file);
    form.append("cycle_year", cycleYear);
    form.append("label", label);
    form.append("set_active", String(setActive));

    try {
      const res = await fetch("/api/operational-plan/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setResult(json.inserted);
      setUploadState("success");
      setFile(null);
      await loadCycles();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      setUploadState("error");
    }
  };

  const handleSetActive = async (id: string) => {
    const res = await fetch(`/api/operational-plan/cycles/${id}/active`, { method: "PATCH" });
    if (res.ok) await loadCycles();
  };

  const handleSyncCycleYearChange = (v: string) => {
    setSyncCycleYear(v);
    setSyncLabel(`${v} Operational Plan`);
  };

  const handleSync = async () => {
    if (!syncPlanId.trim()) {
      setSyncPlanIdError("Plan ID is required");
      return;
    }
    setSyncPlanIdError(null);
    setSyncResult(null);
    setIsSyncing(true);
    try {
      const res = await fetch("/api/operational-plan/sync-achieveit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: syncPlanId.trim(),
          cycleYear: syncCycleYear,
          label: syncLabel,
          setAsActive: syncSetAsActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setSyncResult(data);
      await loadCycles();
    } catch (err: unknown) {
      setSyncPlanIdError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="w-full px-[28px] py-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[.1em] text-ds-text-secondary">
            HR Administration
          </p>
          <h1 className="font-sans text-[20px] font-semibold text-ds-text-primary">
            Operational Plan
          </h1>
          <p className="mt-1 text-[13px] text-ds-text-secondary">
            Upload an AchieveIt export to populate appraisal objectives for the cycle.
          </p>
        </div>
      </div>

      <div className="mb-4 overflow-hidden rounded-ds-panel border border-ds-border bg-white">
        <div className="flex items-center gap-3 border-b border-ds-border bg-ds-surface px-5 py-4">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-ds-panel border border-ds-border-strong bg-ds-surface">
            <Upload className="h-4 w-4 text-ds-accent" />
          </div>
          <div>
            <p className="font-sans text-[13px] font-semibold text-ds-text-primary">Upload AchieveIt Export</p>
            <p className="text-[11px] text-ds-text-secondary">.xlsx file — corporate and divisional objectives will be extracted</p>
          </div>
        </div>

        <div className="flex flex-col gap-5 p-5">
          <div
            role="button"
            tabIndex={0}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
            onClick={() => document.getElementById("xlsx-input")?.click()}
            onKeyDown={(e) => e.key === "Enter" && document.getElementById("xlsx-input")?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-ds-panel border-[2px] border-dashed py-10 transition-all",
              dragging && "border-ds-accent bg-ds-surface",
              !dragging && !file && "border-ds-border bg-ds-surface hover:border-ds-accent hover:bg-ds-surface",
              file && "border-ds-accent bg-ds-surface"
            )}
          >
            <input
              id="xlsx-input"
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {file ? (
              <>
                <div className="flex h-10 w-10 items-center justify-center rounded-ds-panel border border-ds-border-strong bg-white">
                  <CheckCircle className="h-4 w-4 text-ds-accent" />
                </div>
                <p className="font-sans text-[13px] font-semibold text-ds-text-primary">{file.name}</p>
                <p className="text-[11px] text-ds-text-secondary">{(file.size / 1024).toFixed(0)} KB · click to change</p>
              </>
            ) : (
              <>
                <div className="flex h-10 w-10 items-center justify-center rounded-ds-panel border border-ds-border bg-white">
                  <Upload className="h-4 w-4 text-ds-text-secondary" />
                </div>
                <p className="text-[13px] font-semibold text-ds-text-secondary">Drop AchieveIt .xlsx export here</p>
                <p className="text-[11px] text-ds-text-secondary">or click to browse</p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">Cycle Year</label>
              <input
                value={cycleYear}
                onChange={(e) => handleCycleYearChange(e.target.value)}
                placeholder="2025/2026"
                className="rounded-[8px] border-[1.5px] border-ds-border px-3 py-2 text-[13px] text-ds-text-primary outline-none transition-colors focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">Label</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="2025/2026 Operational Plan"
                className="rounded-[8px] border-[1.5px] border-ds-border px-3 py-2 text-[13px] text-ds-text-primary outline-none transition-colors focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10"
              />
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-[8px] border border-ds-border bg-ds-surface px-4 py-3">
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-ds-text-primary">Set as active cycle</p>
              <p className="mt-0.5 text-[11px] text-ds-text-secondary">Staff appraisals will draw objectives from this plan</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={setActive}
              onClick={() => setSetActive((v) => !v)}
              className={cn(
                "relative mt-0.5 h-5 w-9 flex-shrink-0 rounded-full transition-colors",
                setActive ? "bg-ds-accent" : "bg-ds-surface"
              )}
            >
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", setActive ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </div>

          {uploadState === "error" && errorMsg && (
            <div className="flex items-start gap-2.5 rounded-ds-panel border border-ds-error-border bg-ds-error-subtle px-4 py-3">
              <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-ds-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-[13px] text-ds-error">{errorMsg}</p>
            </div>
          )}

          {uploadState === "success" && result && (
            <div className="overflow-hidden rounded-ds-panel border border-ds-border-strong bg-ds-surface">
              <div className="flex items-center gap-2 border-b border-ds-border-strong px-4 py-2.5">
                <CheckCircle className="h-3.5 w-3.5 text-ds-accent" />
                <p className="text-[12px] font-semibold text-ds-accent-hover">Uploaded successfully</p>
              </div>
              <div className="grid grid-cols-2 divide-x divide-ds-border-strong">
                <div className="flex flex-col items-center justify-center gap-1 py-5">
                  <span className="font-sans text-[26px] font-semibold text-ds-accent">{result.corporate_objectives}</span>
                  <span className="text-[11px] font-medium text-ds-accent-hover">Corporate objectives</span>
                </div>
                <div className="flex flex-col items-center justify-center gap-1 py-5">
                  <span className="font-sans text-[26px] font-semibold text-ds-accent">{result.department_objectives}</span>
                  <span className="text-[11px] font-medium text-ds-accent-hover">Divisional objectives</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleUpload}
              disabled={!file || uploadState === "uploading"}
              className={cn(
                "inline-flex items-center gap-2 rounded-[8px] px-6 py-2.5 font-sans text-[13px] font-semibold transition-all",
                file && uploadState !== "uploading" ? "bg-ds-accent text-white hover:bg-ds-accent-hover" : "cursor-not-allowed bg-ds-surface text-ds-text-secondary"
              )}
            >
              {uploadState === "uploading" ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</> : <><Upload className="h-4 w-4" /> Upload & process</>}
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 overflow-hidden rounded-ds-panel border border-ds-border bg-white">
        <div className="flex items-center gap-3 border-b border-ds-border bg-ds-surface px-5 py-4">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-ds-panel border border-ds-border-strong bg-ds-surface">
            <RefreshCw className="h-4 w-4 text-ds-accent" />
          </div>
          <div>
            <p className="font-sans text-[13px] font-semibold text-ds-text-primary">Sync from AchieveIt API</p>
            <p className="text-[11px] text-ds-text-secondary">Fetch objectives directly from AchieveIt by Plan ID</p>
          </div>
        </div>
        <div className="flex flex-col gap-5 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">AchieveIt Plan ID</label>
            <div className="flex items-center gap-2">
              <input
                value={syncPlanId}
                onChange={(e) => { setSyncPlanId(e.target.value); setSyncPlanIdError(null); }}
                placeholder="e.g. 4182395d-dad6-4c56-870f-08dd7c837889"
                className="flex-1 font-mono text-[12px] rounded-[8px] border-[1.5px] border-ds-border px-3 py-2 text-ds-text-primary outline-none focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10 placeholder:text-ds-text-secondary placeholder:font-sans"
              />
              <div className="group relative">
                <button
                  type="button"
                  className="w-8 h-8 rounded-[8px] border border-ds-border bg-ds-surface flex items-center justify-center text-ds-text-secondary hover:border-ds-accent hover:text-ds-accent transition-all"
                  title="In AchieveIt: open the plan → click ··· → Copy Plan ID"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </button>
                <div className="absolute right-0 top-9 w-[220px] p-2.5 rounded-[8px] bg-ds-text-primary text-white text-[10px] leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-ds-popover">
                  In AchieveIt: open the plan → click ··· → Copy Plan ID
                </div>
              </div>
            </div>
            <p className="text-[10px] text-ds-text-secondary">In AchieveIt, open the plan → click the ··· options menu → Copy Plan ID</p>
            {syncPlanIdError && <p className="text-[11px] text-ds-error">{syncPlanIdError}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">Cycle Year</label>
              <input
                value={syncCycleYear}
                onChange={(e) => handleSyncCycleYearChange(e.target.value)}
                placeholder="2025/2026"
                className="rounded-[8px] border-[1.5px] border-ds-border px-3 py-2 text-[13px] text-ds-text-primary outline-none focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">Label</label>
              <input
                value={syncLabel}
                onChange={(e) => setSyncLabel(e.target.value)}
                placeholder="2025/2026 Operational Plan"
                className="rounded-[8px] border-[1.5px] border-ds-border px-3 py-2 text-[13px] text-ds-text-primary outline-none focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10"
              />
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-[8px] border border-ds-border bg-ds-surface px-4 py-3">
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-ds-text-primary">Set as active cycle</p>
              <p className="mt-0.5 text-[11px] text-ds-text-secondary">Staff appraisals will draw objectives from this plan</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={syncSetAsActive}
              onClick={() => setSyncSetAsActive((v) => !v)}
              className={cn(
                "relative mt-0.5 h-5 w-9 flex-shrink-0 rounded-full transition-colors",
                syncSetAsActive ? "bg-ds-accent" : "bg-ds-surface"
              )}
            >
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", syncSetAsActive ? "translate-x-4" : "translate-x-0.5")} />
            </button>
          </div>
          {syncResult && (
            <div className="overflow-hidden rounded-ds-panel border border-ds-border-strong bg-ds-surface">
              <div className="flex items-center gap-2 border-b border-ds-border-strong px-4 py-2.5">
                <CheckCircle className="h-3.5 w-3.5 text-ds-accent" />
                <p className="text-[12px] font-semibold text-ds-accent-hover">Synced successfully</p>
              </div>
              <div className="grid grid-cols-3 divide-x divide-ds-border-strong">
                <div className="flex flex-col items-center justify-center gap-1 py-5">
                  <span className="font-sans text-[22px] font-semibold text-ds-accent">{syncResult.corporate_count}</span>
                  <span className="text-[11px] font-medium text-ds-accent-hover">Corporate</span>
                </div>
                <div className="flex flex-col items-center justify-center gap-1 py-5">
                  <span className="font-sans text-[22px] font-semibold text-ds-accent">{syncResult.divisional_count}</span>
                  <span className="text-[11px] font-medium text-ds-accent-hover">Divisional</span>
                </div>
                <div className="flex flex-col items-center justify-center gap-1 py-5">
                  <span className="font-sans text-[22px] font-semibold text-ds-accent">{syncResult.total_fetched}</span>
                  <span className="text-[11px] font-medium text-ds-accent-hover">Total fetched</span>
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleSync}
              disabled={isSyncing}
              className={cn(
                "inline-flex items-center gap-2 rounded-[8px] px-6 py-2.5 font-sans text-[13px] font-semibold transition-all",
                !isSyncing ? "bg-ds-accent text-white hover:bg-ds-accent-hover" : "cursor-not-allowed bg-ds-surface text-ds-text-secondary"
              )}
            >
              {isSyncing ? <><Loader2 className="h-4 w-4 animate-spin" /> Syncing…</> : <><RefreshCw className="h-4 w-4" /> Sync from API</>}
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-ds-panel border border-ds-border bg-white">
        <div className="flex items-center gap-3 border-b border-ds-border bg-ds-surface px-5 py-4">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-ds-panel border border-ds-border-strong bg-ds-surface">
            <History className="h-4 w-4 text-ds-accent" />
          </div>
          <div>
            <p className="font-sans text-[13px] font-semibold text-ds-text-primary">Uploaded Cycles</p>
            <p className="text-[11px] text-ds-text-secondary">Previously uploaded operational plans</p>
          </div>
        </div>

        {cycles.length === 0 ? (
          <div className="px-5 py-10 text-center text-[13px] text-ds-text-secondary">No cycles uploaded yet</div>
        ) : (
          <div className="divide-y divide-ds-border">
            {cycles.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/admin/operational-plan/${c.id}`)}
                onKeyDown={(e) => e.key === "Enter" && router.push(`/admin/operational-plan/${c.id}`)}
                className="flex cursor-pointer items-center gap-4 px-5 py-4 transition-colors hover:bg-ds-surface"
              >
                {c.is_active ? (
                  <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-ds-badge border border-ds-success-border bg-ds-success-subtle px-2.5 py-1 text-[10px] font-semibold text-ds-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-ds-mint animate-pulse" />
                    ACTIVE
                  </span>
                ) : (
                  <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-ds-badge border border-ds-border bg-ds-surface px-2.5 py-1 text-[10px] font-semibold text-ds-text-secondary">
                    <span className="h-1.5 w-1.5 rounded-full bg-ds-text-secondary" />
                    INACTIVE
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-sans truncate text-[13px] font-semibold text-ds-text-primary">{c.label}</p>
                  <p className="mt-0.5 text-[11px] text-ds-text-secondary">
                    {c.total_corp} corporate · {c.total_dept} divisional · {formatDate(c.uploaded_at)}
                    {c.achieveit_plan_id && (
                      <span className="inline-flex ml-2 items-center gap-1 px-2 py-0.5 rounded-ds-badge bg-ds-surface border border-ds-border-strong text-[9px] font-semibold text-ds-info">
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="1 4 1 10 7 10" />
                          <polyline points="23 20 23 14 17 14" />
                          <path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0118.36 14" />
                        </svg>
                        Synced via API
                      </span>
                    )}
                  </p>
                </div>
                {!c.is_active && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSetActive(c.id);
                    }}
                    className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-[8px] border-[1.5px] border-ds-border bg-white px-3 py-1.5 text-[11px] font-semibold text-ds-text-secondary transition-all hover:border-ds-text-primary hover:text-ds-text-primary"
                  >
                    Set active
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/admin/operational-plan/${c.id}`);
                  }}
                  className="inline-flex flex-shrink-0 items-center gap-1 rounded-[8px] border-[1.5px] border-ds-border bg-white px-3 py-1.5 text-[11px] font-semibold text-ds-text-secondary transition-all hover:border-ds-text-primary hover:text-ds-text-primary"
                >
                  View details
                  <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
