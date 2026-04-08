#!/usr/bin/env bash
set -euo pipefail

APP_NAME="vless-allin-one"
INSTALL_DIR="${INSTALL_DIR:-/opt/${APP_NAME}}"
SERVICE_NAME="${SERVICE_NAME:-vless-allin-one}"
PANEL_PORT="${PANEL_PORT:-8765}"
PANEL_HOST="${PANEL_HOST:-0.0.0.0}"
PANEL_MODE="${PANEL_MODE:-live}"
PANEL_CFG="${PANEL_CFG:-/etc/vless-reality}"
REPO_URL="${REPO_URL:-https://github.com/DeraDream/vless-allin-one.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

need_root() {
  [[ "${EUID:-0}" -eq 0 ]] || fail "请使用 root 运行安装脚本"
}

detect_pm() {
  if command -v apt-get >/dev/null 2>&1; then
    echo apt
  elif command -v dnf >/dev/null 2>&1; then
    echo dnf
  elif command -v yum >/dev/null 2>&1; then
    echo yum
  elif command -v apk >/dev/null 2>&1; then
    echo apk
  else
    fail "未识别包管理器，无法自动安装依赖"
  fi
}

install_packages() {
  local pm
  pm="$(detect_pm)"
  log "安装基础依赖..."
  case "$pm" in
    apt)
      apt-get update -y
      DEBIAN_FRONTEND=noninteractive apt-get install -y git curl wget python3 ca-certificates
      ;;
    dnf)
      dnf install -y git curl wget python3 ca-certificates
      ;;
    yum)
      yum install -y git curl wget python3 ca-certificates
      ;;
    apk)
      apk update
      apk add --no-cache git curl wget python3 ca-certificates
      ;;
  esac
}

ensure_systemd() {
  command -v systemctl >/dev/null 2>&1 || fail "当前系统未检测到 systemd，安装脚本暂只支持 systemd"
}

fetch_repo() {
  log "部署目录: ${INSTALL_DIR}"
  mkdir -p "$(dirname "$INSTALL_DIR")"

  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    log "检测到已有仓库，执行更新..."
    git -C "$INSTALL_DIR" fetch --all --tags
    git -C "$INSTALL_DIR" checkout "$REPO_BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only origin "$REPO_BRANCH"
  else
    rm -rf "$INSTALL_DIR"
    git clone --depth=1 --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

prepare_runtime() {
  mkdir -p "$INSTALL_DIR/runtime"
  chmod +x \
    "$INSTALL_DIR/run_local.sh" \
    "$INSTALL_DIR/deploy_vps.sh" \
    "$INSTALL_DIR/backend/shell/vless_panel_bridge.sh" \
    "$INSTALL_DIR/install.sh"
}

write_service() {
  log "写入 systemd 服务: ${SERVICE_NAME}.service"
  cat >"/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=VLESS All-in-One Panel
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
Environment=PANEL_MODE=${PANEL_MODE}
Environment=PANEL_CFG=${PANEL_CFG}
Environment=PANEL_HOST=${PANEL_HOST}
Environment=PANEL_PORT=${PANEL_PORT}
ExecStart=/usr/bin/env python3 -m backend.server
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
}

start_service() {
  log "启动服务..."
  systemctl restart "$SERVICE_NAME"
  systemctl --no-pager --full status "$SERVICE_NAME" || true
}

print_summary() {
  local primary_ip
  primary_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -z "$primary_ip" ]] && primary_ip="你的服务器IP"

  cat <<EOF

==================================================
安装完成
目录: ${INSTALL_DIR}
服务: ${SERVICE_NAME}
模式: ${PANEL_MODE}
面板地址: http://${primary_ip}:${PANEL_PORT}

常用命令:
  systemctl status ${SERVICE_NAME}
  systemctl restart ${SERVICE_NAME}
  journalctl -u ${SERVICE_NAME} -f

如果面板无法访问，请检查:
  1. VPS 安全组/防火墙是否放行 ${PANEL_PORT}
  2. /etc/vless-reality 是否存在并有脚本运行数据
==================================================
EOF
}

main() {
  need_root
  ensure_systemd
  install_packages
  fetch_repo
  prepare_runtime
  write_service
  start_service
  print_summary
}

main "$@"
