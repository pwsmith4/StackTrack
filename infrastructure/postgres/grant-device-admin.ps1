[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ServerName,

  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[a-zA-Z0-9_]+$")]
  [string]$AdminLogin
)

$ErrorActionPreference = "Stop"
$postgresBin = @(
  "C:\Program Files\PostgreSQL\18\bin",
  "C:\Program Files\PostgreSQL\16\bin"
) | Where-Object { Test-Path (Join-Path $_ "psql.exe") } | Select-Object -First 1

if (-not $postgresBin) {
  throw "psql.exe was not found in PostgreSQL 18 or 16."
}

$psql = Join-Path $postgresBin "psql.exe"
$migrationPath = Join-Path $PSScriptRoot "migrations\002_device_operations.sql"
$adminAccessMigrationPath = Join-Path $PSScriptRoot "migrations\003_admin_access.sql"
$locationManagerMigrationPath = Join-Path $PSScriptRoot "migrations\004_location_manager_access.sql"
$devicePermissionsMigrationPath = Join-Path $PSScriptRoot "migrations\006_device_permissions.sql"
$adminDeletePermissionsMigrationPath = Join-Path $PSScriptRoot "migrations\007_admin_delete_permissions.sql"
$securePassword = Read-Host -AsSecureString "Azure PostgreSQL administrator password"
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $env:PGSSLMODE = "require"
  & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --file=$migrationPath
  if ($LASTEXITCODE -ne 0) { throw "Applying StackTrack device operations migration failed." }
  & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --file=$adminAccessMigrationPath
  if ($LASTEXITCODE -ne 0) { throw "Applying StackTrack admin access migration failed." }
  & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --file=$locationManagerMigrationPath
  if ($LASTEXITCODE -ne 0) { throw "Applying StackTrack location manager migration failed." }
  & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --file=$devicePermissionsMigrationPath
  if ($LASTEXITCODE -ne 0) { throw "Applying StackTrack device-permissions migration failed." }
  & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --file=$adminDeletePermissionsMigrationPath
  if ($LASTEXITCODE -ne 0) { throw "Applying StackTrack administrator-delete permissions migration failed." }
  @"
GRANT USAGE ON SCHEMA public TO stacktrack_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO stacktrack_app;
GRANT UPDATE (location_name, location_type, is_active) ON locations TO stacktrack_app;
GRANT UPDATE (device_label, assigned_location_id, is_active, deactivated_at) ON devices TO stacktrack_app;
GRANT UPDATE (required_app_version) ON devices TO stacktrack_app;
GRANT UPDATE (last_reported_at, reported_app_version, pending_offline_scan_count) ON device_installations TO stacktrack_app;
GRANT SELECT, INSERT ON device_assignment_history TO stacktrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_users TO stacktrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_sessions TO stacktrack_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_user_locations TO stacktrack_app;
GRANT SELECT ON device_roles, device_role_permissions TO stacktrack_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO stacktrack_app;
"@ | & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { throw "Granting StackTrack device administration permission failed." }
  Write-Host "The StackTrack API can now update device assignment, scanning availability, and governed locations."
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
}
