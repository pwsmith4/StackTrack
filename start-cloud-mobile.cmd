@echo off
setlocal
title StackTrack Cloud Mobile Test

cd /d "%~dp0"
set "EXPO_PUBLIC_API_URL=https://stacktrack-api-test.livelyrock-97a45fca.westus3.azurecontainerapps.io"

echo.
echo Starting StackTrack mobile against the Azure test environment...
echo Keep this window open while using the app on the emulator.
echo.
call npm.cmd run android --workspace @stacktrack/mobile -- --clear --lan

echo.
echo StackTrack mobile stopped. Press any key to close this window.
pause >nul
