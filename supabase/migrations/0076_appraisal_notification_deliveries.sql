-- --------------------------------------------------
-- APPRAISAL NOTIFICATION DELIVERIES
-- Ledger of scheduled appraisal reminders (Mid-Year, Final Review, Manager Review). One row per
-- reminder occurrence, unique per appraisal, recipient and deterministic reminder key, so repeated
-- or overlapping reminder runs never create or send the same reminder twice. Rows track delivery
-- state and bounded retries only: no email bodies, scores, tokens or raw provider errors are kept
-- (error_code is a short sanitised code). Written only by the server with the service role.
-- Additive: creates one new table; no existing appraisal data is read, changed or removed.
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.appraisal_notification_deliveries (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id           UUID NOT NULL REFERENCES public.appraisals(id) ON DELETE CASCADE,
  cycle_id               UUID NULL REFERENCES public.appraisal_cycles(id) ON DELETE SET NULL,
  recipient_employee_id  TEXT NOT NULL,
  recipient_email        TEXT NULL,
  recipient_role         TEXT NOT NULL,
  notification_kind      TEXT NOT NULL,
  reminder_key           TEXT NOT NULL,
  offset_days            INTEGER NULL,
  due_date               DATE NULL,
  scheduled_for          DATE NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count          INTEGER NOT NULL DEFAULT 0,
  claim_token            UUID NULL,
  last_attempt_at        TIMESTAMPTZ NULL,
  sent_at                TIMESTAMPTZ NULL,
  next_retry_at          TIMESTAMPTZ NULL,
  error_code             TEXT NULL,
  in_app_notified_at     TIMESTAMPTZ NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT appraisal_notification_deliveries_occurrence_key UNIQUE (appraisal_id, recipient_employee_id, reminder_key),
  CONSTRAINT appraisal_notification_deliveries_status_check
    CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  CONSTRAINT appraisal_notification_deliveries_role_check
    CHECK (recipient_role IN ('employee', 'manager')),
  CONSTRAINT appraisal_notification_deliveries_kind_check
    CHECK (notification_kind ~ '^[A-Z_]{1,64}$'),
  CONSTRAINT appraisal_notification_deliveries_attempts_check
    CHECK (attempt_count >= 0),
  CONSTRAINT appraisal_notification_deliveries_error_code_check
    CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$'),
  CONSTRAINT appraisal_notification_deliveries_sent_at_check
    CHECK (status <> 'SENT' OR sent_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS appraisal_notification_deliveries_status_retry_idx
  ON public.appraisal_notification_deliveries (status, next_retry_at);

CREATE INDEX IF NOT EXISTS appraisal_notification_deliveries_appraisal_idx
  ON public.appraisal_notification_deliveries (appraisal_id);

ALTER TABLE public.appraisal_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appraisal_notification_deliveries FROM anon;

DROP POLICY IF EXISTS service_role_full_access ON public.appraisal_notification_deliveries;
CREATE POLICY service_role_full_access
ON public.appraisal_notification_deliveries
FOR ALL TO service_role
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS appraisal_notification_deliveries_select_hr_admin ON public.appraisal_notification_deliveries;
CREATE POLICY appraisal_notification_deliveries_select_hr_admin
ON public.appraisal_notification_deliveries
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('hr', 'admin'))
);

COMMENT ON TABLE public.appraisal_notification_deliveries IS
  'One row per scheduled appraisal reminder occurrence (unique per appraisal, recipient and reminder key); tracks delivery state and bounded retries. Holds no message content or scores.';
