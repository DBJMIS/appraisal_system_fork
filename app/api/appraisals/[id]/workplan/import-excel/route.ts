import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import type { ColumnMapping } from "../analyse-columns/route";
import {
  applyCarryForward,
  distributeEqualWeightsIfMissing,
  getHierarchyColumnsFromMappings,
  parseWorkplanDateForDb,
  parseWorkplanWeight,
  shouldSkipMappingTarget,
} from "@/lib/workplan-excel-parse";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase config required");
  return createClient(url, key);
}

type WorkplanItemInsert = {
  workplan_id: string;
  corporate_objective: string;
  division_objective: string;
  individual_objective: string;
  major_task: string;
  key_output: string;
  performance_standard: string;
  weight: number;
  status: string;
  version: number;
  metric_type?: string | null;
  metric_target?: number | null;
  metric_deadline?: string | null;
};

function applyMapping(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping[]
): WorkplanItemInsert[] {
  const nonEmpty = rows.filter((row) =>
    Object.values(row).some((v) => v !== null && v !== "" && v !== undefined)
  );

  const typeMap: Record<string, string> = {
    NUMBER: "NUMBER",
    NUM: "NUMBER",
    "#": "NUMBER",
    PERCENTAGE: "PERCENT",
    PERCENT: "PERCENT",
    "%": "PERCENT",
    DATE: "DATE",
    DEADLINE: "DATE",
    BOOLEAN: "PERCENT",
    "YES/NO": "PERCENT",
    BOOL: "PERCENT",
    TEXT: "PERCENT",
    NARRATIVE: "PERCENT",
  };

  const out: WorkplanItemInsert[] = [];
  let lastMajorTask = "";
  for (const row of nonEmpty) {
    const item: Partial<WorkplanItemInsert> = {
      corporate_objective: "",
      division_objective: "",
      individual_objective: "",
      major_task: "",
      key_output: "",
      performance_standard: "",
      weight: 0,
      status: "active",
      version: 1,
    };
    const activitiesParts: string[] = [];

    for (const m of mapping) {
      if (shouldSkipMappingTarget(m.targetField)) continue;
      const rawValue = (row as Record<string, unknown>)[m.excelColumn];
      if (rawValue === undefined || rawValue === null || rawValue === "") continue;

      if (m.targetField === "weight") {
        item.weight = parseWorkplanWeight(rawValue);
      } else if (m.targetField === "metric_target") {
        const parsed = parseFloat(String(rawValue));
        item.metric_target = Number.isNaN(parsed) ? null : parsed;
      } else if (m.targetField === "metric_type") {
        const v = String(rawValue).toUpperCase().trim();
        item.metric_type = typeMap[v] ?? "PERCENT";
      } else if (m.targetField === "metric_deadline") {
        item.metric_deadline = parseWorkplanDateForDb(rawValue);
      } else if (m.targetField === "activities") {
        activitiesParts.push(String(rawValue).trim());
      } else if (m.targetField) {
        (item as Record<string, unknown>)[m.targetField] = String(rawValue).trim();
      }
    }

    if (activitiesParts.length > 0) {
      const act = activitiesParts.join("\n");
      item.key_output = item.key_output?.trim()
        ? `${act}\n${item.key_output.trim()}`
        : act;
    }

    if (!item.major_task && lastMajorTask) {
      item.major_task = lastMajorTask;
    }
    if (item.major_task) {
      lastMajorTask = item.major_task;
    }

    if (item.major_task) {
      out.push({
        workplan_id: "",
        corporate_objective: item.corporate_objective ?? "",
        division_objective: item.division_objective ?? "",
        individual_objective: item.individual_objective ?? "",
        major_task: item.major_task,
        key_output: item.key_output ?? "",
        performance_standard: item.performance_standard ?? "",
        weight: item.weight ?? 0,
        status: "active",
        version: 1,
        metric_type: item.metric_type ?? "PERCENT",
        metric_target: item.metric_target ?? null,
        metric_deadline: item.metric_deadline ?? null,
      });
    }
  }
  return out;
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await context.params;
    const body = await req.json();
    const {
      workplanId,
      rows = [],
      mapping = [],
      filename = "",
      sheetName = "",
    } = body as {
      workplanId: string;
      rows: Record<string, unknown>[];
      mapping: ColumnMapping[];
      filename: string;
      sheetName: string;
    };

    if (!workplanId || !appraisalId) {
      return NextResponse.json({ error: "workplanId and appraisalId required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, status")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });

    const managerAccess = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId: user.employee_id ?? null,
    });
    const canEdit =
      user.roles?.some((r) => r === "hr" || r === "admin") ||
      appraisal.employee_id === user.employee_id ||
      managerAccess.hasManagerAccess;
    if (!canEdit) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const appStatus = (appraisal.status ?? "").toUpperCase();
    if (appStatus !== "DRAFT") {
      return NextResponse.json({ error: "Appraisal must be in DRAFT to import workplan" }, { status: 422 });
    }

    const { data: workplan, error: wpErr } = await supabase
      .from("workplans")
      .select("id, status")
      .eq("id", workplanId)
      .eq("appraisal_id", appraisalId)
      .single();

    if (wpErr || !workplan) return NextResponse.json({ error: "Workplan not found" }, { status: 404 });

    const wpStatus = (workplan.status ?? "draft").toLowerCase();
    if (wpStatus !== "draft") {
      return NextResponse.json({ error: "Workplan is locked; cannot import" }, { status: 422 });
    }

    const hierarchyCols = getHierarchyColumnsFromMappings(mapping);
    const carriedRows = applyCarryForward(rows, hierarchyCols);
    const mappedItems = applyMapping(carriedRows, mapping);
    const itemsToInsert: WorkplanItemInsert[] = [];

    mappedItems.forEach((it, idx) => {
      const rowLabel = idx + 1;
      if (!it.major_task?.trim()) {
        console.warn(`[workplan/import-excel] Row ${rowLabel} skipped — missing Major Task after fill-down.`);
        return;
      }
      if (it.weight == null || Number.isNaN(it.weight) || it.weight <= 0) {
        console.warn(`[workplan/import-excel] Row ${rowLabel} has invalid weight — defaulting to 0.`);
        it.weight = 0;
      }
      itemsToInsert.push(it);
    });

    const itemsWithWeights = distributeEqualWeightsIfMissing(itemsToInsert);

    const totalWeight = itemsWithWeights.reduce((s, i) => s + i.weight, 0);
    if (itemsWithWeights.length > 0 && Math.abs(totalWeight - 100) > 2) {
      console.warn(
        `[workplan/import-excel] Weights sum to ${totalWeight.toFixed(1)}% — expected ~100%.`
      );
    }

    const { error: delErr } = await supabase.from("workplan_items").delete().eq("workplan_id", workplanId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    const insertPayload = itemsWithWeights.map((item) => ({
      ...item,
      workplan_id: workplanId,
    }));

    const { data: inserted, error: insErr } = await supabase.from("workplan_items").insert(insertPayload).select();

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    await supabase
      .from("workplans")
      .update({
        imported_from_file: filename || null,
        imported_sheet: sheetName || null,
        imported_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", workplanId);

    return NextResponse.json({
      imported: (inserted ?? []).length,
      items: inserted ?? [],
    });
  } catch (err) {
    console.error("[workplan/import-excel]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
