$ErrorActionPreference = "Stop"

$postgresHome = "C:\Program Files\PostgreSQL\16"
$postgresBin = Join-Path $postgresHome "bin"
$initdb = Join-Path $postgresBin "initdb.exe"
$pgCtl = Join-Path $postgresBin "pg_ctl.exe"
$psql = Join-Path $postgresBin "psql.exe"
$pgIsReady = Join-Path $postgresBin "pg_isready.exe"
$dataDirectory = Join-Path $PSScriptRoot ".local-data\pg16"
$logDirectory = Join-Path $PSScriptRoot ".local-data"
$logPath = Join-Path $logDirectory "postgres.log"
$migrationPath = Join-Path $PSScriptRoot "migrations\001_accuracy_foundation.sql"
$port = if ($env:STACKTRACK_POSTGRES_PORT) {
  [int]$env:STACKTRACK_POSTGRES_PORT
} else {
  5433
}
$adminPassword = "stacktrack"

if (-not (Test-Path -LiteralPath $initdb)) {
  throw "PostgreSQL 16 was not found at $postgresHome. Install PostgreSQL 16 or update postgresHome in this script."
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory "PG_VERSION"))) {
  Write-Host "Initializing an isolated StackTrack PostgreSQL cluster..."
  $passwordFile = New-TemporaryFile
  try {
    [System.IO.File]::WriteAllText($passwordFile.FullName, $adminPassword)
    & $initdb `
      --pgdata=$dataDirectory `
      --username=postgres `
      --auth=scram-sha-256 `
      --encoding=UTF8 `
      --locale=C `
      --pwfile=$($passwordFile.FullName)
    if ($LASTEXITCODE -ne 0) {
      throw "PostgreSQL initialization failed."
    }
  } finally {
    Remove-Item -LiteralPath $passwordFile.FullName -Force -ErrorAction SilentlyContinue
  }
}

& $pgCtl status --pgdata=$dataDirectory | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Starting StackTrack PostgreSQL on 127.0.0.1:$port..."
  & $pgCtl `
    --pgdata=$dataDirectory `
    --log=$logPath `
    --options="-p $port -h 127.0.0.1" `
    --wait `
    start
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL failed to start. See $logPath."
  }
}

$env:PGPASSWORD = $adminPassword

$roleSql = @"
SELECT 'CREATE ROLE stacktrack LOGIN PASSWORD ''stacktrack'' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stacktrack')
\gexec
ALTER ROLE stacktrack WITH PASSWORD 'stacktrack' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
SELECT 'CREATE DATABASE stacktrack'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'stacktrack')
\gexec
"@

$roleSql | & $psql `
  --host=127.0.0.1 `
  --port=$port `
  --username=postgres `
  --dbname=postgres `
  --set=ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
  throw "Creating the local database roles failed."
}

$schemaExists = & $psql `
  --host=127.0.0.1 `
  --port=$port `
  --username=postgres `
  --dbname=stacktrack `
  --tuples-only `
  --no-align `
  --command="SELECT to_regclass('public.asset_events') IS NOT NULL;"

if ($schemaExists.Trim() -ne "t") {
  Write-Host "Applying the StackTrack accuracy schema..."
  & $psql `
    --host=127.0.0.1 `
    --port=$port `
    --username=postgres `
    --dbname=stacktrack `
    --set=ON_ERROR_STOP=1 `
    --file=$migrationPath
  if ($LASTEXITCODE -ne 0) {
    throw "The StackTrack database migration failed."
  }
}

$grantSql = @"
GRANT CONNECT ON DATABASE stacktrack TO stacktrack;
GRANT USAGE ON SCHEMA public TO stacktrack;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO stacktrack;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO stacktrack;
"@

$grantSql | & $psql `
  --host=127.0.0.1 `
  --port=$port `
  --username=postgres `
  --dbname=stacktrack `
  --set=ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
  throw "Granting local application permissions failed."
}

Remove-Item Env:PGPASSWORD

Write-Host ""
Write-Host "StackTrack PostgreSQL is ready."
Write-Host "Server:   127.0.0.1:$port"
Write-Host "Database: stacktrack"
Write-Host "App user: stacktrack"
Write-Host "Password: stacktrack (development only)"
