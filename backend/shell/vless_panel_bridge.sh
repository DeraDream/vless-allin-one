#!/bin/bash
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/vless-server.sh"
CFG_DIR="${VLESS_CFG:-/etc/vless-reality}"
DB_FILE="$CFG_DIR/db.json"

command="${1:-}"
payload_b64="${PANEL_PAYLOAD_B64:-}"
payload="${PANEL_PAYLOAD:-${2:-{}}}"
if [[ -n "$payload_b64" ]]; then
  payload="$(printf '%s' "$payload_b64" | base64 -d 2>/dev/null || true)"
fi

if [[ -z "${BASH_VERSINFO:-}" || "${BASH_VERSINFO[0]}" -lt 4 ]]; then
  json_fail() {
    local message="$1"
    jq -n --arg msg "$message" '{ok:false,message:$msg}'
  }
  json_fail "live 模式需要 Bash 4+，建议在 Linux VPS 上运行"
  exit 1
fi

source "$SCRIPT_PATH"
init_db >/dev/null 2>&1 || true

json_ok() {
  local message="$1"
  jq -n --arg msg "$message" '{ok:true,message:$msg}'
}

json_fail() {
  local message="$1"
  jq -n --arg msg "$message" '{ok:false,message:$msg}'
}

short_error() {
  local text="${1:-}"
  text="$(printf '%s' "$text" | tr '\r\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/^ //; s/ $//')"
  [[ -z "$text" ]] && text="无输出（可能是系统依赖缺失、包管理器异常或网络不可达）"
  if [[ ${#text} -gt 220 ]]; then
    text="${text:0:220}..."
  fi
  printf '%s' "$text"
}

run_with_error_capture() {
  local __var_name="$1"
  shift
  local out
  set +e
  out="$("$@" 2>&1)"
  local rc=$?
  set -e
  printf -v "$__var_name" '%s' "$out"
  return $rc
}

progress_emit() {
  local message="$1"
  printf '__PROGRESS__:%s\n' "$message" >&2
}

xray_bin() {
  if command -v xray >/dev/null 2>&1; then
    command -v xray
    return 0
  fi
  [[ -x /usr/local/bin/xray ]] && { echo /usr/local/bin/xray; return 0; }
  [[ -x /usr/bin/xray ]] && { echo /usr/bin/xray; return 0; }
  return 1
}

singbox_bin() {
  if command -v sing-box >/dev/null 2>&1; then
    command -v sing-box
    return 0
  fi
  [[ -x /usr/local/bin/sing-box ]] && { echo /usr/local/bin/sing-box; return 0; }
  [[ -x /usr/bin/sing-box ]] && { echo /usr/bin/sing-box; return 0; }
  return 1
}

service_state_json() {
  local service_name="$1"
  if svc status "$service_name" >/dev/null 2>&1; then
    printf '%s' 'running'
  else
    printf '%s' 'stopped'
  fi
}

reality_keys_generate() {
  local bin
  bin="$(xray_bin)" || return 1
  "$bin" x25519 2>&1
}

reality_key_extract() {
  local label="$1"
  local content="$2"
  printf '%s\n' "$content" \
    | tr -d '\r' \
    | awk -F': *' -v target="$label" '
        tolower($1) ~ target {
          print $2
          exit
        }
      '
}

normalize_short_id() {
  local value="$1"
  value="$(printf '%s' "$value" | tr 'A-F' 'a-f' | tr -cd '0-9a-f')"
  [[ -z "$value" ]] && { gen_sid; return 0; }
  if (( ${#value} % 2 == 1 )); then
    value="0${value}"
  fi
  if (( ${#value} > 16 )); then
    value="${value:0:16}"
  fi
  printf '%s' "$value"
}

payload_get() {
  local key="$1"
  payload_validate || { json_fail "安装参数解析失败"; exit 1; }
  printf '%s' "$payload" | jq -r --arg key "$key" '.[$key] // empty'
}

payload_validate() {
  printf '%s' "$payload" | jq -e . >/dev/null 2>&1
}

ensure_base_dependencies() {
  command -v jq >/dev/null 2>&1 || { json_fail "缺少 jq"; exit 1; }
  command -v openssl >/dev/null 2>&1 || { json_fail "缺少 openssl"; exit 1; }
}

detect_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "apt-get"
    return 0
  fi
  if command -v dnf >/dev/null 2>&1; then
    echo "dnf"
    return 0
  fi
  if command -v yum >/dev/null 2>&1; then
    echo "yum"
    return 0
  fi
  if command -v apk >/dev/null 2>&1; then
    echo "apk"
    return 0
  fi
  return 1
}

install_system_packages() {
  local pm="$1"
  shift
  local pkgs=("$@")
  local out=""
  PRECHECK_LAST_ERROR=""
  case "$pm" in
    apt-get)
      run_with_error_capture out env DEBIAN_FRONTEND=noninteractive apt-get update || { PRECHECK_LAST_ERROR="$out"; return 1; }
      run_with_error_capture out env DEBIAN_FRONTEND=noninteractive apt-get install -y "${pkgs[@]}" || { PRECHECK_LAST_ERROR="$out"; return 1; }
      ;;
    dnf)
      run_with_error_capture out dnf install -y "${pkgs[@]}" || { PRECHECK_LAST_ERROR="$out"; return 1; }
      ;;
    yum)
      run_with_error_capture out yum install -y "${pkgs[@]}" || { PRECHECK_LAST_ERROR="$out"; return 1; }
      ;;
    apk)
      run_with_error_capture out apk add --no-cache "${pkgs[@]}" || { PRECHECK_LAST_ERROR="$out"; return 1; }
      ;;
    *)
      return 1
      ;;
  esac
  return 0
}

ensure_cmd_or_install() {
  local cmd="$1"
  shift
  local pm="$1"
  shift
  local pkgs=("$@")
  command -v "$cmd" >/dev/null 2>&1 && return 0
  [[ -n "$pm" ]] || return 1
  install_system_packages "$pm" "${pkgs[@]}" || return 1
  command -v "$cmd" >/dev/null 2>&1
}

diag_append() {
  local current="$1"
  local item="$2"
  if [[ -z "$current" ]]; then
    printf '%s' "$item"
  else
    printf '%s | %s' "$current" "$item"
  fi
}

diagnose_xray_install_failure() {
  local reason=""
  local arch xarch latest_tag latest_ver api_out asset_url net_out

  for cmd in curl jq unzip tar bash; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      reason="$(diag_append "$reason" "缺少命令:$cmd")"
    fi
  done

  [[ -w /usr/local/bin ]] || reason="$(diag_append "$reason" "/usr/local/bin 不可写")"

  arch="$(uname -m 2>/dev/null || echo unknown)"
  case "$arch" in
    x86_64) xarch="64" ;;
    aarch64) xarch="arm64-v8a" ;;
    armv7l) xarch="arm32-v7a" ;;
    *)
      reason="$(diag_append "$reason" "不支持架构:$arch")"
      xarch=""
      ;;
  esac

  api_out=""
  if ! run_with_error_capture api_out curl -fsSL --connect-timeout 10 --max-time 20 \
    https://api.github.com/repos/XTLS/Xray-core/releases/latest; then
    reason="$(diag_append "$reason" "GitHub API 不可达: $(short_error "$api_out")")"
  else
    latest_tag="$(printf '%s' "$api_out" | jq -r '.tag_name // empty' 2>/dev/null || true)"
    latest_ver="${latest_tag#v}"
    if [[ -z "$latest_ver" || "$latest_ver" == "null" ]]; then
      reason="$(diag_append "$reason" "无法解析 Xray 最新版本号")"
    fi
  fi

  if [[ -n "$xarch" && -n "$latest_ver" ]]; then
    asset_url="https://github.com/XTLS/Xray-core/releases/download/v${latest_ver}/Xray-linux-${xarch}.zip"
    net_out=""
    if ! run_with_error_capture net_out curl -fsSLI --connect-timeout 15 --max-time 30 "$asset_url"; then
      reason="$(diag_append "$reason" "Xray 资产不可达: $(short_error "$net_out")")"
    fi
  fi

  [[ -n "$reason" ]] || reason="安装函数返回非零但无输出（建议手动执行 install_xray 观察实时日志）"
  printf '%s' "$reason"
}

