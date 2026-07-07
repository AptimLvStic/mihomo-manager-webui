#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
CONFIG_DIR="/etc/mihomo"
ENV_FILE="${CONFIG_DIR}/subscription.env"
SETTINGS_FILE="${CONFIG_DIR}/mihomo.sh.conf"
MIHOMO_SERVICE="mihomo.service"
UPDATE_SCRIPT="/usr/local/sbin/update-mihomo-subscription"
SELECT_SCRIPT="/usr/local/sbin/select-mihomo-working-proxy"
PROXYCHAINS_CONF="/etc/proxychains4.conf"
PROXYCHAINS_LEGACY="/etc/proxychains.conf"
PROFILE_PROXY="/etc/profile.d/mihomo-proxy.sh"
APT_PROXY="/etc/apt/apt.conf.d/95mihomo-proxy"
DEFAULT_UA="ClashMetaForAndroid/2.10.1"
HTTP_PROXY_URL="http://127.0.0.1:7890"
SOCKS_PROXY_URL="socks5h://127.0.0.1:7891"
NO_PROXY_LIST="localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
DEFAULT_LANG="zh"
MIHOMO_SH_LANG="${MIHOMO_SH_LANG:-$DEFAULT_LANG}"

tr_msg() {
  local key="$1"
  case "${MIHOMO_SH_LANG}:${key}" in
    zh:info_prefix) printf '[信息]' ;;
    zh:warn_prefix) printf '[警告]' ;;
    zh:error_prefix) printf '[错误]' ;;
    zh:run_as_root) printf '请使用 root 运行。' ;;
    zh:missing_command) printf '缺少命令：%s' "$2" ;;
    zh:invalid_url) printf '订阅链接必须以 http:// 或 https:// 开头。' ;;
    zh:not_set) printf '(未设置)' ;;
    zh:url_not_set) printf '订阅链接未设置。' ;;
    zh:missing_update_script) printf '更新脚本不存在或不可执行：%s' "$2" ;;
    zh:updating) printf '正在更新订阅...' ;;
    zh:update_finished) printf '更新完成。' ;;
    zh:select_failed) printf '无法自动选择可用节点。' ;;
    zh:new_url_prompt) printf '请输入新的订阅链接：' ;;
    zh:url_saved) printf '订阅链接已保存。' ;;
    zh:new_ua_prompt) printf '请输入新的 User-Agent [%s]：' "$2" ;;
    zh:ua_empty) printf 'User-Agent 不能为空。' ;;
    zh:ua_saved) printf '订阅 User-Agent 已保存。' ;;
    zh:missing_selector) printf '节点选择脚本不存在或不可执行：%s' "$2" ;;
    zh:proxychains_done) printf 'Proxychains 配置已更新：%s' "$2" ;;
    zh:proxy_on_done) printf '系统代理文件已启用，作用于新的 shell 和 apt。' ;;
    zh:proxy_on_tip) printf '当前 shell 立即生效请运行：eval "$(%s proxy env)"' "$SCRIPT_NAME" ;;
    zh:proxy_off_done) printf '系统代理文件已移除。' ;;
    zh:proxy_off_tip) printf '已经打开的 shell 会保留原环境变量；重新打开 shell 或手动 unset 后失效。' ;;
    zh:proxychains_missing) printf 'proxychains4 未安装。' ;;
    zh:bad_log_count) printf '日志行数必须是数字。' ;;
    zh:unknown_choice) printf '未知选项。' ;;
    zh:bad_lang) printf '语言必须是 zh 或 en。' ;;
    zh:lang_saved) printf '语言已设置为：%s' "$2" ;;
    zh:choose_lang) printf '请选择语言：' ;;
    zh:lang_status) printf '当前语言：%s\n' "$MIHOMO_SH_LANG" ;;
    zh:proxy_usage) printf '用法：%s proxy {on|off|status|env}' "$SCRIPT_NAME" ;;
    *) case "$key" in
      info_prefix) printf '[INFO]' ;;
      warn_prefix) printf '[WARN]' ;;
      error_prefix) printf '[ERROR]' ;;
      run_as_root) printf 'Please run as root.' ;;
      missing_command) printf 'Missing command: %s' "$2" ;;
      invalid_url) printf 'Subscription URL must start with http:// or https://.' ;;
      not_set) printf '(not set)' ;;
      url_not_set) printf 'Subscription URL is not set.' ;;
      missing_update_script) printf 'Missing executable update script: %s' "$2" ;;
      updating) printf 'Updating subscription...' ;;
      update_finished) printf 'Update finished.' ;;
      select_failed) printf 'Could not auto-select a working proxy.' ;;
      new_url_prompt) printf 'New subscription URL: ' ;;
      url_saved) printf 'Subscription URL saved.' ;;
      new_ua_prompt) printf 'New User-Agent [%s]: ' "$2" ;;
      ua_empty) printf 'User-Agent cannot be empty.' ;;
      ua_saved) printf 'Subscription User-Agent saved.' ;;
      missing_selector) printf 'Missing executable selector script: %s' "$2" ;;
      proxychains_done) printf 'Proxychains configured: %s' "$2" ;;
      proxy_on_done) printf 'System proxy files enabled for new shells and apt.' ;;
      proxy_on_tip) printf 'For the current shell, run: eval "$(%s proxy env)"' "$SCRIPT_NAME" ;;
      proxy_off_done) printf 'System proxy files removed.' ;;
      proxy_off_tip) printf 'Already-open shells keep their environment until you unset variables or reopen the shell.' ;;
      proxychains_missing) printf 'proxychains4 is not installed.' ;;
      bad_log_count) printf 'Log line count must be a number.' ;;
      unknown_choice) printf 'Unknown choice.' ;;
      bad_lang) printf 'Language must be zh or en.' ;;
      lang_saved) printf 'Language set to: %s' "$2" ;;
      choose_lang) printf 'Choose language: ' ;;
      lang_status) printf 'Current language: %s\n' "$MIHOMO_SH_LANG" ;;
      proxy_usage) printf 'Usage: %s proxy {on|off|status|env}' "$SCRIPT_NAME" ;;
      *) printf '%s' "$key" ;;
    esac ;;
  esac
}

