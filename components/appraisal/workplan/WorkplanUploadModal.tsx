"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import * as XLSX from "xlsx";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadStepIndicator } from "./UploadStepIndicator";
import type { ColumnMapping } from "@/app/api/appraisals/[id]/workplan/analyse-columns/route";
import {
  applyCarryForward,
  distributeEqualWeightsIfMissing,
  getHierarchyColumnsFromMappings,
  parseWorkplanDateForDb,
  parseWorkplanWeight,
  parseWorksheetToWorkplanRows,
  shouldSkipMappingTarget,
} from "@/lib/workplan-excel-parse";

type Step = "upload" | "sheet" | "mapping" | "review" | "importing";

const TARGET_FIELD_OPTIONS = [
  { value: "", label: "— Skip —" },
  { value: "row_number", label: "Row # (skip)" },
  { value: "corporate_objective", label: "Corporate objective" },
  { value: "division_objective", label: "Division objective" },
  { value: "individual_objective", label: "Individual objective" },
  { value: "major_task", label: "Major task" },
  { value: "activities", label: "Activities" },
  { value: "key_output", label: "Key output" },
  { value: "performance_standard", label: "Performance standard" },
  { value: "weight", label: "Weight (%)" },
  { value: "metric_type", label: "Metric type" },
  { value: "metric_target", label: "Target" },
  { value: "metric_deadline", label: "Deadline / due date" },
];

const CONFIDENCE_STYLES: Record<string, string> = {
  HIGH: "bg-[#ecfdf5] border-[#6ee7b7] text-[#065f46]",
  MEDIUM: "bg-[#fffbeb] border-[#fcd34d] text-[#92400e]",
  LOW: "bg-[#fff1f2] border-[#fecaca] text-[#dc2626]",
  SKIP: "bg-[#f8faff] border-[#dde5f5] text-[#8a97b8]",
};
const CONFIDENCE_LABELS: Record<string, string> = {
  HIGH: "● High",
  MEDIUM: "● Medium",
  LOW: "● Low",
  SKIP: "— Skip",
};

interface WorkplanUploadModalProps {
  appraisalId: string;
  workplanId: string;
  onComplete: (importedCount: number, filename: string) => void;
  onClose: () => void;
}

type WorkbookState = { workbook: XLSX.WorkBook; filename: string } | null;

/** Client preview pipeline (mirrors server `applyMapping`); keeps each row’s index in `allRows` for review exclusions. */
function buildPreviewRowsWithSourceIndex(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping[]
): Array<{ item: Record<string, unknown>; sourceIndex: number }> {
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

  const out: Array<{ item: Record<string, unknown>; sourceIndex: number }> = [];
  let lastMajorTask = "";

  for (let sourceIndex = 0; sourceIndex < rows.length; sourceIndex++) {
    const row = rows[sourceIndex];
    const nonEmpty = Object.values(row).some((v) => v !== null && v !== "" && v !== undefined);
    if (!nonEmpty) continue;

    const item: Record<string, unknown> = {};
    const activitiesParts: string[] = [];

    for (const m of mapping) {
      if (shouldSkipMappingTarget(m.targetField)) continue;
      const rawValue = row[m.excelColumn];
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
        item[m.targetField] = String(rawValue).trim();
      }
    }

    if (activitiesParts.length > 0) {
      const act = activitiesParts.join("\n");
      const ko = item.key_output != null ? String(item.key_output).trim() : "";
      item.key_output = ko ? `${act}\n${ko}` : act;
    }

    if (!item.major_task && lastMajorTask) {
      item.major_task = lastMajorTask;
    }
    if (item.major_task) {
      lastMajorTask = item.major_task as string;
    }

    if (item.major_task) {
      out.push({ item, sourceIndex });
    }
  }

  return out;
}

function formatRowNumbersForMessage(previewIndices0Based: number[]): string {
  const nums = [...new Set(previewIndices0Based)]
    .sort((a, b) => a - b)
    .map((i) => i + 1);
  if (nums.length === 0) return "";
  if (nums.length === 1) return String(nums[0]);
  if (nums.length === 2) return `${nums[0]} and ${nums[1]}`;
  const last = nums[nums.length - 1];
  return `${nums.slice(0, -1).join(", ")}, and ${last}`;
}

