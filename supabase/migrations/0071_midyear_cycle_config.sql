-- --------------------------------------------------
-- MID-YEAR REVIEW: per-cycle configuration and check-in review mode.
-- Defaults keep every existing cycle and check-in on current behaviour
-- (Mid-Year Review off, all check-ins INFORMAL).
-- --------------------------------------------------

ALTER TABLE public.appraisal_cycles
  ADD COLUMN IF NOT EXISTS midyear_review_enabled  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS midyear_scoring_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS midyear_window_start    DATE NULL,
  ADD COLUMN IF NOT EXISTS midyear_due_date        DATE NULL;

ALTER TABLE public.appraisal_cycles DROP CONSTRAINT IF EXISTS appraisal_cycles_midyear_scoring_requires_review;
ALTER TABLE public.appraisal_cycles
  ADD CONSTRAINT appraisal_cycles_midyear_scoring_requires_review
  CHECK (NOT midyear_scoring_enabled OR midyear_review_enabled);

ALTER TABLE public.appraisal_cycles DROP CONSTRAINT IF EXISTS appraisal_cycles_midyear_dates_order;
ALTER TABLE public.appraisal_cycles
  ADD CONSTRAINT appraisal_cycles_midyear_dates_order
  CHECK (midyear_window_start IS NULL OR midyear_due_date IS NULL OR midyear_due_date >= midyear_window_start);

ALTER TABLE public.check_ins
  ADD COLUMN IF NOT EXISTS review_mode TEXT NOT NULL DEFAULT 'INFORMAL';

ALTER TABLE public.check_ins DROP CONSTRAINT IF EXISTS check_ins_review_mode_check;
ALTER TABLE public.check_ins
  ADD CONSTRAINT check_ins_review_mode_check
  CHECK (review_mode IN ('INFORMAL', 'FORMAL', 'FORMAL_SCORED'));

-- Only Mid-Year check-ins can be formal; Quarterly and Ad hoc stay informal.
ALTER TABLE public.check_ins DROP CONSTRAINT IF EXISTS check_ins_formal_only_midyear;
ALTER TABLE public.check_ins
  ADD CONSTRAINT check_ins_formal_only_midyear
  CHECK (review_mode = 'INFORMAL' OR check_in_type = 'MIDYEAR');

-- One formal Mid-Year Review per appraisal (cancelled ones excluded).
CREATE UNIQUE INDEX IF NOT EXISTS idx_check_ins_one_formal_midyear_per_appraisal
  ON public.check_ins(appraisal_id)
  WHERE review_mode <> 'INFORMAL' AND status <> 'CANCELLED';

COMMENT ON COLUMN public.appraisal_cycles.midyear_review_enabled IS 'Formal Mid-Year Review available for appraisals in this cycle.';
COMMENT ON COLUMN public.appraisal_cycles.midyear_scoring_enabled IS 'Formal Mid-Year Review is scored (requires midyear_review_enabled).';
COMMENT ON COLUMN public.check_ins.review_mode IS 'INFORMAL (progress check-in), FORMAL (Mid-Year Review) or FORMAL_SCORED (scored Mid-Year Review).';
