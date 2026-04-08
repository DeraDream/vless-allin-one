$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

if (-not (Test-Path "runtime")) {
  New-Item -ItemType Directory -Path "runtime" | Out-Null
}

if (-not $env:PANEL_MODE) { $env:PANEL_MODE = "mock" }
if (-not $env:PANEL_HOST) { $env:PANEL_HOST = "127.0.0.1" }
if (-not $env:PANEL_PORT) { $env:PANEL_PORT = "8765" }

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  $python = Get-Command python3 -ErrorAction SilentlyContinue
}

if (-not $python) {
  Write-Host "Python 3.8+ was not found. Please install Python and enable Add python to PATH." -ForegroundColor Red
  exit 1
}

Write-Host "Starting VLESS Panel: http://$($env:PANEL_HOST):$($env:PANEL_PORT) (mode=$($env:PANEL_MODE))" -ForegroundColor Cyan
& $python.Source -m backend.server
