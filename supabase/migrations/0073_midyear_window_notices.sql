-- --------------------------------------------------
-- MID-YEAR WINDOW NOTICES
-- Ledger of "Mid-Year Review is now open" notices sent to managers. A row is claimed before the
-- notice is sent, so each recipient is notified at most once per appraisal however often the job
-- runs. Written only by the server with the service role.
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.midyear_window_notices (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id           UUID NOT NULL REFERENCES public.appraisals(id) ON DELETE CASCADE,
  cycle_id               UUID NULL REFERENCES public.appraisal_cycles(id) ON DELETE SET NULL,
  recipient_employee_id  TEXT NOT NULL,
  sent_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT midyear_window_notices_appraisal_recipient_key UNIQUE (appraisal_id, recipient_employee_id)
);

ALTER TABLE public.midyear_window_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS midyear_window_notices_select_hr_admin ON public.midyear_window_notices;
CREATE POLICY midyear_window_notices_select_hr_admin
ON public.midyear_window_notices
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('hr', 'admin'))
);

COMMENT ON TABLE public.midyear_window_notices IS
  'One row per Mid-Year window-open notice sent (unique per appraisal and recipient); makes the notice idempotent.';
