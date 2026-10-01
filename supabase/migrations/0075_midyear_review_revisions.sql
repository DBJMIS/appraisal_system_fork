-- --------------------------------------------------
-- MID-YEAR REVIEW REVISIONS
-- A completed formal Mid-Year Review stays locked (0074). The only correction path is an explicit
-- reopen, done by reopen_midyear_review() in one transaction:
--   * the review returns to EMPLOYEE_SUBMITTED, the existing state in which the manager edits the
--     manager portion; the employee portion stays as submitted,
--   * who reopened it, when, why and the revision number are recorded in midyear_review_revisions,
--   * the current MIDYEAR score snapshot is marked superseded (kept, not deleted).
-- Completing the revised review writes a new MIDYEAR snapshot row with the next revision number.
-- FINAL keeps exactly one row per appraisal (revision 1, never superseded).
-- Written only by the server with the service role.
-- --------------------------------------------------

-- ── Score snapshot revisions ─────────────────────────────────────────────────

ALTER TABLE public.appraisal_score_snapshots
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS superseded_by TEXT NULL;

ALTER TABLE public.appraisal_score_snapshots DROP CONSTRAINT IF EXISTS appraisal_score_snapshots_appraisal_score_type_key;
ALTER TABLE public.appraisal_score_snapshots DROP CONSTRAINT IF EXISTS appraisal_score_snapshots_revision_key;
ALTER TABLE public.appraisal_score_snapshots
  ADD CONSTRAINT appraisal_score_snapshots_revision_key UNIQUE (appraisal_id, score_type, revision);

ALTER TABLE public.appraisal_score_snapshots DROP CONSTRAINT IF EXISTS appraisal_score_snapshots_revision_check;
ALTER TABLE public.appraisal_score_snapshots
  ADD CONSTRAINT appraisal_score_snapshots_revision_check CHECK (revision >= 1);

ALTER TABLE public.appraisal_score_snapshots DROP CONSTRAINT IF EXISTS appraisal_score_snapshots_final_single_revision;
ALTER TABLE public.appraisal_score_snapshots
  ADD CONSTRAINT appraisal_score_snapshots_final_single_revision
  CHECK (score_type <> 'FINAL' OR (revision = 1 AND superseded_at IS NULL));

ALTER TABLE public.appraisal_score_snapshots DROP CONSTRAINT IF EXISTS appraisal_score_snapshots_superseded_by_check;
ALTER TABLE public.appraisal_score_snapshots
  ADD CONSTRAINT appraisal_score_snapshots_superseded_by_check CHECK (superseded_by IS NULL OR superseded_at IS NOT NULL);

-- Exactly one current (not superseded) snapshot per appraisal and score type.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appraisal_score_snapshots_one_current
  ON public.appraisal_score_snapshots (appraisal_id, score_type)
  WHERE superseded_at IS NULL;

