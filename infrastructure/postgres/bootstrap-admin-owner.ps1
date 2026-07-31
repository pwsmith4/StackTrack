[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string]$ServerName,
  [Parameter(Mandatory = $true)] [ValidatePattern("^[a-zA-Z0-9_]+$")] [string]$AdminLogin,
  [string]$TenantId = "10000000-0000-4000-8000-000000000001",
  [string]$Username = "root",
  [string]$DisplayName = "StackTrack Organization Owner"
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

function ConvertTo-Base64Url([byte[]]$Bytes) {
  [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$adminPassword = Read-PlainSecret "Azure PostgreSQL administrator password"
$ownerPassword = Read-PlainSecret "Initial Organization Owner password (12+ characters)"
if ($ownerPassword.Length -lt 12) { throw "Use a password of at least 12 characters." }
$username = $Username.Trim().ToLowerInvariant()
if ($username -notmatch '^[a-z0-9._-]{3,64}$') { throw "Username must use 3 to 64 lowercase letters, numbers, periods, underscores, or hyphens." }

$salt = New-Object byte[] 16
[Security.Cryptography.RandomNumberGenerator]::Fill($salt)
$derive = [Security.Cryptography.Rfc2898DeriveBytes]::new($ownerPassword, $salt, 210000, [Security.Cryptography.HashAlgorithmName]::SHA512)
try {
  $passwordHash = "pbkdf2-sha512`$210000`$(ConvertTo-Base64Url $salt)`$(ConvertTo-Base64Url $derive.GetBytes(32))"
} finally { $derive.Dispose() }

$env:PGPASSWORD = $adminPassword
$env:PGSSLMODE = "require"
try {
  & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --file=$migrationPath
  if ($LASTEXITCODE -ne 0) { throw "Applying StackTrack admin access migration failed." }
  $sql = @"
GRANT SELECT, INSERT, UPDATE ON admin_users TO stacktrack_app;
GRANT SELECT, INSERT, UPDATE ON admin_sessions TO stacktrack_app;
INSERT INTO admin_users (tenant_id, username, display_name, role, password_hash, must_change_password)
VALUES (:'tenant_id'::uuid, :'username', :'display_name', 'organization_owner', :'password_hash', false)
ON CONFLICT (tenant_id, username) DO NOTHING;
"@
  $sql | & $psql --host=$ServerName --port=5432 --username=$AdminLogin --dbname=stacktrack --set=ON_ERROR_STOP=1 --set="tenant_id=$TenantId" --set="username=$username" --set="display_name=$DisplayName" --set="password_hash=$passwordHash"
  if ($LASTEXITCODE -ne 0) { throw "Creating the Organization Owner failed." }
  Write-Host "Organization Owner '$username' is ready. The password was never written to disk."
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
}