info() { printf '%s %s\n' "$(tr_msg info_prefix)" "$*"; }
warn() { printf '%s %s\n' "$(tr_msg warn_prefix)" "$*" >&2; }
die() { printf '%s %s\n' "$(tr_msg error_prefix)" "$*" >&2; exit 1; }

require_root() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    die "$(tr_msg run_as_root)"
  fi
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$(tr_msg missing_command "$1")"
}

quote_sh() {
  local value="${1-}"
  printf "'"
  printf '%s' "$value" | sed "s/'/'\\\\''/g"
  printf "'"
}

load_settings() {
  MIHOMO_SH_LANG="$DEFAULT_LANG"
  if [ -r "$SETTINGS_FILE" ]; then
    # shellcheck disable=SC1090
    . "$SETTINGS_FILE"
  fi
  case "${MIHOMO_SH_LANG:-$DEFAULT_LANG}" in
    zh|en) ;;
    *) MIHOMO_SH_LANG="$DEFAULT_LANG" ;;
  esac
}

write_settings() {
  local lang="$1"
  install -d -m 700 "$CONFIG_DIR"
  {
    printf '# Managed by %s.\n' "$SCRIPT_NAME"
    printf 'MIHOMO_SH_LANG='
    quote_sh "$lang"
    printf '\n'
  } > "$SETTINGS_FILE.tmp"
  install -m 600 "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
  rm -f "$SETTINGS_FILE.tmp"
}

backup_file() {
  local path="$1"
  if [ -e "$path" ] && [ ! -L "$path" ]; then
    cp -a "$path" "${path}.backup.$(date +%Y%m%d%H%M%S)"
  fi
}

load_subscription_env() {
  SUBSCRIPTION_URL=""
  SUBSCRIPTION_UA="$DEFAULT_UA"
  if [ -r "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    . "$ENV_FILE"
  fi
  SUBSCRIPTION_URL="${SUBSCRIPTION_URL:-}"
  SUBSCRIPTION_UA="${SUBSCRIPTION_UA:-$DEFAULT_UA}"
}

write_subscription_env() {
  local url="$1"
  local ua="$2"
  local tmp
  install -d -m 700 "$CONFIG_DIR"
  tmp="$(mktemp)"
  {
    printf '# Managed by %s. Keep this file root-only.\n' "$SCRIPT_NAME"
    printf 'SUBSCRIPTION_URL='
    quote_sh "$url"
    printf '\nSUBSCRIPTION_UA='
    quote_sh "$ua"
    printf '\n'
  } > "$tmp"
  install -m 600 "$tmp" "$ENV_FILE"
  rm -f "$tmp"
}

validate_url() {
  case "${1-}" in
    http://*|https://*) return 0 ;;
    *) die "$(tr_msg invalid_url)" ;;
  esac
}

