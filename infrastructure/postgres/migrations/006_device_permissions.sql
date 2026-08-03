BEGIN;

-- Device capabilities are explicit named keys.  The installation role is
-- resolved at authentication time so an administrator can change a role
-- without rewriting the immutable event history.
ALTER TABLE device_installations
  ADD COLUMN IF NOT EXISTS device_role TEXT NOT NULL DEFAULT 'field_scanner';

CREATE TABLE IF NOT EXISTS device_roles (
  tenant_id UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  role_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, role_key)
);

CREATE TABLE IF NOT EXISTS device_role_permissions (
  tenant_id UUID NOT NULL,
  role_key TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, role_key, permission_key),
  FOREIGN KEY (tenant_id, role_key)
    REFERENCES device_roles (tenant_id, role_key) ON DELETE CASCADE,
  CHECK (permission_key IN (
    'reference_data.read',
    'observation.create',
    'load_code.lookup',
    'telemetry.report'
  ))
);

CREATE INDEX IF NOT EXISTS device_role_permissions_lookup_idx
  ON device_role_permissions (tenant_id, role_key, permission_key);

-- Existing pilot installations receive the least-privilege field-scanner
-- role.  Future roles can be added by corporate administration without a
-- schema change.
INSERT INTO device_roles (tenant_id, role_key, display_name)
SELECT tenant_id, 'field_scanner', 'Field scanner'
  FROM tenants
ON CONFLICT (tenant_id, role_key) DO NOTHING;

INSERT INTO device_role_permissions (tenant_id, role_key, permission_key)
SELECT tenant_id, 'field_scanner', permission_key
  FROM tenants
  CROSS JOIN unnest(ARRAY[
    'reference_data.read',
    'observation.create',
    'load_code.lookup',
    'telemetry.report'
  ]::TEXT[]) AS permission_key
ON CONFLICT (tenant_id, role_key, permission_key) DO NOTHING;

ALTER TABLE device_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE device_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_role_permissions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'device_roles'
       AND policyname = 'device_roles_isolation'
  ) THEN
    CREATE POLICY device_roles_isolation ON device_roles
      USING (tenant_id = stacktrack_current_tenant())
      WITH CHECK (tenant_id = stacktrack_current_tenant());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'device_role_permissions'
       AND policyname = 'device_role_permissions_isolation'
  ) THEN
    CREATE POLICY device_role_permissions_isolation ON device_role_permissions
      USING (tenant_id = stacktrack_current_tenant())
      WITH CHECK (tenant_id = stacktrack_current_tenant());
  END IF;
END;
$$;

COMMIT;
