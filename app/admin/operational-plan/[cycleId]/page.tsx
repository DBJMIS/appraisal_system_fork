"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Building2, Layers, Target, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface CycleDetail {
  id: string;
  label: string;
  cycle_year: string;
  is_active: boolean;
  corporate_count: number;
  divisional_count: number;
  created_at: string;
  uploaded_by_name: string;
}

interface ObjectiveRow {
  id: string;
  type: "CORPORATE" | "DIVISIONAL";
  external_id: string;
  title: string;
  division?: string;
  weight?: number;
  created_at: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-JM", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function OperationalPlanCycleDetailPage({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  const router = useRouter();
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [cycle, setCycle] = useState<CycleDetail | null>(null);
  const [objectives, setObjectives] = useState<ObjectiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"All" | "Corporate" | "Divisional">("All");

  useEffect(() => {
    params.then((p) => setCycleId(p.cycleId));
  }, [params]);

  const load = useCallback(async () => {
    if (!cycleId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/operational-plan/${cycleId}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Failed to load cycle");
      }
      const data = await res.json();
      setCycle(data.cycle);
      setObjectives(data.objectives ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setCycle(null);
      setObjectives([]);
    } finally {
      setLoading(false);
    }
  }, [cycleId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSetActive = async () => {
    if (!cycleId) return;
    const res = await fetch(`/api/operational-plan/cycles/${cycleId}/active`, { method: "PATCH" });
    if (res.ok) await load();
  };

  const filtered = useMemo(() => {
    return objectives.filter((obj) => {
      const matchSearch =
        !search ||
        obj.title.toLowerCase().includes(search.toLowerCase()) ||
        obj.external_id.toLowerCase().includes(search.toLowerCase()) ||
        obj.division?.toLowerCase().includes(search.toLowerCase());
      const matchType =
        filter === "All" ||
        (filter === "Corporate" && obj.type === "CORPORATE") ||
        (filter === "Divisional" && obj.type === "DIVISIONAL");
      return matchSearch && matchType;
    });
  }, [objectives, search, filter]);

  if (loading && !cycle) {
    return (
      <div className="w-full px-[28px] py-6">
        <p className="text-[13px] text-ds-text-secondary">Loading…</p>
      </div>
    );
  }

  if (error || !cycle) {
    return (
      <div className="w-full px-[28px] py-6">
        <p className="text-[13px] text-ds-error">{error ?? "Cycle not found"}</p>
        <Link
          href="/hr/operational-plan"
          className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-ds-text-secondary transition-colors hover:text-ds-text-primary"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to Operational Plan
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full px-[28px] py-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link
            href="/admin/operational-plan"
            className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-ds-text-secondary transition-colors hover:text-ds-text-primary"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to Operational Plan
          </Link>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[.1em] text-ds-text-secondary">
            HR Administration · Operational Plan
          </p>
          <h1 className="font-sans text-[20px] font-semibold text-ds-text-primary">{cycle.label}</h1>
          <p className="mt-1 text-[13px] text-ds-text-secondary">
            {cycle.cycle_year} · Uploaded {formatDate(cycle.created_at)} by {cycle.uploaded_by_name}
          </p>
        </div>
        {cycle.is_active ? (
          <span className="inline-flex items-center gap-1.5 rounded-ds-badge border border-ds-success-border bg-ds-success-subtle px-3 py-1.5 text-[11px] font-semibold text-ds-success">
            <span className="h-1.5 w-1.5 rounded-full bg-ds-mint animate-pulse" />
            Active Cycle
          </span>
        ) : (
          <button
            type="button"
            onClick={handleSetActive}
            className="inline-flex items-center gap-2 rounded-[8px] border-[1.5px] border-ds-border bg-white px-4 py-2 text-[12px] font-semibold text-ds-text-secondary transition-all hover:border-ds-text-primary hover:text-ds-text-primary"
          >
            Set as active cycle
          </button>
        )}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4">
        {[
          {
            label: "Corporate Objectives",
            value: cycle.corporate_count,
            color: "#0d0e10",
            bg: "#f3f3f3",
            border: "#d0d4d8",
            icon: <Building2 className="h-4 w-4" style={{ color: "#0d0e10" }} />,
          },
          {
            label: "Divisional Objectives",
            value: cycle.divisional_count,
            color: "#0d0e10",
            bg: "#f3f3f3",
            border: "#d0d4d8",
            icon: <Layers className="h-4 w-4" style={{ color: "#0d0e10" }} />,
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="flex items-center gap-4 rounded-ds-panel border border-ds-border bg-white p-5"
          >
            <div
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-ds-panel"
              style={{ background: kpi.bg, border: `1px solid ${kpi.border}` }}
            >
              {kpi.icon}
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">
                {kpi.label}
              </p>
              <p className="font-sans text-[26px] font-semibold" style={{ color: kpi.color }}>
                {kpi.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-ds-panel border border-ds-border bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-ds-border bg-ds-surface px-5 py-4">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-ds-panel border border-ds-border-strong bg-ds-surface">
            <Target className="h-4 w-4 text-ds-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-sans text-[13px] font-semibold text-ds-text-primary">Objectives</p>
            <p className="text-[11px] text-ds-text-secondary">All objectives imported from this plan</p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-text-secondary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search objectives..."
              className="w-[220px] rounded-[8px] border-[1.5px] border-ds-border bg-white py-2 pl-8 pr-3 text-[12px] text-ds-text-primary outline-none transition-colors focus:border-ds-accent"
            />
          </div>
          <div className="flex gap-1.5">
            {(["All", "Corporate", "Divisional"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-ds-button border-[1.5px] px-3 py-1.5 text-[11px] font-semibold transition-all",
                  filter === f
                    ? "border-ds-text-primary bg-ds-text-primary text-white"
                    : "border-ds-border bg-white text-ds-text-secondary hover:border-ds-text-primary hover:text-ds-text-primary"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-ds-surface">
              <th className="w-[10%] px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">
                Type
              </th>
              <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">
                Objective
              </th>
              <th className="w-[20%] px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">
                Division
              </th>
              <th className="w-[12%] px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">
                External ID
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((obj) => (
              <tr
                key={obj.id}
                className="border-t border-ds-border transition-colors hover:bg-ds-surface"
              >
                <td className="px-5 py-3">
                  {obj.type === "CORPORATE" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-ds-badge border border-ds-border-strong bg-ds-surface px-2.5 py-1 text-[10px] font-semibold text-ds-info">
                      <Building2 className="h-2.5 w-2.5" />
                      Corporate
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-ds-badge border border-ds-border-strong bg-ds-surface px-2.5 py-1 text-[10px] font-semibold text-ds-accent-hover">
                      <Layers className="h-2.5 w-2.5" />
                      Divisional
                    </span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <p className="text-[13px] font-semibold text-ds-text-primary">{obj.title}</p>
                </td>
                <td className="px-5 py-3">
                  <p className="text-[12px] text-ds-text-secondary">{obj.division ?? "—"}</p>
                </td>
                <td className="px-5 py-3">
                  <span className="rounded-[6px] border border-ds-border bg-ds-surface px-2 py-0.5 font-mono text-[11px] text-ds-text-secondary">
                    {obj.external_id}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t border-ds-border bg-ds-surface px-5 py-3">
          <p className="text-[11px] text-ds-text-secondary">
            Showing {filtered.length} of {objectives.length} objectives
          </p>
        </div>
      </div>
    </div>
  );
}