mask_url() {
  local url="${1-}"
  if [ -z "$url" ]; then
    tr_msg not_set
    printf '\n'
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$url" <<'PY'
import re
import sys
from urllib.parse import parse_qsl, quote, urlsplit, urlunsplit

url = sys.argv[1]
secret_keys = {"token", "access_token", "key", "secret", "password", "passwd"}
try:
    parts = urlsplit(url)
    query = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key.lower() in secret_keys:
            value = "***"
        elif len(value) > 24:
            value = value[:8] + "..." + value[-4:]
        query.append((key, value))
    masked_query = "&".join(
        quote(key, safe="") + "=" + quote(value, safe="*")
        for key, value in query
    )
    print(urlunsplit((parts.scheme, parts.netloc, parts.path, masked_query, parts.fragment)))
except Exception:
    print(re.sub(r"((?:token|access_token|key|secret|password|passwd)=)[^&]+", r"\1***", url, flags=re.I))
PY
  else
    printf '%s\n' "$url" | sed -E 's/((token|access_token|key|secret|password|passwd)=)[^&]+/\1***/Ig'
  fi
}

print_help() {
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    cat <<EOF
用法：
  $SCRIPT_NAME [命令] [选项]

命令：
  status                 查看 Mihomo、订阅、proxychains 和系统代理状态。
  ports                  查看 Mihomo 本地监听端口。
  update                 拉取当前订阅，重启 Mihomo，并自动选择可用节点。
  set-url [URL]          更换订阅链接并立即更新。
  set-ua [USER_AGENT]    更换订阅 User-Agent 并立即更新。
  show-url               显示脱敏后的订阅链接。
  lang                   查看当前语言。
  set-lang zh|en         设置脚本语言：中文或英文。
  start                  启动 Mihomo。
  stop                   停止 Mihomo。
  restart                重启 Mihomo 并自动选择可用节点。
  service-status         查看 Mihomo systemd 服务详情。
  timer                  查看订阅自动更新定时器。
  select                 通过 Mihomo 控制接口选择可用节点。
  test                   测试 socks5 和 proxychains 连通性。
  logs [N]               查看最近的 Mihomo 日志，默认 100 行。
  logs-sub [N]           查看最近的订阅更新日志，默认 100 行。
  proxy on               开启系统代理，作用于新 shell 和 apt。
  proxy off              关闭本脚本创建的系统代理配置。
  proxy status           查看系统代理状态。
  proxy env              输出当前 shell 可用的代理环境变量。
  proxychains            重建 proxychains 配置，指向 127.0.0.1:7891。
  proxychains-show       查看 proxychains 配置。
  menu                   打开分组交互菜单。
  help                   显示帮助。

示例：
  $SCRIPT_NAME update
  $SCRIPT_NAME set-url
  $SCRIPT_NAME set-lang en
  $SCRIPT_NAME proxy on
  eval "\$($SCRIPT_NAME proxy env)"
  proxychains4 -q curl https://api.ipify.org

提示：
  敏感订阅链接推荐使用 "$SCRIPT_NAME set-url" 后按提示输入，
  这样 token 不会保存在 shell 历史记录里。
EOF
    return
  fi
  cat <<EOF
Usage:
  $SCRIPT_NAME [command] [options]

Commands:
  status                 Show Mihomo, subscription, proxychains, and system proxy status.
  ports                  Show Mihomo local listening ports.
  update                 Pull the current subscription, restart Mihomo, and select a working node.
  set-url [URL]          Replace subscription URL and update immediately.
  set-ua [USER_AGENT]    Replace subscription User-Agent and update immediately.
  show-url               Show masked subscription URL.
  lang                   Show current language.
  set-lang zh|en         Set script language to Chinese or English.
  start                  Start Mihomo.
  stop                   Stop Mihomo.
  restart                Restart Mihomo and select a working node.
  service-status         Show Mihomo systemd service detail.
  timer                  Show subscription update timer.
  select                 Select a working proxy node through Mihomo controller.
  test                   Test socks5 and proxychains connectivity.
  logs [N]               Show recent Mihomo logs. Default: 100 lines.
  logs-sub [N]           Show recent subscription update logs. Default: 100 lines.
  proxy on               Enable system proxy for new shells and apt.
  proxy off              Disable system proxy files created by this script.
  proxy status           Show system proxy status.
  proxy env              Print export commands for the current shell.
  proxychains            Recreate proxychains config for 127.0.0.1:7891.
  proxychains-show       Show proxychains config.
  menu                   Open grouped interactive menu.
  help                   Show this help.

Examples:
  $SCRIPT_NAME update
  $SCRIPT_NAME set-url
  $SCRIPT_NAME set-lang zh
  $SCRIPT_NAME proxy on
  eval "\$($SCRIPT_NAME proxy env)"
  proxychains4 -q curl https://api.ipify.org

Tip:
  Use "$SCRIPT_NAME set-url" without an argument for sensitive URLs, so the token
  is not saved in shell history.
EOF
}