install_xray_direct() {
  local arch xarch api_out latest_tag latest_ver url out
  local tmp_dir bin_path

  arch="$(uname -m 2>/dev/null || echo unknown)"
  case "$arch" in
    x86_64) xarch="64" ;;
    aarch64) xarch="arm64-v8a" ;;
    armv7l) xarch="arm32-v7a" ;;
    *) return 1 ;;
  esac

  if ! run_with_error_capture api_out curl -fsSL --connect-timeout 15 --max-time 30 \
    https://api.github.com/repos/XTLS/Xray-core/releases/latest; then
    return 1
  fi
  latest_tag="$(printf '%s' "$api_out" | jq -r '.tag_name // empty' 2>/dev/null || true)"
  latest_ver="${latest_tag#v}"
  [[ -n "$latest_ver" && "$latest_ver" != "null" ]] || return 1

  url="https://github.com/XTLS/Xray-core/releases/download/v${latest_ver}/Xray-linux-${xarch}.zip"
  tmp_dir="$(mktemp -d 2>/dev/null || true)"
  [[ -n "$tmp_dir" && -d "$tmp_dir" ]] || return 1

  if ! run_with_error_capture out curl -fsSL --connect-timeout 30 --max-time 180 --retry 2 \
    -o "${tmp_dir}/xray.zip" "$url"; then
    rm -rf "$tmp_dir"
    return 1
  fi

  if ! run_with_error_capture out unzip -oq "${tmp_dir}/xray.zip" -d "$tmp_dir"; then
    rm -rf "$tmp_dir"
    return 1
  fi

  bin_path="$(find "$tmp_dir" -type f -name xray | head -n1)"
  [[ -n "$bin_path" && -f "$bin_path" ]] || { rm -rf "$tmp_dir"; return 1; }

  install -m 755 "$bin_path" /usr/local/bin/xray || { rm -rf "$tmp_dir"; return 1; }
  mkdir -p /usr/local/share/xray
  find "$tmp_dir" -type f -name "*.dat" -exec cp -f {} /usr/local/share/xray/ \; 2>/dev/null || true

  if ! command -v xray >/dev/null 2>&1; then
    rm -rf "$tmp_dir"
    return 1
  fi
  xray version >/dev/null 2>&1 || { rm -rf "$tmp_dir"; return 1; }

  rm -rf "$tmp_dir"
  return 0
}

preflight_binary_install() {
  [[ "${EUID:-0}" -eq 0 ]] || { json_fail "需要 root 权限执行安装（请使用 root 或 sudo）"; exit 1; }

  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|aarch64|armv7l) ;;
    *)
      json_fail "当前架构不支持自动安装核心: $arch"
      exit 1
      ;;
  esac

  mkdir -p /usr/local/bin >/dev/null 2>&1 || true
  [[ -w /usr/local/bin ]] || { json_fail "/usr/local/bin 不可写，请检查权限"; exit 1; }

  local pm=""
  pm="$(detect_package_manager || true)"
  [[ -n "$pm" ]] || { json_fail "未检测到支持的包管理器（apt-get/dnf/yum/apk）"; exit 1; }

  # 核心安装依赖
  if ! ensure_cmd_or_install curl "$pm" curl; then
    json_fail "缺少 curl，且自动安装失败: $(short_error "$PRECHECK_LAST_ERROR")"
    exit 1
  fi
  if ! ensure_cmd_or_install unzip "$pm" unzip; then
    json_fail "缺少 unzip，且自动安装失败: $(short_error "$PRECHECK_LAST_ERROR")"
    exit 1
  fi
  if ! ensure_cmd_or_install tar "$pm" tar; then
    json_fail "缺少 tar，且自动安装失败: $(short_error "$PRECHECK_LAST_ERROR")"
    exit 1
  fi

  # jq/openssl 已在 ensure_base_dependencies 校验，这里补自动安装能力
  if ! command -v jq >/dev/null 2>&1; then
    if ! install_system_packages "$pm" jq; then
      json_fail "缺少 jq，且自动安装失败: $(short_error "$PRECHECK_LAST_ERROR")"
      exit 1
    fi
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    if ! install_system_packages "$pm" openssl ca-certificates; then
      json_fail "缺少 openssl/ca-certificates，且自动安装失败: $(short_error "$PRECHECK_LAST_ERROR")"
      exit 1
    fi
  fi

  local net_out=""
  if ! run_with_error_capture net_out curl -fsSL --connect-timeout 10 --max-time 20 https://api.github.com/repos/XTLS/Xray-core/releases/latest; then
    json_fail "无法访问 GitHub API，请检查服务器网络/DNS/防火墙: $(short_error "$net_out")"
    exit 1
  fi
}

ensure_xray_ready() {
  local out=""
  if ! xray_bin >/dev/null 2>&1; then
    preflight_binary_install
    check_dependencies >/dev/null 2>&1 || true
    if ! run_with_error_capture out install_xray; then
      # 主脚本安装失败时，启用桥接层兜底安装，避免黑盒失败卡死。
      if ! install_xray_direct; then
        [[ -z "$(printf '%s' "$out" | tr -d '[:space:]')" ]] && out="$(diagnose_xray_install_failure)"
        [[ -n "$out" ]] && printf '%s\n' "$out" >&2
        json_fail "Xray 安装失败: $(short_error "$out")"
        exit 1
      fi
    fi
  fi
  if ! xray_bin >/dev/null 2>&1; then
    json_fail "Xray 安装后未检测到可执行文件"
    exit 1
  fi
}

