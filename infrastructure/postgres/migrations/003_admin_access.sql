BEGIN;

CREATE TABLE IF NOT EXISTS admin_users (
  tenant_id UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  user_id UUID NOT NULL DEFAULT gen_random_uuid(),
  username TEXT NOT NULL CHECK (username = lower(username) AND username ~ '^[a-z0-9._-]{3,64}$'),
  display_name TEXT NOT NULL CHECK (char_length(trim(display_name)) BETWEEN 2 AND 120),
  role TEXT NOT NULL CHECK (role IN ('organization_owner', 'operations_administrator', 'read_only_reviewer', 'support')),
  password_hash TEXT,
  entra_object_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  support_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, user_id),
  UNIQUE (tenant_id, username),
  UNIQUE (tenant_id, entra_object_id),
  CHECK ((password_hash IS NOT NULL) OR (entra_object_id IS NOT NULL)),
  CHECK ((role <> 'support') OR support_expires_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  tenant_id UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  session_id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, session_id),
  UNIQUE (token_sha256),
  FOREIGN KEY (tenant_id, user_id) REFERENCES admin_users (tenant_id, user_id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS admin_sessions_lookup_idx
  ON admin_sessions (tenant_id, token_sha256)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS admin_users_active_idx
  ON admin_users (tenant_id, role, username)
  WHERE is_active;

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users FORCE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'admin_users' AND policyname = 'admin_users_isolation') THEN
    CREATE POLICY admin_users_isolation ON admin_users
      USING (tenant_id = stacktrack_current_tenant())
      WITH CHECK (tenant_id = stacktrack_current_tenant());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'admin_sessions' AND policyname = 'admin_sessions_isolation') THEN
    CREATE POLICY admin_sessions_isolation ON admin_sessions
      USING (tenant_id = stacktrack_current_tenant())
      WITH CHECK (tenant_id = stacktrack_current_tenant());
  END IF;
END;
$$;

COMMIT;