show_status() {
  load_subscription_env
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf '语言：%s\n' "$MIHOMO_SH_LANG"
    printf 'Mihomo 服务：'
  else
    printf 'Language: %s\n' "$MIHOMO_SH_LANG"
    printf 'Mihomo service: '
  fi
  systemctl is-active "$MIHOMO_SERVICE" 2>/dev/null || true
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf 'Mihomo 开机自启：'
  else
    printf 'Mihomo enabled: '
  fi
  systemctl is-enabled "$MIHOMO_SERVICE" 2>/dev/null || true
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf '订阅定时更新：'
  else
    printf 'Subscription timer: '
  fi
  systemctl is-enabled mihomo-subscription.timer 2>/dev/null || true
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf '订阅链接：'
  else
    printf 'Subscription URL: '
  fi
  mask_url "$SUBSCRIPTION_URL"
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf '订阅 UA：%s\n' "$SUBSCRIPTION_UA"
    printf 'Mihomo 程序：'
  else
    printf 'Subscription UA: %s\n' "$SUBSCRIPTION_UA"
    printf 'Mihomo binary: '
  fi
  if command -v mihomo >/dev/null 2>&1; then
    command -v mihomo
  elif [ -x /usr/local/bin/mihomo ]; then
    printf '/usr/local/bin/mihomo\n'
  else
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      printf '(未找到)\n'
    else
      printf '(not found)\n'
    fi
  fi
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf '监听端口：\n'
  else
    printf 'Listening ports:\n'
  fi
  ss -ltnp 2>/dev/null | grep -E '127\.0\.0\.1:(7890|7891|9090)\b' || true
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf 'Proxychains 配置：'
  else
    printf 'Proxychains config: '
  fi
  if [ -e "$PROXYCHAINS_CONF" ]; then
    printf '%s\n' "$PROXYCHAINS_CONF"
  else
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      printf '(缺失)\n'
    else
      printf '(missing)\n'
    fi
  fi
  show_proxy_status
}

run_update() {
  load_subscription_env
  [ -n "$SUBSCRIPTION_URL" ] || die "$(tr_msg url_not_set)"
  [ -x "$UPDATE_SCRIPT" ] || die "$(tr_msg missing_update_script "$UPDATE_SCRIPT")"
  info "$(tr_msg updating)"
  "$UPDATE_SCRIPT"
  if systemctl is-active --quiet "$MIHOMO_SERVICE"; then
    systemctl restart "$MIHOMO_SERVICE"
  else
    systemctl start "$MIHOMO_SERVICE"
  fi
  sleep 2
  if [ -x "$SELECT_SCRIPT" ]; then
    "$SELECT_SCRIPT" || warn "$(tr_msg select_failed)"
  fi
  info "$(tr_msg update_finished)"
}

set_url() {
  local url="${1-}"
  load_subscription_env
  if [ -z "$url" ]; then
    tr_msg new_url_prompt
    IFS= read -r -s url
    printf '\n'
  fi
  validate_url "$url"
  write_subscription_env "$url" "$SUBSCRIPTION_UA"
  info "$(tr_msg url_saved)"
  run_update
}

