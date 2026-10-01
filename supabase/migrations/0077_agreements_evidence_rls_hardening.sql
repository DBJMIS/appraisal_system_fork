-- --------------------------------------------------
-- ADOBE AGREEMENT / WORKPLAN EVIDENCE RLS HARDENING
-- 0055 and 0057 left workplan_item_evidence and appraisal_agreements open to every role
-- (FOR ALL USING (true), no TO clause), so the public anon key could read and write them:
-- signed-PDF links and paths, decline reasons, evidence notes, links and storage paths.
-- The application reads and writes both tables only from server routes with the service role
-- (the browser evidence-count read now goes through /api/appraisals/[id]/workplan/evidence-counts).
-- Same pattern as 0074:
--   * the permissive policies are removed,
--   * service_role gets explicit full access,
--   * anon loses every privilege,
--   * authenticated has no policy, so RLS denies it.
-- Additive and idempotent; no data is changed. Apply on its own (not via db push).
-- --------------------------------------------------

DROP POLICY IF EXISTS "agreements_access" ON public.appraisal_agreements;
DROP POLICY IF EXISTS "workplan_evidence_access" ON public.workplan_item_evidence;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'appraisal_agreements',
    'workplan_item_evidence'
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
