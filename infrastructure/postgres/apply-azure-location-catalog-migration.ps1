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

# This repair applies only the location catalog migration and its application
# role grants. It never seeds, resets, or rewrites operational data.
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
$migrationPath = Join-Path $PSScriptRoot "migrations\008_location_catalog.sql"

if (-not (Test-Path -LiteralPath $migrationPath)) {
  throw "The location catalog migration was not found at $migrationPath."
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

  $prerequisites = & $psql @baseArgs --tuples-only --no-align --command="SELECT to_regclass('public.admin_users') IS NOT NULL AND to_regclass('public.locations') IS NOT NULL AND to_regclass('public.containers') IS NOT NULL;"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect the Azure StackTrack database. Check the server, database, administrator login, and password."
  }
  if ($prerequisites.Trim() -ne "t") {
    throw "The base StackTrack schema is not present. Run bootstrap-azure.ps1 once before applying this repair."
  }

  $catalog = & $psql @baseArgs --tuples-only --no-align --command="SELECT to_regclass('public.location_types') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'location_type_key') AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'locations_type_catalog_fk') AND EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'location_types_isolation' AND polrelid = to_regclass('public.location_types'));"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not check for the location catalog schema."
  }
  if ($catalog.Trim() -ne "t") {
    Write-Host "Applying location catalog migration 008..."
    & $psql @baseArgs --file=$migrationPath
    if ($LASTEXITCODE -ne 0) {
      throw "Location catalog migration failed."
    }
  } else {
    Write-Host "Location catalog tables already exist; skipping migration."
  }

  # A grant made before a table was created does not cover that new table.
  # Keep the API role non-superuser; RLS remains responsible for tenant scope.
  $grantSql = @"
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE location_types TO "$ApplicationRole";
GRANT UPDATE (location_name, location_type, location_type_key, is_active) ON locations TO "$ApplicationRole";
"@
  $grantSql | & $psql @baseArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Granting application access to the location catalog failed."
  }

  $verified = & $psql @baseArgs --tuples-only --no-align --command="SELECT to_regclass('public.location_types') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'location_type_key') AND has_table_privilege('$ApplicationRole', 'public.location_types', 'SELECT') AND has_table_privilege('$ApplicationRole', 'public.location_types', 'INSERT') AND has_table_privilege('$ApplicationRole', 'public.location_types', 'UPDATE') AND has_table_privilege('$ApplicationRole', 'public.location_types', 'DELETE') AND has_column_privilege('$ApplicationRole', 'public.locations', 'location_type_key', 'UPDATE');"
  if ($LASTEXITCODE -ne 0 -or $verified.Trim() -ne "t") {
    throw "The location catalog exists, but application permissions could not be verified."
  }

  Write-Host "Azure location catalog is ready. No operational data was changed."
  Write-Host "Restart the test API revision or wait for its next health check, then refresh the admin site."
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
}
