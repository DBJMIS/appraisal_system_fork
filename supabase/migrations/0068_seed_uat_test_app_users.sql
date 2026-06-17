-- HR UAT test personas (passwords set separately via scripts/set-uat-password.mjs).
-- Does not modify existing users except matching email on conflict.

INSERT INTO app_users (aad_object_id, email, display_name, role, employee_id)
VALUES
  (
    'uat-persona-00000001-employee',
    'leonwull@dbankjm.com',
    'Leon Wull',
    'individual',
    'Employee1'
  ),
  (
    'uat-persona-00000002-manager',
    'millygates@dbankjm.com',
    'Milly Gates',
    'manager',
    'Employee2'
  ),
  (
    'uat-persona-00000003-gm',
    'winnyharper@dbankjm.com',
    'Winny Harper',
    'gm',
    'Employee3'
  )
ON CONFLICT (email) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  employee_id = COALESCE(EXCLUDED.employee_id, app_users.employee_id),
  is_active = true,
  updated_at = now();
