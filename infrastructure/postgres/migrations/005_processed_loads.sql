BEGIN;

CREATE TABLE IF NOT EXISTS processed_loads (
  tenant_id UUID NOT NULL,
  processed_load_id UUID NOT NULL DEFAULT gen_random_uuid(),
  container_id UUID NOT NULL,
  load_code_id UUID,
  location_id UUID NOT NULL,
  event_id UUID NOT NULL,
  device_id UUID NOT NULL,
  processed_percentage SMALLINT NOT NULL DEFAULT 100
    CHECK (processed_percentage BETWEEN 1 AND 100),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, processed_load_id),
  UNIQUE (tenant_id, event_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, container_id) REFERENCES containers (tenant_id, container_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, load_code_id) REFERENCES load_codes (tenant_id, load_code_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, location_id) REFERENCES locations (tenant_id, location_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, event_id) REFERENCES asset_events (tenant_id, event_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, device_id) REFERENCES devices (tenant_id, device_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS processed_loads_location_time_idx
  ON processed_loads (tenant_id, location_id, processed_at DESC);

ALTER TABLE processed_loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_loads FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'processed_loads'
       AND policyname = 'processed_loads_isolation'
  ) THEN
    CREATE POLICY processed_loads_isolation ON processed_loads
      USING (tenant_id = stacktrack_current_tenant())
      WITH CHECK (tenant_id = stacktrack_current_tenant());
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS processed_loads_append_only ON processed_loads;
CREATE TRIGGER processed_loads_append_only
  BEFORE UPDATE OR DELETE ON processed_loads
  FOR EACH ROW EXECUTE FUNCTION stacktrack_prevent_mutation();

COMMIT;
