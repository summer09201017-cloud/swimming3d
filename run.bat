@echo off
REM swimming3d playtest. English-only, CRLF.
cd /d "%~dp0"
echo Starting Swimming 3D ...
if not exist "node_modules" call npm install
call npm run dev -- --open --port 5221
pause
