/**
 * Per-cycle Mid-Year Review configuration (appraisal_cycles.midyear_*) and the check-in
 * review mode it implies. Shared by the admin cycle API, the check-ins API and the check-in UI.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type CheckInReviewMode = "INFORMAL" | "FORMAL" | "FORMAL_SCORED";

export interface MidyearConfig {
  enabled: boolean;
  scoringEnabled: boolean;
  windowStart: string | null;
  dueDate: string | null;
}

export interface MidyearCycleFields {
  midyear_review_enabled: boolean;
  midyear_scoring_enabled: boolean;
  midyear_window_start: string | null;
  midyear_due_date: string | null;
}

export const MIDYEAR_DISABLED: MidyearConfig = { enabled: false, scoringEnabled: false, windowStart: null, dueDate: null };

export const MIDYEAR_FIELD_DEFAULTS: MidyearCycleFields = {
  midyear_review_enabled: false,
  midyear_scoring_enabled: false,
  midyear_window_start: null,
  midyear_due_date: null,
};

const MIDYEAR_KEYS = Object.keys(MIDYEAR_FIELD_DEFAULTS) as (keyof MidyearCycleFields)[];

/** Cycle statuses whose Mid-Year settings can no longer change. */
export const LOCKED_CYCLE_STATUSES = ["closed", "archived"];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function midyearConfigFromRow(row: Partial<MidyearCycleFields> | null | undefined): MidyearConfig {
  if (!row) return MIDYEAR_DISABLED;
  const enabled = row.midyear_review_enabled === true;
  return {
    enabled,
    scoringEnabled: enabled && row.midyear_scoring_enabled === true,
    windowStart: row.midyear_window_start ?? null,
    dueDate: row.midyear_due_date ?? null,
  };
}

/**
 * Reads a cycle's Mid-Year settings. Any read failure (including the columns not yet existing)
 * yields the disabled configuration, i.e. current behaviour.
 */
export async function loadCycleMidyearConfig(
  supabase: SupabaseClient,
  cycleId: string | null | undefined
): Promise<{ config: MidyearConfig; fiscalYear: string | null }> {
  if (!cycleId) return { config: MIDYEAR_DISABLED, fiscalYear: null };
  const { data, error } = await supabase
    .from("appraisal_cycles")
    .select("fiscal_year, midyear_review_enabled, midyear_scoring_enabled, midyear_window_start, midyear_due_date")
    .eq("id", cycleId)
    .maybeSingle();
  if (error || !data) return { config: MIDYEAR_DISABLED, fiscalYear: null };
  return {
    config: midyearConfigFromRow(data as Partial<MidyearCycleFields>),
    fiscalYear: (data as { fiscal_year?: string | null }).fiscal_year ?? null,
  };
}

/** Picks the Mid-Year fields present in a request body and validates their types. */
export function parseMidyearFields(
  body: Record<string, unknown>
): { fields: Partial<MidyearCycleFields>; error: string | null } {
  const fields: Partial<MidyearCycleFields> = {};
  for (const key of ["midyear_review_enabled", "midyear_scoring_enabled"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") return { fields: {}, error: `${key} must be true or false` };
    fields[key] = body[key] as boolean;
  }
  for (const key of ["midyear_window_start", "midyear_due_date"] as const) {
    if (body[key] === undefined) continue;
    const raw = body[key];
    if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
      fields[key] = null;
      continue;
    }
    if (typeof raw !== "string" || !isValidIsoDate(raw.trim())) {
      return { fields: {}, error: `${key} must be a date (YYYY-MM-DD)` };
    }
    fields[key] = raw.trim();
  }
  return { fields, error: null };
}

export function hasMidyearFields(fields: Partial<MidyearCycleFields>): boolean {
  return MIDYEAR_KEYS.some((k) => fields[k] !== undefined);
}

/**
 * Applies a partial change to the current settings. Turning the review off also turns scoring
 * off unless scoring is sent explicitly. Returns the columns to write, or a validation error.
 */
