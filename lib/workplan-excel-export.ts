import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";

/** Official DBJ template: first data row (0-based). */
const DBJ_DATA_START_ROW = 7;
/** Pre-printed objective rows in the bundled template (rows 7–13). */
const DBJ_TEMPLATE_DATA_SLOTS = 7;
/** First footer row in template (TOTAL); 0-based row 14 = Excel row 15. */
const DBJ_FOOTER_START_ROW = 14;

const DBJ_TEMPLATE_PATH = path.join(
  process.cwd(),
  "lib",
  "templates",
  "dbj-individual-workplan-template.xlsx"
);

export type WorkplanExportItem = {
  corporate_objective: string;
  division_objective: string;
  individual_objective: string;
  major_task: string;
  key_output: string;
  performance_standard: string;
  weight: number;
  metric_type?: string | null;
  metric_target?: number | null;
  metric_deadline?: string | null;
};

export type WorkplanExportMeta = {
  employeeName?: string;
  position?: string;
  unit?: string;
  division?: string;
  fiscalYear?: string;
};

/** DBJ export columns (0-based) after Activities column is removed. */
const COL_CORPORATE = 1;
const COL_DIVISION = 2;
const COL_MAJOR_TASK = 3;
const COL_KEY_OUTPUT = 4;
const COL_PERFORMANCE = 5;
const COL_WEIGHT = 6;

function buildKeyOutputForExport(item: WorkplanExportItem): string {
  const keyOutput = (item.key_output ?? "").trim();
  const individual = (item.individual_objective ?? "").trim();
  if (!individual) return keyOutput;
  if (!keyOutput) return individual;
  return `${individual}\n${keyOutput}`;
}

/** Remove a column from the sheet and shift merges/cells left (used to drop Activities). */
function removeSheetColumn(sheet: XLSX.WorkSheet, removeCol: number): void {
  const ref = sheet["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = removeCol; c < range.e.c; c++) {
      const src = XLSX.utils.encode_cell({ r, c: c + 1 });
      const dst = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[src];
      if (cell) sheet[dst] = cell;
      else delete sheet[dst];
    }
    delete sheet[XLSX.utils.encode_cell({ r, c: range.e.c })];
  }

  if (range.e.c > removeCol) range.e.c--;
  sheet["!ref"] = XLSX.utils.encode_range(range);

  const merges = sheet["!merges"];
  if (!merges?.length) return;

  const next: XLSX.Range[] = [];
  for (const m of merges) {
    if (m.s.c === removeCol && m.e.c === removeCol) continue;

    let sc = m.s.c;
    let ec = m.e.c;
    if (ec < removeCol) {
      next.push(m);
      continue;
    }
    if (sc > removeCol) {
      sc--;
      ec--;
    } else {
      ec--;
      if (sc === removeCol) sc = removeCol;
    }
    if (sc > ec) continue;
    next.push({ s: { r: m.s.r, c: sc }, e: { r: m.e.r, c: ec } });
  }
  sheet["!merges"] = next;
}

function setSheetCell(sheet: XLSX.WorkSheet, r: number, c: number, value: string | number) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (value === "" || value === null || value === undefined) {
    delete sheet[addr];
    return;
  }
  if (typeof value === "number" && !Number.isNaN(value)) {
    sheet[addr] = { t: "n", v: value };
  } else {
    sheet[addr] = { t: "s", v: String(value) };
  }
}

/** Shift footer/signature rows down when there are more objectives than template slots. */
function shiftSheetRowsDown(sheet: XLSX.WorkSheet, startRow: number, delta: number) {
  if (delta <= 0) return;
  const ref = sheet["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const moves: { newR: number; c: number; cell: XLSX.CellObject }[] = [];

  for (let r = range.e.r; r >= startRow; r--) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (cell) {
        moves.push({ newR: r + delta, c, cell });
        delete sheet[addr];
      }
    }
  }

  for (const m of moves) {
    sheet[XLSX.utils.encode_cell({ r: m.newR, c: m.c })] = m.cell;
  }

  const merges = sheet["!merges"];
  if (merges) {
    for (const merge of merges) {
      if (merge.s.r >= startRow) {
        merge.s.r += delta;
        merge.e.r += delta;
      }
    }
  }

  range.e.r += delta;
  sheet["!ref"] = XLSX.utils.encode_range(range);
}

function clearDataArea(sheet: XLSX.WorkSheet, startRow: number, rowCount: number) {
  for (let r = startRow; r < startRow + rowCount; r++) {
    for (let c = 1; c <= COL_WEIGHT; c++) {
      delete sheet[XLSX.utils.encode_cell({ r, c })];
    }
    delete sheet[XLSX.utils.encode_cell({ r, c: 0 })];
  }
}

function formatFiscalYearLabel(fiscalYear?: string): string {
  const y = (fiscalYear ?? "").trim();
  if (!y) return "";
  if (y.includes("/") || y.toLowerCase().includes("fy")) return y;
  const n = parseInt(y, 10);
  if (!Number.isNaN(n)) return `${n}/${n + 1} FY`;
  return y;
}

function formatTitleFiscalYear(fiscalYear?: string): string {
  const y = (fiscalYear ?? "").trim();
  if (!y) return " INDIVIDUAL WORK PLAN";
  if (y.includes("/")) {
    const parts = y.split("/");
    return ` INDIVIDUAL WORK PLAN FY ${parts[0]}/${parts[1]?.replace(/\D/g, "") || ""}`;
  }
  const n = parseInt(y, 10);
  if (!Number.isNaN(n)) return ` INDIVIDUAL WORK PLAN FY ${n}/${String(n + 1).slice(-2)}`;
  return ` INDIVIDUAL WORK PLAN FY ${y}`;
}

