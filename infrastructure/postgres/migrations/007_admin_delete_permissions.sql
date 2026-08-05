BEGIN;

-- Permanent administrator removal is performed by the API as a single,
-- owner-authorized transaction.  The transaction first revokes sessions and
-- clears location-assignment references, then deletes the administrator row.
-- Keep the app role non-superuser and preserve the existing tenant RLS
-- policies; these grants enable the explicit session/account cleanup and the
-- assignment-owner nulling that must happen before the account row is removed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stacktrack_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO stacktrack_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE admin_sessions, admin_users TO stacktrack_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE admin_user_locations TO stacktrack_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stacktrack') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO stacktrack';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE admin_sessions, admin_users TO stacktrack';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE admin_user_locations TO stacktrack';
  END IF;
END;
$$;

COMMIT;
