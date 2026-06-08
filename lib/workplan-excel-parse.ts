import * as XLSX from "xlsx";
import Anthropic from "@anthropic-ai/sdk";
import type { ColumnMapping } from "@/app/api/appraisals/[id]/workplan/analyse-columns/route";

/** Only these three fields fill down (merged-cell hierarchy). Row-specific columns are excluded. */
const CARRY_FORWARD_TARGET_FIELDS = [
  "corporate_objective",
  "division_objective",
  "major_task",
] as const;

export function getHierarchyColumnsFromMappings(mappings: ColumnMapping[]): string[] {
  return mappings
    .filter((m) =>
      CARRY_FORWARD_TARGET_FIELDS.includes(
        (m.targetField ?? "") as (typeof CARRY_FORWARD_TARGET_FIELDS)[number]
      )
    )
    .map((m) => m.excelColumn);
}

/** Fallback: simple carry-forward without AI */
export function applyCarryForward(
  rows: Record<string, unknown>[],
  cols: string[]
): Record<string, unknown>[] {
  const last: Record<string, unknown> = {};
  return rows.map((row) => {
    const merged = { ...row };
    for (const col of cols) {
      if (merged[col]) {
        last[col] = merged[col];
      } else if (last[col]) {
        merged[col] = last[col];
      }
    }
    return merged;
  });
}

function buildCompactHierarchyRows(
  rows: Record<string, unknown>[],
  hierarchyFields: string[]
): Record<string, unknown>[] {
  return rows.map((row, i) => {
    const entry: Record<string, unknown> = { _idx: i };
    for (const col of hierarchyFields) {
      entry[col] = row[col] ?? null;
    }
    return entry;
  });
}

function mergeEnrichedHierarchyIntoRows(
  rows: Record<string, unknown>[],
  enriched: Record<string, unknown>[],
  hierarchyFields: string[]
): Record<string, unknown>[] {
  return rows.map((row, i) => {
    const enrichedRow = enriched.find((e) => e._idx === i);
    if (!enrichedRow) return row;
    const merged = { ...row };
    for (const col of hierarchyFields) {
      if (
        (row[col] === null || row[col] === undefined || row[col] === "") &&
        enrichedRow[col]
      ) {
        merged[col] = enrichedRow[col];
      }
    }
    return merged;
  });
}

export async function enrichRowsWithAI(
  rows: Record<string, unknown>[],
  mappings: ColumnMapping[]
): Promise<Record<string, unknown>[]> {
  const hierarchyFields = getHierarchyColumnsFromMappings(mappings);
  if (hierarchyFields.length === 0) return rows;

  const compact = buildCompactHierarchyRows(rows, hierarchyFields);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return applyCarryForward(rows, hierarchyFields);
  }

  const prompt = `You are given rows parsed from an Excel workplan. The Excel used merged cells, so 
Corporate Objective, Division Objective, and Major Task columns are only filled on 
the first row of each group — child rows have null in those columns.

Your job: return the same array with every null hierarchy field filled in by 
carrying forward the most recent non-null value from above. Do not invent or 
change any actual text values. Only fill nulls using carry-forward logic.

Return ONLY a JSON array. No explanation. No markdown. Each object must have 
the same keys as the input plus the filled values.

Rows:
${JSON.stringify(compact, null, 2)}`;

  try {
    const anthropic = new Anthropic({ apiKey });
    const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 4000,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    });
    const block = msg.content.find((b) => b.type === "text");
    const text = block && "text" in block ? block.text : "[]";
    const enriched = JSON.parse(text.replace(/```json|```/g, "").trim()) as Record<string, unknown>[];
    if (!Array.isArray(enriched)) {
      return applyCarryForward(rows, hierarchyFields);
    }
    return mergeEnrichedHierarchyIntoRows(rows, enriched, hierarchyFields);
  } catch {
    return applyCarryForward(rows, hierarchyFields);
  }
}

/** Normalize Excel weight: DBJ uses 5,10,20 as points; decimals 0–1 treated as fractions of 100. */
export function parseWorkplanWeight(raw: unknown): number {
  const rawStr = String(raw).replace(/%/g, "").trim();
  const rawWeight = parseFloat(rawStr);
  if (Number.isNaN(rawWeight) || rawWeight <= 0) return 0;
  if (rawWeight > 100) return rawWeight;
  if (rawWeight <= 1) return rawWeight * 100;
  return rawWeight;
}

