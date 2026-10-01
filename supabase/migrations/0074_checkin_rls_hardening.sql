-- --------------------------------------------------
-- CHECK-IN / MID-YEAR RLS HARDENING AND LOCKS
-- 0052 left check_ins and check_in_responses open to every role (FOR ALL USING (true)).
-- Users sign in through NextAuth (Azure AD), not Supabase Auth, and the application reads and
-- writes these tables only from server routes with the service role; those routes enforce the
-- employee / manager / delegate / HR rules. Access is therefore service-role-only:
--   * the permissive policies are removed,
--   * service_role gets explicit full access (same pattern as 0066),
--   * anon loses every privilege, so no check-in or score data is readable anonymously,
--   * authenticated has no new policy, so RLS denies it reads and writes. The existing HR/admin
--     SELECT policies from 0070, 0072 and 0073 are left as they are.
-- --------------------------------------------------

DROP POLICY IF EXISTS "check_ins_access" ON public.check_ins;
DROP POLICY IF EXISTS "check_in_responses_access" ON public.check_in_responses;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'check_ins',
    'check_in_responses',
    'check_in_competency_ratings',
    'appraisal_score_snapshots',
    'midyear_window_notices'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('DROP POLICY IF EXISTS service_role_full_access ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY service_role_full_access ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- --------------------------------------------------
-- Completed formal Mid-Year Reviews are locked in the database as well as in the API.
-- The only way to change one is the explicit correction path: a transaction that runs
--   SET LOCAL app.midyear_correction = 'on';
-- before its statements. Deletes (e.g. an appraisal being removed) are not blocked.
-- --------------------------------------------------

CREATE OR REPLACE FUNCTION public.midyear_correction_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(current_setting('app.midyear_correction', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION public.guard_completed_midyear_check_in()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.review_mode IS DISTINCT FROM 'INFORMAL' AND OLD.status = 'COMPLETE' AND NOT public.midyear_correction_enabled() THEN
    RAISE EXCEPTION 'midyear_review_locked: completed Mid-Year Review % cannot be changed', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_completed_midyear_child()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ids uuid[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    ids := ARRAY[OLD.check_in_id, NEW.check_in_id];
  ELSE
    ids := ARRAY[NEW.check_in_id];
  END IF;
  IF NOT public.midyear_correction_enabled() AND EXISTS (
    SELECT 1 FROM public.check_ins c
    WHERE c.id = ANY(ids) AND c.review_mode IS DISTINCT FROM 'INFORMAL' AND c.status = 'COMPLETE'
  ) THEN
    RAISE EXCEPTION 'midyear_review_locked: completed Mid-Year Review cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_guard_completed_midyear_check_in ON public.check_ins;
CREATE TRIGGER trg_guard_completed_midyear_check_in
  BEFORE UPDATE ON public.check_ins
  FOR EACH ROW EXECUTE FUNCTION public.guard_completed_midyear_check_in();

DROP TRIGGER IF EXISTS trg_guard_completed_midyear_responses ON public.check_in_responses;
CREATE TRIGGER trg_guard_completed_midyear_responses
  BEFORE INSERT OR UPDATE ON public.check_in_responses
  FOR EACH ROW EXECUTE FUNCTION public.guard_completed_midyear_child();

DROP TRIGGER IF EXISTS trg_guard_completed_midyear_competencies ON public.check_in_competency_ratings;
CREATE TRIGGER trg_guard_completed_midyear_competencies
  BEFORE INSERT OR UPDATE ON public.check_in_competency_ratings
  FOR EACH ROW EXECUTE FUNCTION public.guard_completed_midyear_child();
