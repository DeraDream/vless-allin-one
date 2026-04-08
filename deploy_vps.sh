#!/bin/bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "用法: $0 user@host [target_dir]"
  exit 1
fi

TARGET="$1"
TARGET_DIR="${2:-/opt/vless-server-panel}"
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

tar czf /tmp/vless-server-panel.tar.gz \
  --exclude runtime \
  -C "$ROOT_DIR" \
  .

scp /tmp/vless-server-panel.tar.gz "$TARGET:/tmp/vless-server-panel.tar.gz"
ssh "$TARGET" "mkdir -p '$TARGET_DIR' && tar xzf /tmp/vless-server-panel.tar.gz -C '$TARGET_DIR' && chmod +x '$TARGET_DIR/run_local.sh' '$TARGET_DIR/deploy_vps.sh' '$TARGET_DIR/backend/shell/vless_panel_bridge.sh'"

echo "已部署到 $TARGET:$TARGET_DIR"