ensure_singbox_ready() {
  local out=""
  if ! singbox_bin >/dev/null 2>&1; then
    preflight_binary_install
    check_dependencies >/dev/null 2>&1 || true
    if ! run_with_error_capture out install_singbox; then
      [[ -n "$out" ]] && printf '%s\n' "$out" >&2
      json_fail "Sing-box 安装失败: $(short_error "$out")"
      exit 1
    fi
  fi
  if ! singbox_bin >/dev/null 2>&1; then
    json_fail "Sing-box 安装后未检测到可执行文件"
    exit 1
  fi
}

panel_protocol_core() {
  local protocol="$1"
  if [[ " $SINGBOX_PROTOCOLS " == *" $protocol "* ]]; then
    echo "singbox"
  else
    echo "xray"
  fi
}

panel_reload_core() {
  local core="$1"
  local out=""
  local out_fallback=""
  case "$core" in
    xray)
      if [[ -n "$(get_xray_protocols 2>/dev/null || true)" ]]; then
        create_server_scripts >/dev/null 2>&1 || true
        create_service "vless" >/dev/null 2>&1 || true
        if ! run_with_error_capture out rebuild_and_reload_xray "silent"; then
          if ! run_with_error_capture out_fallback start_services; then
            [[ -n "$out" ]] && printf '%s\n' "$out" >&2
            [[ -n "$out_fallback" ]] && printf '%s\n' "$out_fallback" >&2
            return 1
          fi
        fi
        if ! svc status vless-reality >/dev/null 2>&1; then
          if ! run_with_error_capture out svc start vless-reality; then
            [[ -n "$out" ]] && printf '%s\n' "$out" >&2
            return 1
          fi
        fi
      else
        svc stop vless-reality >/dev/null 2>&1 || true
        rm -f "$CFG/config.json"
      fi
      ;;
    singbox)
      if [[ -n "$(get_singbox_protocols 2>/dev/null || true)" ]]; then
        create_server_scripts >/dev/null 2>&1 || true
        create_singbox_service >/dev/null 2>&1 || true
        if ! run_with_error_capture out rebuild_and_reload_singbox "silent"; then
          if ! run_with_error_capture out_fallback start_services; then
            [[ -n "$out" ]] && printf '%s\n' "$out" >&2
            [[ -n "$out_fallback" ]] && printf '%s\n' "$out_fallback" >&2
            return 1
          fi
        fi
        if ! svc status vless-singbox >/dev/null 2>&1; then
          if ! run_with_error_capture out svc start vless-singbox; then
            [[ -n "$out" ]] && printf '%s\n' "$out" >&2
            return 1
          fi
        fi
      else
        svc stop vless-singbox >/dev/null 2>&1 || true
        rm -f "$CFG/singbox.json"
      fi
      ;;
  esac
  return 0
}

panel_reload_all_routing() {
  panel_reload_core "xray"
  panel_reload_core "singbox"
}

panel_remove_protocol_state() {
  local core="$1"
  local protocol="$2"
  local ports
  ports="$(db_list_ports "$core" "$protocol" 2>/dev/null || true)"
  if [[ -n "$ports" ]]; then
    while IFS= read -r existing_port; do
      [[ -z "$existing_port" ]] && continue
      db_remove_port "$core" "$protocol" "$existing_port" >/dev/null 2>&1 || true
    done <<< "$ports"
  fi
  db_del "$core" "$protocol" >/dev/null 2>&1 || true
  panel_reload_core "$core"
}

panel_reload_services() {
  panel_reload_core "xray"
  panel_reload_core "singbox"
  json_ok "services reloaded"
}

