@echo off
cd /d "%~dp0"
echo Starting StackTrack API, admin website, and mobile preview...
echo Leave this window open while testing. The first mobile start can take a minute.
echo.
npm.cmd run dev
