-- Shared location-type catalog and the permissions required by the governed
-- administration screens.  The existing location_type column remains the
-- operational category used by routing/planning; location_type_key points to
-- the editable catalog entry shown to administrators.
ALTER TYPE stacktrack_location_type ADD VALUE IF NOT EXISTS 'other';

CREATE TABLE IF NOT EXISTS location_types (
  tenant_id UUID NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
  type_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category stacktrack_location_type NOT NULL DEFAULT 'other',
  icon_key TEXT NOT NULL DEFAULT 'map-pin',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, type_key),
  UNIQUE (tenant_id, display_name),
  CONSTRAINT location_types_key_format CHECK (type_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  CONSTRAINT location_types_name_length CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 80),
  CONSTRAINT location_types_icon_length CHECK (char_length(btrim(icon_key)) BETWEEN 2 AND 40)
);

ALTER TABLE locations ADD COLUMN IF NOT EXISTS location_type_key TEXT;

INSERT INTO location_types (tenant_id, type_key, display_name, category, icon_key, is_system)
SELECT t.tenant_id, seed.type_key, seed.display_name, seed.category::stacktrack_location_type, seed.icon_key, TRUE
  FROM tenants t
 CROSS JOIN (VALUES
   ('donation_express', 'Donation Xpress', 'donation_express', 'hand-heart'),
   ('store_backroom', 'Store', 'store_backroom', 'store'),
   ('warehouse', 'Warehouse', 'warehouse', 'warehouse'),
   ('in_transit', 'In transit', 'in_transit', 'truck')
 ) AS seed(type_key, display_name, category, icon_key)
ON CONFLICT (tenant_id, type_key) DO NOTHING;

DO $$
DECLARE
  tenant_id_value UUID;
BEGIN
  -- Existing operating tables use FORCE RLS.  Apply the backfill once per
  -- tenant so a non-superuser database administrator can run this migration
  -- without disabling tenant isolation.
  FOR tenant_id_value IN SELECT tenant_id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', tenant_id_value::text, true);
    UPDATE locations
       SET location_type_key = location_type::text
     WHERE tenant_id = tenant_id_value AND location_type_key IS NULL;
  END LOOP;
END;
$$;

ALTER TABLE locations ALTER COLUMN location_type_key SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'locations_type_catalog_fk'
  ) THEN
    ALTER TABLE locations
      ADD CONSTRAINT locations_type_catalog_fk
      FOREIGN KEY (tenant_id, location_type_key)
      REFERENCES location_types (tenant_id, type_key);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS location_types_active_idx
  ON location_types (tenant_id, is_active, display_name);

ALTER TABLE location_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_types FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'location_types_isolation' AND polrelid = 'location_types'::regclass
  ) THEN
    CREATE POLICY location_types_isolation ON location_types
      USING (tenant_id = stacktrack_current_tenant())
      WITH CHECK (tenant_id = stacktrack_current_tenant());
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stacktrack_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON location_types TO stacktrack_app';
    EXECUTE 'GRANT UPDATE (location_name, location_type, location_type_key, is_active) ON locations TO stacktrack_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stacktrack') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON location_types TO stacktrack';
    EXECUTE 'GRANT UPDATE (location_name, location_type, location_type_key, is_active) ON locations TO stacktrack';
  END IF;
END;
$$;
