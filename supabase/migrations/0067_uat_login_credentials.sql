-- UAT-only username/password login (gated by ENABLE_UAT_CREDENTIALS in the app).
-- Does not affect Azure AD SSO. Passwords are set via scripts/set-uat-password.mjs.

CREATE TABLE IF NOT EXISTS uat_login_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uat_login_credentials_app_user_id_key UNIQUE (app_user_id)
);

CREATE INDEX IF NOT EXISTS idx_uat_login_credentials_app_user_id
  ON uat_login_credentials(app_user_id);

ALTER TABLE uat_login_credentials ENABLE ROW LEVEL SECURITY;

-- No client policies: app uses service role for credential verification only.