panel_install_protocol() {
  ensure_base_dependencies
  progress_emit "检查安装参数"

  local protocol port domain transport cert_mode notes short_id server_name core
  protocol="$(payload_get protocol)"
  port="$(payload_get port)"
  domain="$(payload_get domain)"
  transport="$(payload_get transport)"
  cert_mode="$(payload_get cert_mode)"
  notes="$(payload_get notes)"
  short_id="$(payload_get short_id)"
  server_name="$(payload_get server_name)"
  core="$(panel_protocol_core "$protocol")"
  if db_exists "$core" "$protocol"; then
    progress_emit "检测到已安装同协议，先彻底卸载旧配置"
    panel_remove_protocol_state "$core" "$protocol"
  fi

  [[ -z "$protocol" || -z "$port" ]] && { json_fail "缺少协议或端口"; exit 1; }

  case "$protocol" in
    vless)
      progress_emit "检查 Xray 依赖"
      ensure_xray_ready
      local uuid sid keys privkey pubkey sni
      uuid="$(gen_uuid)"
      sid="$(normalize_short_id "${short_id:-$(gen_sid)}")"
      sni="${server_name:-${domain:-$(gen_sni)}}"
      progress_emit "生成 Reality 密钥"
      if ! run_with_error_capture keys reality_keys_generate; then
        [[ -n "$keys" ]] && printf '%s\n' "$keys" >&2
        json_fail "Reality 密钥生成失败: $(short_error "$keys")"
        exit 1
      fi
      privkey="$(reality_key_extract 'private[ _-]*key' "$keys")"
      pubkey="$(reality_key_extract 'public[ _-]*key' "$keys")"
      [[ -z "$pubkey" ]] && pubkey="$(reality_key_extract 'password' "$keys")"
      [[ -z "$privkey" || -z "$pubkey" ]] && { json_fail "Reality 密钥生成失败"; exit 1; }
      progress_emit "写入 VLESS Reality 配置"
      gen_server_config "$uuid" "$port" "$privkey" "$pubkey" "$sid" "$sni" || { json_fail "写入 VLESS Reality 配置失败"; exit 1; }
      progress_emit "创建服务并启动"
      create_server_scripts || { json_fail "创建服务脚本失败"; exit 1; }
      create_service "$protocol" || { json_fail "创建服务失败"; exit 1; }
      panel_reload_core "xray" || { json_fail "重载 Xray 服务失败"; exit 1; }
      json_ok "VLESS 已安装并写入脚本数据库"
      ;;
    vless-xhttp)
      progress_emit "检查 Xray 依赖"
      ensure_xray_ready
      local uuid sid keys privkey pubkey sni path
      uuid="$(gen_uuid)"
      sid="$(normalize_short_id "${short_id:-$(gen_sid)}")"
      path="/xhttp"
      sni="${server_name:-${domain:-$(gen_sni)}}"
      progress_emit "生成 XHTTP Reality 密钥"
      if ! run_with_error_capture keys reality_keys_generate; then
        [[ -n "$keys" ]] && printf '%s\n' "$keys" >&2
        json_fail "XHTTP Reality 密钥生成失败: $(short_error "$keys")"
        exit 1
      fi
      privkey="$(reality_key_extract 'private[ _-]*key' "$keys")"
      pubkey="$(reality_key_extract 'public[ _-]*key' "$keys")"
      [[ -z "$pubkey" ]] && pubkey="$(reality_key_extract 'password' "$keys")"
      [[ -z "$privkey" || -z "$pubkey" ]] && { json_fail "XHTTP Reality 密钥生成失败"; exit 1; }
      progress_emit "写入 VLESS-XHTTP 配置"
      gen_vless_xhttp_server_config "$uuid" "$port" "$privkey" "$pubkey" "$sid" "$sni" "$path" || { json_fail "写入 VLESS-XHTTP 配置失败"; exit 1; }
      progress_emit "创建服务并启动"
      create_server_scripts || { json_fail "创建服务脚本失败"; exit 1; }
      create_service "$protocol" || { json_fail "创建服务失败"; exit 1; }
      panel_reload_core "xray" || { json_fail "重载 Xray 服务失败"; exit 1; }
      json_ok "VLESS-XHTTP 已安装并写入脚本数据库"
      ;;
    trojan)
      progress_emit "检查 Xray 依赖"
      ensure_xray_ready
      local password sni
      password="$(gen_password 16)"
      sni="${domain:-${server_name:-$(gen_sni)}}"
      progress_emit "写入 Trojan 配置"
      [[ "$cert_mode" == "self-signed" || ! -f "$CFG/certs/server.crt" ]] && gen_self_cert "$sni" >/dev/null 2>&1
      gen_trojan_server_config "$password" "$port" "$sni" >/dev/null 2>&1
      progress_emit "创建服务并启动"
      create_server_scripts >/dev/null 2>&1 || true
      create_service "$protocol" >/dev/null 2>&1 || true
      panel_reload_core "xray"
      json_ok "Trojan 已安装并写入脚本数据库"
      ;;
    vmess-ws)
      progress_emit "检查 Xray 依赖"
      ensure_xray_ready
      local uuid sni path
      uuid="$(gen_uuid)"
      sni="${domain:-${server_name:-$(gen_sni)}}"
      path="/vmess"
      progress_emit "写入 VMess 配置"
      [[ "$cert_mode" == "self-signed" || ! -f "$CFG/certs/server.crt" ]] && gen_self_cert "$sni" >/dev/null 2>&1
      gen_vmess_ws_server_config "$uuid" "$port" "$sni" "$path" "false" >/dev/null 2>&1
      progress_emit "创建服务并启动"
      create_server_scripts >/dev/null 2>&1 || true
      create_service "$protocol" >/dev/null 2>&1 || true
      panel_reload_core "xray"
      json_ok "VMess-WS 已安装并写入脚本数据库"
      ;;
    hy2)
      progress_emit "检查 Sing-box 依赖"
      ensure_singbox_ready
      local password sni
      password="$(gen_password 16)"
      sni="${domain:-${server_name:-$(gen_sni)}}"
      progress_emit "写入 Hysteria2 配置"
      gen_hy2_server_config "$password" "$port" "$sni" 0 20000 50000 >/dev/null 2>&1
      progress_emit "创建服务并启动"
      create_server_scripts >/dev/null 2>&1 || true
      create_singbox_service >/dev/null 2>&1 || true
      panel_reload_core "singbox"
      json_ok "Hysteria2 已安装并写入脚本数据库"
      ;;
    tuic)
      progress_emit "检查 Sing-box 依赖"
      ensure_singbox_ready
      local uuid password sni
      uuid="$(gen_uuid)"
      password="$(gen_password 16)"
      sni="${domain:-${server_name:-$(gen_sni)}}"
      progress_emit "写入 TUIC 配置"
      gen_tuic_server_config "$uuid" "$password" "$port" "$sni" 0 20000 50000 >/dev/null 2>&1
      progress_emit "创建服务并启动"
      create_server_scripts >/dev/null 2>&1 || true
      create_singbox_service >/dev/null 2>&1 || true
      panel_reload_core "singbox"
      json_ok "TUIC 已安装并写入脚本数据库"
      ;;
    *)
      json_fail "暂不支持该协议: $protocol"
      exit 1
      ;;
  esac
}

panel_uninstall_protocol() {
  local identifier core protocol port
  identifier="$(payload_get id)"
  core="$(printf '%s' "$identifier" | cut -d'|' -f1)"
  protocol="$(printf '%s' "$identifier" | cut -d'|' -f2)"
  port="$(printf '%s' "$identifier" | cut -d'|' -f3)"
  [[ -z "$core" || -z "$protocol" || -z "$port" ]] && { json_fail "协议标识无效"; exit 1; }

  if ! db_exists "$core" "$protocol"; then
    json_fail "协议不存在"
    exit 1
  fi

  db_remove_port "$core" "$protocol" "$port" >/dev/null 2>&1 || true
  if db_exists "$core" "$protocol"; then
    local remaining_ports
    remaining_ports="$(db_list_ports "$core" "$protocol" 2>/dev/null || true)"
    if ! grep -qx "$port" <<<"$remaining_ports"; then
      :
    fi
  fi
  if db_exists "$core" "$protocol"; then
    local ports_after
    ports_after="$(db_list_ports "$core" "$protocol" 2>/dev/null || true)"
    if [[ -z "$ports_after" ]]; then
      db_del "$core" "$protocol" >/dev/null 2>&1 || true
    fi
  fi

  panel_reload_core "$core"
  json_ok "${protocol}:${port} 已从脚本数据库移除"
}

panel_update_core() {
  ensure_base_dependencies
  local name target channel
  name="$(payload_get name)"
  target="$(payload_get target_version)"
  channel="$(payload_get channel)"
  [[ -z "$channel" ]] && channel="stable"
  if [[ -z "$target" ]]; then
    case "$name" in
      Xray)
        if [[ "$channel" == "beta" || "$channel" == "prerelease" ]]; then
          target="$(_get_cached_prerelease_with_fallback "XTLS/Xray-core" 2>/dev/null || true)"
        else
          target="$(_get_cached_version_with_fallback "XTLS/Xray-core" 2>/dev/null || true)"
        fi
        ;;
      Sing-box)
        if [[ "$channel" == "beta" || "$channel" == "prerelease" ]]; then
          target="$(_get_cached_prerelease_with_fallback "SagerNet/sing-box" 2>/dev/null || true)"
        else
          target="$(_get_cached_version_with_fallback "SagerNet/sing-box" 2>/dev/null || true)"
        fi
        ;;
      "Snell v5")
        target="$(_get_cached_version_with_fallback "surge-networks/snell" 2>/dev/null || true)"
        ;;
    esac
  fi
  [[ -z "$name" || -z "$target" || "$target" == "unknown" ]] && { json_fail "目标版本无效"; exit 1; }

  case "$name" in
    Xray)
      install_xray "" "true" "${target#v}" >/dev/null 2>&1 || { json_fail "Xray 更新失败"; exit 1; }
      panel_reload_core "xray"
      ;;
    Sing-box)
      install_singbox "" "true" "${target#v}" >/dev/null 2>&1 || { json_fail "Sing-box 更新失败"; exit 1; }
      panel_reload_core "singbox"
      ;;
    "Snell v5")
      install_snell_v5 >/dev/null 2>&1 || { json_fail "Snell v5 更新失败"; exit 1; }
      start_services >/dev/null 2>&1 || true
      ;;
    *)
      json_fail "未知核心: $name"
      exit 1
      ;;
  esac

  json_ok "$name 已更新到 $target"
}

