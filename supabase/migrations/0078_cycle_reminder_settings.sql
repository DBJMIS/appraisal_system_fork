-- --------------------------------------------------
-- APPRAISAL REMINDERS: per-cycle reminder timing, set by HR/Admin under
-- Cycle Settings. Replaces the APPRAISAL_REMINDER_DAYS_BEFORE,
-- APPRAISAL_OVERDUE_REMINDER_DAYS and APPRAISAL_FINAL_REVIEW_NOTICE_DAYS
-- environment variables. Defaults keep every existing cycle on the current
-- reminder policy (7, 3, 1 and 0 days before due; 1, 3 and 7 days overdue;
-- Final Review notice 30 days before cycle end).
-- Duplicate values are rejected by the application; the planner ignores an
-- invalid stored value and uses the default for that field.
-- --------------------------------------------------

ALTER TABLE public.appraisal_cycles
  ADD COLUMN IF NOT EXISTS reminder_days_before     INTEGER[] NOT NULL DEFAULT '{7,3,1,0}',
  ADD COLUMN IF NOT EXISTS overdue_reminder_days    INTEGER[] NOT NULL DEFAULT '{1,3,7}',
  ADD COLUMN IF NOT EXISTS final_review_notice_days INTEGER   NOT NULL DEFAULT 30;

ALTER TABLE public.appraisal_cycles DROP CONSTRAINT IF EXISTS appraisal_cycles_reminder_days_before_check;
ALTER TABLE public.appraisal_cycles
  ADD CONSTRAINT appraisal_cycles_reminder_days_before_check
  CHECK (
    array_ndims(reminder_days_before) = 1
    AND cardinality(reminder_days_before) BETWEEN 1 AND 10
    AND array_position(reminder_days_before, NULL) IS NULL
    AND 0 <= ALL (reminder_days_before)
    AND 60 >= ALL (reminder_days_before)
  );

ALTER TABLE public.appraisal_cycles DROP CONSTRAINT IF EXISTS appraisal_cycles_overdue_reminder_days_check;
ALTER TABLE public.appraisal_cycles
  ADD CONSTRAINT appraisal_cycles_overdue_reminder_days_check
  CHECK (
    array_ndims(overdue_reminder_days) = 1
    AND cardinality(overdue_reminder_days) BETWEEN 1 AND 10
    AND array_position(overdue_reminder_days, NULL) IS NULL
    AND 1 <= ALL (overdue_reminder_days)
    AND 60 >= ALL (overdue_reminder_days)
  );

ALTER TABLE public.appraisal_cycles DROP CONSTRAINT IF EXISTS appraisal_cycles_final_review_notice_days_check;
ALTER TABLE public.appraisal_cycles
  ADD CONSTRAINT appraisal_cycles_final_review_notice_days_check
  CHECK (final_review_notice_days BETWEEN 1 AND 90);

COMMENT ON COLUMN public.appraisal_cycles.reminder_days_before IS 'Days before a due date on which reminders are sent (0 = on the due date).';
COMMENT ON COLUMN public.appraisal_cycles.overdue_reminder_days IS 'Days after a due date on which overdue reminders are sent; reminders stop after the last value.';
COMMENT ON COLUMN public.appraisal_cycles.final_review_notice_days IS 'Days before cycle end when the Final Review availability notice is sent.';
