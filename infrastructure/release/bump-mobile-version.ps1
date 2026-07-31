param(
  [ValidateSet("patch", "minor", "major")]
  [string]$Bump = "patch"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$releasePath = Join-Path $root "apps\mobile\src\release.ts"
$appConfigPath = Join-Path $root "apps\mobile\app.json"
$packagePath = Join-Path $root "apps\mobile\package.json"

$release = Get-Content -Raw $releasePath
$match = [regex]::Match($release, 'APP_VERSION = "(?<version>\d+\.\d+\.\d+)";\s*\r?\nexport const APP_BUILD_NUMBER = (?<build>\d+);')
if (-not $match.Success) { throw "Could not read the current StackTrack mobile release number." }

$parts = $match.Groups["version"].Value.Split('.') | ForEach-Object { [int]$_ }
switch ($Bump) {
  "major" { $parts[0]++; $parts[1] = 0; $parts[2] = 0 }
  "minor" { $parts[1]++; $parts[2] = 0 }
  default { $parts[2]++ }
}
$nextVersion = $parts -join '.'
$nextBuild = [int]$match.Groups["build"].Value + 1

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$nextRelease = [regex]::Replace($release, 'APP_VERSION = "\d+\.\d+\.\d+";\s*\r?\nexport const APP_BUILD_NUMBER = \d+;', "APP_VERSION = `"$nextVersion`";`r`nexport const APP_BUILD_NUMBER = $nextBuild;", 1)
[System.IO.File]::WriteAllText($releasePath, $nextRelease, $utf8NoBom)

foreach ($path in @($appConfigPath, $packagePath)) {
  $content = Get-Content -Raw $path
  $content = [regex]::Replace($content, '"version": "\d+\.\d+\.\d+"', "`"version`": `"$nextVersion`"", 1)
  if ($path -eq $appConfigPath) {
    $content = [regex]::Replace($content, '"versionCode": \d+', "`"versionCode`": $nextBuild", 1)
  }
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

Write-Host "StackTrack mobile release bumped to $nextVersion (build $nextBuild)."
