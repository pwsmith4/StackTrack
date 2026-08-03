[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ServerName,

  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[a-zA-Z0-9_]+$")]
  [string]$AdminLogin
)

$ErrorActionPreference = "Stop"

# This script is intentionally interactive: Azure credentials never enter a file,
# source control, or the command history.
$postgresBin = "C:\Program Files\PostgreSQL\16\bin"
$psql = Join-Path $postgresBin "psql.exe"
$migrationPath = Join-Path $PSScriptRoot "migrations\001_accuracy_foundation.sql"
$deviceOperationsMigrationPath = Join-Path $PSScriptRoot "migrations\002_device_operations.sql"
$adminAccessMigrationPath = Join-Path $PSScriptRoot "migrations\003_admin_access.sql"
$locationManagerMigrationPath = Join-Path $PSScriptRoot "migrations\004_location_manager_access.sql"
$processedLoadsMigrationPath = Join-Path $PSScriptRoot "migrations\005_processed_loads.sql"
$devicePermissionsMigrationPath = Join-Path $PSScriptRoot "migrations\006_device_permissions.sql"
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

if (-not (Test-Path -LiteralPath $psql)) {
  throw "PostgreSQL 16 psql.exe was not found at $psql. Install PostgreSQL 16 or update bootstrap-azure.ps1."
}

function Read-PlainSecret([string]$Prompt) {
  $secure = Read-Host -AsSecureString $Prompt
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

$adminPassword = Read-PlainSecret "Azure PostgreSQL administrator password"
$appPassword = Read-PlainSecret "New StackTrack application password"
if ($appPassword.Length -lt 16) {
  throw "Use a StackTrack application password of at least 16 characters."
}

$env:PGSSLMODE = "require"
$env:PGPASSWORD = $adminPassword
try {
  # Azure starts with only the postgres maintenance database. Create our isolated
  # application database if this is the first bootstrap run.
  @"
SELECT format('CREATE DATABASE %I', 'stacktrack')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'stacktrack')
\gexec
"@ | & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=postgres --set=ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "Azure database creation failed." }

  $schemaExists = & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --tuples-only --no-align --command="SELECT to_regclass('public.asset_events') IS NOT NULL;"
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect the Azure StackTrack database." }
  if ($schemaExists.Trim() -ne "t") {
    Write-Host "Applying the StackTrack accuracy schema..."
    & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --file=$migrationPath
    if ($LASTEXITCODE -ne 0) { throw "Azure schema migration failed." }
  }

  & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --file=$deviceOperationsMigrationPath
  if ($LASTEXITCODE -ne 0) { throw "Azure device operations migration failed." }
  & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --file=$adminAccessMigrationPath
  if ($LASTEXITCODE -ne 0) { throw "Azure admin access migration failed." }
  & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --file=$locationManagerMigrationPath
  if ($LASTEXITCODE -ne 0) { throw "Azure location manager migration failed." }
  & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --file=$processedLoadsMigrationPath
  if ($LASTEXITCODE -ne 0) { throw "Azure processed-load migration failed." }
  & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --file=$devicePermissionsMigrationPath
  if ($LASTEXITCODE -ne 0) { throw "Azure device-permissions migration failed." }

  # Create a separate, non-admin login for the API. Password is passed as a psql
  # variable and quoted as a SQL literal, so punctuation in the password is safe.
  @"
SELECT format('CREATE ROLE stacktrack_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stacktrack_app')
\gexec
ALTER ROLE stacktrack_app WITH LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE stacktrack TO stacktrack_app;
GRANT USAGE ON SCHEMA public TO stacktrack_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO stacktrack_app;
GRANT UPDATE (location_name, location_type, is_active) ON locations TO stacktrack_app;
GRANT UPDATE (device_label, assigned_location_id, is_active, deactivated_at) ON devices TO stacktrack_app;
GRANT UPDATE (required_app_version) ON devices TO stacktrack_app;
GRANT UPDATE (last_reported_at, reported_app_version, pending_offline_scan_count) ON device_installations TO stacktrack_app;
GRANT SELECT, INSERT ON device_assignment_history TO stacktrack_app;
GRANT SELECT, INSERT, UPDATE ON admin_users TO stacktrack_app;
GRANT SELECT, INSERT, UPDATE ON admin_sessions TO stacktrack_app;
GRANT SELECT, INSERT, DELETE ON admin_user_locations TO stacktrack_app;
GRANT SELECT, INSERT ON processed_loads TO stacktrack_app;
GRANT SELECT ON device_roles, device_role_permissions TO stacktrack_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO stacktrack_app;
"@ | & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --set="app_password=$appPassword"
  if ($LASTEXITCODE -ne 0) { throw "Azure application-login setup failed." }

  $adminPasswordForUrl = [uri]::EscapeDataString($adminPassword)
  $appPasswordForUrl = [uri]::EscapeDataString($appPassword)
  $env:DATABASE_ADMIN_URL = "postgresql://$AdminLogin`:$adminPasswordForUrl@$ServerName`:5432/stacktrack?sslmode=require"
  $env:DATABASE_URL = "postgresql://stacktrack_app`:$appPasswordForUrl@$ServerName`:5432/stacktrack?sslmode=require"

  Write-Host "Loading synthetic StackTrack test data..."
  & npm.cmd --prefix $projectRoot run db:seed
  if ($LASTEXITCODE -ne 0) { throw "Azure data seed failed." }

  Write-Host ""
  Write-Host "Azure StackTrack test database is ready."
  Write-Host "Server:   $ServerName"
  Write-Host "Database: stacktrack"
  Write-Host "API user: stacktrack_app"
  Write-Host "Keep both passwords in a password manager; do not add them to Git."
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_ADMIN_URL -ErrorAction SilentlyContinue
}
