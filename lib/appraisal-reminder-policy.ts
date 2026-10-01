/**
 * Appraisal reminder policy: when reminders fall due relative to a deadline, and how failed
 * deliveries are retried. Pure (no I/O).
 *
 * Timing is configured per appraisal cycle by HR/Admin (appraisal_cycles columns, migration 0078):
 *   reminder_days_before      days before the due date, default 7,3,1,0 (0 = on the day)
 *   overdue_reminder_days     days after the due date, default 1,3,7 (bounded; no open-ended nagging)
 *   final_review_notice_days  how early the one-off "Final Review available" notice may go, default 30
 * A value a cycle does not have, or an invalid stored value, uses the default for that field.
 */

export const DEFAULT_REMINDER_DAYS_BEFORE = [7, 3, 1, 0];
export const DEFAULT_OVERDUE_REMINDER_DAYS = [1, 3, 7];
export const DEFAULT_FINAL_REVIEW_NOTICE_DAYS = 30;

export const MAX_REMINDER_OFFSET_DAYS = 60;
export const MAX_REMINDER_OFFSETS = 10;
export const MIN_FINAL_REVIEW_NOTICE_DAYS = 1;
export const MAX_FINAL_REVIEW_NOTICE_DAYS = 90;
/** Smallest allowed value: due reminders may fall on the due date (0); overdue ones start the day after. */
export const MIN_DAYS_BEFORE = 0;
export const MIN_OVERDUE_DAYS = 1;

/** A missed occurrence (e.g. the job did not run that day) is still sent if at most this many days late. */
export const REMINDER_CATCH_UP_DAYS = 2;

/** Total send attempts per reminder, including the first. */
export const MAX_DELIVERY_ATTEMPTS = 3;
/** Wait after the 1st, 2nd and 3rd failed attempt. Only the first MAX_DELIVERY_ATTEMPTS - 1 apply. */
export const RETRY_BACKOFF_MINUTES = [15, 60, 240];
/** A delivery left in SENDING longer than this (crashed run) is released for retry. */
export const STALE_SENDING_MINUTES = 30;
/** Upper bound on deliveries processed in one run. */
export const MAX_DELIVERIES_PER_RUN = 200;
/** Stop starting new sends after this long so a run ends inside the function time limit; the rest stay PENDING. */
export const RUN_TIME_BUDGET_MS = 45_000;

/** Reminder dates are evaluated in Jamaica time (UTC-5, no daylight saving). */
export const REMINDER_UTC_OFFSET_HOURS = -5;

export interface ReminderPolicy {
  daysBefore: number[];
  overdueDays: number[];
  finalReviewNoticeDays: number;
}

export interface LoadedReminderPolicy extends ReminderPolicy {
  warnings: string[];
}

export const DEFAULT_REMINDER_POLICY: ReminderPolicy = {
  daysBefore: DEFAULT_REMINDER_DAYS_BEFORE,
  overdueDays: DEFAULT_OVERDUE_REMINDER_DAYS,
  finalReviewNoticeDays: DEFAULT_FINAL_REVIEW_NOTICE_DAYS,
};

// ── Per-cycle configuration ──────────────────────────────────────────────────

/** appraisal_cycles columns holding a cycle's reminder timing; absent before migration 0078. */
export interface CycleReminderFields {
  reminder_days_before?: number[] | null;
  overdue_reminder_days?: number[] | null;
  final_review_notice_days?: number | null;
}

export const CYCLE_REMINDER_COLUMNS = "reminder_days_before, overdue_reminder_days, final_review_notice_days";

export const CYCLE_REMINDER_DEFAULTS: Required<{ [K in keyof CycleReminderFields]: NonNullable<CycleReminderFields[K]> }> = {
  reminder_days_before: DEFAULT_REMINDER_DAYS_BEFORE,
  overdue_reminder_days: DEFAULT_OVERDUE_REMINDER_DAYS,
  final_review_notice_days: DEFAULT_FINAL_REVIEW_NOTICE_DAYS,
};

/** A valid list of day offsets (whole numbers in range, unique, 1 to MAX_REMINDER_OFFSETS values), or null. */
export function validOffsetList(value: unknown, min: number): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REMINDER_OFFSETS) return null;
  const seen = new Set<number>();
  for (const n of value) {
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > MAX_REMINDER_OFFSET_DAYS || seen.has(n)) return null;
    seen.add(n);
  }
  return [...seen];
}

