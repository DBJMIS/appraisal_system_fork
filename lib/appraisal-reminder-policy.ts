/**
 * Appraisal reminder policy: when reminders fall due relative to a deadline, and how failed
 * deliveries are retried. Pure (no I/O) apart from reading the optional environment overrides.
 *
 * Environment (all optional, validated; invalid values fall back to the defaults with a warning):
 *   APPRAISAL_REMINDER_DAYS_BEFORE      days before the due date, default "7,3,1,0" (0 = on the day)
 *   APPRAISAL_OVERDUE_REMINDER_DAYS     days after the due date, default "1,3,7" (bounded; no open-ended nagging)
 *   APPRAISAL_FINAL_REVIEW_NOTICE_DAYS  how early the one-off "Final Review available" notice may go, default 30
 */

export const DEFAULT_REMINDER_DAYS_BEFORE = [7, 3, 1, 0];
export const DEFAULT_OVERDUE_REMINDER_DAYS = [1, 3, 7];
export const DEFAULT_FINAL_REVIEW_NOTICE_DAYS = 30;

export const MAX_REMINDER_OFFSET_DAYS = 60;
export const MAX_REMINDER_OFFSETS = 10;

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

/** Parses a comma-separated list of whole-day offsets; null when invalid. */
export function parseOffsetList(raw: string, min: number, max: number = MAX_REMINDER_OFFSET_DAYS): number[] | null {
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length === 0 || parts.length > MAX_REMINDER_OFFSETS) return null;
  const values: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < min || n > max || values.includes(n)) return null;
    values.push(n);
  }
  return values;
}

export function loadReminderPolicy(env: Record<string, string | undefined> = process.env): LoadedReminderPolicy {
  const warnings: string[] = [];

  const list = (name: string, min: number, fallback: number[]) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const parsed = parseOffsetList(raw, min);
    if (parsed) return parsed;
    warnings.push(
      `${name} must be up to ${MAX_REMINDER_OFFSETS} unique whole numbers between ${min} and ${MAX_REMINDER_OFFSET_DAYS}; using the default ${fallback.join(",")}.`
    );
    return fallback;
  };

  const daysBefore = list("APPRAISAL_REMINDER_DAYS_BEFORE", 0, DEFAULT_REMINDER_DAYS_BEFORE);
  const overdueDays = list("APPRAISAL_OVERDUE_REMINDER_DAYS", 1, DEFAULT_OVERDUE_REMINDER_DAYS);

  let finalReviewNoticeDays = DEFAULT_FINAL_REVIEW_NOTICE_DAYS;
  const rawNotice = env.APPRAISAL_FINAL_REVIEW_NOTICE_DAYS?.trim();
  if (rawNotice) {
    const n = /^\d+$/.test(rawNotice) ? Number(rawNotice) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= 90) finalReviewNoticeDays = n;
    else
      warnings.push(
        `APPRAISAL_FINAL_REVIEW_NOTICE_DAYS must be a whole number between 1 and 90; using the default ${DEFAULT_FINAL_REVIEW_NOTICE_DAYS}.`
      );
  }

  return {
    daysBefore: [...daysBefore].sort((a, b) => b - a),
    overdueDays: [...overdueDays].sort((a, b) => a - b),
    finalReviewNoticeDays,
    warnings,
  };
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
