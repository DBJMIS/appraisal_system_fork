-- Supabase security linter (project qvbjqzghoinghipiauyx): RLS on public tables + view security.
-- Safe to re-run: drops service_role policy before recreate; ALTER VIEW is idempotent.
-- App server uses service role (bypasses RLS in PostgREST); explicit service_role policies
-- cover direct SQL and keep tables non-wide-open for anon/authenticated without other policies.

-- ---------------------------------------------------------------------------
-- PART 1 — Enable RLS on listed public tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.feedback_reviewer ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eq_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rating_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.development_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rating_scale ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appraisal_hr_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.development_profile_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievement_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_rating_scale ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_question ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.development_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.career_aspirations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_development_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_cycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievement_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reporting_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appraisal_delegations ENABLE ROW LEVEL SECURITY;

-- One permissive policy per table for role service_role (idempotent).
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'feedback_reviewer','eq_questions','audit_log','user_signatures',
    'recommendation_rules','feedback_audit_log','evaluation_categories',
    'rating_bands','development_profiles','evaluation_factors',
    'rating_scale','appraisal_hr_recommendations',
    'development_profile_snapshots','achievement_suggestions',
    'feedback_rating_scale','feedback_question','development_skills',
    'career_aspirations','evidence_items','app_users','ai_audit_log',
    'employee_development_profiles','feedback_cycle','feedback_participant',
    'achievement_timeline','employees','reporting_lines',
    'employee_sync_log','appraisal_delegations'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS service_role_full_access ON public.%I',
      t
    );
    EXECUTE format(
      'CREATE POLICY service_role_full_access ON public.%I
       FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- PART 2 — SECURITY DEFINER views → invoker (PostgreSQL 15+)
-- Keeps definitions and dependents; satisfies security_definer_view lint.
-- If your Postgres is older than 15, replace this section with DROP/CREATE from pg_views.
-- ---------------------------------------------------------------------------

ALTER VIEW public.workplan_approval_queue SET (security_invoker = true);
ALTER VIEW public.user_roles SET (security_invoker = true);
ALTER VIEW public.feedback_response_anonymous_aggregate SET (security_invoker = true);
ALTER VIEW public.appraisal_summary SET (security_invoker = true);

GRANT SELECT ON public.workplan_approval_queue TO service_role;
GRANT SELECT ON public.user_roles TO service_role;
GRANT SELECT ON public.feedback_response_anonymous_aggregate TO service_role;
GRANT SELECT ON public.appraisal_summary TO service_role;
