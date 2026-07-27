@echo off
setlocal
title StackTrack Local Android Build

cd /d "%~dp0apps\mobile"
set "JAVA_HOME=C:\Program Files\Java\jdk-17"
set "PATH=%JAVA_HOME%\bin;%PATH%"
set "EXPO_PUBLIC_API_URL=http://10.0.2.2:3000"

echo.
echo Building and installing StackTrack on the Android emulator...
echo The emulator will report its installed version to the local admin site.
echo.
call npx.cmd expo run:android

echo.
echo Android build stopped. Press any key to close this window.
pause >nul
