"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Check, Save, Loader2 } from "lucide-react";
import type { HRReviewRow } from "@/lib/hr-review-data";

interface FilterOptions {
  cycles: { id: string; name: string }[];
  divisions: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}

interface HRReviewPanelProps {
  rows: HRReviewRow[];
  filterOptions: FilterOptions;
}

export function HRReviewPanel({ rows, filterOptions }: HRReviewPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cycleId = searchParams.get("cycle") ?? "";
  const divisionId = searchParams.get("division") ?? "";
  const departmentId = searchParams.get("department") ?? "";

  const [localDecisions, setLocalDecisions] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        rows.map((r) => [r.appraisalId, r.hrFinalDecision ?? ""])
      )
  );
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    setLocalDecisions(
      Object.fromEntries(
        rows.map((r) => [r.appraisalId, r.hrFinalDecision ?? ""])
      )
    );
  }, [rows]);

  const updateFilter = useCallback(
    (key: "cycle" | "division" | "department", value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      router.push(`/hr/review?${params.toString()}`);
    },
    [router, searchParams]
  );

  const setDecision = useCallback((appraisalId: string, value: string) => {
    setLocalDecisions((prev) => ({ ...prev, [appraisalId]: value }));
  }, []);

  const confirmSystem = useCallback((row: HRReviewRow) => {
    const v = row.systemRecommendation ?? "";
    setLocalDecisions((prev) => ({ ...prev, [row.appraisalId]: v }));
  }, []);

  const saveDecision = useCallback(async (appraisalId: string) => {
    setSavingId(appraisalId);
    try {
      const res = await fetch("/api/hr/recommendations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appraisalId,
          hrFinalDecision: localDecisions[appraisalId] ?? "",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to save");
      } else {
        router.refresh();
      }
    } finally {
      setSavingId(null);
    }
  }, [localDecisions, router]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-ds-page-title text-ds-text-primary">
          HR Review Panel
        </h1>
        <p className="text-muted-foreground">
          Review completed appraisals and confirm or override recommendations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">
                  Cycle
                </label>
                <select
                  className="flex h-10 w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={cycleId}
                  onChange={(e) => updateFilter("cycle", e.target.value)}
                >
                  <option value="">All cycles</option>
                  {filterOptions.cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">
                  Division
                </label>
                <select
                  className="flex h-10 w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={divisionId}
                  onChange={(e) => updateFilter("division", e.target.value)}
                >
                  <option value="">All divisions</option>
                  {filterOptions.divisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">
                  Department
                </label>
                <select
                  className="flex h-10 w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={departmentId}
                  onChange={(e) => updateFilter("department", e.target.value)}
                >
                  <option value="">All departments</option>
                  {filterOptions.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appraisals for HR review</CardTitle>
          <p className="text-sm text-muted-foreground">
            Confirm system recommendation, override with your decision, or add
            comments. Save per row.
          </p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No appraisals match the current filters or no appraisals are ready
              for HR review (manager_completed or later).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="w-24">Total Score</TableHead>
                    <TableHead>System Recommendation</TableHead>
                    <TableHead>Manager Recommendation</TableHead>
                    <TableHead>HR Decision</TableHead>
                    <TableHead className="w-[180px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.appraisalId}>
                      <TableCell className="font-medium">
                        {row.employeeName}
                      </TableCell>
                      <TableCell>
                        {row.totalScore != null
                          ? Math.round(row.totalScore)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {row.systemRecommendation ? (
                          <Badge variant="secondary" className="font-normal">
                            {row.systemRecommendation}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {row.managerOverride ? (
                          <span className="text-sm">
                            {row.managerRecommendation ?? "—"}
                            {row.managerJustification && (
                              <span className="block text-muted-foreground text-xs mt-0.5">
                                {row.managerJustification}
                              </span>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          className="min-w-[180px]"
                          value={
                            localDecisions[row.appraisalId] ??
                            row.hrFinalDecision ??
                            ""
                          }
                          onChange={(e) =>
                            setDecision(row.appraisalId, e.target.value)
                          }
                          placeholder="HR final decision…"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => confirmSystem(row)}
                            title="Use system recommendation"
                          >
                            <Check className="h-4 w-4 mr-1" />
                            Confirm system
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => saveDecision(row.appraisalId)}
                            disabled={savingId === row.appraisalId}
                          >
                            {savingId === row.appraisalId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4 mr-1" />
                            )}
                            Save
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
