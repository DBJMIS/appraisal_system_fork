"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CycleForm } from "./admin-shared";

type MidyearForm = Pick<
  CycleForm,
  "midyear_review_enabled" | "midyear_scoring_enabled" | "midyear_window_start" | "midyear_due_date"
>;

interface CycleMidyearFieldsProps {
  value: MidyearForm;
  onChange: (patch: Partial<MidyearForm>) => void;
  /** Closed/archived cycles: settings are shown read-only. */
  locked?: boolean;
}

export function CycleMidyearFields({ value, onChange, locked = false }: CycleMidyearFieldsProps) {
  const enabled = value.midyear_review_enabled;
  return (
    <div data-midyear-section className="space-y-3 rounded-ds-panel border border-ds-border px-3 py-3">
      <p className="text-[13px] font-semibold leading-[1.4] text-ds-text-primary">Mid-Year Review</p>
      <label className="flex items-center gap-2 text-[13px] text-ds-text-primary">
        <Checkbox
          data-midyear-review-toggle
          checked={enabled}
          disabled={locked}
          onCheckedChange={(checked) =>
            onChange(checked ? { midyear_review_enabled: true } : { midyear_review_enabled: false, midyear_scoring_enabled: false })
          }
        />
        Enable Mid-Year Review
      </label>
      <label className={`flex items-center gap-2 text-[13px] ${enabled ? "text-ds-text-primary" : "text-ds-text-secondary"}`}>
        <Checkbox
          data-midyear-scoring-toggle
          checked={enabled && value.midyear_scoring_enabled}
          disabled={locked || !enabled}
          onCheckedChange={(checked) => onChange({ midyear_scoring_enabled: checked })}
        />
        Enable Mid-Year Scoring
      </label>
      {enabled && (
        <div data-midyear-dates className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Review Window Start</Label>
            <Input
              type="date"
              data-midyear-window-start
              disabled={locked}
              value={value.midyear_window_start}
              onChange={(e) => onChange({ midyear_window_start: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Due Date</Label>
            <Input
              type="date"
              data-midyear-due-date
              disabled={locked}
              min={value.midyear_window_start || undefined}
              value={value.midyear_due_date}
              onChange={(e) => onChange({ midyear_due_date: e.target.value })}
            />
          </div>
        </div>
      )}
      {locked && (
        <p className="text-xs leading-[1.45] text-ds-text-secondary">
          Mid-Year settings can&apos;t be changed on a closed or archived cycle.
        </p>
      )}
    </div>
  );
}

/** Request fields for the Mid-Year settings; dates are only sent while the review is on. */
export function midyearRequestFields(form: MidyearForm): Record<string, boolean | string | null> {
  const enabled = form.midyear_review_enabled;
  return {
    midyear_review_enabled: enabled,
    midyear_scoring_enabled: enabled && form.midyear_scoring_enabled,
    ...(enabled
      ? { midyear_window_start: form.midyear_window_start || null, midyear_due_date: form.midyear_due_date || null }
      : {}),
  };
}

/** Client-side check mirroring the database constraints; returns an error message or null. */
export function validateMidyearForm(form: MidyearForm): string | null {
  if (!form.midyear_review_enabled) return null;
  if (form.midyear_window_start && form.midyear_due_date && form.midyear_due_date < form.midyear_window_start) {
    return "Mid-Year due date cannot be before the review window start.";
  }
  return null;
}
