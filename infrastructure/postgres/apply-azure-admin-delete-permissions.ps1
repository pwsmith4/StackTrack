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

# This is a non-destructive repair for an existing pilot database. It grants
# only the DELETE privileges required by the already-authorized permanent
# administrator removal transaction; it does not seed, reset, or remove data.
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
$migrationPath = Join-Path $PSScriptRoot "migrations\007_admin_delete_permissions.sql"
if (-not (Test-Path -LiteralPath $migrationPath)) {
  throw "The administrator-delete permissions migration was not found at $migrationPath."
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

  $prerequisites = & $psql @baseArgs --tuples-only --no-align --command="SELECT to_regclass('public.admin_users') IS NOT NULL AND to_regclass('public.admin_sessions') IS NOT NULL AND to_regclass('public.admin_user_locations') IS NOT NULL;"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect the Azure StackTrack database. Check the server, database, administrator login, and password."
  }
  if ($prerequisites.Trim() -ne "t") {
    throw "The administrator access schema is not present. Run bootstrap-azure.ps1 once before applying this repair."
  }

  $roleExists = & $psql @baseArgs --tuples-only --no-align --command="SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$ApplicationRole');"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not check for the StackTrack application role."
  }
  if ($roleExists.Trim() -ne "t") {
    throw "The application role '$ApplicationRole' does not exist. Run the Azure bootstrap first."
  }

  # Capture ownership before attempting the grant. Azure PostgreSQL's server
  # administrator is not a PostgreSQL superuser; if an earlier bootstrap was
  # run by a different database role, only that table owner (or a role with
  # the owner's grant option) can repair the ACL.
  $owners = & $psql @baseArgs --tuples-only --no-align --field-separator=" | " --command="SELECT c.relname, pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid IN ('public.admin_sessions'::regclass, 'public.admin_users'::regclass, 'public.admin_user_locations'::regclass) ORDER BY c.relname;"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect administrator-table ownership."
  }

  # Apply the migration as a convenience for databases where the Azure
  # administrator owns the admin tables.  On Flexible Server the maintenance
  # login is not a PostgreSQL superuser, so an older database may have tables
  # owned by a different role.  Keep the owner context in the error instead of
  # hiding the actionable instruction behind a generic migration failure.
  $migrationOutput = & $psql @baseArgs --file=$migrationPath 2>&1
  if ($LASTEXITCODE -ne 0) {
    $ownerText = ($owners | Where-Object { $_ -and $_.Trim() }) -join "; "
    $databaseOutput = ($migrationOutput | Where-Object { $_ -and $_.ToString().Trim() } | Select-Object -Last 1)
    throw "Applying administrator-delete permissions migration failed. Current table owners: $ownerText. The login must own these tables (or be authorized by their owner). Run the SQL from migrations\007_admin_delete_permissions.sql as the owning role. Database message: $databaseOutput"
  }

  $grantSql = @"
GRANT USAGE ON SCHEMA public TO "$ApplicationRole";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE admin_sessions, admin_users TO "$ApplicationRole";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE admin_user_locations TO "$ApplicationRole";
"@
  $grantSql | & $psql @baseArgs
  if ($LASTEXITCODE -ne 0) {
    $ownerText = ($owners | Where-Object { $_ -and $_.Trim() }) -join "; "
    throw "Granting administrator-delete permissions failed. The Azure login must own the StackTrack admin tables (or be authorized by their owner) to grant these rights. Current table owners: $ownerText. Sign in with the owning role (or ask its owner) and run the SQL from migrations\007_admin_delete_permissions.sql, then rerun this repair to verify it."
  }

  $verified = & $psql @baseArgs --tuples-only --no-align --command="SELECT has_schema_privilege('$ApplicationRole', 'public', 'USAGE') AND has_table_privilege('$ApplicationRole', 'public.admin_sessions', 'SELECT,INSERT,UPDATE,DELETE') AND has_table_privilege('$ApplicationRole', 'public.admin_users', 'SELECT,INSERT,UPDATE,DELETE') AND has_table_privilege('$ApplicationRole', 'public.admin_user_locations', 'SELECT,INSERT,UPDATE,DELETE');"
  if ($LASTEXITCODE -ne 0 -or $verified.Trim() -ne "t") {
    throw "The application role still does not have the DELETE permissions required to remove an administrator."
  }

  Write-Host "Azure administrator-delete permissions are ready. No operational data was changed."
  Write-Host "Restart the API revision (or wait for its next health check), refresh the admin site, and try the removal again."
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
}
