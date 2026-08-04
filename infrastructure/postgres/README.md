# PostgreSQL development database

PostgreSQL 16 is the current local target because it is supported by Azure Database for PostgreSQL Flexible Server. On Parker's Windows development machine, the native PostgreSQL tools are already installed. Start the isolated project-owned cluster with:

```powershell
npm.cmd run db:start
npm.cmd run db:seed
npm.cmd run db:verify
```

The cluster listens only on `127.0.0.1:5433`. Port 5433 intentionally avoids
the installer-created Windows PostgreSQL service on port 5432. Its files stay
under this directory's ignored `.local-data` folder and do not modify the
Windows service.

Development connection:

```text
postgres://stacktrack:stacktrack@127.0.0.1:5433/stacktrack
```

Stop it with:

```powershell
npm.cmd run db:stop
```

The native scripts create a restricted, non-owner `stacktrack` application role, apply the accuracy schema (including the persisted `admin_user_locations` table used for Location Manager scope), and verify both row-level tenant isolation and append-only controls. The credentials are development-only and match the repository `.env.example`.

When an existing Azure database receives the access-control build, rerun the
database bootstrap/grant script so migration `004_location_manager_access.sql`
and its application-role grants are applied before deploying the API. Do not
manually edit password hashes or grant the application role superuser access.

If the API is already deployed and reports that `admin_user_locations` does not
exist, use the non-destructive repair command below. It prompts for the Azure
administrator password, applies only migration `004`, repairs the application
role grant, and does not seed, delete, or overwrite operational data:

```powershell
npm.cmd run db:azure:location-manager -- -ServerName "testserv5.postgres.database.azure.com" -AdminLogin "theparkersmith"
```

Run it once against the test database, then restart the test Container App
revision (or wait for the next revision health check) and refresh the admin
site. The full bootstrap remains the right command for a brand-new database;
the repair command is safer for an existing pilot database.

If the mobile API reports a 500 from `/api/v1/mobile/permissions` or
`/api/v1/mobile/reference-data` because the named scanner-role tables are
missing, apply migration `006` without reseeding the database:

```powershell
npm.cmd run db:azure:device-permissions -- -ServerName "testserv5.postgres.database.azure.com" -AdminLogin "theparkersmith"
```

This repair creates the `field_scanner` role and its least-privilege grants,
adds the installation role column, and verifies the `stacktrack_app` read
permissions. It does not reset containers, observations, users, or scanner
assignments. Restart the API after it completes so the next permission request
uses the persisted role.

`db:seed` deliberately resets this isolated development database, then creates a
repeatable simulation with 120 containers, 8 locations, 7 shared scanners, four
goods types, roughly 300 observations, completed movement histories, active
in-transit loads, warnings, and review cases. Both user interfaces read these
records through the Fastify API. New mobile observations are inserted into the
same PostgreSQL tables.

To inspect the records in pgAdmin, register/connect to `127.0.0.1:5433` with
database `stacktrack`, username `postgres`, and the development password
`stacktrack`. Open **Databases → stacktrack → Schemas → public → Tables**,
right-click a table such as `asset_events`, and choose **View/Edit Data → All
Rows**.

## Docker alternative

The Compose file creates a disposable local database and runs migrations only when its volume is first created:

```powershell
docker compose -f infrastructure/postgres/compose.yml up -d
```

Production secrets belong in Azure-managed secret storage and must never be committed.

Application transactions must set tenant context before accessing tenant data:

```sql
BEGIN;
SET LOCAL app.tenant_id = '11111111-1111-4111-8111-111111111111';
-- tenant-scoped statements
COMMIT;
```

The application database role must not be a superuser or have `BYPASSRLS`. Migration and break-glass roles are separate.