panel_uninstall_core() {
  local name
  name="$(payload_get name)"
  [[ -z "$name" ]] && { json_fail "核心名称不能为空"; exit 1; }

  case "$name" in
    Xray)
      [[ -n "$(get_xray_protocols 2>/dev/null || true)" ]] && { json_fail "Xray 仍有已安装协议，请先卸载协议"; exit 1; }
      svc stop vless-reality >/dev/null 2>&1 || true
      svc disable vless-reality >/dev/null 2>&1 || true
      rm -f /usr/local/bin/xray /usr/bin/xray
      rm -f /etc/systemd/system/vless-reality.service "$CFG/config.json"
      command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload >/dev/null 2>&1 || true
      ;;
    Sing-box)
      [[ -n "$(get_singbox_protocols 2>/dev/null || true)" ]] && { json_fail "Sing-box 仍有已安装协议，请先卸载协议"; exit 1; }
      svc stop vless-singbox >/dev/null 2>&1 || true
      svc disable vless-singbox >/dev/null 2>&1 || true
      rm -f /usr/local/bin/sing-box /usr/bin/sing-box
      rm -f /etc/systemd/system/vless-singbox.service "$CFG/singbox.json"
      command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload >/dev/null 2>&1 || true
      ;;
    "Snell v5")
      svc stop vless-snell-v5 >/dev/null 2>&1 || true
      svc disable vless-snell-v5 >/dev/null 2>&1 || true
      rm -f /usr/local/bin/snell-server-v5 /usr/bin/snell-server-v5
      rm -f /etc/systemd/system/vless-snell-v5.service "$CFG/snell-v5.conf"
      command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload >/dev/null 2>&1 || true
      ;;
    *)
      json_fail "未知核心: $name"
      exit 1
      ;;
  esac

  json_ok "$name 已卸载"
}

panel_create_user() {
  local username protocol port quota expire status routing core credential quota_int
  username="$(payload_get username)"
  protocol="$(payload_get protocol)"
  port="$(payload_get port)"
  quota="$(payload_get quota_gb)"
  expire="$(payload_get expire_at)"
  status="$(payload_get status)"
  routing="$(payload_get routing)"
  core="$(panel_protocol_core "$protocol")"
  quota_int="${quota%.*}"
  [[ -z "$quota_int" ]] && quota_int=0

  [[ -z "$username" || -z "$protocol" ]] && { json_fail "缺少用户名或协议"; exit 1; }
  db_exists "$core" "$protocol" || { json_fail "协议不存在，请先安装协议"; exit 1; }

  case "$protocol" in
    vless|vless-xhttp|vmess-ws|tuic)
      credential="$(gen_uuid)"
      ;;
    hy2|trojan)
      credential="$(gen_password 16)"
      ;;
    *)
      json_fail "当前协议暂不支持从面板直接创建用户"
      exit 1
      ;;
  esac

  if [[ "$protocol" == "tuic" ]]; then
    json_fail "TUIC 当前脚本版本未完整支持多用户下发，请先使用 mock 或脚本原生流程"
    exit 1
  fi

  db_add_user "$core" "$protocol" "$username" "$credential" "$quota_int" "$expire" >/dev/null 2>&1 || {
    json_fail "用户创建失败"
    exit 1
  }

  if [[ -n "$routing" && "$routing" != "default" ]]; then
    if [[ "$routing" == chain:* ]]; then
      local chain_name
      chain_name="${routing#chain:}"
      db_chain_node_exists "$chain_name" || {
        db_del_user "$core" "$protocol" "$username" >/dev/null 2>&1 || true
        json_fail "指定的链式节点不存在"
        exit 1
      }
    fi
    db_set_user_routing "$core" "$protocol" "$username" "$routing" >/dev/null 2>&1 || {
      db_del_user "$core" "$protocol" "$username" >/dev/null 2>&1 || true
      json_fail "用户路由写入失败"
      exit 1
    }
  fi

  if [[ "$status" == "disabled" ]]; then
    db_set_user_enabled "$core" "$protocol" "$username" false >/dev/null 2>&1 || true
  fi
  if [[ -n "$port" ]]; then
    :
  fi

  panel_reload_core "$core"

  json_ok "用户 $username 已写入脚本数据库"
}

panel_delete_user() {
  local identifier core protocol username
  identifier="$(payload_get id)"
  core="$(printf '%s' "$identifier" | cut -d'|' -f1)"
  protocol="$(printf '%s' "$identifier" | cut -d'|' -f2)"
  username="$(printf '%s' "$identifier" | cut -d'|' -f3)"
  [[ -z "$core" || -z "$protocol" || -z "$username" ]] && { json_fail "用户标识无效"; exit 1; }

  db_del_user "$core" "$protocol" "$username" >/dev/null 2>&1 || {
    json_fail "用户删除失败"
    exit 1
  }
  panel_reload_core "$core"
  json_ok "用户 $username 已从脚本数据库删除"
}

panel_user_share() {
  local identifier core protocol username credential stats_line
  identifier="$(payload_get id)"
  core="$(printf '%s' "$identifier" | cut -d'|' -f1)"
  protocol="$(printf '%s' "$identifier" | cut -d'|' -f2)"
  username="$(printf '%s' "$identifier" | cut -d'|' -f3)"
  [[ -z "$core" || -z "$protocol" || -z "$username" ]] && { json_fail "用户标识无效"; exit 1; }

  stats_line="$(
    db_get_users_stats "$core" "$protocol" 2>/dev/null \
      | awk -F'|' -v user="$username" '$1 == user { print; exit }'
  )"
  [[ -z "$stats_line" ]] && { json_fail "用户不存在"; exit 1; }

  credential="$(printf '%s' "$stats_line" | cut -d'|' -f2)"
  [[ -z "$credential" ]] && { json_fail "用户凭证不存在"; exit 1; }

  local link
  link="$(_gen_user_share_link "$core" "$protocol" "$credential" "$username" 2>/dev/null || true)"
  [[ -z "$link" ]] && { json_fail "当前协议暂不支持导出分享链接"; exit 1; }

  jq -n --arg id "$identifier" --arg username "$username" --arg protocol "$protocol" --arg link "$link" \
    '{ok:true,message:"用户分享链接已生成",id:$id,username:$username,protocol:$protocol,link:$link}'
}

