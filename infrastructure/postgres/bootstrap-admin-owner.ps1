[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string]$ServerName,
  [Parameter(Mandatory = $true)] [ValidatePattern("^[a-zA-Z0-9_]+$")] [string]$AdminLogin,
  [string]$TenantId = "10000000-0000-4000-8000-000000000001",
  [string]$Username = "root",
  [string]$DisplayName = "StackTrack Organization Owner",
  [switch]$ResetExisting
)

$ErrorActionPreference = "Stop"
$postgresBin = @("C:\Program Files\PostgreSQL\18\bin", "C:\Program Files\PostgreSQL\16\bin") |
  Where-Object { Test-Path (Join-Path $_ "psql.exe") } | Select-Object -First 1
if (-not $postgresBin) { throw "psql.exe was not found in PostgreSQL 18 or 16." }
$psql = Join-Path $postgresBin "psql.exe"
$migrationPath = Join-Path $PSScriptRoot "migrations\003_admin_access.sql"

function Read-PlainSecret([string]$Prompt) {
  $secure = Read-Host -AsSecureString $Prompt
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$adminPassword = Read-PlainSecret "Azure PostgreSQL administrator password"
$ownerPassword = Read-PlainSecret "Initial Organization Owner password (12+ characters)"
if ($ownerPassword.Length -lt 12) { throw "Use a password of at least 12 characters." }
$username = $Username.Trim().ToLowerInvariant()
if ($username -notmatch '^[a-z0-9._-]{3,64}$') { throw "Username must use 3 to 64 lowercase letters, numbers, periods, underscores, or hyphens." }

# The API verifies with Node's crypto implementation. Generate the bootstrap
# hash with the same implementation so Windows PowerShell/.NET encoding details
# cannot cause a valid password to be rejected.
$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeHashProgram = @'
const { randomBytes, pbkdf2Sync } = require("node:crypto");
const password = process.env.STACKTRACK_BOOTSTRAP_PASSWORD;
if (!password) process.exit(2);
const salt = randomBytes(16).toString("base64url");
const derived = pbkdf2Sync(password, salt, 210000, 32, "sha512").toString("base64url");
process.stdout.write(`pbkdf2-sha512$210000$${salt}$${derived}`);
'@
$env:STACKTRACK_BOOTSTRAP_PASSWORD = $ownerPassword
$nodeProgramPath = [System.IO.Path]::ChangeExtension([System.IO.Path]::GetTempFileName(), ".cjs")
try {
  [System.IO.File]::WriteAllText($nodeProgramPath, $nodeHashProgram, [System.Text.UTF8Encoding]::new($false))
  $passwordHash = & $node $nodeProgramPath
  if ($LASTEXITCODE -ne 0 -or -not $passwordHash) { throw "Could not create the password hash with Node.js." }
} finally {
  Remove-Item Env:STACKTRACK_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $nodeProgramPath -Force -ErrorAction SilentlyContinue
}

$env:PGPASSWORD = $adminPassword
$env:PGSSLMODE = "require"
try {
  & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --file=$migrationPath
  if ($LASTEXITCODE -ne 0) { throw "Applying StackTrack admin access migration failed." }
  $sql = if ($ResetExisting) { @"
GRANT SELECT, INSERT, UPDATE ON admin_users TO stacktrack_app;
GRANT SELECT, INSERT, UPDATE ON admin_sessions TO stacktrack_app;
INSERT INTO admin_users (tenant_id, username, display_name, role, password_hash, must_change_password)
VALUES (:'tenant_id'::uuid, :'username', :'display_name', 'organization_owner', :'password_hash', false)
ON CONFLICT (tenant_id, username) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      role = 'organization_owner',
      password_hash = EXCLUDED.password_hash,
      is_active = true,
      must_change_password = false,
      support_expires_at = NULL,
      updated_at = clock_timestamp();
"@ } else { @"
GRANT SELECT, INSERT, UPDATE ON admin_users TO stacktrack_app;
GRANT SELECT, INSERT, UPDATE ON admin_sessions TO stacktrack_app;
INSERT INTO admin_users (tenant_id, username, display_name, role, password_hash, must_change_password)
VALUES (:'tenant_id'::uuid, :'username', :'display_name', 'organization_owner', :'password_hash', false)
ON CONFLICT (tenant_id, username) DO NOTHING;
"@ }
  $sql | & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --set="tenant_id=$TenantId" --set="username=$username" --set="display_name=$DisplayName" --set="password_hash=$passwordHash"
  if ($LASTEXITCODE -ne 0) { throw "Creating the Organization Owner failed." }
  Write-Host "Organization Owner '$username' is ready. The password was never written to disk."
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
}
