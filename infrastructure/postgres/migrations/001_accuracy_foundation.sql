BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE stacktrack_location_type AS ENUM (
  'donation_express',
  'store_backroom',
  'warehouse',
  'in_transit'
);

CREATE TYPE stacktrack_event_type AS ENUM (
  'load_assigned',
  'batch_out',
  'batch_in',
  'emptied'
);

CREATE TYPE stacktrack_ingestion_disposition AS ENUM (
  'accepted',
  'accepted_with_warning',
  'accepted_for_review'
);

CREATE TYPE stacktrack_review_action AS ENUM (
  'opened',
  'assigned',
  'approved',
  'rejected',
  'resolved',
  'reopened'
);

CREATE TABLE tenants (
  tenant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_slug TEXT NOT NULL UNIQUE,
  tenant_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE locations (
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL DEFAULT gen_random_uuid(),
  location_name TEXT NOT NULL,
  location_type stacktrack_location_type NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, location_id),
  UNIQUE (tenant_id, location_name),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT
);

CREATE TABLE devices (
  tenant_id UUID NOT NULL,
  device_id UUID NOT NULL DEFAULT gen_random_uuid(),
  device_label TEXT NOT NULL,
  assigned_location_id UUID NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deactivated_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, device_id),
  UNIQUE (tenant_id, device_label),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, assigned_location_id)
    REFERENCES locations (tenant_id, location_id) ON DELETE RESTRICT,
  CHECK ((is_active AND deactivated_at IS NULL) OR NOT is_active)
);

CREATE TABLE device_installations (
  tenant_id UUID NOT NULL,
  device_id UUID NOT NULL,
  installation_id UUID NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_authenticated_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (tenant_id, installation_id),
  UNIQUE (tenant_id, device_id, installation_id),
  FOREIGN KEY (tenant_id, device_id)
    REFERENCES devices (tenant_id, device_id) ON DELETE RESTRICT
);

CREATE TABLE container_types (
  tenant_id UUID NOT NULL,
  container_type_id UUID NOT NULL DEFAULT gen_random_uuid(),
  type_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (tenant_id, container_type_id),
  UNIQUE (tenant_id, type_name),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT
);

CREATE TABLE containers (
  tenant_id UUID NOT NULL,
  container_id UUID NOT NULL DEFAULT gen_random_uuid(),
  container_label TEXT NOT NULL,
  container_type_id UUID NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, container_id),
  UNIQUE (tenant_id, container_label),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, container_type_id)
    REFERENCES container_types (tenant_id, container_type_id) ON DELETE RESTRICT
);

CREATE TABLE secondary_fields (
  tenant_id UUID NOT NULL,
  secondary_field_id UUID NOT NULL DEFAULT gen_random_uuid(),
  secondary_field_name TEXT NOT NULL,
  options JSONB NOT NULL,
  contains_salvage BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (tenant_id, secondary_field_id),
  UNIQUE (tenant_id, secondary_field_name),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  CHECK (jsonb_typeof(options) = 'array')
);

CREATE TABLE goods_types (
  tenant_id UUID NOT NULL,
  goods_type_id UUID NOT NULL DEFAULT gen_random_uuid(),
  goods_type_name TEXT NOT NULL,
  secondary_field_id UUID NOT NULL,
  sort_order INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (tenant_id, goods_type_id),
  UNIQUE (tenant_id, goods_type_name),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, secondary_field_id)
    REFERENCES secondary_fields (tenant_id, secondary_field_id) ON DELETE RESTRICT
);

CREATE TABLE load_codes (
  tenant_id UUID NOT NULL,
  load_code_id UUID NOT NULL,
  external_reference TEXT,
  code_source TEXT NOT NULL DEFAULT 'stacktrack'
    CHECK (code_source IN ('stacktrack', 'external')),
  generating_location_id UUID NOT NULL,
  goods_type_id UUID NOT NULL,
  secondary_field_id UUID NOT NULL,
  secondary_value TEXT NOT NULL,
  reference_data_version TIMESTAMPTZ NOT NULL,
  device_created_at TIMESTAMPTZ NOT NULL,
  effective_created_at TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_by_device_id UUID NOT NULL,
  notes TEXT,
  PRIMARY KEY (tenant_id, load_code_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, generating_location_id)
    REFERENCES locations (tenant_id, location_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, goods_type_id)
    REFERENCES goods_types (tenant_id, goods_type_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, secondary_field_id)
    REFERENCES secondary_fields (tenant_id, secondary_field_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, created_by_device_id)
    REFERENCES devices (tenant_id, device_id) ON DELETE RESTRICT,
  CHECK (
    (code_source = 'external' AND external_reference IS NOT NULL)
    OR code_source = 'stacktrack'
  )
);

CREATE UNIQUE INDEX load_codes_external_reference_idx
  ON load_codes (tenant_id, external_reference)
  WHERE external_reference IS NOT NULL;