/** When no row has a weight from Excel, split 100% evenly (DB requires NOT NULL weight). */
export function distributeEqualWeightsIfMissing<T extends { weight?: number }>(items: T[]): T[] {
  if (items.length === 0) return items;
  if (items.some((i) => (i.weight ?? 0) > 0)) return items;

  const perRow = Math.round((100 / items.length) * 100) / 100;
  return items.map((item, idx) => {
    let weight = perRow;
    if (idx === items.length - 1) {
      weight = Math.round((100 - perRow * (items.length - 1)) * 100) / 100;
    }
    return { ...item, weight };
  });
}

export function findHeaderRow(worksheet: XLSX.WorkSheet): number {
  const ref = worksheet["!ref"];
  if (!ref) return 0;
  const range = XLSX.utils.decode_range(ref);

  const headerKeywords = [
    "major task",
    "major tasks",
    "weight",
    "weighting",
    "corporate objective",
    "division objective",
    "key output",
    "performance standard",
    "activities",
    "task",
  ];

  for (let row = 0; row <= Math.min(10, range.e.r); row++) {
    const rowValues: string[] = [];
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell?.v != null && cell.v !== "") rowValues.push(String(cell.v).toLowerCase().trim());
    }
    const matches = rowValues.filter((v) => headerKeywords.some((kw) => v.includes(kw)));
    if (matches.length >= 2) return row;
  }
  return 0;
}

export function extractTemplateMetadata(worksheet: XLSX.WorkSheet): Record<string, string> {
  const meta: Record<string, string> = {};
  const nameCell = worksheet["B1"];
  const posCell = worksheet["E1"];
  const unitCell = worksheet["B2"];
  const divCell = worksheet["B3"];
  if (nameCell?.v != null && String(nameCell.v).trim() !== "") meta.employeeName = String(nameCell.v).trim();
  if (posCell?.v != null && String(posCell.v).trim() !== "") meta.position = String(posCell.v).trim();
  if (unitCell?.v != null && String(unitCell.v).trim() !== "") meta.unit = String(unitCell.v).trim();
  if (divCell?.v != null && String(divCell.v).trim() !== "") meta.division = String(divCell.v).trim();
  return meta;
}

function isFooterCell(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  const s = String(value).trim();
  const lower = s.toLowerCase();
  if (lower === "key:" || lower.startsWith("key:")) return true;
  if (/^\d+\.\s/.test(s)) return true;
  if (lower.includes("technical competency")) return true;
  if (lower.includes("critical functional/technical competencies")) return true;
  if (lower.includes("required level")) return true;
  if (lower.includes("actual performance rating")) return true;
  if (lower.includes("total") || lower.includes("sum")) return true;
  if (lower.includes("we agree")) return true;
  if (lower.includes("employee___") || lower.includes("employee __")) return true;
  if (/employee\s*:/i.test(s)) return true;
  if (/gm\s*\/\s*hod/i.test(s)) return true;
  if (lower.includes("hod")) return true;
  if (lower.includes("for hr")) return true;
  if (lower.startsWith("=")) return true;
  if (lower.includes("supervisor___") || lower.includes("supervisor __")) return true;
  return false;
}

export function isDataRow(row: unknown[]): boolean {
  if (!row || row.length === 0) return false;
  if (row.every((v) => v === null || v === "" || v === undefined)) return false;
  for (const v of row) {
    if (isFooterCell(v)) return false;
  }
  const firstMeaningful = row.find((v) => v !== null && v !== "" && v !== undefined);
  if (firstMeaningful === undefined) return false;
  if (typeof firstMeaningful === "number") return true;
  return true;
}