set_ua() {
  local ua="${1-}"
  load_subscription_env
  if [ -z "$ua" ]; then
    tr_msg new_ua_prompt "$SUBSCRIPTION_UA"
    IFS= read -r ua
    ua="${ua:-$SUBSCRIPTION_UA}"
  fi
  [ -n "$ua" ] || die "$(tr_msg ua_empty)"
  write_subscription_env "$SUBSCRIPTION_URL" "$ua"
  info "$(tr_msg ua_saved)"
  run_update
}

restart_mihomo() {
  systemctl restart "$MIHOMO_SERVICE"
  sleep 2
  if [ -x "$SELECT_SCRIPT" ]; then
    "$SELECT_SCRIPT" || warn "$(tr_msg select_failed)"
  fi
}

select_proxy() {
  [ -x "$SELECT_SCRIPT" ] || die "$(tr_msg missing_selector "$SELECT_SCRIPT")"
  "$SELECT_SCRIPT"
}

show_language() {
  tr_msg lang_status
}

normalize_language() {
  case "${1:-}" in
    zh|ZH|cn|CN|中文|Chinese|chinese) printf 'zh' ;;
    en|EN|英文|English|english) printf 'en' ;;
    *) return 1 ;;
  esac
}

set_language() {
  local input="${1-}"
  local lang
  if [ -z "$input" ]; then
    printf '1) 中文\n2) English\n'
    tr_msg choose_lang
    IFS= read -r input
  fi
  case "$input" in
    1) input="zh" ;;
    2) input="en" ;;
  esac
  lang="$(normalize_language "$input")" || die "$(tr_msg bad_lang)"
  MIHOMO_SH_LANG="$lang"
  write_settings "$lang"
  info "$(tr_msg lang_saved "$lang")"
}

ensure_proxychains() {
  need_cmd proxychains4
  backup_file "$PROXYCHAINS_CONF"
  cat > "$PROXYCHAINS_CONF" <<EOF
strict_chain
proxy_dns
quiet_mode
tcp_read_time_out 15000
tcp_connect_time_out 8000

[ProxyList]
socks5 127.0.0.1 7891
EOF
  chmod 644 "$PROXYCHAINS_CONF"
  ln -sfn "$PROXYCHAINS_CONF" "$PROXYCHAINS_LEGACY"
  info "$(tr_msg proxychains_done "$PROXYCHAINS_CONF")"
}

proxy_env() {
  cat <<EOF
export http_proxy="$HTTP_PROXY_URL"
export https_proxy="$HTTP_PROXY_URL"
export HTTP_PROXY="$HTTP_PROXY_URL"
export HTTPS_PROXY="$HTTP_PROXY_URL"
export all_proxy="$SOCKS_PROXY_URL"
export ALL_PROXY="$SOCKS_PROXY_URL"
export no_proxy="$NO_PROXY_LIST"
export NO_PROXY="$NO_PROXY_LIST"
EOF
}

proxy_on() {
  cat > "$PROFILE_PROXY" <<EOF
# Managed by $SCRIPT_NAME. Applies to new login shells.
export http_proxy="$HTTP_PROXY_URL"
export https_proxy="$HTTP_PROXY_URL"
export HTTP_PROXY="$HTTP_PROXY_URL"
export HTTPS_PROXY="$HTTP_PROXY_URL"
export all_proxy="$SOCKS_PROXY_URL"
export ALL_PROXY="$SOCKS_PROXY_URL"
export no_proxy="$NO_PROXY_LIST"
export NO_PROXY="$NO_PROXY_LIST"
EOF
  chmod 644 "$PROFILE_PROXY"
  if [ -d /etc/apt/apt.conf.d ]; then
    cat > "$APT_PROXY" <<EOF
Acquire::http::Proxy "$HTTP_PROXY_URL/";
Acquire::https::Proxy "$HTTP_PROXY_URL/";
EOF
    chmod 644 "$APT_PROXY"
  fi
  info "$(tr_msg proxy_on_done)"
  info "$(tr_msg proxy_on_tip)"
}

proxy_off() {
  rm -f "$PROFILE_PROXY" "$APT_PROXY"
  info "$(tr_msg proxy_off_done)"
  info "$(tr_msg proxy_off_tip)"
}

