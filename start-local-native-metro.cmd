@echo off
setlocal
title StackTrack Native Android Development Server

cd /d "%~dp0apps\mobile"
set "EXPO_PUBLIC_API_URL=http://10.0.2.2:3000"

echo.
echo Starting Metro for the installed StackTrack native Android app...
echo Keep this window open while testing.
echo.
call npx.cmd expo start --dev-client --clear --lan

echo.
echo Metro stopped. Press any key to close this window.
pause >nul
