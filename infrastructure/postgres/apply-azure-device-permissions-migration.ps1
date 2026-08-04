[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ServerName,

  [Parameter(Mandatory = $true)]
  [ValidatePattern("^[a-zA-Z0-9_]+$")]
  [string]$AdminLogin,

  [string]$DatabaseName = "stacktrack",

  [string]$ApplicationRole = "stacktrack_app"
)

$ErrorActionPreference = "Stop"

# This repair is deliberately separate from the full bootstrap. It applies the
# named scanner-role schema and grants without reseeding or changing events.
$postgresRoots = @(
  "C:\Program Files\PostgreSQL\18\bin",
  "C:\Program Files\PostgreSQL\16\bin"
)
$postgresBin = $postgresRoots |
  Where-Object { Test-Path -LiteralPath (Join-Path $_ "psql.exe") } |
  Select-Object -First 1
if (-not $postgresBin) {
  throw "psql.exe was not found in PostgreSQL 18 or 16. Install PostgreSQL client tools first."
}

$psql = Join-Path $postgresBin "psql.exe"
$migrationPath = Join-Path $PSScriptRoot "migrations\006_device_permissions.sql"
if (-not (Test-Path -LiteralPath $migrationPath)) {
  throw "The device-permissions migration was not found at $migrationPath."
}
if ($ApplicationRole -notmatch "^[a-zA-Z0-9_]+$") {
  throw "ApplicationRole must contain only letters, numbers, and underscores."
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
$env:PGSSLMODE = "require"
$env:PGPASSWORD = $adminPassword

try {
  $baseArgs = @(
    "--host=$ServerName",
    "--port=5432",
    "--username=$AdminLogin",
    "--dbname=$DatabaseName",
    "--set=ON_ERROR_STOP=1"
  )

  $prerequisites = & $psql @baseArgs --tuples-only --no-align --command="SELECT to_regclass('public.devices') IS NOT NULL AND to_regclass('public.device_installations') IS NOT NULL AND to_regclass('public.tenants') IS NOT NULL;"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect the Azure StackTrack database. Check the server, database, administrator login, and password."
  }
  if ($prerequisites.Trim() -ne "t") {
    throw "The base StackTrack device schema is not present. Run the full bootstrap once before applying this repair."
  }

  $schema = & $psql @baseArgs --tuples-only --no-align --command="SELECT to_regclass('public.device_roles') IS NOT NULL AND to_regclass('public.device_role_permissions') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='device_installations' AND column_name='device_role');"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not check for the device-permissions schema."
  }

  if ($schema.Trim() -ne "t") {
    Write-Host "Applying device-permissions migration 006..."
    & $psql @baseArgs --file=$migrationPath
    if ($LASTEXITCODE -ne 0) {
      throw "Device-permissions migration failed."
    }
  } else {
    Write-Host "Device-permissions schema already exists; skipping migration."
  }

  # The API only reads these tables. The application role remains a
  # non-superuser; RLS policies still enforce the tenant boundary.
  $grantSql = @"
GRANT USAGE ON SCHEMA public TO "$ApplicationRole";
GRANT SELECT ON TABLE device_roles, device_role_permissions TO "$ApplicationRole";
"@
  $grantSql | & $psql @baseArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Granting application access to device-permission tables failed."
  }

  $verified = & $psql @baseArgs --tuples-only --no-align --command="SELECT to_regclass('public.device_roles') IS NOT NULL AND to_regclass('public.device_role_permissions') IS NOT NULL AND has_table_privilege('$ApplicationRole', 'public.device_roles', 'SELECT') AND has_table_privilege('$ApplicationRole', 'public.device_role_permissions', 'SELECT') AND EXISTS (SELECT 1 FROM device_roles WHERE role_key = 'field_scanner');"
  if ($LASTEXITCODE -ne 0 -or $verified.Trim() -ne "t") {
    throw "The device-permissions schema exists, but its application grants or field-scanner role could not be verified."
  }

  Write-Host "Azure device-permissions schema is ready. No operational data was changed."
  Write-Host "Restart the test Container App revision, then refresh the emulator and admin site."
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
}
