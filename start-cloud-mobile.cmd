@echo off
setlocal
title StackTrack Cloud Mobile Test

cd /d "%~dp0apps\mobile"
set "EXPO_PUBLIC_API_URL=https://stacktrack-api-test.livelyrock-97a45fca.westus3.azurecontainerapps.io"

echo.
echo Starting the installed native StackTrack app against the Azure test environment...
echo Keep this window open while using the app on the emulator.
echo.
call npx.cmd expo start --dev-client --clear --lan

echo.
echo StackTrack mobile stopped. Press any key to close this window.
pause >nul