export function validFinalReviewNoticeDays(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_FINAL_REVIEW_NOTICE_DAYS &&
    value <= MAX_FINAL_REVIEW_NOTICE_DAYS
    ? value
    : null;
}

export const sortDaysBefore = (days: number[]) => [...days].sort((a, b) => b - a);
export const sortOverdueDays = (days: number[]) => [...days].sort((a, b) => a - b);

/**
 * The reminder timing for one cycle: each field the cycle configures (and is valid) wins; anything
 * missing or invalid uses `fallback`, which is the standard default policy unless a caller passes one.
 */
export function cycleReminderPolicy(
  cycle: (CycleReminderFields & { id?: string | null }) | null | undefined,
  fallback: ReminderPolicy = DEFAULT_REMINDER_POLICY
): LoadedReminderPolicy {
  const warnings: string[] = [];
  const label = cycle?.id ? `Cycle ${cycle.id}` : "Cycle";
  const pick = <T>(raw: unknown, valid: T | null, column: string, rule: string, fallbackValue: T, shown: string): T => {
    if (raw === undefined || raw === null) return fallbackValue;
    if (valid !== null) return valid;
    warnings.push(`${label}: ${column} must be ${rule}; using the default ${shown}.`);
    return fallbackValue;
  };

  const listRule = (min: number) =>
    `up to ${MAX_REMINDER_OFFSETS} unique whole numbers between ${min} and ${MAX_REMINDER_OFFSET_DAYS}`;
  const before = validOffsetList(cycle?.reminder_days_before, MIN_DAYS_BEFORE);
  const overdue = validOffsetList(cycle?.overdue_reminder_days, MIN_OVERDUE_DAYS);
  const notice = validFinalReviewNoticeDays(cycle?.final_review_notice_days);

  return {
    daysBefore: pick(
      cycle?.reminder_days_before,
      before && sortDaysBefore(before),
      "reminder_days_before",
      listRule(MIN_DAYS_BEFORE),
      fallback.daysBefore,
      fallback.daysBefore.join(",")
    ),
    overdueDays: pick(
      cycle?.overdue_reminder_days,
      overdue && sortOverdueDays(overdue),
      "overdue_reminder_days",
      listRule(MIN_OVERDUE_DAYS),
      fallback.overdueDays,
      fallback.overdueDays.join(",")
    ),
    finalReviewNoticeDays: pick(
      cycle?.final_review_notice_days,
      notice,
      "final_review_notice_days",
      `a whole number between ${MIN_FINAL_REVIEW_NOTICE_DAYS} and ${MAX_FINAL_REVIEW_NOTICE_DAYS}`,
      fallback.finalReviewNoticeDays,
      String(fallback.finalReviewNoticeDays)
    ),
    warnings,
  };
}

/**
 * Picks the reminder settings present in an admin request body and validates them. Lists are
 * stored in display order (due reminders furthest first, overdue reminders soonest first).
 */
export function parseCycleReminderFields(body: Record<string, unknown>): { fields: CycleReminderFields; error: string | null } {
  const fields: CycleReminderFields = {};
  if (body.reminder_days_before !== undefined) {
    const v = validOffsetList(body.reminder_days_before, MIN_DAYS_BEFORE);
    if (!v) {
      return {
        fields: {},
        error: `Due reminders must be up to ${MAX_REMINDER_OFFSETS} different whole numbers between ${MIN_DAYS_BEFORE} and ${MAX_REMINDER_OFFSET_DAYS}.`,
      };
    }
    fields.reminder_days_before = sortDaysBefore(v);
  }
  if (body.overdue_reminder_days !== undefined) {
    const v = validOffsetList(body.overdue_reminder_days, MIN_OVERDUE_DAYS);
    if (!v) {
      return {
        fields: {},
        error: `Overdue reminders must be up to ${MAX_REMINDER_OFFSETS} different whole numbers between ${MIN_OVERDUE_DAYS} and ${MAX_REMINDER_OFFSET_DAYS}.`,
      };
    }
    fields.overdue_reminder_days = sortOverdueDays(v);
  }
  if (body.final_review_notice_days !== undefined) {
    const v = validFinalReviewNoticeDays(body.final_review_notice_days);
    if (v === null) {
      return {
        fields: {},
        error: `Final Review notice must be a whole number of days between ${MIN_FINAL_REVIEW_NOTICE_DAYS} and ${MAX_FINAL_REVIEW_NOTICE_DAYS}.`,
      };
    }
    fields.final_review_notice_days = v;
  }
  return { fields, error: null };
}