export function WorkplanUploadModal({
  appraisalId,
  workplanId,
  onComplete,
  onClose,
}: WorkplanUploadModalProps) {
  const [step, setStep] = useState<Step>("upload");
  const [workbookState, setWorkbookState] = useState<WorkbookState>(null);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [allRows, setAllRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [sheetPreviewRows, setSheetPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [sheetPreviewHeaders, setSheetPreviewHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [analysing, setAnalysing] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [templateMeta, setTemplateMeta] = useState<Record<string, string>>({});
  /** 0-based sheet row where data headers were found; used to show B1:E3 metadata only for DBJ-style sheets. */
  const [dataHeaderRowIndex, setDataHeaderRowIndex] = useState(0);
  /** Step 4 only: `allRows` indices to omit from the import payload. */
  const [excludedSourceIndices, setExcludedSourceIndices] = useState<number[]>([]);
  /** Step 4: hierarchy-enriched rows (AI + carry-forward fallback). */
  const [enrichedRows, setEnrichedRows] = useState<Record<string, unknown>[] | null>(null);
  const [enriching, setEnriching] = useState(false);

  useEffect(() => {
    if (step !== "sheet" || !workbookState?.workbook || !selectedSheet) return;
    const sheet = workbookState.workbook.Sheets[selectedSheet];
    const { rows, headers, templateMeta: meta, headerRowIndex } = parseWorksheetToWorkplanRows(sheet);
    setSheetPreviewRows(rows);
    setSheetPreviewHeaders(headers);
    setTemplateMeta(meta);
    setDataHeaderRowIndex(headerRowIndex);
  }, [step, workbookState, selectedSheet]);

  const stepIndex = step === "upload" ? 0 : step === "sheet" ? 1 : step === "mapping" ? 2 : step === "review" ? 3 : 3;

  const handleFile = useCallback((file: File) => {
    const accept = ".xlsx,.xls";
    const ext = file.name.toLowerCase();
    if (!ext.endsWith(".xlsx") && !ext.endsWith(".xls")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const ab = e.target?.result as ArrayBuffer;
      if (!ab) return;
      const wb = XLSX.read(ab, { type: "array", cellDates: true });
      setWorkbookState({ workbook: wb, filename: file.name });
      setSelectedSheet(wb.SheetNames[0] ?? "");
      setStep("sheet");
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const onSheetSelected = useCallback(() => {
    if (!workbookState || !selectedSheet) return;
    const sheet = workbookState.workbook.Sheets[selectedSheet];
    const { rows, headers: h, templateMeta: meta, headerRowIndex } = parseWorksheetToWorkplanRows(sheet);
    setAllRows(rows);
    setHeaders(h);
    setTemplateMeta(meta);
    setDataHeaderRowIndex(headerRowIndex);
    setMappings([]);
    setStep("mapping");
    setAnalysing(true);
    fetch(`/api/appraisals/${appraisalId}/workplan/analyse-columns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headers: h, sampleRows: rows.slice(0, 5) }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.mappings && Array.isArray(data.mappings)) {
          setMappings(data.mappings);
        }
      })
      .finally(() => setAnalysing(false));
  }, [workbookState, selectedSheet, appraisalId]);

  useEffect(() => {
    if (step !== "review" || allRows.length === 0 || mappings.length === 0) return;

    let cancelled = false;
    setEnriching(true);
    setEnrichedRows(null);

    fetch(`/api/appraisals/${appraisalId}/workplan/enrich-rows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: allRows, mappings }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.rows && Array.isArray(data.rows)) {
          setEnrichedRows(data.rows);
        } else {
          setEnrichedRows(applyCarryForward(allRows, getHierarchyColumnsFromMappings(mappings)));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEnrichedRows(applyCarryForward(allRows, getHierarchyColumnsFromMappings(mappings)));
        }
      })
      .finally(() => {
        if (!cancelled) setEnriching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [step, allRows, mappings, appraisalId]);

  const previewRowsWithSource = useMemo(
    () =>
      step === "review" && enrichedRows
        ? buildPreviewRowsWithSourceIndex(enrichedRows, mappings)
        : [],
    [step, enrichedRows, mappings]
  );

  const excludedSet = useMemo(() => new Set(excludedSourceIndices), [excludedSourceIndices]);

  const activePreviewRows = useMemo(
    () => previewRowsWithSource.filter((r) => !excludedSet.has(r.sourceIndex)),
    [previewRowsWithSource, excludedSet]
  );

  const previewItems = useMemo(
    () => distributeEqualWeightsIfMissing(activePreviewRows.map((r) => ({ ...r.item }))),
    [activePreviewRows]
  );

  const previewWeightBySourceIndex = useMemo(() => {
    const map = new Map<number, number>();
    activePreviewRows.forEach((r, i) => {
      map.set(r.sourceIndex, (previewItems[i]?.weight as number) ?? 0);
    });
    return map;
  }, [activePreviewRows, previewItems]);

  const totalWeight = previewItems.reduce((s, i) => s + ((i.weight as number) ?? 0), 0);
  const weightValid = previewItems.length === 0 || Math.abs(totalWeight - 100) <= 2;
  const hasRequired =
    previewItems.length > 0 &&
    previewItems.every((i) => i.major_task && String(i.major_task).trim());

  const duplicateMeta = useMemo(() => {
    const keyToPreviewIndices = new Map<string, number[]>();
    activePreviewRows.forEach((row, previewIdx) => {
      const mt = String(row.item.major_task ?? "").trim().toLowerCase();
      const act = String(row.item.key_output ?? "").trim().toLowerCase();
      const key = `${mt}\x1f${act}`;
      if (!mt && !act) return;
      const arr = keyToPreviewIndices.get(key) ?? [];
      arr.push(previewIdx);
      keyToPreviewIndices.set(key, arr);
    });
    const groups = [...keyToPreviewIndices.values()].filter((indices) => indices.length > 1);
    const dupPreviewIndexSet = new Set<number>();
    for (const g of groups) for (const idx of g) dupPreviewIndexSet.add(idx);
    const participating = groups.reduce((sum, g) => sum + g.length, 0);
    /** Rows beyond the first occurrence for each major task (what will still duplicate if imported). */
    const duplicateRowsToImport = activePreviewRows.length - keyToPreviewIndices.size;
    return { groups, dupPreviewIndexSet, participating, duplicateRowsToImport };
  }, [activePreviewRows]);

  const hasDupe = duplicateMeta.groups.length > 0;

  const duplicateBannerMessage = useMemo(() => {
    if (!hasDupe) return "";
    const parts = duplicateMeta.groups.map(
      (indices) => `rows ${formatRowNumbersForMessage(indices)} share the same task`
    );
    const n = duplicateMeta.participating;
    return `${n} duplicate major task${n === 1 ? "" : "s"} detected — ${parts.join(" · ")}. Review below or exclude before importing.`;
  }, [duplicateMeta.groups, duplicateMeta.participating, hasDupe]);

  const rowsToSubmit = useMemo(() => {
    const base = enrichedRows ?? allRows;
    if (excludedSourceIndices.length === 0) return base;
    const ex = excludedSet;
    return base.filter((_, idx) => !ex.has(idx));
  }, [enrichedRows, allRows, excludedSet, excludedSourceIndices.length]);

  const handleConfirmImport = useCallback(async () => {
    setImportError(null);
    setStep("importing");
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/workplan/import-excel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workplanId,
          rows: rowsToSubmit,
          mapping: mappings,
          filename: workbookState?.filename ?? "",
          sheetName: selectedSheet,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.errors?.join(" ") || data.error || "Import failed");
        setStep("review");
        return;
      }
      onComplete(data.imported ?? 0, workbookState?.filename ?? "");
      onClose();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
      setStep("review");
    }
  }, [appraisalId, workplanId, rowsToSubmit, mappings, workbookState, selectedSheet, onComplete, onClose]);

  const mappedCount = mappings.filter((m) => m.targetField && !shouldSkipMappingTarget(m.targetField)).length;
  const skipCount = mappings.length - mappedCount;

  const setRowExcluded = useCallback((sourceIndex: number, exclude: boolean) => {
    setExcludedSourceIndices((prev) => {
      if (exclude) return prev.includes(sourceIndex) ? prev : [...prev, sourceIndex];
      return prev.filter((x) => x !== sourceIndex);
    });
  }, []);

  const modalContent = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={(e) => e.target === e.currentTarget && step !== "importing" && onClose()}
    >
      <div
        className="bg-white rounded-[16px] w-full max-w-[640px] max-h-[90vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-[#dde5f5]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-['Sora'] text-[16px] font-bold text-[#0f1f3d]">
              Import workplan from Excel
            </h2>
            {step !== "importing" && (
              <button
                type="button"
                onClick={onClose}
                className="text-[#8a97b8] hover:text-[#0f1f3d] text-[20px] leading-none"
              >
                ×
              </button>
            )}
          </div>
          <UploadStepIndicator currentStep={stepIndex} />
        </div>

        <div className="p-6">
          {step === "upload" && (
            <>
              <div
                className="border-2 border-dashed border-[#dde5f5] rounded-[12px] p-10 text-center hover:border-[#0d9488] hover:bg-[#f0fdfa] transition-colors"
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-[#0d9488]", "bg-[#f0fdfa]"); }}
                onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove("border-[#0d9488]", "bg-[#f0fdfa]"); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove("border-[#0d9488]", "bg-[#f0fdfa]");
                  const f = e.dataTransfer.files[0];
                  if (f) handleFile(f);
                }}
              >
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  id="workplan-excel-upload"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = "";
                  }}
                />
                <label htmlFor="workplan-excel-upload" className="cursor-pointer block">
                  <div className="w-12 h-12 rounded-[12px] bg-[#f8faff] border border-[#dde5f5] flex items-center justify-center mx-auto mb-3">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8a97b8" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                  </div>
                  <p className="text-[13px] font-medium text-[#0f1f3d]">Drop your Excel file here or click to browse</p>
                  <p className="text-[11px] text-[#8a97b8] mt-1">.xlsx or .xls only</p>
                </label>
              </div>
              <p className="text-[11px] text-[#8a97b8] mt-3 text-center">
                Expected columns: Corporate objective · Division objective · Major task · Key output · Performance standard · Weight (%) · Metric type · Target
              </p>
            </>
          )}

          {step === "sheet" && workbookState && (
            <>
              <p className="text-[12px] text-[#0f1f3d] font-medium mb-2">Select sheet</p>
              {(() => {
                const parts = [
                  templateMeta.employeeName,
                  templateMeta.division || templateMeta.unit,
                  templateMeta.position,
                ].filter(Boolean);
                if (parts.length === 0 || dataHeaderRowIndex < 4) return null;
                return (
                  <p className="text-[11px] text-[#4a5a82] mb-3 px-1 py-2 rounded-[8px] bg-[#f8faff] border border-[#dde5f5]">
                    <span className="font-semibold text-[#0f1f3d]">Detected:</span> {parts.join(" · ")}
                  </p>
                );
              })()}
              <div className="flex flex-wrap gap-2 mb-4">
                {workbookState.workbook.SheetNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setSelectedSheet(name)}
                    className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors
                      ${selectedSheet === name ? "bg-[#0d9488] text-white" : "bg-[#f8faff] border border-[#dde5f5] text-[#4a5a82] hover:border-[#0d9488]"}`}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[#8a97b8] mb-2">Preview (first 5 rows)</p>
              <div className="max-h-[200px] overflow-auto rounded-[8px] border border-[#dde5f5] mb-4">
                <table className="w-full text-[11px]">
                  <thead className="bg-[#f8faff] sticky top-0">
                    <tr>
                      {sheetPreviewHeaders.slice(0, 8).map((h) => (
                        <th key={h} className="text-left p-2 border-b border-[#dde5f5] font-medium text-[#0f1f3d] truncate max-w-[120px]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sheetPreviewRows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-b border-[#dde5f5]">
                        {sheetPreviewHeaders.slice(0, 8).map((h) => (
                          <td key={h} className="p-2 text-[#4a5a82] truncate max-w-[120px]">
                            {String((row as Record<string, unknown>)[h] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={onSheetSelected}
                className="w-full py-2.5 rounded-[8px] bg-[#0d9488] text-white text-[13px] font-semibold hover:bg-[#0f766e] transition-colors"
              >
                Analyse columns →
              </button>
            </>
          )}

          {step === "mapping" && (
            <>
              {analysing ? (
                <div className="flex items-center gap-2 py-6 text-[#6d28d9]">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#f5f3ff] border border-[#c4b5fd]">
                    AI
                  </span>
                  <span className="text-[13px]">Analysing your columns...</span>
                </div>
              ) : (
                <>
                  <div className="max-h-[280px] overflow-auto rounded-[8px] border border-[#dde5f5] mb-4">
                    <table className="w-full text-[11px]">
                      <thead className="bg-[#f8faff] sticky top-0">
                        <tr>
                          <th className="text-left p-2 font-medium text-[#0f1f3d]">Excel column</th>
                          <th className="text-left p-2 font-medium text-[#0f1f3d]">Map to</th>
                          <th className="text-left p-2 font-medium text-[#0f1f3d]">Confidence</th>
                          <th className="text-left p-2 font-medium text-[#0f1f3d]">Reasoning</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mappings.map((m, i) => (
                          <tr
                            key={i}
                            className={`border-b border-[#dde5f5] ${m.confidence === "LOW" ? "bg-[#fffbeb]" : ""}`}
                          >
                            <td className="p-2">
                              <span className="font-mono text-[10px] bg-[#f1f5f9] px-2 py-0.5 rounded">
                                {m.excelColumn}
                              </span>
                            </td>
                            <td className="p-2">
                              <select
                                value={m.targetField ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setMappings((prev) => {
                                    const next = [...prev];
                                    next[i] = { ...next[i], targetField: v || null };
                                    return next;
                                  });
                                }}
                                className="text-[11px] border border-[#dde5f5] rounded-[6px] px-2 py-1 bg-white"
                              >
                                {TARGET_FIELD_OPTIONS.map((opt) => (
                                  <option key={opt.value || "skip"} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${CONFIDENCE_STYLES[m.confidence] ?? CONFIDENCE_STYLES.SKIP}`}
                              >
                                {CONFIDENCE_LABELS[m.confidence] ?? "— Skip"}
                              </span>
                            </td>
                            <td className="p-2 text-[10px] text-[#8a97b8] max-w-[160px] truncate">
                              {m.reasoning}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#8a97b8] mb-4">
                    <span>
                      {mappedCount} mapped · {skipCount} skipped
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setEnrichedRows(null);
                        setExcludedSourceIndices([]);
                        setStep("review");
                      }}
                      className="px-3 py-2 rounded-[8px] bg-[#0d9488] text-white text-[11px] font-semibold hover:bg-[#0f766e]"
                    >
                      Preview import →
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {step === "review" && (
            <>
              {enriching ? (
                <div className="flex items-center gap-2 py-6 text-[#6d28d9]">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#f5f3ff] border border-[#c4b5fd]">
                    AI
                  </span>
                  <span className="text-[13px]">Analysing workplan structure...</span>
                </div>
              ) : (
                <>
              {!weightValid && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-[8px] bg-[#fffbeb] border border-[#fcd34d] mb-4 text-[11px] text-[#92400e]">
                Weights sum to {totalWeight.toFixed(1)}% — adjust before confirming
              </div>
              )}
              {!hasRequired && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-[8px] bg-[#fef2f2] border border-[#fecaca] mb-4 text-[11px] text-[#dc2626]">
                  Some rows are missing required fields (Major task, Weight)
                </div>
              )}
              {hasDupe && duplicateBannerMessage && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-[8px] bg-[#fffbeb] border border-[#fcd34d] mb-4 text-[11px] text-[#92400e]">
                  {duplicateBannerMessage}
                </div>
              )}
              {importError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-[8px] bg-[#fef2f2] border border-[#fecaca] mb-4 text-[11px] text-[#dc2626]">
                  {importError}
                </div>
              )}
              <div className="max-h-[300px] overflow-auto space-y-3 mb-4">
                {previewRowsWithSource.map(({ item, sourceIndex }, previewIdx) => {
                  const excluded = excludedSet.has(sourceIndex);
                  const isDupMember =
                    !excluded && duplicateMeta.dupPreviewIndexSet.has(previewIdx);
                  return (
                    <div
                      key={`${sourceIndex}-${previewIdx}`}
                      className={`rounded-[12px] border border-[#dde5f5] p-3 bg-[#f8faff] ${
                        isDupMember ? "border-l-[3px] border-l-solid border-l-[#f59e0b]" : ""
                      } ${excluded ? "opacity-40" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#eff6ff] text-[#1d4ed8] text-[11px] font-semibold flex items-center justify-center">
                            {previewIdx + 1}
                          </span>
                          <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0">
                            <span
                              className={`font-medium text-[13px] text-[#0f1f3d] truncate ${
                                excluded ? "line-through" : ""
                              }`}
                            >
                              {String(item.major_task ?? "")}
                            </span>
                            {excluded && (
                              <button
                                type="button"
                                onClick={() => setRowExcluded(sourceIndex, false)}
                                className="text-[11px] font-medium text-[#0d9488] hover:underline shrink-0"
                              >
                                Undo
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isDupMember && (
                            <span
                              className="rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                              style={{ backgroundColor: "#fef3c7", color: "#92400e" }}
                            >
                              Duplicate
                            </span>
                          )}
                          {!excluded && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 min-h-6 min-w-6 p-0 text-[#8a97b8] hover:text-[#0f1f3d]"
                              aria-label="Exclude row from import"
                              onClick={() => setRowExcluded(sourceIndex, true)}
                            >
                              <X className="h-4 w-4" strokeWidth={2} />
                            </Button>
                          )}
                          <span className="text-[12px] font-bold text-[#0d9488] tabular-nums">
                            {(previewWeightBySourceIndex.get(sourceIndex) ?? (item.weight as number) ?? 0).toFixed(2)}%
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] text-[#8a97b8] mt-1 truncate">
                        {String(item.corporate_objective ?? "")} → {String(item.division_objective ?? "")}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.key_output != null && String(item.key_output).trim() !== "" && (
                          <span className="inline-flex px-2 py-0.5 rounded bg-white border border-[#dde5f5] text-[10px] text-[#4a5a82]">
                            {String(item.key_output)}
                          </span>
                        )}
                        {item.performance_standard != null && String(item.performance_standard).trim() !== "" && (
                          <span className="inline-flex px-2 py-0.5 rounded bg-white border border-[#dde5f5] text-[10px] text-[#4a5a82]">
                            {String(item.performance_standard)}
                          </span>
                        )}
                        {item.metric_type != null && String(item.metric_type).trim() !== "" && (
                          <span className="inline-flex px-2 py-0.5 rounded bg-[#f0fdfa] border border-[#99f6e4] text-[10px] text-[#0d9488]">
                            {String(item.metric_type)}
                          </span>
                        )}
                        {item.metric_target != null && (
                          <span className="inline-flex px-2 py-0.5 rounded bg-[#f0fdfa] border border-[#99f6e4] text-[10px] text-[#0d9488]">
                            Target: {String(item.metric_target)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-end justify-between gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setExcludedSourceIndices([]);
                    setEnrichedRows(null);
                    setStep("mapping");
                  }}
                  className="px-3 py-2 rounded-[8px] border border-[#dde5f5] bg-white text-[#4a5a82] text-[11px] font-semibold hover:bg-[#f8faff]"
                >
                  Edit mapping
                </button>
                <div className="flex flex-col items-end gap-1">
                  <p className="text-[11px] text-[#8a97b8]">
                    Importing {activePreviewRows.length} of {previewRowsWithSource.length} objectives
                  </p>
                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={!hasRequired}
                    className="px-3 py-2 rounded-[8px] bg-[#0d9488] text-white text-[11px] font-semibold hover:bg-[#0f766e] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Confirm & create workplan
                  </button>
                  {hasDupe && duplicateMeta.duplicateRowsToImport > 0 && (
                    <p className="text-[10px] text-[#92400e] text-right max-w-[280px]">
                      ⚠ {duplicateMeta.duplicateRowsToImport} duplicate
                      {duplicateMeta.duplicateRowsToImport === 1 ? "" : "s"} will be imported
                    </p>
                  )}
                </div>
              </div>
                </>
              )}
            </>
          )}

          {step === "importing" && (
            <div className="py-8 text-center text-[#0d9488] text-[13px] font-medium">
              Importing objectives...
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(modalContent, document.body)
    : null;
}