-- A recorded MIDYEAR revision is never edited. It may only be marked superseded once, and its
-- check-in link may be cleared when the check-in is deleted (ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION public.guard_midyear_score_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.score_type <> 'MIDYEAR' THEN
    RETURN NEW;
  END IF;
  IF (NEW.check_in_id IS DISTINCT FROM OLD.check_in_id AND NEW.check_in_id IS NOT NULL)
     OR (to_jsonb(NEW) - 'superseded_at' - 'superseded_by' - 'check_in_id')
        IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at' - 'superseded_by' - 'check_in_id')
     OR (OLD.superseded_at IS NOT NULL
         AND (NEW.superseded_at IS DISTINCT FROM OLD.superseded_at OR NEW.superseded_by IS DISTINCT FROM OLD.superseded_by)) THEN
    RAISE EXCEPTION 'midyear_score_revision_immutable: Mid-Year score revision % cannot be changed', OLD.revision
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_midyear_score_revision ON public.appraisal_score_snapshots;
CREATE TRIGGER trg_guard_midyear_score_revision
  BEFORE UPDATE ON public.appraisal_score_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.guard_midyear_score_revision();

COMMENT ON TABLE public.appraisal_score_snapshots IS
  'Point-in-time copies of the canonical appraisal score (calcSummary). FINAL: one row per appraisal (revision 1). MIDYEAR: one row per revision; earlier revisions are kept with superseded_at set.';

-- ── Revision records ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.midyear_review_revisions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_in_id             UUID NOT NULL REFERENCES public.check_ins(id) ON DELETE CASCADE,
  appraisal_id            UUID NOT NULL REFERENCES public.appraisals(id) ON DELETE CASCADE,
  -- The review version being prepared: 2 for the first reopen (the original completion is 1).
  revision_number         INTEGER NOT NULL,
  reopened_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  reopened_by             TEXT NOT NULL,
  reopened_by_name        TEXT NULL,
  reopen_reason           TEXT NOT NULL,
  -- MIDYEAR snapshot revision that this reopen superseded (NULL for unscored reviews).
  previous_score_revision INTEGER NULL,
  completed_at            TIMESTAMPTZ NULL,
  completed_by            TEXT NULL,
  -- MIDYEAR snapshot revision recorded when the revised review was completed.
  score_revision          INTEGER NULL,
  CONSTRAINT midyear_review_revisions_number_check CHECK (revision_number >= 2),
  CONSTRAINT midyear_review_revisions_reason_check CHECK (length(btrim(reopen_reason)) BETWEEN 1 AND 2000),
  CONSTRAINT midyear_review_revisions_completion_check CHECK (completed_at IS NOT NULL OR (completed_by IS NULL AND score_revision IS NULL)),
  CONSTRAINT midyear_review_revisions_check_in_number_key UNIQUE (check_in_id, revision_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_midyear_review_revisions_one_open
  ON public.midyear_review_revisions (check_in_id)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_midyear_review_revisions_appraisal_id
  ON public.midyear_review_revisions (appraisal_id);

-- The reopen facts never change; an open revision may only be completed, once.
CREATE OR REPLACE FUNCTION public.guard_midyear_review_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.completed_at IS NOT NULL
     OR (to_jsonb(NEW) - 'completed_at' - 'completed_by' - 'score_revision')
        IS DISTINCT FROM (to_jsonb(OLD) - 'completed_at' - 'completed_by' - 'score_revision') THEN
    RAISE EXCEPTION 'midyear_revision_immutable: Mid-Year Review revision % cannot be changed', OLD.revision_number
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_midyear_review_revision ON public.midyear_review_revisions;
CREATE TRIGGER trg_guard_midyear_review_revision
  BEFORE UPDATE ON public.midyear_review_revisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_midyear_review_revision();

ALTER TABLE public.midyear_review_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.midyear_review_revisions FROM anon;
DROP POLICY IF EXISTS service_role_full_access ON public.midyear_review_revisions;
CREATE POLICY service_role_full_access ON public.midyear_review_revisions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.midyear_review_revisions IS
  'One row per reopening of a completed formal Mid-Year Review: who, when, why, revision number, and the score revisions superseded and recorded.';

-- ── Reopen ───────────────────────────────────────────────────────────────────

-- Callers (the API) check who may reopen; this function enforces the state rules atomically.
CREATE OR REPLACE FUNCTION public.reopen_midyear_review(
  p_check_in_id UUID,
  p_actor TEXT,
  p_actor_name TEXT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_check_in public.check_ins%ROWTYPE;
  v_appraisal_status TEXT;
  v_reason TEXT := btrim(coalesce(p_reason, ''));
  v_revision INTEGER;
  v_previous INTEGER;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'midyear_reopen_actor_required' USING ERRCODE = 'check_violation';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION 'midyear_reopen_reason_required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_check_in FROM public.check_ins WHERE id = p_check_in_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'midyear_reopen_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_check_in.review_mode IS NULL OR v_check_in.review_mode = 'INFORMAL' THEN
    RAISE EXCEPTION 'midyear_reopen_not_formal' USING ERRCODE = 'check_violation';
  END IF;
  IF v_check_in.status <> 'COMPLETE' THEN
    RAISE EXCEPTION 'midyear_reopen_not_complete' USING ERRCODE = 'check_violation';
  END IF;

  SELECT status INTO v_appraisal_status FROM public.appraisals WHERE id = v_check_in.appraisal_id FOR UPDATE;
  IF v_appraisal_status IS DISTINCT FROM 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'midyear_reopen_appraisal_locked' USING ERRCODE = 'check_violation';
  END IF;

  -- A revision left open by an interrupted completion is closed before the next one starts.
  UPDATE public.midyear_review_revisions SET completed_at = v_now
  WHERE check_in_id = p_check_in_id AND completed_at IS NULL;

  SELECT coalesce(max(r.revision_number), 1) + 1 INTO v_revision
  FROM public.midyear_review_revisions r
  WHERE r.check_in_id = p_check_in_id;

  UPDATE public.appraisal_score_snapshots s
  SET superseded_at = v_now, superseded_by = p_actor
  WHERE s.appraisal_id = v_check_in.appraisal_id
    AND s.score_type = 'MIDYEAR'
    AND s.check_in_id = p_check_in_id
    AND s.superseded_at IS NULL
  RETURNING s.revision INTO v_previous;

  PERFORM set_config('app.midyear_correction', 'on', true);
  UPDATE public.check_ins SET status = 'EMPLOYEE_SUBMITTED', updated_at = v_now WHERE id = p_check_in_id;
  PERFORM set_config('app.midyear_correction', '', true);

  INSERT INTO public.midyear_review_revisions
    (check_in_id, appraisal_id, revision_number, reopened_at, reopened_by, reopened_by_name, reopen_reason, previous_score_revision)
  VALUES
    (p_check_in_id, v_check_in.appraisal_id, v_revision, v_now, p_actor, nullif(btrim(coalesce(p_actor_name, '')), ''), v_reason, v_previous);

  RETURN jsonb_build_object('revision_number', v_revision, 'reopened_at', v_now, 'previous_score_revision', v_previous);
END
$$;

REVOKE ALL ON FUNCTION public.reopen_midyear_review(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_midyear_review(UUID, TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_midyear_review(UUID, TEXT, TEXT, TEXT) TO service_role;