const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/**
 * The requested reminder settings that differ from what the cycle uses now (its stored values, or
 * the defaults where it has none). Unchanged settings are never written.
 */
export function changedCycleReminderFields(
  current: CycleReminderFields | null | undefined,
  requested: CycleReminderFields
): CycleReminderFields {
  const now = cycleReminderPolicy(current);
  const changed: CycleReminderFields = {};
  if (requested.reminder_days_before && !sameDays(requested.reminder_days_before, now.daysBefore)) {
    changed.reminder_days_before = requested.reminder_days_before;
  }
  if (requested.overdue_reminder_days && !sameDays(requested.overdue_reminder_days, now.overdueDays)) {
    changed.overdue_reminder_days = requested.overdue_reminder_days;
  }
  if (requested.final_review_notice_days != null && requested.final_review_notice_days !== now.finalReviewNoticeDays) {
    changed.final_review_notice_days = requested.final_review_notice_days;
  }
  return changed;
}

export const hasCycleReminderFields = (fields: CycleReminderFields) => Object.keys(fields).length > 0;

/** Readable message when saving reminder settings fails because migration 0078 is not applied yet. */
export function reminderSettingsWriteError(error: { code?: string; message?: string }): string | null {
  const missing =
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /(reminder_days_before|overdue_reminder_days|final_review_notice_days)/.test(error.message ?? "");
  return missing ? "Reminder settings can't be saved until database migration 0078 is applied." : null;
}

/** Field-level result of reading one HR/Admin input; `error` is shown to the user as-is. */
export type ReminderInputResult<T> = { value: T; error: null } | { value: null; error: string };

/**
 * Parses the HR/Admin text for a list of reminder days ("7, 3, 1, 0"). Whole numbers only, no
 * duplicates, MIN to MAX_REMINDER_OFFSET_DAYS, at least one and at most MAX_REMINDER_OFFSETS values.
 */
export function parseReminderDaysText(raw: string, min: number, fieldLabel: string): ReminderInputResult<number[]> {
  const parts = String(raw ?? "")
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { value: null, error: `${fieldLabel}: enter at least one day.` };
  if (parts.length > MAX_REMINDER_OFFSETS) {
    return { value: null, error: `${fieldLabel}: enter no more than ${MAX_REMINDER_OFFSETS} days.` };
  }
  const values: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return { value: null, error: `${fieldLabel}: use whole numbers only ("${part}" is not).` };
    const n = Number(part);
    if (n < min || n > MAX_REMINDER_OFFSET_DAYS) {
      return { value: null, error: `${fieldLabel}: each day must be between ${min} and ${MAX_REMINDER_OFFSET_DAYS}.` };
    }
    if (values.includes(n)) return { value: null, error: `${fieldLabel}: ${n} is listed more than once.` };
    values.push(n);
  }
  return { value: values, error: null };
}

export function parseFinalReviewNoticeText(raw: string, fieldLabel: string): ReminderInputResult<number> {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return { value: null, error: `${fieldLabel}: enter a whole number of days.` };
  const n = Number(s);
  if (n < MIN_FINAL_REVIEW_NOTICE_DAYS || n > MAX_FINAL_REVIEW_NOTICE_DAYS) {
    return {
      value: null,
      error: `${fieldLabel}: must be between ${MIN_FINAL_REVIEW_NOTICE_DAYS} and ${MAX_FINAL_REVIEW_NOTICE_DAYS} days.`,
    };
  }
  return { value: n, error: null };
}

// ── Escalation (HR/Admin oversight only; nothing is emailed) ─────────────────

/**
 * APPRAISAL_ESCALATION_DAYS_OVERDUE (optional, default 7, whole number 1-90): how many days an
 * appraisal action must stay overdue, after its overdue reminders were attempted, before it is
 * listed as an escalation candidate.
 */
export const DEFAULT_ESCALATION_DAYS_OVERDUE = 7;

