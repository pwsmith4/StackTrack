@echo off
cd /d "%~dp0"
echo Running StackTrack automated checks...
echo.
npm.cmd test
npm.cmd run check
echo.
pause

