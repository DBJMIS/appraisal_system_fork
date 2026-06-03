-- Ensure RLS is enabled on appraisal_delegations.
-- Fixes Supabase advisor "rls_disabled_in_public" when the table was created manually
-- (e.g. SQL editor) without ENABLE ROW LEVEL SECURITY.

ALTER TABLE public.appraisal_delegations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appraisal_delegations_manager_select ON public.appraisal_delegations;
CREATE POLICY appraisal_delegations_manager_select
ON public.appraisal_delegations
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.appraisals a
    WHERE a.id = appraisal_delegations.appraisal_id
      AND a.manager_employee_id = (
        SELECT employee_id
        FROM public.app_users
        WHERE id = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS appraisal_delegations_manager_insert ON public.appraisal_delegations;
CREATE POLICY appraisal_delegations_manager_insert
ON public.appraisal_delegations
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.appraisals a
    WHERE a.id = appraisal_delegations.appraisal_id
      AND a.manager_employee_id = (
        SELECT employee_id
        FROM public.app_users
        WHERE id = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS appraisal_delegations_manager_update ON public.appraisal_delegations;
CREATE POLICY appraisal_delegations_manager_update
ON public.appraisal_delegations
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.appraisals a
    WHERE a.id = appraisal_delegations.appraisal_id
      AND a.manager_employee_id = (
        SELECT employee_id
        FROM public.app_users
        WHERE id = auth.uid()
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.appraisals a
    WHERE a.id = appraisal_delegations.appraisal_id
      AND a.manager_employee_id = (
        SELECT employee_id
        FROM public.app_users
        WHERE id = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS appraisal_delegations_manager_delete ON public.appraisal_delegations;
CREATE POLICY appraisal_delegations_manager_delete
ON public.appraisal_delegations
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.appraisals a
    WHERE a.id = appraisal_delegations.appraisal_id
      AND a.manager_employee_id = (
        SELECT employee_id
        FROM public.app_users
        WHERE id = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS appraisal_delegations_delegate_read ON public.appraisal_delegations;
CREATE POLICY appraisal_delegations_delegate_read
ON public.appraisal_delegations
FOR SELECT
USING (
  delegated_to::text = (
    SELECT employee_id
    FROM public.app_users
    WHERE id = auth.uid()
  )
);