function enrichPerformanceStandard(item: WorkplanExportItem): string {
  let text = (item.performance_standard ?? "").trim();
  const extras: string[] = [];
  if (item.metric_target != null && !Number.isNaN(Number(item.metric_target))) {
    extras.push(`Target: ${item.metric_target}`);
  }
  if (item.metric_deadline) {
    extras.push(`Due: ${item.metric_deadline}`);
  }
  if (extras.length > 0) {
    text = text ? `${text} — ${extras.join(" · ")}` : extras.join(" · ");
  }
  return text;
}

/**
 * Fill the official DBJ Individual Workplan template (labels, merges, footer intact).
 */
export function fillDbjWorkplanTemplate(
  sheet: XLSX.WorkSheet,
  meta: WorkplanExportMeta,
  items: WorkplanExportItem[]
): void {
  const extraRows = Math.max(0, items.length - DBJ_TEMPLATE_DATA_SLOTS);
  if (extraRows > 0) {
    shiftSheetRowsDown(sheet, DBJ_FOOTER_START_ROW, extraRows);
  }

  const dataRowCount = Math.max(DBJ_TEMPLATE_DATA_SLOTS, items.length);
  clearDataArea(sheet, DBJ_DATA_START_ROW, dataRowCount + extraRows);

  // Value cells (labels remain in B1, E1, B2, B3 per template; col indices are post–Activities removal)
  setSheetCell(sheet, 0, 2, meta.employeeName ?? "");
  setSheetCell(sheet, 0, 5, meta.position ?? "");
  setSheetCell(sheet, 1, 2, meta.unit ?? "");
  setSheetCell(sheet, 1, 4, formatFiscalYearLabel(meta.fiscalYear));
  setSheetCell(sheet, 2, 2, meta.division ?? "");
  setSheetCell(sheet, 3, 0, formatTitleFiscalYear(meta.fiscalYear));

  let totalWeight = 0;
  items.forEach((item, index) => {
    const row = DBJ_DATA_START_ROW + index;
    const weight = Number(item.weight) || 0;
    totalWeight += weight;

    setSheetCell(sheet, row, 0, index + 1);
    setSheetCell(sheet, row, COL_CORPORATE, item.corporate_objective ?? "");
    setSheetCell(sheet, row, COL_DIVISION, item.division_objective ?? "");
    setSheetCell(sheet, row, COL_MAJOR_TASK, item.major_task ?? "");
    setSheetCell(sheet, row, COL_KEY_OUTPUT, buildKeyOutputForExport(item));
    setSheetCell(sheet, row, COL_PERFORMANCE, enrichPerformanceStandard(item));
    setSheetCell(sheet, row, COL_WEIGHT, weight);
  });

  const totalRow = DBJ_FOOTER_START_ROW + extraRows;
  setSheetCell(sheet, totalRow, COL_WEIGHT, totalWeight);
}

function loadTemplateSheet(): XLSX.WorkSheet | null {
  if (!fs.existsSync(DBJ_TEMPLATE_PATH)) return null;
  const wb = XLSX.read(fs.readFileSync(DBJ_TEMPLATE_PATH), { cellStyles: true });
  const name = wb.SheetNames.includes("Workplan") ? "Workplan" : wb.SheetNames[0];
  if (!name) return null;
  const sheet = JSON.parse(JSON.stringify(wb.Sheets[name])) as XLSX.WorkSheet;
  removeSheetColumn(sheet, 4);
  return sheet;
}

/** Fallback grid when template file is missing (import-compatible columns). */
export function buildWorkplanExportAoA(
  meta: WorkplanExportMeta,
  items: WorkplanExportItem[]
): unknown[][] {
  const aoa: unknown[][] = [];
  aoa[0] = ["", meta.employeeName ?? "", "", "", meta.position ?? ""];
  aoa[1] = ["", meta.unit ?? "", "", "", formatFiscalYearLabel(meta.fiscalYear)];
  aoa[2] = ["", meta.division ?? ""];
  aoa[3] = [formatTitleFiscalYear(meta.fiscalYear)];
  const headers = [
    "#",
    "Corporate Objective",
    "Division Objective",
    "Major Tasks",
    "Key Outputs",
    "Performance Standard / Metric",
    "Weighting",
  ];
  aoa[5] = headers;
  items.forEach((item, index) => {
    aoa.push([
      index + 1,
      item.corporate_objective ?? "",
      item.division_objective ?? "",
      item.major_task ?? "",
      buildKeyOutputForExport(item),
      enrichPerformanceStandard(item),
      Number(item.weight) || 0,
    ]);
  });
  return aoa;
}

export function buildWorkplanExportBuffer(
  meta: WorkplanExportMeta,
  items: WorkplanExportItem[]
): Buffer {
  const templateSheet = loadTemplateSheet();
  if (templateSheet) {
    fillDbjWorkplanTemplate(templateSheet, meta, items);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, templateSheet, "Workplan");
    return Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
    );
  }

  const aoa = buildWorkplanExportAoA(meta, items);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Workplan");
  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

export function sanitizeWorkplanExportFilename(base: string): string {
  const cleaned = base
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 120);
  return cleaned.endsWith(".xlsx") ? cleaned : `${cleaned || "workplan"}.xlsx`;
}