show_proxy_status() {
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf '系统 shell 代理：'
  else
    printf 'System shell proxy: '
  fi
  if [ -f "$PROFILE_PROXY" ]; then
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      printf '已启用（%s）\n' "$PROFILE_PROXY"
    else
      printf 'enabled (%s)\n' "$PROFILE_PROXY"
    fi
  else
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      printf '未启用\n'
    else
      printf 'disabled\n'
    fi
  fi
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf 'APT 代理：'
  else
    printf 'APT proxy: '
  fi
  if [ -f "$APT_PROXY" ]; then
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      printf '已启用（%s）\n' "$APT_PROXY"
    else
      printf 'enabled (%s)\n' "$APT_PROXY"
    fi
  else
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      printf '未启用\n'
    else
      printf 'disabled\n'
    fi
  fi
}

test_proxy() {
  need_cmd curl
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf 'Mihomo 服务：'
  else
    printf 'Mihomo service: '
  fi
  systemctl is-active "$MIHOMO_SERVICE" 2>/dev/null || true
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf 'SOCKS5 Google 204：'
  else
    printf 'SOCKS5 google 204: '
  fi
  curl -4 -sS -o /dev/null -w 'code=%{http_code} time=%{time_total}\n' \
    --socks5-hostname 127.0.0.1:7891 --connect-timeout 8 --max-time 25 \
    https://www.google.com/generate_204 || true
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf 'SOCKS5 出口 IP：'
  else
    printf 'SOCKS5 exit IP: '
  fi
  curl -4 -sS --socks5-hostname 127.0.0.1:7891 --connect-timeout 8 --max-time 25 \
    https://api.ipify.org || true
  printf '\n'
  if command -v proxychains4 >/dev/null 2>&1; then
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      printf 'Proxychains Google 204：'
    else
      printf 'Proxychains google 204: '
    fi
    proxychains4 -q -f "$PROXYCHAINS_CONF" curl -4 -sS -o /dev/null \
      -w 'code=%{http_code} time=%{time_total}\n' \
      --connect-timeout 8 --max-time 25 https://www.google.com/generate_204 || true
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      printf 'Proxychains 出口 IP：'
    else
      printf 'Proxychains exit IP: '
    fi
    proxychains4 -q -f "$PROXYCHAINS_CONF" curl -4 -sS \
      --connect-timeout 8 --max-time 25 https://api.ipify.org || true
    printf '\n'
  else
    warn "$(tr_msg proxychains_missing)"
  fi
}

show_logs() {
  local lines="${1:-100}"
  case "$lines" in
    ''|*[!0-9]*) die "$(tr_msg bad_log_count)" ;;
  esac
  journalctl -u "$MIHOMO_SERVICE" -n "$lines" --no-pager
}

show_ports() {
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf 'Mihomo 监听端口：\n'
  else
    printf 'Mihomo listening ports:\n'
  fi
  ss -ltnp 2>/dev/null | grep -E '127\.0\.0\.1:(7890|7891|9090)\b' || true
}

show_subscription_files() {
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf '订阅相关文件：\n'
  else
    printf 'Subscription files:\n'
  fi
  ls -lh "$ENV_FILE" "${CONFIG_DIR}/config.yaml" "${CONFIG_DIR}/subscription.raw.yaml" 2>/dev/null || true
}

show_service_detail() {
  systemctl --no-pager --full status "$MIHOMO_SERVICE" | sed -n '1,35p'
}

show_timer_detail() {
  systemctl --no-pager --full status mihomo-subscription.timer 2>/dev/null | sed -n '1,25p' || true
  systemctl list-timers --all mihomo-subscription.timer --no-pager 2>/dev/null || true
}

show_proxychains_config() {
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf 'Proxychains 配置文件：%s\n' "$PROXYCHAINS_CONF"
  else
    printf 'Proxychains config file: %s\n' "$PROXYCHAINS_CONF"
  fi
  if [ -r "$PROXYCHAINS_CONF" ]; then
    sed -n '1,120p' "$PROXYCHAINS_CONF"
  else
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      printf '配置文件不存在或不可读。\n'
    else
      printf 'Config file is missing or unreadable.\n'
    fi
  fi
}

show_subscription_logs() {
  journalctl -u mihomo-subscription.service -n "${1:-100}" --no-pager
}

follow_logs() {
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf '正在跟随 Mihomo 日志，按 Ctrl+C 退出。\n'
  else
    printf 'Following Mihomo logs. Press Ctrl+C to exit.\n'
  fi
  journalctl -u "$MIHOMO_SERVICE" -f --no-pager
}

