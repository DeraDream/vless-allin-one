#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/vless-allin-one}"
SERVICE_NAME="${SERVICE_NAME:-vless-allin-one}"
REPO_BRANCH="${REPO_BRANCH:-main}"

[[ "${EUID:-0}" -eq 0 ]] || {
  echo "请使用 root 运行 update.sh"
  exit 1
}

if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
  echo "未找到安装目录: ${INSTALL_DIR}"
  exit 1
fi

git -C "$INSTALL_DIR" fetch --all --tags
git -C "$INSTALL_DIR" checkout "$REPO_BRANCH"
git -C "$INSTALL_DIR" pull --ff-only origin "$REPO_BRANCH"

chmod +x \
  "$INSTALL_DIR/run_local.sh" \
  "$INSTALL_DIR/deploy_vps.sh" \
  "$INSTALL_DIR/backend/shell/vless_panel_bridge.sh" \
  "$INSTALL_DIR/install.sh" \
  "$INSTALL_DIR/update.sh"

systemctl daemon-reload
systemctl restart "$SERVICE_NAME"
systemctl --no-pager --full status "$SERVICE_NAME" || true
