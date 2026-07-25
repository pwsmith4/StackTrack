$ErrorActionPreference = "Stop"

$pgCtl = "C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe"
$dataDirectory = Join-Path $PSScriptRoot ".local-data\pg16"

if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory "PG_VERSION"))) {
  Write-Host "The StackTrack PostgreSQL cluster has not been initialized."
  exit 0
}

& $pgCtl --pgdata=$dataDirectory --wait stop
if ($LASTEXITCODE -ne 0) {
  throw "PostgreSQL did not stop cleanly."
}

Write-Host "StackTrack PostgreSQL stopped."