menu_prompt() {
  if [ "$MIHOMO_SH_LANG" = "zh" ]; then
    printf '请选择：'
  else
    printf 'Choose: '
  fi
}

status_menu() {
  while true; do
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      cat <<EOF

状态与测试
1) 总览状态
2) 监听端口
3) 代理连通性测试
4) 查看脱敏订阅链接
5) 打印当前 shell 代理环境变量
0) 返回主菜单
EOF
    else
      cat <<EOF

Status and tests
1) Overview status
2) Listening ports
3) Proxy connectivity test
4) Show masked subscription URL
5) Print proxy env for current shell
0) Back to main menu
EOF
    fi
    menu_prompt
    IFS= read -r choice
    case "$choice" in
      1) show_status ;;
      2) show_ports ;;
      3) test_proxy ;;
      4) load_subscription_env; mask_url "$SUBSCRIPTION_URL" ;;
      5) proxy_env ;;
      0|b|B|q|Q) return ;;
      *) warn "$(tr_msg unknown_choice)" ;;
    esac
  done
}

subscription_menu() {
  while true; do
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      cat <<EOF

订阅管理
1) 立即更新订阅
2) 更换订阅链接
3) 更换 User-Agent
4) 查看脱敏订阅链接
5) 查看订阅相关文件
6) 自动选择可用节点
0) 返回主菜单
EOF
    else
      cat <<EOF

Subscription management
1) Update now
2) Replace subscription URL
3) Replace User-Agent
4) Show masked subscription URL
5) Show subscription files
6) Select a working proxy
0) Back to main menu
EOF
    fi
    menu_prompt
    IFS= read -r choice
    case "$choice" in
      1) run_update ;;
      2) set_url ;;
      3) set_ua ;;
      4) load_subscription_env; mask_url "$SUBSCRIPTION_URL" ;;
      5) show_subscription_files ;;
      6) select_proxy ;;
      0|b|B|q|Q) return ;;
      *) warn "$(tr_msg unknown_choice)" ;;
    esac
  done
}

service_menu() {
  while true; do
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      cat <<EOF

Mihomo 服务管理
1) 服务详情
2) 启动服务
3) 停止服务
4) 重启服务并选择可用节点
5) 仅自动选择可用节点
6) 启用开机自启
7) 关闭开机自启
8) 查看订阅定时器
0) 返回主菜单
EOF
    else
      cat <<EOF

Mihomo service management
1) Service detail
2) Start service
3) Stop service
4) Restart service and select a working proxy
5) Select a working proxy only
6) Enable autostart
7) Disable autostart
8) Show subscription timer
0) Back to main menu
EOF
    fi
    menu_prompt
    IFS= read -r choice
    case "$choice" in
      1) show_service_detail ;;
      2) systemctl start "$MIHOMO_SERVICE" ;;
      3) systemctl stop "$MIHOMO_SERVICE" ;;
      4) restart_mihomo ;;
      5) select_proxy ;;
      6) systemctl enable "$MIHOMO_SERVICE" ;;
      7) systemctl disable "$MIHOMO_SERVICE" ;;
      8) show_timer_detail ;;
      0|b|B|q|Q) return ;;
      *) warn "$(tr_msg unknown_choice)" ;;
    esac
  done
}

proxy_menu() {
  while true; do
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      cat <<EOF

系统代理与 Proxychains
1) 查看系统代理状态
2) 开启系统代理（新 shell 和 apt）
3) 关闭系统代理
4) 打印当前 shell 代理环境变量
5) 重建 proxychains 配置
6) 查看 proxychains 配置
7) 代理连通性测试
0) 返回主菜单
EOF
    else
      cat <<EOF

System proxy and Proxychains
1) Show system proxy status
2) Enable system proxy for new shells and apt
3) Disable system proxy
4) Print proxy env for current shell
5) Recreate proxychains config
6) Show proxychains config
7) Proxy connectivity test
0) Back to main menu
EOF
    fi
    menu_prompt
    IFS= read -r choice
    case "$choice" in
      1) show_proxy_status ;;
      2) proxy_on ;;
      3) proxy_off ;;
      4) proxy_env ;;
      5) ensure_proxychains ;;
      6) show_proxychains_config ;;
      7) test_proxy ;;
      0|b|B|q|Q) return ;;
      *) warn "$(tr_msg unknown_choice)" ;;
    esac
  done
}

