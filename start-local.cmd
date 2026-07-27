@echo off
cd /d "%~dp0"
rem Allow the Android emulator to reach the local API at 10.0.2.2:3000.
set "LOCAL_HOST=0.0.0.0"
echo Starting the isolated StackTrack PostgreSQL database...
call npm.cmd run db:start
if errorlevel 1 (
  echo.
  echo StackTrack could not start its database.
  pause
  exit /b 1
)
echo.
echo Starting StackTrack API, admin website, and mobile preview...
echo Leave this window open while testing. The first mobile start can take a minute.
echo.
call npm.cmd run dev
