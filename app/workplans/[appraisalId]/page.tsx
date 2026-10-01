"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Plus, Save, Trash2, AlertTriangle } from "lucide-react";

export interface WorkplanItemRow {
  id: string;
  workplan_id: string;
  corporate_objective: string;
  division_objective: string;
  individual_objective: string;
  task: string;
  output: string;
  performance_standard: string;
  weight: number;
  actual_result: string;
  points: number | null;
}

const BLANK_ROW = (workplan_id: string): Omit<WorkplanItemRow, "id"> => ({
  workplan_id,
  corporate_objective: "",
  division_objective: "",
  individual_objective: "",
  task: "",
  output: "",
  performance_standard: "",
  weight: 0,
  actual_result: "",
  points: null,
});

function nextNewId() {
  return `new-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type PageParams = { appraisalId: string } | Promise<{ appraisalId: string }>;

export default function WorkplanEditorPage({
  params,
}: {
  params: PageParams;
}) {
  const [appraisalId, setAppraisalId] = useState<string | null>(null);
  const [workplanId, setWorkplanId] = useState<string | null>(null);
  const [items, setItems] = useState<WorkplanItemRow[]>([]);
  const [idsToDelete, setIdsToDelete] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveParams = useCallback(async (): Promise<string> => {
    const p = await Promise.resolve(params);
    setAppraisalId(p.appraisalId);
    return p.appraisalId;
  }, [params]);

  const loadWorkplan = useCallback(async (appraisalIdParam: string) => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: workplan, error: wpError } = await supabase
      .from("workplans")
      .select("id")
      .eq("appraisal_id", appraisalIdParam)
      .single();

    if (wpError || !workplan) {
      setError("Workplan not found for this appraisal.");
      setLoading(false);
      return;
    }

    setWorkplanId(workplan.id);

    const { data: rows, error: itemsError } = await supabase
      .from("workplan_items")
      .select("*")
      .eq("workplan_id", workplan.id)
      .order("created_at", { ascending: true });

    if (itemsError) {
      setError(itemsError.message);
      setLoading(false);
      return;
    }

    const mapped: WorkplanItemRow[] = (rows ?? []).map((r) => ({
      id: r.id,
      workplan_id: r.workplan_id,
      corporate_objective: r.corporate_objective ?? "",
      division_objective: r.division_objective ?? "",
      individual_objective: r.individual_objective ?? "",
      task: r.task ?? "",
      output: r.output ?? "",
      performance_standard: r.performance_standard ?? "",
      weight: Number(r.weight) || 0,
      actual_result: r.actual_result ?? "",
      points: r.points != null ? Number(r.points) : null,
    }));

    setItems(mapped);
    setIdsToDelete([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    resolveParams().then((id) => {
      if (mounted && id) loadWorkplan(id);
    });
    return () => {
      mounted = false;
    };
  }, [resolveParams, loadWorkplan]);

  const addRow = useCallback(() => {
    if (!workplanId) return;
    setItems((prev) => [
      ...prev,
      { ...BLANK_ROW(workplanId), id: nextNewId() } as WorkplanItemRow,
    ]);
  }, [workplanId]);

  const updateRow = useCallback(
    (id: string, field: keyof WorkplanItemRow, value: string | number | null) => {
      setItems((prev) =>
        prev.map((row) =>
          row.id === id ? { ...row, [field]: value } : row
        )
      );
    },
    []
  );

  const deleteRow = useCallback((id: string) => {
    setItems((prev) => prev.filter((r) => r.id !== id));
    if (!id.startsWith("new-")) {
      setIdsToDelete((prev) => [...prev, id]);
    }
  }, []);

  const totalWeight = items.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
  const weightValid = Math.abs(totalWeight - 100) < 0.01;
  const hasEmptyTask = items.some((r) => !String(r.task).trim());
  const canSave = weightValid && !hasEmptyTask && !saving && workplanId;

  const saveWorkplan = useCallback(async () => {
    if (!canSave || !workplanId) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    const supabase = createClient();

    try {
      for (const id of idsToDelete) {
        await supabase.from("workplan_items").delete().eq("id", id);
      }
      setIdsToDelete([]);

      for (const row of items) {
        const payload = {
          workplan_id: workplanId,
          corporate_objective: row.corporate_objective || "",
          division_objective: row.division_objective || "",
          individual_objective: row.individual_objective || "",
          task: row.task.trim(),
          output: row.output || "",
          performance_standard: row.performance_standard || "",
          weight: Number(row.weight) || 0,
          actual_result: row.actual_result || "",
          points: row.points,
        };

        if (row.id.startsWith("new-")) {
          const { error: insErr } = await supabase
            .from("workplan_items")
            .insert(payload);
          if (insErr) throw new Error(insErr.message);
        } else {
          const { error: upErr } = await supabase
            .from("workplan_items")
            .update(payload)
            .eq("id", row.id);
          if (upErr) throw new Error(upErr.message);
        }
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
      await loadWorkplan(appraisalId!);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save workplan");
    } finally {
      setSaving(false);
    }
  }, [canSave, workplanId, items, idsToDelete, appraisalId, loadWorkplan]);

  if (loading && !workplanId) {
    return (
      <div className="space-y-6">
        <p className="text-muted-foreground">Loading workplan…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/workplans" className="flex items-center gap-1">
              <ArrowLeft className="h-4 w-4" />
              Back to Workplans
            </Link>
          </Button>
          <h1 className="mt-2 text-ds-page-title text-ds-text-primary">
            Employee Workplan
          </h1>
          <p className="text-muted-foreground">
            Define the objectives and tasks that will be used to evaluate
            performance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={addRow} variant="outline" disabled={!workplanId}>
            <Plus className="mr-2 h-4 w-4" />
            Add Objective
          </Button>
          <Button onClick={saveWorkplan} disabled={!canSave}>
            <Save className="mr-2 h-4 w-4" />
            Save Workplan
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {saveSuccess && (
        <Alert className="border-ds-success-border bg-ds-success-subtle text-ds-success dark:border-green-900 dark:bg-green-950/30 dark:text-green-100">
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>Workplan saved successfully.</AlertDescription>
        </Alert>
      )}

      {!weightValid && items.length > 0 && (
        <Alert
          className={
            totalWeight > 100
              ? "border-ds-error-border bg-ds-error-subtle text-ds-error dark:border-red-900 dark:bg-red-950/30 dark:text-red-100"
              : "border-ds-warning-border bg-ds-warning-subtle text-ds-warning dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
          }
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Weight validation</AlertTitle>
          <AlertDescription>
            Total objective weight must equal 100%. Current total: {totalWeight.toFixed(1)}%
          </AlertDescription>
        </Alert>
      )}

      {hasEmptyTask && (
        <Alert className="border-ds-warning-border bg-ds-warning-subtle dark:border-amber-900 dark:bg-amber-950/30">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Required field</AlertTitle>
          <AlertDescription>
            Task cannot be empty. Fill in the Task column for every row before saving.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Objectives</CardTitle>
          <p className="text-sm text-muted-foreground">
            Edit cells below. Points are read-only. Total weight must equal 100%.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Corporate Objective</TableHead>
                  <TableHead>Division Objective</TableHead>
                  <TableHead>Individual Objective</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Output</TableHead>
                  <TableHead>Performance Standard</TableHead>
                  <TableHead className="w-20">Weight</TableHead>
                  <TableHead>Actual Result</TableHead>
                  <TableHead className="w-20">Points</TableHead>
                  <TableHead className="w-16">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="p-1">
                      <Input
                        className="min-w-[120px]"
                        value={row.corporate_objective}
                        onChange={(e) =>
                          updateRow(row.id, "corporate_objective", e.target.value)
                        }
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        className="min-w-[120px]"
                        value={row.division_objective}
                        onChange={(e) =>
                          updateRow(row.id, "division_objective", e.target.value)
                        }
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        className="min-w-[120px]"
                        value={row.individual_objective}
                        onChange={(e) =>
                          updateRow(row.id, "individual_objective", e.target.value)
                        }
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        className="min-w-[140px]"
                        value={row.task}
                        onChange={(e) => updateRow(row.id, "task", e.target.value)}
                        placeholder="Required"
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        className="min-w-[120px]"
                        value={row.output}
                        onChange={(e) =>
                          updateRow(row.id, "output", e.target.value)
                        }
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        className="min-w-[140px]"
                        value={row.performance_standard}
                        onChange={(e) =>
                          updateRow(row.id, "performance_standard", e.target.value)
                        }
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        className="w-20"
                        value={row.weight === 0 ? "" : row.weight}
                        onChange={(e) =>
                          updateRow(
                            row.id,
                            "weight",
                            e.target.value === "" ? 0 : Number(e.target.value)
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Input
                        className="min-w-[120px]"
                        value={row.actual_result}
                        onChange={(e) =>
                          updateRow(row.id, "actual_result", e.target.value)
                        }
                      />
                    </TableCell>
                    <TableCell className="p-1 text-muted-foreground">
                      {row.points != null ? String(row.points) : "—"}
                    </TableCell>
                    <TableCell className="p-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteRow(row.id)}
                        aria-label="Delete row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={7} className="text-right font-medium">
                    Total Weight:
                  </TableCell>
                  <TableCell
                    className={
                      totalWeight > 100
                        ? "text-ds-error dark:text-red-400"
                        : totalWeight < 100
                          ? "text-ds-warning dark:text-amber-400"
                          : ""
                    }
                  >
                    {totalWeight.toFixed(1)}%
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