export function resolveMidyearChange(
  current: Partial<MidyearCycleFields> | null | undefined,
  change: Partial<MidyearCycleFields>
): { update: Partial<MidyearCycleFields>; merged: MidyearCycleFields; error: string | null } {
  const update: Partial<MidyearCycleFields> = { ...change };
  if (change.midyear_review_enabled === false && change.midyear_scoring_enabled === undefined) {
    update.midyear_scoring_enabled = false;
  }
  const base: MidyearCycleFields = { ...MIDYEAR_FIELD_DEFAULTS };
  for (const k of MIDYEAR_KEYS) {
    const v = current?.[k];
    if (v !== undefined) (base as unknown as Record<string, unknown>)[k] = v;
  }
  const merged: MidyearCycleFields = { ...base, ...update };

  if (merged.midyear_scoring_enabled && !merged.midyear_review_enabled) {
    return { update, merged, error: "Mid-Year scoring cannot be enabled while Mid-Year Review is disabled." };
  }
  if (merged.midyear_window_start && merged.midyear_due_date && merged.midyear_due_date < merged.midyear_window_start) {
    return { update, merged, error: "Mid-Year due date cannot be before the review window start." };
  }
  return { update, merged, error: null };
}

/** Review mode for a new check-in. Only Mid-Year check-ins in an enabled cycle are formal. */
export function resolveCheckInReviewMode(checkInType: string, config: MidyearConfig): CheckInReviewMode {
  if (checkInType !== "MIDYEAR" || !config.enabled) return "INFORMAL";
  return config.scoringEnabled ? "FORMAL_SCORED" : "FORMAL";
}

/**
 * Request body for POST /api/appraisals/[id]/checkins that starts the formal Mid-Year Review.
 * The server sets the title, due date and review mode from the cycle; the due date sent here is
 * only a fallback for cycles without a configured Mid-Year due date.
 */
export function formalMidyearCreateBody(
  midyear: MidyearConfig | null | undefined,
  extras: { due_date?: string | null; note_to_employee?: string | null } = {}
) {
  return {
    check_in_type: "MIDYEAR" as const,
    review_mode: (midyear?.scoringEnabled ? "FORMAL_SCORED" : "FORMAL") as CheckInReviewMode,
    due_date: midyear?.dueDate ?? extras.due_date ?? null,
    note_to_employee: extras.note_to_employee ?? null,
  };
}

export function midyearReviewTitle(fiscalYear: string | null | undefined): string {
  const fy = (fiscalYear ?? "").trim();
  return fy ? `Mid-Year Review – ${fy}` : "Mid-Year Review";
}

/** "2026" → "FY 2026/27", "2026/2027" → "FY 2026/2027"; same convention as the workplan export title. */
export function fiscalYearLabel(fiscalYear: string | null | undefined): string | null {
  const y = (fiscalYear ?? "").trim();
  if (!y) return null;
  if (/^FY\b/i.test(y)) return y;
  if (y.includes("/")) {
    const [start, end] = y.split("/");
    return `FY ${start}/${(end ?? "").replace(/\D/g, "")}`;
  }
  if (/^\d{4}$/.test(y)) return `FY ${y}/${String(Number(y) + 1).slice(-2)}`;
  return `FY ${y}`;
}

/** Collapses a repeated fiscal-year prefix in display text: "FY FY 2026/27" → "FY 2026/27". */
export function dedupeFiscalYearPrefix(text: string): string {
  return text.replace(/\bFY(?:\s+FY\b)+/gi, "FY");
}

/** Cycle label for display: repeated FY prefixes collapsed and identical " · " segments shown once. */
export function formatCycleLabel(label: string | null | undefined): string {
  const parts = dedupeFiscalYearPrefix(label ?? "")
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(parts)].join(" · ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonthYear = (year: number, monthIndex: number, day: number) => `${day} ${MONTHS[monthIndex]} ${year}`;

/**
 * ISO date (YYYY-MM-DD) → "30 Jun 2026". Read as a calendar date, so it never shifts a day in
 * time zones behind UTC. Other values are returned unchanged.
 */
export function formatMidyearDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!isValidIsoDate(value)) return value;
  const [year, month, day] = value.split("-").map(Number);
  return dayMonthYear(year, month - 1, day);
}

/** Check-in dates: date-only values as calendar dates, timestamps in the viewer's local time. */
export function formatCheckInDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (ISO_DATE.test(value)) return formatMidyearDate(value);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : dayMonthYear(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Timestamps → "20 Oct 2026, 9:05 AM" in the viewer's local time; date-only values as calendar dates. */
export function formatCheckInDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  if (ISO_DATE.test(value)) return formatMidyearDate(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const hour = d.getHours() % 12 || 12;
  const minute = String(d.getMinutes()).padStart(2, "0");
  return `${dayMonthYear(d.getFullYear(), d.getMonth(), d.getDate())}, ${hour}:${minute} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

export function isFormalReviewMode(mode: string | null | undefined): boolean {
  return mode === "FORMAL" || mode === "FORMAL_SCORED";
}
