#!/usr/bin/env bash
set -euo pipefail

APP_NAME="vless-allin-one"
INSTALL_DIR="${INSTALL_DIR:-/opt/${APP_NAME}}"
SERVICE_NAME="${SERVICE_NAME:-vless-allin-one}"
PANEL_PORT="${PANEL_PORT:-}"
PANEL_HOST="${PANEL_HOST:-0.0.0.0}"
PANEL_MODE="${PANEL_MODE:-live}"
PANEL_CFG="${PANEL_CFG:-/etc/vless-reality}"
REPO_URL="${REPO_URL:-https://github.com/DeraDream/vless-allin-one.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
REQUIRE_NODE="${REQUIRE_NODE:-false}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

random_panel_port() {
  shuf -i 20000-40000 -n 1 2>/dev/null || awk 'BEGIN{srand(); print int(20000 + rand() * 20000)}'
}

resolve_panel_port() {
  if [[ -z "$PANEL_PORT" ]]; then
    PANEL_PORT="$(random_panel_port)"
    log "未指定面板端口，已自动分配随机端口: ${PANEL_PORT}"
  fi
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
      DEBIAN_FRONTEND=noninteractive apt-get install -y \
        git curl wget python3 python3-venv python3-pip ca-certificates jq openssl
      if [[ "$REQUIRE_NODE" == "true" ]]; then
        DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm || true
      fi
      ;;
    dnf)
      dnf install -y git curl wget python3 python3-pip ca-certificates jq openssl
      [[ "$REQUIRE_NODE" == "true" ]] && dnf install -y nodejs npm || true
      ;;
    yum)
      yum install -y git curl wget python3 python3-pip ca-certificates jq openssl
      [[ "$REQUIRE_NODE" == "true" ]] && yum install -y nodejs npm || true
      ;;
    apk)
      apk update
      apk add --no-cache git curl wget python3 py3-pip ca-certificates jq openssl bash
      [[ "$REQUIRE_NODE" == "true" ]] && apk add --no-cache nodejs npm || true
      ;;
  esac
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

python_version_ok() {
  python3 - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if sys.version_info >= (3, 8) else 1)
PY
}

node_version_ok() {
  node - <<'JS' >/dev/null 2>&1
const major = Number(process.versions.node.split('.')[0]);
process.exit(major >= 18 ? 0 : 1);
JS
}

verify_environment() {
  log "执行环境检测..."

  local required_cmds missing=()
  required_cmds=(git curl wget python3 jq openssl systemctl bash)

  for cmd in "${required_cmds[@]}"; do
    command_exists "$cmd" || missing+=("$cmd")
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    fail "安装后仍缺少依赖: ${missing[*]}"
  fi

  python_version_ok || fail "需要 Python 3.8+"

  local bash_major="${BASH_VERSINFO[0]:-0}"
  [[ "$bash_major" -ge 4 ]] || fail "需要 Bash 4+，当前版本不满足"

  if [[ "$REQUIRE_NODE" == "true" ]]; then
    command_exists node || fail "需要 Node.js，但未安装成功"
    command_exists npm || fail "需要 npm，但未安装成功"
    node_version_ok || fail "需要 Node.js 18+"
  fi

  log "环境检测通过"
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
    "$INSTALL_DIR/install.sh" \
    "$INSTALL_DIR/vless-server.sh"
}

write_cli() {
  log "写入命令行菜单: /usr/local/bin/vless"
  cat >"/usr/local/bin/vless" <<EOF
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${INSTALL_DIR}"
PANEL_SERVICE="${SERVICE_NAME}"

kill_panel_processes() {
  pkill -f "\$APP_DIR.*backend\\.server" 2>/dev/null || true
  pkill -f "python3 -m backend.server" 2>/dev/null || true
}

show_menu() {
  echo ""
  echo "VLESS 管理菜单"
  echo "1. 打开脚本主菜单"
  echo "2. 查看面板状态"
  echo "3. 重启面板"
  echo "4. 停止面板"
  echo "5. 启动面板"
  echo "6. 查看实时日志"
  echo "7. 更新项目"
  echo "8. 彻底卸载面板"
  echo "0. 退出"
  echo ""
  read -rp "请选择: " choice
  case "\$choice" in
    1) bash "\$APP_DIR/vless-server.sh" ;;
    2) systemctl --no-pager --full status "\$PANEL_SERVICE" ;;
    3) systemctl restart "\$PANEL_SERVICE" && systemctl --no-pager --full status "\$PANEL_SERVICE" ;;
    4) systemctl stop "\$PANEL_SERVICE" ;;
    5) systemctl start "\$PANEL_SERVICE" && systemctl --no-pager --full status "\$PANEL_SERVICE" ;;
    6) journalctl -u "\$PANEL_SERVICE" -f ;;
    7) git -C "\$APP_DIR" fetch --all --tags && git -C "\$APP_DIR" pull --ff-only && systemctl restart "\$PANEL_SERVICE" ;;
    8)
      read -rp "确认彻底卸载面板和命令菜单？[y/N]: " confirm
      [[ "\$confirm" =~ ^[yY]$ ]] || exit 0
      systemctl stop "\$PANEL_SERVICE" 2>/dev/null || true
      systemctl disable "\$PANEL_SERVICE" 2>/dev/null || true
      kill_panel_processes
      rm -f "/etc/systemd/system/\${PANEL_SERVICE}.service"
      systemctl daemon-reload 2>/dev/null || true
      rm -f /usr/local/bin/vless
      rm -rf "\$APP_DIR"
      echo "面板已彻底卸载"
      ;;
    0) exit 0 ;;
    *) echo "无效选择"; exit 1 ;;
  esac
}

case "\${1:-menu}" in
  menu) show_menu ;;
  script) bash "\$APP_DIR/vless-server.sh" ;;
  status) systemctl --no-pager --full status "\$PANEL_SERVICE" ;;
  restart) systemctl restart "\$PANEL_SERVICE" ;;
  stop) systemctl stop "\$PANEL_SERVICE" && kill_panel_processes ;;
  start) systemctl start "\$PANEL_SERVICE" ;;
  logs) journalctl -u "\$PANEL_SERVICE" -f ;;
  update) git -C "\$APP_DIR" fetch --all --tags && git -C "\$APP_DIR" pull --ff-only && systemctl restart "\$PANEL_SERVICE" ;;
  uninstall)
    systemctl stop "\$PANEL_SERVICE" 2>/dev/null || true
    systemctl disable "\$PANEL_SERVICE" 2>/dev/null || true
    kill_panel_processes
    rm -f "/etc/systemd/system/\${PANEL_SERVICE}.service"
    systemctl daemon-reload 2>/dev/null || true
    rm -f /usr/local/bin/vless
    rm -rf "\$APP_DIR"
    ;;
  *)
    echo "用法: vless [menu|script|status|restart|stop|start|logs|update|uninstall]"
    exit 1
    ;;
esac
EOF
  chmod +x /usr/local/bin/vless
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
  vless

如果面板无法访问，请检查:
  1. VPS 安全组/防火墙是否放行 ${PANEL_PORT}
  2. /etc/vless-reality 是否存在并有脚本运行数据
==================================================
EOF
}

main() {
  need_root
  resolve_panel_port
  ensure_systemd
  install_packages
  verify_environment
  fetch_repo
  prepare_runtime
  write_cli
  write_service
  start_service
  print_summary
}

main "$@"
