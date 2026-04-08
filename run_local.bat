@echo off
setlocal
cd /d "%~dp0"

if not exist runtime mkdir runtime

if "%PANEL_MODE%"=="" set PANEL_MODE=mock
if "%PANEL_HOST%"=="" set PANEL_HOST=127.0.0.1
if "%PANEL_PORT%"=="" set PANEL_PORT=8765

where python >nul 2>nul
if %errorlevel%==0 (
  echo Starting VLESS Panel: http://%PANEL_HOST%:%PANEL_PORT% ^(mode=%PANEL_MODE%^)
  python -m backend.server
  exit /b %errorlevel%
)

where python3 >nul 2>nul
if %errorlevel%==0 (
  echo Starting VLESS Panel: http://%PANEL_HOST%:%PANEL_PORT% ^(mode=%PANEL_MODE%^)
  python3 -m backend.server
  exit /b %errorlevel%
)

echo Python 3.8+ not found. Please install Python and add it to PATH.
exit /b 1