panel_reset_subscription() {
  local new_uuid
  new_uuid="$(reset_sub_uuid 2>/dev/null || true)"
  [[ -z "$new_uuid" ]] && {
    # reset_sub_uuid 直接操作文件但不回显时，重新读一遍
    new_uuid="$(get_sub_uuid 2>/dev/null || true)"
  }
  [[ -z "$new_uuid" ]] && { json_fail "订阅 UUID 重置失败"; exit 1; }
  json_ok "订阅 UUID 已重置为 $new_uuid"
}

panel_update_subscription() {
  local sub_name default_format tmp_file
  sub_name="$(payload_get name)"
  default_format="$(payload_get default_format)"

  [[ -z "$sub_name" || -z "$default_format" ]] && {
    json_fail "订阅名称或默认格式不能为空"
    exit 1
  }

  tmp_file="$(mktemp)"
  jq \
    --arg sub_name "$sub_name" \
    --arg default_format "$default_format" \
    '
      .panel = (.panel // {}) |
      .panel.subscription = (.panel.subscription // {}) |
      .panel.subscription.name = $sub_name |
      .panel.subscription.default_format = $default_format
    ' "$DB_FILE" > "$tmp_file" || {
      rm -f "$tmp_file"
      json_fail "订阅设置保存失败"
      exit 1
    }

  mv "$tmp_file" "$DB_FILE"
  json_ok "订阅设置已保存"
}

panel_add_routing() {
  local rule_type target outbound ip_strategy normalized_type
  rule_type="$(payload_get rule_type)"
  target="$(payload_get target)"
  outbound="$(payload_get outbound)"
  ip_strategy="$(payload_get ip_strategy)"
  normalized_type="$rule_type"
  [[ -z "$outbound" ]] && outbound="direct"
  [[ -z "$ip_strategy" ]] && ip_strategy="prefer_ipv4"

  case "$rule_type" in
    openai|netflix|telegram|youtube|google|tiktok|bilibili|github|ai|all)
      normalized_type="$rule_type"
      ;;
    *)
      normalized_type="custom"
      ;;
  esac

  db_add_routing_rule "$normalized_type" "$outbound" "$target" "$ip_strategy" >/dev/null 2>&1 || {
    json_fail "分流规则添加失败"
    exit 1
  }
  panel_reload_all_routing
  json_ok "分流规则已写入脚本数据库"
}

panel_delete_routing() {
  local rule_id
  rule_id="$(payload_get id)"
  [[ -z "$rule_id" ]] && { json_fail "规则标识无效"; exit 1; }
  db_del_routing_rule "$rule_id" >/dev/null 2>&1 || {
    json_fail "分流规则删除失败"
    exit 1
  }
  panel_reload_all_routing
  json_ok "分流规则已从脚本数据库删除"
}

