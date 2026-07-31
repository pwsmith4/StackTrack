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

# This repair is intentionally separate from bootstrap-azure.ps1. It applies
# only the missing location-manager migration and grants; it never seeds or
# resets operational data.
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
$migrationPath = Join-Path $PSScriptRoot "migrations\004_location_manager_access.sql"

if (-not (Test-Path -LiteralPath $migrationPath)) {
  throw "The location-manager migration was not found at $migrationPath."
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

  $prerequisites = & $psql @baseArgs --tuples-only --no-align --command="SELECT to_regclass('public.admin_users') IS NOT NULL AND to_regclass('public.locations') IS NOT NULL;"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect the Azure StackTrack database. Check the server, database, administrator login, and password."
  }
  if ($prerequisites.Trim() -ne "t") {
    throw "The base StackTrack schema is not present. Run bootstrap-azure.ps1 once before applying this repair."
  }

  $table = & $psql @baseArgs --tuples-only --no-align --command="SELECT to_regclass('public.admin_user_locations');"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not check for the location-manager table."
  }

  if ($table.Trim() -ne "admin_user_locations") {
    Write-Host "Applying location-manager migration 004..."
    & $psql @baseArgs --file=$migrationPath
    if ($LASTEXITCODE -ne 0) {
      throw "Location-manager migration failed."
    }
  } else {
    Write-Host "Location-manager table already exists; skipping migration."
  }

  # A grant made before a table was created does not cover that new table, so
  # repair the application role explicitly. The API remains non-superuser and
  # RLS continues to enforce tenant scope.
  $grantSql = @"
GRANT SELECT, INSERT, DELETE ON TABLE admin_user_locations TO "$ApplicationRole";
"@
  $grantSql | & $psql @baseArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Granting application access to admin_user_locations failed."
  }

  $verified = & $psql @baseArgs --tuples-only --no-align --command="SELECT to_regclass('public.admin_user_locations') IS NOT NULL AND has_table_privilege('$ApplicationRole', 'public.admin_user_locations', 'SELECT') AND has_table_privilege('$ApplicationRole', 'public.admin_user_locations', 'INSERT') AND has_table_privilege('$ApplicationRole', 'public.admin_user_locations', 'DELETE');"
  if ($LASTEXITCODE -ne 0 -or $verified.Trim() -ne "t") {
    throw "The location-manager table exists, but application permissions could not be verified."
  }

  Write-Host "Azure location-manager schema is ready. No operational data was changed."
  Write-Host "Restart the test API revision or wait for its next health check, then refresh the admin site."
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
}