CREATE TABLE asset_events (
  tenant_id UUID NOT NULL,
  event_id UUID NOT NULL,
  container_id UUID NOT NULL,
  load_code_id UUID,
  location_id UUID NOT NULL,
  device_id UUID NOT NULL,
  device_installation_id UUID NOT NULL,
  device_sequence BIGINT NOT NULL CHECK (device_sequence >= 0),
  event_type stacktrack_event_type NOT NULL,
  device_observed_at TIMESTAMPTZ NOT NULL,
  device_clock_offset_seconds NUMERIC(12,3),
  clock_verified_at TIMESTAMPTZ,
  effective_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reference_data_version TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_sha256 CHAR(64) NOT NULL,
  accuracy_flags TEXT[] NOT NULL DEFAULT '{}',
  ingestion_disposition stacktrack_ingestion_disposition NOT NULL,
  PRIMARY KEY (tenant_id, event_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, container_id)
    REFERENCES containers (tenant_id, container_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, load_code_id)
    REFERENCES load_codes (tenant_id, load_code_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, location_id)
    REFERENCES locations (tenant_id, location_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, device_id)
    REFERENCES devices (tenant_id, device_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, device_id, device_installation_id)
    REFERENCES device_installations (tenant_id, device_id, installation_id)
    ON DELETE RESTRICT,
  CHECK (
    (device_clock_offset_seconds IS NULL AND clock_verified_at IS NULL)
    OR
    (device_clock_offset_seconds IS NOT NULL AND clock_verified_at IS NOT NULL)
  ),
  CHECK (
    (event_type = 'load_assigned' AND load_code_id IS NOT NULL)
    OR
    (event_type = 'emptied' AND load_code_id IS NULL)
    OR
    event_type IN ('batch_out', 'batch_in')
  )
);

CREATE INDEX asset_events_container_timeline_idx
  ON asset_events (tenant_id, container_id, effective_at, received_at, event_id);
CREATE INDEX asset_events_device_sequence_idx
  ON asset_events (
    tenant_id,
    device_id,
    device_installation_id,
    device_sequence
  );
CREATE INDEX asset_events_review_idx
  ON asset_events (tenant_id, received_at)
  WHERE ingestion_disposition = 'accepted_for_review';

COMMENT ON INDEX asset_events_device_sequence_idx IS
  'Intentionally non-unique: sequence collisions are preserved as evidence and flagged for review.';

CREATE TABLE review_cases (
  tenant_id UUID NOT NULL,
  review_case_id UUID NOT NULL DEFAULT gen_random_uuid(),
  container_id UUID NOT NULL,
  reason_code TEXT NOT NULL,
  evidence_event_ids UUID[] NOT NULL,
  evidence_fingerprint CHAR(64) NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, review_case_id),
  UNIQUE (tenant_id, evidence_fingerprint),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, container_id)
    REFERENCES containers (tenant_id, container_id) ON DELETE RESTRICT,
  CHECK (cardinality(evidence_event_ids) > 0)
);

CREATE TABLE review_case_actions (
  tenant_id UUID NOT NULL,
  review_action_id UUID NOT NULL DEFAULT gen_random_uuid(),
  review_case_id UUID NOT NULL,
  action stacktrack_review_action NOT NULL,
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('device', 'user', 'system')),
  actor_id UUID,
  reason TEXT NOT NULL,
  resolution JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, review_action_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, review_case_id)
    REFERENCES review_cases (tenant_id, review_case_id) ON DELETE RESTRICT
);

CREATE TABLE correction_requests (
  tenant_id UUID NOT NULL,
  correction_request_id UUID NOT NULL DEFAULT gen_random_uuid(),
  container_id UUID NOT NULL,
  requested_by_user_id UUID NOT NULL,
  impact_level TEXT NOT NULL CHECK (impact_level IN ('routine', 'material')),
  reason TEXT NOT NULL,
  proposed_correction JSONB NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, correction_request_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, container_id)
    REFERENCES containers (tenant_id, container_id) ON DELETE RESTRICT
);

CREATE TABLE correction_actions (
  tenant_id UUID NOT NULL,
  correction_action_id UUID NOT NULL DEFAULT gen_random_uuid(),
  correction_request_id UUID NOT NULL,
  action stacktrack_review_action NOT NULL,
  actor_user_id UUID NOT NULL,
  reason TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, correction_action_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, correction_request_id)
    REFERENCES correction_requests (tenant_id, correction_request_id)
    ON DELETE RESTRICT
);

CREATE TABLE audit_log (
  tenant_id UUID NOT NULL,
  audit_id UUID NOT NULL DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('device', 'user', 'system')),
  actor_id UUID,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, audit_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id) ON DELETE RESTRICT
);

CREATE FUNCTION stacktrack_prevent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; write a correction or review action instead',
    TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER asset_events_append_only
  BEFORE UPDATE OR DELETE ON asset_events
  FOR EACH ROW EXECUTE FUNCTION stacktrack_prevent_mutation();
CREATE TRIGGER review_case_actions_append_only
  BEFORE UPDATE OR DELETE ON review_case_actions
  FOR EACH ROW EXECUTE FUNCTION stacktrack_prevent_mutation();
CREATE TRIGGER correction_requests_append_only
  BEFORE UPDATE OR DELETE ON correction_requests
  FOR EACH ROW EXECUTE FUNCTION stacktrack_prevent_mutation();
CREATE TRIGGER correction_actions_append_only
  BEFORE UPDATE OR DELETE ON correction_actions
  FOR EACH ROW EXECUTE FUNCTION stacktrack_prevent_mutation();
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION stacktrack_prevent_mutation();

CREATE FUNCTION stacktrack_current_tenant()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', TRUE), '')::UUID
$$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON tenants
  USING (tenant_id = stacktrack_current_tenant())
  WITH CHECK (tenant_id = stacktrack_current_tenant());

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'locations',
    'devices',
    'device_installations',
    'container_types',
    'containers',
    'secondary_fields',
    'goods_types',
    'load_codes',
    'asset_events',
    'review_cases',
    'review_case_actions',
    'correction_requests',
    'correction_actions',
    'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = stacktrack_current_tenant()) WITH CHECK (tenant_id = stacktrack_current_tenant())',
      table_name || '_isolation',
      table_name
    );
  END LOOP;
END;
$$;

COMMIT;