emit_dashboard() {
  local protocol_count user_count route_count expiring_count
  protocol_count=$(jq '
    ((.xray // {}) | to_entries | map(if (.value | type) == "array" then (.value | length) else 1 end) | add // 0) +
    ((.singbox // {}) | to_entries | map(if (.value | type) == "array" then (.value | length) else 1 end) | add // 0)
  ' "$DB_FILE" 2>/dev/null || echo 0)
  user_count=$(jq '
    [
      (.xray // {} | to_entries[]? | if (.value|type)=="array" then .value[] else .value end | .users // [] | .[]),
      (.singbox // {} | to_entries[]? | if (.value|type)=="array" then .value[] else .value end | .users // [] | .[])
    ] | flatten | length
  ' "$DB_FILE" 2>/dev/null || echo 0)
  route_count=$(jq '.routing_rules | length // 0' "$DB_FILE" 2>/dev/null || echo 0)
  expiring_count=$(jq '
    [
      (.xray // {} | to_entries[]? | if (.value|type)=="array" then .value[] else .value end | .users // [] | .[] | select(.expire_date != null and .expire_date != "")),
      (.singbox // {} | to_entries[]? | if (.value|type)=="array" then .value[] else .value end | .users // [] | .[] | select(.expire_date != null and .expire_date != ""))
    ] | flatten | length
  ' "$DB_FILE" 2>/dev/null || echo 0)
  jq -n \
    --argjson installed "$protocol_count" \
    --argjson users "$user_count" \
    --argjson expiring "$expiring_count" \
    --argjson routes "$route_count" \
    '{stats:{installed:$installed,users:$users,expiring:$expiring,routes:$routes},logs:[]}'
}

emit_protocols() {
  local xray_status singbox_status
  xray_status="$(service_state_json "vless-reality")"
  singbox_status="$(service_state_json "vless-singbox")"
  jq -c '
      [
        (.xray // {} | to_entries[]? | .key as $proto |
          if (.value | type) == "array" then
            .value[] | {
              id: ("xray|" + $proto + "|" + ((.port // 0) | tostring)),
              name: $proto,
              core: "xray",
              port: (.port // 0),
              service: "vless-reality",
              status: $xray_status,
              config: .,
              created_at: ""
            }
          else
            {
              id: ("xray|" + $proto + "|" + ((.value.port // 0) | tostring)),
              name: $proto,
              core: "xray",
              port: (.value.port // 0),
              service: "vless-reality",
              status: $xray_status,
              config: .value,
              created_at: ""
            }
          end
        ),
      (.singbox // {} | to_entries[]? | .key as $proto |
        if (.value | type) == "array" then
          .value[] | {
              id: ("singbox|" + $proto + "|" + ((.port // 0) | tostring)),
              name: $proto,
              core: "singbox",
              port: (.port // 0),
              service: "vless-singbox",
              status: $singbox_status,
              config: .,
              created_at: ""
            }
          else
            {
              id: ("singbox|" + $proto + "|" + ((.value.port // 0) | tostring)),
              name: $proto,
              core: "singbox",
              port: (.value.port // 0),
              service: "vless-singbox",
              status: $singbox_status,
              config: .value,
              created_at: ""
            }
          end
        )
      ] | flatten
    ' --arg xray_status "$xray_status" --arg singbox_status "$singbox_status" "$DB_FILE"
}

emit_cores() {
  _refresh_core_versions_async "all" >/dev/null 2>&1 || true
  local xray_current singbox_current snell_current
  local xray_stable xray_beta singbox_stable singbox_beta snell_stable snell_beta
  xray_current="$(_get_core_version "xray" 2>/dev/null || echo unknown)"
  singbox_current="$(_get_core_version "sing-box" 2>/dev/null || echo unknown)"
  snell_current="$(_get_core_version "snell-server-v5" 2>/dev/null || echo unknown)"
  xray_stable="$(_get_cached_version_with_fallback "XTLS/Xray-core" 2>/dev/null || echo unknown)"
  xray_beta="$(_get_cached_prerelease_with_fallback "XTLS/Xray-core" 2>/dev/null || true)"
  singbox_stable="$(_get_cached_version_with_fallback "SagerNet/sing-box" 2>/dev/null || echo unknown)"
  singbox_beta="$(_get_cached_prerelease_with_fallback "SagerNet/sing-box" 2>/dev/null || true)"
  snell_stable="$(_get_cached_version_with_fallback "surge-networks/snell" 2>/dev/null || echo unknown)"
  snell_beta="无"
  [[ -z "$xray_beta" ]] && xray_beta="$xray_stable"
  [[ -z "$singbox_beta" ]] && singbox_beta="$singbox_stable"
  jq -n \
    --arg xray_current "$xray_current" \
    --arg xray_stable "$xray_stable" \
    --arg xray_beta "$xray_beta" \
    --arg singbox_current "$singbox_current" \
    --arg singbox_stable "$singbox_stable" \
    --arg singbox_beta "$singbox_beta" \
    --arg snell_current "$snell_current" \
    --arg snell_stable "$snell_stable" \
    --arg snell_beta "$snell_beta" \
    '[
      {name:"Xray", current_version:$xray_current, latest_version:$xray_stable, stable_version:$xray_stable, beta_version:$xray_beta, channel:"stable", needs_update:(if $xray_current != $xray_stable then 1 else 0 end)},
      {name:"Sing-box", current_version:$singbox_current, latest_version:$singbox_stable, stable_version:$singbox_stable, beta_version:$singbox_beta, channel:"stable", needs_update:(if $singbox_current != $singbox_stable then 1 else 0 end)},
      {name:"Snell v5", current_version:$snell_current, latest_version:$snell_stable, stable_version:$snell_stable, beta_version:$snell_beta, channel:"stable", needs_update:(if $snell_current != $snell_stable then 1 else 0 end)}
    ]'
}

emit_users() {
  jq -c '
    [
      (.xray // {} | to_entries[]? | .key as $proto |
        if (.value | type) == "array" then
          .value[] | .port as $port | (.users // [])[]? | {
            id: ("xray|" + $proto + "|" + .name),
            username: .name,
            protocol: $proto,
            port: $port,
            routing: (.routing // ""),
            used_gb: (((.used // 0) / 1073741824) * 10 | round / 10),
            quota_gb: (((.quota // 0) / 1073741824) * 10 | round / 10),
            expire_at: (.expire_date // ""),
            status: (if (.enabled == false) then "disabled" else "enabled" end)
          }
        else
          (.value.port // 0) as $port | (.value.users // [])[]? | {
            id: ("xray|" + $proto + "|" + .name),
            username: .name,
            protocol: $proto,
            port: $port,
            routing: (.routing // ""),
            used_gb: (((.used // 0) / 1073741824) * 10 | round / 10),
            quota_gb: (((.quota // 0) / 1073741824) * 10 | round / 10),
            expire_at: (.expire_date // ""),
            status: (if (.enabled == false) then "disabled" else "enabled" end)
          }
        end
      ),
      (.singbox // {} | to_entries[]? | .key as $proto |
        if (.value | type) == "array" then
          .value[] | .port as $port | (.users // [])[]? | {
            id: ("singbox|" + $proto + "|" + .name),
            username: .name,
            protocol: $proto,
            port: $port,
            routing: (.routing // ""),
            used_gb: (((.used // 0) / 1073741824) * 10 | round / 10),
            quota_gb: (((.quota // 0) / 1073741824) * 10 | round / 10),
            expire_at: (.expire_date // ""),
            status: (if (.enabled == false) then "disabled" else "enabled" end)
          }
        else
          (.value.port // 0) as $port | (.value.users // [])[]? | {
            id: ("singbox|" + $proto + "|" + .name),
            username: .name,
            protocol: $proto,
            port: $port,
            routing: (.routing // ""),
            used_gb: (((.used // 0) / 1073741824) * 10 | round / 10),
            quota_gb: (((.quota // 0) / 1073741824) * 10 | round / 10),
            expire_at: (.expire_date // ""),
            status: (if (.enabled == false) then "disabled" else "enabled" end)
          }
        end
      )
    ] | flatten
    | map(. + {
        routing_label: (
          if (.routing // "") == "" or (.routing // "") == "default" then "全局规则"
          elif (.routing // "") == "direct" then "直连"
          elif (.routing | startswith("chain:")) then ("链式: " + (.routing | ltrimstr("chain:")))
          elif (.routing | startswith("balancer:")) then ("负载均衡: " + (.routing | ltrimstr("balancer:")))
          elif (.routing // "") == "warp" then "WARP"
          else (.routing // "")
          end
        )
      })
  ' "$DB_FILE"
}

emit_user_routing_options() {
  local nodes_json routes_json balancers_json
  nodes_json="$(db_get_chain_nodes 2>/dev/null || echo '[]')"
  routes_json="$(jq -c '.routing_rules // []' "$DB_FILE" 2>/dev/null || echo '[]')"
  balancers_json="$(jq -c '.balancer_groups // []' "$DB_FILE" 2>/dev/null || echo '[]')"
  jq -n \
    --argjson nodes "$nodes_json" \
    --argjson routes "$routes_json" \
    --argjson balancers "$balancers_json" '
      def label_for(v):
        if v == "" then "全局规则"
        elif v == "direct" then "直连"
        elif v == "warp" then "WARP"
        elif (v | startswith("chain:")) then ("链式: " + (v | ltrimstr("chain:")))
        elif (v | startswith("balancer:")) then ("负载均衡: " + (v | ltrimstr("balancer:")))
        else v
        end;

      (
        [{value:"",label:"全局规则"},{value:"direct",label:"直连"},{value:"warp",label:"WARP"}]
        + ($nodes | map(select(.name != null and .name != "") | {value:("chain:" + .name), label:("链式: " + .name)}))
        + ($balancers | map(select(.name != null and .name != "") | {value:("balancer:" + .name), label:("负载均衡: " + .name)}))
        + (
            $routes
            | map(.outbound // "")
            | map(select(startswith("chain:") or startswith("balancer:") or . == "warp" or . == "direct"))
            | map({value: ., label: label_for(.)})
          )
      )
      | unique_by(.value)
    '
}

emit_subscriptions() {
  local sub_uuid
  sub_uuid="$(get_sub_uuid 2>/dev/null || true)"
  sub_uuid="${sub_uuid:-unknown}"
  local sub_name
  sub_name="$(jq -r '.panel.subscription.name // "Server Subscription"' "$DB_FILE" 2>/dev/null || true)"
  sub_name="${sub_name:-Server Subscription}"
  local default_format
  default_format="$(jq -r '.panel.subscription.default_format // "v2ray"' "$DB_FILE" 2>/dev/null || true)"
  default_format="${default_format:-v2ray}"
  jq -n \
    --arg sub_name "$sub_name" \
    --arg token "$sub_uuid" \
    --arg default_format "$default_format" \
    '[{
      id: 1,
      name: $sub_name,
      sub_uuid: $token,
      default_format: $default_format,
      base_url: "https://your-domain.example/sub",
      updated_at: "",
      links: {
        v2ray: ("https://your-domain.example/sub/" + $token + "/v2ray"),
        clash: ("https://your-domain.example/sub/" + $token + "/clash"),
        surge: ("https://your-domain.example/sub/" + $token + "/surge")
      }
    }]'
}

emit_routing() {
  jq -c '.routing_rules // []
    | to_entries
    | map({
        id: (.value.id // ("row-" + ((.key + 1) | tostring))),
        rule_type: (.value.type // "custom"),
        target: (.value.domains // ""),
        outbound: (.value.outbound // "direct"),
        ip_strategy: (.value.ip_version // "prefer_ipv4"),
        priority: (.key + 1)
      })' "$DB_FILE"
}

emit_chain_nodes() {
  db_get_chain_nodes 2>/dev/null | jq -c '
    map({
      id: (.name // ""),
      name: (.name // ""),
      type: (.type // ""),
      server: (.server // ""),
      port: (.port // 0),
      via_warp: (.via_warp // false)
    })
  '
}

panel_import_chain_nodes() {
  local kind content source raw_line line node_json name type server port
  kind="$(payload_get kind)"
  content="$(payload_get content)"
  [[ -z "$kind" ]] && kind="auto"
  [[ -z "$content" ]] && { json_fail "导入内容不能为空"; exit 1; }

  source="$content"
  if [[ "$kind" == "subscription" ]]; then
    source="$(fetch_subscription "$content" 2>/dev/null || true)"
    [[ -z "$source" ]] && { json_fail "订阅获取失败或内容为空"; exit 1; }
  fi

  local added=0 skipped=0 failed=0
  local details=""

  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    line="$(printf '%s' "$raw_line" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [[ -z "$line" || "$line" == \#* ]] && continue

    node_json="$(parse_proxy_link "$line" 2>/dev/null || true)"
    if [[ -z "$node_json" || "$node_json" == "null" ]]; then
      node_json="$(parse_share_link "$line" 2>/dev/null || true)"
    fi
    if [[ -z "$node_json" || "$node_json" == "null" ]]; then
      ((failed++))
      continue
    fi

    name="$(echo "$node_json" | jq -r '.name // empty' 2>/dev/null)"
    type="$(echo "$node_json" | jq -r '.type // "node"' 2>/dev/null)"
    server="$(echo "$node_json" | jq -r '.server // "server"' 2>/dev/null)"
    port="$(echo "$node_json" | jq -r '.port // 0' 2>/dev/null)"
    name="$(printf '%s' "$name" | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    if [[ -z "$name" ]]; then
      name="${type}-${server}:${port}"
    fi
    node_json="$(echo "$node_json" | jq --arg name "$name" '.name = $name' 2>/dev/null || true)"
    [[ -z "$node_json" || "$node_json" == "null" ]] && { ((failed++)); continue; }

    if db_chain_node_exists "$name"; then
      ((skipped++))
      continue
    fi

    if db_add_chain_node "$node_json" >/dev/null 2>&1; then
      ((added++))
      details="${details}${name}\n"
    else
      ((failed++))
    fi
  done <<< "$source"

  if [[ $added -eq 0 && $failed -gt 0 ]]; then
    json_fail "没有导入成功，请检查链接格式或订阅内容"
    exit 1
  fi

  local message="导入完成：新增 ${added}，跳过 ${skipped}，失败 ${failed}"
  jq -n \
    --arg msg "$message" \
    --argjson added "$added" \
    --argjson skipped "$skipped" \
    --argjson failed "$failed" \
    --arg detail "$details" \
    '{ok:true,message:$msg,data:{added:$added,skipped:$skipped,failed:$failed,added_names:($detail|split("\n")|map(select(length>0)))}}'
}

panel_delete_routing_stable() {
  local rule_id
  rule_id="$(payload_get id)"
  [[ -z "$rule_id" ]] && { json_fail "瑙勫垯鏍囪瘑鏃犳晥"; exit 1; }

  if [[ "$rule_id" =~ ^row-([0-9]+)$ ]]; then
    local row_index tmp_file
    row_index="${BASH_REMATCH[1]}"
    tmp_file="$(mktemp)"
    jq --argjson row "$row_index" \
      '.routing_rules = [(.routing_rules // []) | to_entries[] | select((.key + 1) != $row) | .value]' \
      "$DB_FILE" > "$tmp_file" || {
        rm -f "$tmp_file"
        json_fail "鍒嗘祦瑙勫垯鍒犻櫎澶辫触"
        exit 1
      }
    mv "$tmp_file" "$DB_FILE"
  else
    db_del_routing_rule "$rule_id" >/dev/null 2>&1 || {
      local tmp_file
      tmp_file="$(mktemp)"
      jq --arg rid "$rule_id" \
        '.routing_rules = [(.routing_rules // [])[] | select((.id // "") != $rid)]' \
        "$DB_FILE" > "$tmp_file" || {
          rm -f "$tmp_file"
          json_fail "鍒嗘祦瑙勫垯鍒犻櫎澶辫触"
          exit 1
        }
      mv "$tmp_file" "$DB_FILE"
    }
  fi

  panel_reload_all_routing
  json_ok "鍒嗘祦瑙勫垯宸蹭粠鑴氭湰鏁版嵁搴撳垹闄?"
}

case "$command" in
  dashboard) emit_dashboard ;;
  protocols) emit_protocols ;;
  cores) emit_cores ;;
  users) emit_users ;;
  user-routing-options) emit_user_routing_options ;;
  subscriptions) emit_subscriptions ;;
  routing) emit_routing ;;
  chain-nodes) emit_chain_nodes ;;
  install) panel_install_protocol ;;
  uninstall) panel_uninstall_protocol ;;
  core-update) panel_update_core ;;
  core-uninstall) panel_uninstall_core ;;
  user-create) panel_create_user ;;
  user-delete) panel_delete_user ;;
  user-share) panel_user_share ;;
  reload-services) panel_reload_services ;;
  subscription-update) panel_update_subscription ;;
  subscription-reset) panel_reset_subscription ;;
  routing-add) panel_add_routing ;;
  routing-delete) panel_delete_routing_stable ;;
  chain-import) panel_import_chain_nodes ;;
  *)
    json_fail "unsupported live bridge command"
    exit 1
    ;;
esac
