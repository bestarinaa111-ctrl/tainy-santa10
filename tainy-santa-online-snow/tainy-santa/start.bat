@echo off
cd /d "%~dp0"
node --version >nul 2>&1
if errorlevel 1 (
  echo Node.js ne naiden. Ustanovite Node.js 18 ili novee: https://nodejs.org/
  pause
  exit /b 1
)
node server.js
pause
