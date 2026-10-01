-- --------------------------------------------------
-- MID-YEAR REVIEW: assessment input storage, kept separate from the annual tables.
-- Workplan inputs live on check_in_responses; competency inputs live in
-- check_in_competency_ratings. Weights and the management track are frozen
-- when a formal Mid-Year Review is created. Informal check-ins leave every new
-- column NULL, so their behaviour is unchanged. Writes no rows.
-- --------------------------------------------------

ALTER TABLE public.check_in_responses
  ADD COLUMN IF NOT EXISTS employee_actual_raw      NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS employee_completion_date DATE NULL,
  ADD COLUMN IF NOT EXISTS employee_result          NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS mgr_actual_raw           NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS mgr_completion_date      DATE NULL,
  ADD COLUMN IF NOT EXISTS mgr_result               NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS weight_snapshot          NUMERIC NULL;

ALTER TABLE public.check_in_responses DROP CONSTRAINT IF EXISTS check_in_responses_employee_result_range;
ALTER TABLE public.check_in_responses
  ADD CONSTRAINT check_in_responses_employee_result_range
  CHECK (employee_result IS NULL OR (employee_result >= 0 AND employee_result <= 100));

ALTER TABLE public.check_in_responses DROP CONSTRAINT IF EXISTS check_in_responses_mgr_result_range;
ALTER TABLE public.check_in_responses
  ADD CONSTRAINT check_in_responses_mgr_result_range
  CHECK (mgr_result IS NULL OR (mgr_result >= 0 AND mgr_result <= 100));

ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS is_management_track BOOLEAN NULL;

-- A formal Mid-Year Review always has its track frozen; informal check-ins have none.
ALTER TABLE public.check_ins DROP CONSTRAINT IF EXISTS check_ins_formal_track_frozen;
ALTER TABLE public.check_ins
  ADD CONSTRAINT check_ins_formal_track_frozen
  CHECK (review_mode = 'INFORMAL' OR is_management_track IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.check_in_competency_ratings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id             UUID NOT NULL REFERENCES public.check_ins(id) ON DELETE CASCADE,
  section                 TEXT NOT NULL,
  factor_id               UUID NULL REFERENCES public.evaluation_factors(id) ON DELETE SET NULL,
  technical_competency_id UUID NULL REFERENCES public.appraisal_technical_competencies(id) ON DELETE SET NULL,
  name_snapshot           TEXT NOT NULL,
  weight_snapshot         NUMERIC NOT NULL DEFAULT 0,
  display_order           INT NOT NULL DEFAULT 0,
  employee_rating_code    TEXT NULL,
  manager_rating_code     TEXT NULL,
  employee_comment        TEXT NULL,
  manager_comment         TEXT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT check_in_competency_ratings_section_check
    CHECK (section IN ('CORE', 'PRODUCTIVITY', 'TECHNICAL', 'LEADERSHIP')),
  -- Factor sections reference evaluation_factors; TECHNICAL references the appraisal's technical competency.
  CONSTRAINT check_in_competency_ratings_source_check
    CHECK (
      (section = 'TECHNICAL' AND factor_id IS NULL)
      OR (section <> 'TECHNICAL' AND technical_competency_id IS NULL)
    ),
  CONSTRAINT check_in_competency_ratings_employee_rating_check
    CHECK (employee_rating_code IS NULL OR employee_rating_code IN ('1','2','3','4','5','6','7','8','9','10')),
  CONSTRAINT check_in_competency_ratings_manager_rating_check
    CHECK (manager_rating_code IS NULL OR manager_rating_code IN ('1','2','3','4','5','6','7','8','9','10')),
  CONSTRAINT check_in_competency_ratings_weight_check CHECK (weight_snapshot >= 0),
  CONSTRAINT check_in_competency_ratings_factor_key UNIQUE (check_in_id, factor_id),
  CONSTRAINT check_in_competency_ratings_technical_key UNIQUE (check_in_id, technical_competency_id)
);

CREATE INDEX IF NOT EXISTS idx_check_in_competency_ratings_check_in_id
  ON public.check_in_competency_ratings(check_in_id);

-- Accessed through service-role API routes only; HR/admin may read directly.
ALTER TABLE public.check_in_competency_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS check_in_competency_ratings_select_hr_admin ON public.check_in_competency_ratings;
CREATE POLICY check_in_competency_ratings_select_hr_admin
  ON public.check_in_competency_ratings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE app_users.id = auth.uid() AND app_users.role IN ('hr', 'admin')
    )
  );

COMMENT ON TABLE public.check_in_competency_ratings IS
  'Mid-Year Review competency inputs (employee and manager ratings/comments) with the competency name and weight frozen at creation. Separate from appraisal_factor_ratings and appraisal_technical_competencies.';
COMMENT ON COLUMN public.check_in_responses.weight_snapshot IS 'Workplan item weight frozen when the formal Mid-Year Review was created.';
COMMENT ON COLUMN public.check_in_responses.employee_result IS 'Mid-Year employee result (0-100) from lib/metric-calc.ts.';
COMMENT ON COLUMN public.check_in_responses.mgr_result IS 'Mid-Year manager result (0-100) from lib/metric-calc.ts.';
COMMENT ON COLUMN public.check_ins.is_management_track IS 'Management track frozen when the formal Mid-Year Review was created; NULL for informal check-ins.';
