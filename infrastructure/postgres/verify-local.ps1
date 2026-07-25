$ErrorActionPreference = "Stop"

$postgresBin = "C:\Program Files\PostgreSQL\16\bin"
$psql = Join-Path $postgresBin "psql.exe"
$pgIsReady = Join-Path $postgresBin "pg_isready.exe"
$port = if ($env:STACKTRACK_POSTGRES_PORT) {
  [int]$env:STACKTRACK_POSTGRES_PORT
} else {
  5432
}
$tenantA = "90000000-0000-4000-8000-000000000001"
$tenantB = "90000000-0000-4000-8000-000000000002"

& $pgIsReady -h 127.0.0.1 -p $port | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "StackTrack PostgreSQL is not running. Run npm.cmd run db:start first."
}

$env:PGPASSWORD = "stacktrack"

$seedSql = @"
INSERT INTO tenants (tenant_id, tenant_slug, tenant_name)
VALUES
  ('$tenantA', 'stacktrack-local-a', 'StackTrack Local Tenant A'),
  ('$tenantB', 'stacktrack-local-b', 'StackTrack Local Tenant B')
ON CONFLICT (tenant_id) DO NOTHING;
"@

$seedSql | & $psql `
  --host=127.0.0.1 `
  --port=$port `
  --username=postgres `
  --dbname=stacktrack `
  --set=ON_ERROR_STOP=1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Could not create the database verification fixtures."
}

$withoutContext = & $psql `
  --host=127.0.0.1 `
  --port=$port `
  --username=stacktrack `
  --dbname=stacktrack `
  --tuples-only `
  --no-align `
  --set=ON_ERROR_STOP=1 `
  --command="SELECT count(*) FROM tenants;"

$withTenantA = & $psql `
  --host=127.0.0.1 `
  --port=$port `
  --username=stacktrack `
  --dbname=stacktrack `
  --tuples-only `
  --no-align `
  --set=ON_ERROR_STOP=1 `
  --command="BEGIN; SET LOCAL app.tenant_id = '$tenantA'; SELECT count(*) FROM tenants; COMMIT;"

$rlsTableCount = & $psql `
  --host=127.0.0.1 `
  --port=$port `
  --username=postgres `
  --dbname=stacktrack `
  --tuples-only `
  --no-align `
  --set=ON_ERROR_STOP=1 `
  --command="SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relrowsecurity AND relforcerowsecurity;"

$appendOnlyTriggerCount = & $psql `
  --host=127.0.0.1 `
  --port=$port `
  --username=postgres `
  --dbname=stacktrack `
  --tuples-only `
  --no-align `
  --set=ON_ERROR_STOP=1 `
  --command="SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%_append_only';"

Remove-Item Env:PGPASSWORD

if ($withoutContext.Trim() -ne "0") {
  throw "Tenant isolation failed: the application role saw data without tenant context."
}
if (($withTenantA -join "`n") -notmatch "(?m)^1$") {
  throw "Tenant isolation failed: Tenant A did not see exactly its own row."
}
if ([int]$rlsTableCount.Trim() -lt 15) {
  throw "Expected row-level security to be forced on at least 15 tables; found $($rlsTableCount.Trim())."
}
if ([int]$appendOnlyTriggerCount.Trim() -lt 5) {
  throw "Expected at least five append-only triggers; found $($appendOnlyTriggerCount.Trim())."
}

Write-Host "PostgreSQL verification passed."
Write-Host "  No tenant context sees: 0 tenants"
Write-Host "  Tenant A context sees:   1 tenant"
Write-Host "  RLS-protected tables:    $($rlsTableCount.Trim())"
Write-Host "  Append-only triggers:    $($appendOnlyTriggerCount.Trim())"
