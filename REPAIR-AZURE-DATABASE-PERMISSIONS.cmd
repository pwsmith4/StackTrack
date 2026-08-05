@echo off
setlocal
cd /d "%~dp0"

echo StackTrack Azure administrator-delete permission repair
echo.
echo You will be prompted for the Azure PostgreSQL administrator password.
echo The password is used only by psql for this repair and is not saved.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\infrastructure\postgres\apply-azure-admin-delete-permissions.ps1" -ServerName "testserv5.postgres.database.azure.com" -AdminLogin "theparkersmith" -ApplicationRole "stacktrack_app"
if errorlevel 1 (
  echo.
  echo The permission repair did not complete. Leave this window open and share the error shown above.
  pause
  exit /b 1
)

echo.
echo Azure database permissions are ready. Refresh the StackTrack admin website.
pause
