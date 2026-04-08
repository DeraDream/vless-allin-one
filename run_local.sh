#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p runtime
export PANEL_MODE="${PANEL_MODE:-mock}"
export PANEL_HOST="${PANEL_HOST:-127.0.0.1}"
export PANEL_PORT="${PANEL_PORT:-8765}"

python3 -m backend.server