function rowHasWorkplanContent(row: unknown[], headers: string[]): boolean {
  const hasValue = (i: number) => {
    const v = row[i];
    return v !== null && v !== undefined && v !== "";
  };

  let hasCorporate = false;
  let hasDivision = false;
  let hasMajor = false;
  let hasActivities = false;
  let hasKeyOutput = false;
  let hasPerf = false;

  for (let i = 0; i < headers.length; i++) {
    if (!hasValue(i)) continue;
    const h = headers[i].toLowerCase().trim();
    if (h.includes("corporate") && h.includes("objective")) hasCorporate = true;
    else if (h.includes("division") && h.includes("objective")) hasDivision = true;
    else if (h.includes("major") && h.includes("task")) hasMajor = true;
    else if (h.includes("activit") && !h.includes("objective")) hasActivities = true;
    else if (h.includes("key") && h.includes("output")) hasKeyOutput = true;
    else if (h.includes("performance") && h.includes("standard")) hasPerf = true;
  }

  if (!hasCorporate && !hasDivision && !hasMajor && !hasActivities && !hasKeyOutput && !hasPerf) {
    return false;
  }

  // Status-grid rows with only an isolated major-task label and no row content
  if (
    hasMajor &&
    !hasCorporate &&
    !hasDivision &&
    !hasActivities &&
    !hasKeyOutput &&
    !hasPerf
  ) {
    return false;
  }

  return true;
}

function findRowNumberColumnIndex(headers: string[]): number | null {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().replace(/\s+/g, " ").trim();
    if (h === "#" || h === "no." || h === "no") return i;
  }
  return null;
}

function rowPassesRowNumberColumn(row: unknown[], colIdx: number | null): boolean {
  if (colIdx == null) return true;
  const v = row[colIdx];
  if (v === null || v === undefined || v === "") return false;
  if (typeof v === "number" && !Number.isNaN(v)) return true;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return true;
  return false;
}

/** Build header names from first row; dedupe collisions. */
function normalizeHeaderRow(headerCells: unknown[]): string[] {
  const seen = new Map<string, number>();
  return headerCells.map((h, i) => {
    const base = h == null || h === "" ? `Column${i + 1}` : String(h).trim();
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

/**
 * Parse sheet from detected header row: object rows, headers, template metadata.
 */
export function parseWorksheetToWorkplanRows(sheet: XLSX.WorkSheet): {
  rows: Record<string, unknown>[];
  headers: string[];
  headerRowIndex: number;
  templateMeta: Record<string, string>;
} {
  const headerRow = findHeaderRow(sheet);
  const raw = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    range: headerRow,
    defval: null,
  }) as unknown[][];

  const templateMeta = extractTemplateMetadata(sheet);

  if (!raw.length) {
    return { rows: [], headers: [], headerRowIndex: headerRow, templateMeta };
  }

  const headers = normalizeHeaderRow(raw[0]);
  const dataRows = raw.slice(1);
  const rowNumIdx = findRowNumberColumnIndex(headers);
  const filtered = dataRows.filter((row) => {
    const arr = row as unknown[];
    if (!isDataRow(arr)) return false;
    if (!rowHasWorkplanContent(arr, headers)) return false;
    return rowPassesRowNumberColumn(arr, rowNumIdx);
  });

  const rows = filtered.map((cells) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((key, i) => {
      obj[key] = (cells as unknown[])[i] ?? null;
    });
    return obj;
  });

  return { rows, headers, headerRowIndex: headerRow, templateMeta };
}

export function shouldSkipMappingTarget(targetField: string | null | undefined): boolean {
  if (targetField == null || targetField === "") return true;
  const t = String(targetField).trim();
  if (t === "" || t.toUpperCase() === "SKIP") return true;
  if (t === "row_number" || t.toLowerCase() === "skip") return true;
  return false;
}

function isValidCalendarYmd(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function formatLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Normalize a cell/API value to YYYY-MM-DD for Postgres DATE columns.
 * Non-dates (e.g. "Ongoing", "TBD") return null so the field is stored blank.
 */
export function parseWorkplanDateForDb(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "number" && !Number.isNaN(raw)) {
    const date = XLSX.SSF.parse_date_code(raw);
    if (date && date.y && date.m && date.d) {
      return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
    }
    return null;
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return formatLocalYmd(raw);
  }
  const s = String(raw).trim();
  if (!s) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidCalendarYmd(y, m, d)) return s;
    return null;
  }

  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (!Number.isNaN(n)) {
      const date = XLSX.SSF.parse_date_code(n);
      if (date && date.y && date.m && date.d) {
        return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
      }
    }
    return null;
  }

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    const y = d.getFullYear();
    if (y < 1900 || y > 2200) return null;
    return formatLocalYmd(d);
  }
  return null;
}