export function loadEscalationPolicy(env: Record<string, string | undefined> = process.env): {
  daysOverdue: number;
  warnings: string[];
} {
  const raw = env.APPRAISAL_ESCALATION_DAYS_OVERDUE?.trim();
  if (!raw) return { daysOverdue: DEFAULT_ESCALATION_DAYS_OVERDUE, warnings: [] };
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (n >= 1 && n <= 90) return { daysOverdue: n, warnings: [] };
  return {
    daysOverdue: DEFAULT_ESCALATION_DAYS_OVERDUE,
    warnings: [
      `APPRAISAL_ESCALATION_DAYS_OVERDUE must be a whole number between 1 and 90; using the default ${DEFAULT_ESCALATION_DAYS_OVERDUE}.`,
    ],
  };
}

// ── Dates (ISO yyyy-mm-dd, calendar arithmetic in UTC) ───────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const head = String(value).slice(0, 10);
  if (!ISO_DATE.test(head)) return null;
  const d = new Date(`${head}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== head ? null : head;
}

/** Today's calendar date in Jamaica. */
export function reminderToday(now: Date): string {
  return new Date(now.getTime() + REMINDER_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// ── Occurrences ──────────────────────────────────────────────────────────────

export interface ReminderOccurrence {
  /** Negative before the due date, 0 on it, positive when overdue. */
  offsetDays: number;
  scheduledFor: string;
  overdue: boolean;
}

/**
 * The reminder occurrence due on `today` for a deadline: the latest configured offset whose date has
 * arrived, if it arrived at most REMINDER_CATCH_UP_DAYS ago. At most one per deadline per day, and
 * nothing once the last overdue offset has passed.
 */
export function currentOccurrence(today: string, dueDate: string, policy: ReminderPolicy): ReminderOccurrence | null {
  let current: ReminderOccurrence | null = null;
  for (const offsetDays of reminderOffsets(policy)) {
    const scheduledFor = addDays(dueDate, offsetDays);
    if (scheduledFor > today) break;
    current = { offsetDays, scheduledFor, overdue: offsetDays > 0 };
  }
  if (!current || daysBetween(current.scheduledFor, today) > REMINDER_CATCH_UP_DAYS) return null;
  return current;
}

/** All configured offsets relative to the due date, earliest first. */
function reminderOffsets(policy: ReminderPolicy): number[] {
  return [...new Set([...policy.daysBefore.map((d) => -d), ...policy.overdueDays])].sort((a, b) => a - b);
}

/** The first configured occurrence strictly after `today`, or null once the schedule is exhausted. */
export function upcomingOccurrence(today: string, dueDate: string, policy: ReminderPolicy): ReminderOccurrence | null {
  for (const offsetDays of reminderOffsets(policy)) {
    const scheduledFor = addDays(dueDate, offsetDays);
    if (scheduledFor > today) return { offsetDays, scheduledFor, overdue: offsetDays > 0 };
  }
  return null;
}

/** Compact timing label for the "next eligible reminder" helper. */
export function shortOffsetLabel(offsetDays: number | null): string {
  if (offsetDays == null) return "availability notice";
  if (offsetDays === 0) return "due-date reminder";
  const n = Math.abs(offsetDays);
  const unit = n === 1 ? "day" : "days";
  return offsetDays < 0 ? `${n} ${unit} before due` : `${n} ${unit} overdue`;
}

export const formatOffsetKey = (offsetDays: number) => (offsetDays > 0 ? `+${offsetDays}` : String(offsetDays));

export function describeOffset(offsetDays: number | null): string {
  if (offsetDays == null) return "Review available notice";
  if (offsetDays === 0) return "On the due date";
  const n = Math.abs(offsetDays);
  const unit = n === 1 ? "day" : "days";
  return offsetDays < 0 ? `${n} ${unit} before due date` : `${n} ${unit} overdue`;
}

/** Wait before the next attempt after `attemptCount` failed attempts; null when no retry remains. */
export function retryDelayMinutes(attemptCount: number): number | null {
  if (attemptCount >= MAX_DELIVERY_ATTEMPTS) return null;
  return RETRY_BACKOFF_MINUTES[Math.min(attemptCount, RETRY_BACKOFF_MINUTES.length) - 1] ?? null;
}
