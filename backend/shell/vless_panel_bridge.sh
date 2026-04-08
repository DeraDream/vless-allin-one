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

progress_emit() {
  local message="$1"
  printf '__PROGRESS__:%s\n' "$message" >&2
}

reality_keys_generate() {
  xray x25519 2>&1
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

ensure_xray_ready() {
  if ! command -v xray >/dev/null 2>&1 && [[ ! -x /usr/local/bin/xray ]] && [[ ! -x /usr/bin/xray ]]; then
    check_dependencies >/dev/null 2>&1 || true
    install_xray >/dev/null 2>&1 || { json_fail "Xray 安装失败"; exit 1; }
  fi
}

ensure_singbox_ready() {
  if ! command -v sing-box >/dev/null 2>&1 && [[ ! -x /usr/local/bin/sing-box ]] && [[ ! -x /usr/bin/sing-box ]]; then
    check_dependencies >/dev/null 2>&1 || true
    install_singbox >/dev/null 2>&1 || { json_fail "Sing-box 安装失败"; exit 1; }
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
  case "$core" in
    xray)
      if [[ -n "$(get_xray_protocols 2>/dev/null || true)" ]]; then
        create_server_scripts >/dev/null 2>&1 || true
        create_service "vless" >/dev/null 2>&1 || true
        rebuild_and_reload_xray "silent" >/dev/null 2>&1 || start_services >/dev/null 2>&1 || true
      else
        svc stop vless-reality >/dev/null 2>&1 || true
        rm -f "$CFG/config.json"
      fi
      ;;
    singbox)
      if [[ -n "$(get_singbox_protocols 2>/dev/null || true)" ]]; then
        create_server_scripts >/dev/null 2>&1 || true
        create_singbox_service >/dev/null 2>&1 || true
        rebuild_and_reload_singbox "silent" >/dev/null 2>&1 || start_services >/dev/null 2>&1 || true
      else
        svc stop vless-singbox >/dev/null 2>&1 || true
        rm -f "$CFG/singbox.json"
      fi
      ;;
  esac
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
      sid="${short_id:-$(gen_sid)}"
      sni="${server_name:-${domain:-$(gen_sni)}}"
      progress_emit "生成 Reality 密钥"
      keys="$(reality_keys_generate)"
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
      sid="${short_id:-$(gen_sid)}"
      path="/xhttp"
      sni="${server_name:-${domain:-$(gen_sni)}}"
      progress_emit "生成 XHTTP Reality 密钥"
      keys="$(reality_keys_generate)"
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
  local username protocol port quota expire status core credential quota_int
  username="$(payload_get username)"
  protocol="$(payload_get protocol)"
  port="$(payload_get port)"
  quota="$(payload_get quota_gb)"
  expire="$(payload_get expire_at)"
  status="$(payload_get status)"
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

  if [[ "$status" == "disabled" ]]; then
    db_set_user_enabled "$core" "$protocol" "$username" false >/dev/null 2>&1 || true
  fi
  if [[ -n "$port" ]]; then
    :
  fi

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
            status: "unknown",
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
            status: "unknown",
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
            status: "unknown",
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
            status: "unknown",
            config: .value,
            created_at: ""
          }
        end
      )
    ] | flatten
  ' "$DB_FILE"
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
            used_gb: (((.used // 0) / 1073741824) * 10 | round / 10),
            quota_gb: (((.quota // 0) / 1073741824) * 10 | round / 10),
            expire_at: (.expire_date // ""),
            status: (if (.enabled == false) then "disabled" else "enabled" end)
          }
        end
      )
    ] | flatten
  ' "$DB_FILE"
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

case "$command" in
  dashboard) emit_dashboard ;;
  protocols) emit_protocols ;;
  cores) emit_cores ;;
  users) emit_users ;;
  subscriptions) emit_subscriptions ;;
  routing) emit_routing ;;
  install) panel_install_protocol ;;
  uninstall) panel_uninstall_protocol ;;
  core-update) panel_update_core ;;
  core-uninstall) panel_uninstall_core ;;
  user-create) panel_create_user ;;
  user-delete) panel_delete_user ;;
  reload-services) panel_reload_services ;;
  subscription-update) panel_update_subscription ;;
  subscription-reset) panel_reset_subscription ;;
  routing-add) panel_add_routing ;;
  routing-delete) panel_delete_routing ;;
  *)
    json_fail "unsupported live bridge command"
    exit 1
    ;;
esac
