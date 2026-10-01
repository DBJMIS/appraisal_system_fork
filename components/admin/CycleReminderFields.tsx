"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MIN_DAYS_BEFORE,
  MIN_OVERDUE_DAYS,
  parseFinalReviewNoticeText,
  parseReminderDaysText,
  sortDaysBefore,
  sortOverdueDays,
} from "@/lib/appraisal-reminder-policy";
import type { CycleForm } from "./admin-shared";

type ReminderForm = Pick<CycleForm, "reminder_days_before" | "overdue_reminder_days" | "final_review_notice_days">;

const LABELS = {
  before: "Due reminders",
  overdue: "Overdue reminders",
  notice: "Final Review notice",
} as const;

interface CycleReminderFieldsProps {
  value: ReminderForm;
  onChange: (patch: Partial<ReminderForm>) => void;
  /** Closed/archived cycles: settings are shown read-only. */
  locked?: boolean;
}

const chipLabel = (n: number, overdue: boolean) =>
  overdue ? `${n}d overdue` : n === 0 ? "On due date" : `${n}d before`;

function DayChips({ days, overdue }: { days: number[]; overdue: boolean }) {
  return (
    <div className="flex flex-wrap gap-1" aria-hidden="true">
      {days.map((n) => (
        <span
          key={n}
          data-reminder-chip
          className="inline-flex items-center rounded-ds-badge border border-ds-border bg-ds-surface px-1.5 py-0.5 text-[11px] leading-4 text-ds-text-secondary"
        >
          {chipLabel(n, overdue)}
        </span>
      ))}
    </div>
  );
}

function DaysField({
  id,
  label,
  help,
  raw,
  min,
  overdue,
  locked,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  raw: string;
  min: number;
  overdue: boolean;
  locked: boolean;
  onChange: (raw: string) => void;
}) {
  const parsed = parseReminderDaysText(raw, min, label);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        data-reminder-input={id}
        inputMode="numeric"
        disabled={locked}
        value={raw}
        aria-invalid={parsed.error ? true : undefined}
        aria-describedby={parsed.error ? `${helpId} ${errorId}` : helpId}
        onChange={(e) => onChange(e.target.value)}
      />
      {parsed.value && <DayChips days={overdue ? sortOverdueDays(parsed.value) : sortDaysBefore(parsed.value)} overdue={overdue} />}
      <p id={helpId} className="text-[11px] leading-[1.45] text-ds-text-secondary">{help}</p>
      {parsed.error && (
        <p id={errorId} data-reminder-error={id} className="text-[11px] leading-[1.45] text-ds-error">
          {parsed.error}
        </p>
      )}
    </div>
  );
}

export function CycleReminderFields({ value, onChange, locked = false }: CycleReminderFieldsProps) {
  const notice = parseFinalReviewNoticeText(value.final_review_notice_days, LABELS.notice);
  return (
    <div data-reminder-section className="space-y-3 rounded-ds-panel border border-ds-border px-3 py-3">
      <p className="text-[13px] font-semibold leading-[1.4] text-ds-text-primary">Reminder settings</p>
      <DaysField
        id="reminder-days-before"
        label={LABELS.before}
        help="Days before the due date, separated by commas. 0 means on the due date."
        raw={value.reminder_days_before}
        min={MIN_DAYS_BEFORE}
        overdue={false}
        locked={locked}
        onChange={(raw) => onChange({ reminder_days_before: raw })}
      />
      <DaysField
        id="overdue-reminder-days"
        label={LABELS.overdue}
        help="Days after the due date. Overdue reminders stop after the last configured day."
        raw={value.overdue_reminder_days}
        min={MIN_OVERDUE_DAYS}
        overdue
        locked={locked}
        onChange={(raw) => onChange({ overdue_reminder_days: raw })}
      />
      <div className="space-y-1">
        <Label htmlFor="final-review-notice-days" className="text-xs">{LABELS.notice}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="final-review-notice-days"
            data-reminder-input="final-review-notice-days"
            inputMode="numeric"
            className="w-20"
            disabled={locked}
            value={value.final_review_notice_days}
            aria-invalid={notice.error ? true : undefined}
            aria-describedby={notice.error ? "final-review-notice-days-help final-review-notice-days-error" : "final-review-notice-days-help"}
            onChange={(e) => onChange({ final_review_notice_days: e.target.value })}
          />
          <span className="text-[13px] text-ds-text-secondary">days before cycle end</span>
        </div>
        <p id="final-review-notice-days-help" className="text-[11px] leading-[1.45] text-ds-text-secondary">
          When employees are first told their Final Review is available.
        </p>
        {notice.error && (
          <p id="final-review-notice-days-error" data-reminder-error="final-review-notice-days" className="text-[11px] leading-[1.45] text-ds-error">
            {notice.error}
          </p>
        )}
      </div>
      {locked && (
        <p className="text-xs leading-[1.45] text-ds-text-secondary">
          Reminder settings can&apos;t be changed on a closed or archived cycle.
        </p>
      )}
    </div>
  );
}

/** Client-side check of the reminder inputs; returns the first error message or null. */
export function validateReminderForm(form: ReminderForm): string | null {
  return (
    parseReminderDaysText(form.reminder_days_before, MIN_DAYS_BEFORE, LABELS.before).error ??
    parseReminderDaysText(form.overdue_reminder_days, MIN_OVERDUE_DAYS, LABELS.overdue).error ??
    parseFinalReviewNoticeText(form.final_review_notice_days, LABELS.notice).error
  );
}

/** Request fields for the reminder settings; call only after validateReminderForm passes. */
export function reminderRequestFields(form: ReminderForm): {
  reminder_days_before: number[];
  overdue_reminder_days: number[];
  final_review_notice_days: number;
} {
  return {
    reminder_days_before: sortDaysBefore(parseReminderDaysText(form.reminder_days_before, MIN_DAYS_BEFORE, LABELS.before).value ?? []),
    overdue_reminder_days: sortOverdueDays(parseReminderDaysText(form.overdue_reminder_days, MIN_OVERDUE_DAYS, LABELS.overdue).value ?? []),
    final_review_notice_days: parseFinalReviewNoticeText(form.final_review_notice_days, LABELS.notice).value ?? 0,
  };
}
