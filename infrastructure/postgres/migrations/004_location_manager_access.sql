BEGIN;

-- Location Manager is a real, persisted role. Scope is kept in its own table
-- so changing a person's access never rewrites the immutable operational record.
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('organization_owner', 'operations_administrator', 'location_manager', 'read_only_reviewer', 'support'));

CREATE TABLE IF NOT EXISTS admin_user_locations (
  tenant_id UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  location_id UUID NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  assigned_by UUID,
  PRIMARY KEY (tenant_id, user_id, location_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES admin_users (tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, location_id) REFERENCES locations (tenant_id, location_id) ON DELETE RESTRICT,
  -- Keep the assigning account in the audit relationship. Accounts are disabled
  -- rather than deleted, so a future hard-delete must first reassign this history.
  FOREIGN KEY (tenant_id, assigned_by) REFERENCES admin_users (tenant_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS admin_user_locations_location_idx
  ON admin_user_locations (tenant_id, location_id, user_id);

ALTER TABLE admin_user_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_user_locations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'admin_user_locations'
       AND policyname = 'admin_user_locations_isolation'
  ) THEN
    CREATE POLICY admin_user_locations_isolation ON admin_user_locations
      USING (tenant_id = stacktrack_current_tenant())
      WITH CHECK (tenant_id = stacktrack_current_tenant());
  END IF;
END;
$$;

COMMIT;