logs_menu() {
  while true; do
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      cat <<EOF

日志
1) Mihomo 最近 50 行
2) Mihomo 最近 100 行
3) Mihomo 最近 200 行
4) 订阅更新日志最近 100 行
5) 跟随 Mihomo 实时日志
0) 返回主菜单
EOF
    else
      cat <<EOF

Logs
1) Mihomo last 50 lines
2) Mihomo last 100 lines
3) Mihomo last 200 lines
4) Subscription update last 100 lines
5) Follow Mihomo live logs
0) Back to main menu
EOF
    fi
    menu_prompt
    IFS= read -r choice
    case "$choice" in
      1) show_logs 50 ;;
      2) show_logs 100 ;;
      3) show_logs 200 ;;
      4) show_subscription_logs 100 ;;
      5) follow_logs ;;
      0|b|B|q|Q) return ;;
      *) warn "$(tr_msg unknown_choice)" ;;
    esac
  done
}

language_menu() {
  while true; do
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      cat <<EOF

语言设置
1) 查看当前语言
2) 切换到中文
3) Switch to English
0) 返回主菜单
EOF
    else
      cat <<EOF

Language
1) Show current language
2) Switch to Chinese
3) Switch to English
0) Back to main menu
EOF
    fi
    menu_prompt
    IFS= read -r choice
    case "$choice" in
      1) show_language ;;
      2) set_language zh ;;
      3) set_language en ;;
      0|b|B|q|Q) return ;;
      *) warn "$(tr_msg unknown_choice)" ;;
    esac
  done
}

menu() {
  while true; do
    if [ "$MIHOMO_SH_LANG" = "zh" ]; then
      cat <<EOF

$SCRIPT_NAME 主菜单
1) 状态与测试
2) 订阅管理
3) Mihomo 服务管理
4) 系统代理与 Proxychains
5) 日志
6) 语言设置
0) 退出
EOF
    else
      cat <<EOF

$SCRIPT_NAME main menu
1) Status and tests
2) Subscription management
3) Mihomo service management
4) System proxy and Proxychains
5) Logs
6) Language
0) Exit
EOF
    fi
    menu_prompt
    IFS= read -r choice
    case "$choice" in
      1) status_menu ;;
      2) subscription_menu ;;
      3) service_menu ;;
      4) proxy_menu ;;
      5) logs_menu ;;
      6) language_menu ;;
      0) exit 0 ;;
      *) warn "$(tr_msg unknown_choice)" ;;
    esac
  done
}

main() {
  load_settings
  local cmd="${1:-menu}"
  if [ "$cmd" = "help" ] || [ "$cmd" = "-h" ] || [ "$cmd" = "--help" ]; then
    print_help
    exit 0
  fi
  if [ "$cmd" = "proxy" ] && [ "${2-}" = "env" ]; then
    proxy_env
    exit 0
  fi

  require_root
  case "$cmd" in
    menu) menu ;;
    status) show_status ;;
    ports) show_ports ;;
    update|refresh) run_update ;;
    set-url|url) shift || true; set_url "${1-}" ;;
    set-ua|ua) shift || true; set_ua "${1-}" ;;
    show-url) load_subscription_env; mask_url "$SUBSCRIPTION_URL" ;;
    lang|language) show_language ;;
    set-lang|language-set) shift || true; set_language "${1-}" ;;
    start) systemctl start "$MIHOMO_SERVICE" ;;
    stop) systemctl stop "$MIHOMO_SERVICE" ;;
    restart) restart_mihomo ;;
    service-status) show_service_detail ;;
    timer) show_timer_detail ;;
    select) select_proxy ;;
    test) test_proxy ;;
    logs) shift || true; show_logs "${1:-100}" ;;
    logs-sub) shift || true; show_subscription_logs "${1:-100}" ;;
    proxychains) ensure_proxychains ;;
    proxychains-show) show_proxychains_config ;;
    proxy)
      case "${2-}" in
        on) proxy_on ;;
        off) proxy_off ;;
        status) show_proxy_status ;;
        env) proxy_env ;;
        *) die "$(tr_msg proxy_usage)" ;;
      esac
      ;;
    *) print_help; exit 1 ;;
  esac
}

main "$@"
