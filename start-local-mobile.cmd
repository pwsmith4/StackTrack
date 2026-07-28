@echo off
setlocal
title StackTrack Local Android Test

cd /d "%~dp0"
set "EXPO_PUBLIC_API_URL=http://10.0.2.2:3000"

echo.
echo Starting StackTrack mobile against the local API for the Android emulator...
echo Keep this window open while testing.
echo.
call npm.cmd run android --workspace @stacktrack/mobile -- --clear --localhost

echo.
echo StackTrack mobile stopped. Press any key to close this window.
pause >nul
