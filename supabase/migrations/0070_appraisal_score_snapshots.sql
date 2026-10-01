-- --------------------------------------------------
-- APPRAISAL SCORE SNAPSHOTS
-- Durable copies of the canonical score (lib/summary-calc.ts calcSummary) at a point in time.
-- One row per appraisal per score_type. FINAL is written when the sign-off PDF is generated.
-- `inputs` holds the SummaryCalcProps and `components` the ComponentScore[] used, so each
-- snapshot can be reproduced. Written only by the server with the service role.
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.appraisal_score_snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id        UUID NOT NULL REFERENCES public.appraisals(id) ON DELETE CASCADE,
  score_type          TEXT NOT NULL,
  check_in_id         UUID NULL REFERENCES public.check_ins(id) ON DELETE SET NULL,
  is_management_track BOOLEAN NOT NULL,
  total_points        NUMERIC NOT NULL,
  overall_grade       TEXT NULL,
  grade_label         TEXT NULL,
  cc_actual           NUMERIC NULL,
  cc_points           NUMERIC NULL,
  prod_actual         NUMERIC NULL,
  prod_points         NUMERIC NULL,
  technical_actual    NUMERIC NULL,
  technical_points    NUMERIC NULL,
  leadership_actual   NUMERIC NULL,
  leadership_points   NUMERIC NULL,
  workplan_actual     NUMERIC NULL,
  workplan_points     NUMERIC NULL,
  components          JSONB NOT NULL,
  inputs              JSONB NOT NULL,
  engine_version      TEXT NOT NULL,
  calculated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  calculated_by       TEXT NULL,
  CONSTRAINT appraisal_score_snapshots_score_type_check CHECK (score_type IN ('MIDYEAR', 'FINAL')),
  CONSTRAINT appraisal_score_snapshots_appraisal_score_type_key UNIQUE (appraisal_id, score_type)
);

CREATE INDEX IF NOT EXISTS idx_appraisal_score_snapshots_check_in_id
  ON public.appraisal_score_snapshots(check_in_id);

ALTER TABLE public.appraisal_score_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appraisal_score_snapshots_select_hr_admin ON public.appraisal_score_snapshots;
CREATE POLICY appraisal_score_snapshots_select_hr_admin
ON public.appraisal_score_snapshots
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role IN ('hr', 'admin'))
);

COMMENT ON TABLE public.appraisal_score_snapshots IS
  'Point-in-time copies of the canonical appraisal score (calcSummary). score_type MIDYEAR or FINAL; one row per appraisal per type.';
