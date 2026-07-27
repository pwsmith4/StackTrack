BEGIN;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS required_app_version TEXT NOT NULL DEFAULT '0.2.0';

ALTER TABLE device_installations
  ADD COLUMN IF NOT EXISTS last_reported_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reported_app_version TEXT,
  ADD COLUMN IF NOT EXISTS pending_offline_scan_count INTEGER NOT NULL DEFAULT 0
    CHECK (pending_offline_scan_count >= 0);

CREATE TABLE IF NOT EXISTS device_assignment_history (
  tenant_id UUID NOT NULL,
  assignment_history_id UUID NOT NULL DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL,
  previous_location_id UUID NOT NULL,
  assigned_location_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) >= 5),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system')),
  actor_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, assignment_history_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, device_id) REFERENCES devices (tenant_id, device_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, previous_location_id) REFERENCES locations (tenant_id, location_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, assigned_location_id) REFERENCES locations (tenant_id, location_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS device_assignment_history_device_idx
  ON device_assignment_history (tenant_id, device_id, occurred_at DESC);

ALTER TABLE device_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_assignment_history FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'device_assignment_history'
       AND policyname = 'device_assignment_history_isolation'
  ) THEN
    CREATE POLICY device_assignment_history_isolation ON device_assignment_history
      USING (tenant_id = stacktrack_current_tenant())
      WITH CHECK (tenant_id = stacktrack_current_tenant());
  END IF;
END;
$$;

COMMIT;
