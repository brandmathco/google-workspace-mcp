@echo off
setlocal
cd /d "%~dp0"

echo.
echo BrandMatchGrowth - Google Workspace MCP Setup Wizard
echo ====================================================
echo https://www.brandmatchgrowth.com/
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo 1^) Open https://nodejs.org
  echo 2^) Download the LTS installer and run it
  echo 3^) Double-click this file again
  echo.
  start "" "https://nodejs.org"
  pause
  exit /b 1
)

for /f %%A in ('node -p "process.versions.node.split('.')[0]"') do set MAJOR=%%A
if %MAJOR% LSS 20 (
  echo Node.js 20+ is required. You have:
  node -v
  start "" "https://nodejs.org"
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Starting wizard...
call npx --yes tsx setup/wizard-server.ts
if errorlevel 1 (
  echo Wizard exited with an error.
  pause
  exit /b 1
)

endlocal
