import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const rootDir = resolve(".");
const publicDir = join(rootDir, "public");
const port = Number(process.env.PORT || 5178);
const listenHost = process.env.LISTEN_HOST || "127.0.0.1";
const config = loadConfig();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const readOnlyHandlers = {
  status: () => runRemoteScript(statusScript()),
  test: () => runRemoteScript(testScript(), 90_000),
  ports: () => runRemoteScript(portsScript()),
  "show-url": () => runRemoteScript(showUrlScript()),
  "proxy-status": () => runRemoteScript(proxyStatusScript()),
  "proxy-env": () => runRemoteScript(proxyEnvScript()),
  timer: () => runRemoteScript(timerScript()),
  "service-status": () => runRemoteScript(serviceStatusScript()),
  "proxychains-show": () => runRemoteScript(proxychainsShowScript()),
  lang: () => runRemoteScript(languageScript()),
};

const actionHandlers = {
  update: () => runRemoteScript(updateScript(), 180_000),
  start: () => runRemoteScript(startServiceScript(), 120_000),
  stop: () => runRemoteScript(stopServiceScript(), 60_000),
  restart: () => runRemoteScript(restartServiceScript(), 120_000),
  select: () => runRemoteScript(selectOnlyScript(), 120_000),
  "proxy-on": () => runRemoteScript(proxyOnScript()),
  "proxy-off": () => runRemoteScript(proxyOffScript()),
  proxychains: () => runRemoteScript(proxychainsConfigureScript()),
};

createServer(async (req, res) => {
  try {
    if (req.url?.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}).listen(port, listenHost, () => {
  console.log(`Mihomo Manager UI listening on http://${listenHost}:${port}`);
});

function loadConfig() {
  const fileConfig = existsSync(join(rootDir, "server.config.json"))
    ? JSON.parse(readFileSync(join(rootDir, "server.config.json"), "utf8"))
    : {};
  const merged = {
    host: process.env.MIHOMO_HOST || fileConfig.host,
    port: Number(process.env.MIHOMO_SSH_PORT || fileConfig.port || 22),
    user: process.env.MIHOMO_USER || fileConfig.user || "root",
    identityFile: process.env.MIHOMO_KEY || fileConfig.identityFile,
  };
  if (!merged.host) {
    throw new Error("Missing server host. Create server.config.json or set MIHOMO_HOST.");
  }
  if (!merged.identityFile) {
    throw new Error("Missing SSH identity file. Create server.config.json or set MIHOMO_KEY.");
  }
  return merged;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      ok: true,
      data: {
        host: config.host,
        port: config.port,
        user: config.user,
        mode: "direct-ssh",
      },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/run") {
    const command = url.searchParams.get("command") || "";
    const handler = readOnlyHandlers[command];
    if (!handler) {
      sendJson(res, 400, { ok: false, error: "Unknown read-only command." });
      return;
    }
    const result = await handler();
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    const target = url.searchParams.get("target") === "subscription" ? "subscription" : "mihomo";
    const lines = normalizeLines(url.searchParams.get("lines"));
    const result = await runRemoteScript(logsScript(target, lines), 60_000);
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/action") {
    const body = await readBody(req);
    const action = String(body.action || "");
    const handler = actionHandlers[action];
    if (!handler) {
      sendJson(res, 400, { ok: false, error: "Unknown action." });
      return;
    }
    const result = await handler();
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/subscription/url") {
    const body = await readBody(req);
    const subscriptionUrl = String(body.url || "").trim();
    if (!/^https?:\/\//i.test(subscriptionUrl)) {
      sendJson(res, 400, { ok: false, error: "Subscription URL must start with http:// or https://." });
      return;
    }
    const result = await runRemoteScript(setSubscriptionUrlScript(subscriptionUrl), 180_000);
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/subscription/ua") {
    const body = await readBody(req);
    const userAgent = String(body.ua || "").trim();
    if (!userAgent) {
      sendJson(res, 400, { ok: false, error: "User-Agent cannot be empty." });
      return;
    }
    const result = await runRemoteScript(setSubscriptionUaScript(userAgent), 180_000);
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/lang") {
    const body = await readBody(req);
    const lang = String(body.lang || "").toLowerCase();
    if (!["zh", "en"].includes(lang)) {
      sendJson(res, 400, { ok: false, error: "Language must be zh or en." });
      return;
    }
    const result = await runRemoteScript(setLanguageScript(lang));
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found." });
}

function serveStatic(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
  res.end(readFileSync(filePath));
}

function remoteBase() {
  return String.raw`set -euo pipefail
CONFIG_DIR=/etc/mihomo
ENV_FILE=$CONFIG_DIR/subscription.env
WEBUI_ENV_FILE=$CONFIG_DIR/webui.env
CONFIG_FILE=$CONFIG_DIR/config.yaml
RAW_FILE=$CONFIG_DIR/subscription.raw.yaml
PROFILE_PROXY=/etc/profile.d/mihomo-proxy.sh
APT_PROXY=/etc/apt/apt.conf.d/95mihomo-proxy
PROXYCHAINS_CONF=/etc/proxychains4.conf
PROXYCHAINS_LEGACY=/etc/proxychains.conf
HTTP_PROXY_URL=http://127.0.0.1:7890
SOCKS_PROXY_URL=socks5h://127.0.0.1:7891
NO_PROXY_LIST=localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
DEFAULT_UA=ClashMetaForAndroid/2.10.1
WEBUI_LANG=zh

if [ -r "$WEBUI_ENV_FILE" ]; then
  . "$WEBUI_ENV_FILE"
fi
case "$WEBUI_LANG" in
  zh|en) ;;
  *) WEBUI_LANG=zh ;;
esac

mihomo_bin() {
  if command -v mihomo >/dev/null 2>&1; then
    command -v mihomo
  elif [ -x /usr/local/bin/mihomo ]; then
    printf '/usr/local/bin/mihomo\n'
  else
    return 1
  fi
}

load_subscription_env() {
  SUBSCRIPTION_URL=
  SUBSCRIPTION_UA=$DEFAULT_UA
  if [ -r "$ENV_FILE" ]; then
    . "$ENV_FILE"
  fi
  if [ -z "$SUBSCRIPTION_UA" ]; then
    SUBSCRIPTION_UA=$DEFAULT_UA
  fi
}

quote_sh() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

write_subscription_env() {
  url_value=$1
  ua_value=$2
  install -d -m 700 "$CONFIG_DIR"
  tmp_file=$(mktemp)
  {
    printf '# Managed by mihomo-manager-webui. Keep this file root-only.\n'
    printf 'SUBSCRIPTION_URL='
    quote_sh "$url_value"
    printf '\nSUBSCRIPTION_UA='
    quote_sh "$ua_value"
    printf '\n'
  } > "$tmp_file"
  install -m 600 "$tmp_file" "$ENV_FILE"
  rm -f "$tmp_file"
}

mask_url() {
  value=$1
  if [ -z "$value" ]; then
    if [ "$WEBUI_LANG" = zh ]; then printf '(未设置)\n'; else printf '(not set)\n'; fi
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$value" <<'PY'
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
    printf '%s\n' "$value" | sed -E 's/((token|access_token|key|secret|password|passwd)=)[^&[:space:]]+/\1***/Ig'
  fi
}
`;
}

function statusScript() {
  return `${remoteBase()}
load_subscription_env
active=$(systemctl is-active mihomo.service 2>/dev/null || true)
enabled=$(systemctl is-enabled mihomo.service 2>/dev/null || true)
timer=$(systemctl is-enabled mihomo-subscription.timer 2>/dev/null || true)
bin_path=$(mihomo_bin 2>/dev/null || true)

if [ "$WEBUI_LANG" = zh ]; then
  if [ -z "$bin_path" ]; then bin_path='(未找到)'; fi
  printf '语言：%s\n' "$WEBUI_LANG"
  printf 'Mihomo 服务：%s\n' "$active"
  printf 'Mihomo 开机自启：%s\n' "$enabled"
  printf '订阅定时更新：%s\n' "$timer"
  printf '订阅链接：'
  mask_url "$SUBSCRIPTION_URL"
  printf '订阅 UA：%s\n' "$SUBSCRIPTION_UA"
  printf 'Mihomo 程序：%s\n' "$bin_path"
  printf '监听端口：\n'
else
  if [ -z "$bin_path" ]; then bin_path='(not found)'; fi
  printf 'Language: %s\n' "$WEBUI_LANG"
  printf 'Mihomo service: %s\n' "$active"
  printf 'Mihomo enabled: %s\n' "$enabled"
  printf 'Subscription timer: %s\n' "$timer"
  printf 'Subscription URL: '
  mask_url "$SUBSCRIPTION_URL"
  printf 'Subscription UA: %s\n' "$SUBSCRIPTION_UA"
  printf 'Mihomo binary: %s\n' "$bin_path"
  printf 'Listening ports:\n'
fi
ss -ltnp 2>/dev/null | grep -E '127\\.0\\.0\\.1:(7890|7891|9090)\\b' || true
if [ "$WEBUI_LANG" = zh ]; then
  printf 'Proxychains 配置：'
else
  printf 'Proxychains config: '
fi
if [ -e "$PROXYCHAINS_CONF" ]; then
  printf '%s\n' "$PROXYCHAINS_CONF"
else
  if [ "$WEBUI_LANG" = zh ]; then printf '(缺失)\n'; else printf '(missing)\n'; fi
fi
${proxyStatusBody()}
`;
}

function portsScript() {
  return `${remoteBase()}
if [ "$WEBUI_LANG" = zh ]; then printf 'Mihomo 监听端口：\n'; else printf 'Mihomo listening ports:\n'; fi
ss -ltnp 2>/dev/null | grep -E '127\\.0\\.0\\.1:(7890|7891|9090)\\b' || true
`;
}

function showUrlScript() {
  return `${remoteBase()}
load_subscription_env
mask_url "$SUBSCRIPTION_URL"
`;
}

function proxyStatusBody() {
  return String.raw`if [ "$WEBUI_LANG" = zh ]; then
  printf '系统 shell 代理：'
else
  printf 'System shell proxy: '
fi
if [ -f "$PROFILE_PROXY" ]; then
  if [ "$WEBUI_LANG" = zh ]; then printf '已启用（%s）\n' "$PROFILE_PROXY"; else printf 'enabled (%s)\n' "$PROFILE_PROXY"; fi
else
  if [ "$WEBUI_LANG" = zh ]; then printf '未启用\n'; else printf 'disabled\n'; fi
fi
if [ "$WEBUI_LANG" = zh ]; then
  printf 'APT 代理：'
else
  printf 'APT proxy: '
fi
if [ -f "$APT_PROXY" ]; then
  if [ "$WEBUI_LANG" = zh ]; then printf '已启用（%s）\n' "$APT_PROXY"; else printf 'enabled (%s)\n' "$APT_PROXY"; fi
else
  if [ "$WEBUI_LANG" = zh ]; then printf '未启用\n'; else printf 'disabled\n'; fi
fi`;
}

function proxyStatusScript() {
  return `${remoteBase()}
${proxyStatusBody()}
`;
}

function proxyEnvScript() {
  return `${remoteBase()}
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
`;
}

function proxyOnScript() {
  return `${remoteBase()}
cat > "$PROFILE_PROXY" <<EOF
# Managed by mihomo-manager-webui. Applies to new login shells.
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
if [ "$WEBUI_LANG" = zh ]; then
  printf '[信息] 系统代理文件已启用，作用于新的 shell 和 apt。\n'
  printf '[信息] 当前 shell 立即生效请复制“当前 shell 环境变量”输出并执行。\n'
else
  printf '[INFO] System proxy files enabled for new shells and apt.\n'
  printf '[INFO] For the current shell, copy and run the proxy env output.\n'
fi
`;
}

function proxyOffScript() {
  return `${remoteBase()}
rm -f "$PROFILE_PROXY" "$APT_PROXY"
if [ "$WEBUI_LANG" = zh ]; then
  printf '[信息] 系统代理文件已移除。\n'
  printf '[信息] 已经打开的 shell 会保留原环境变量；重新打开 shell 或手动 unset 后失效。\n'
else
  printf '[INFO] System proxy files removed.\n'
  printf '[INFO] Already-open shells keep their environment until you unset variables or reopen the shell.\n'
fi
`;
}

function timerScript() {
  return `${remoteBase()}
systemctl --no-pager --full status mihomo-subscription.timer 2>/dev/null | sed -n '1,25p' || true
systemctl list-timers --all mihomo-subscription.timer --no-pager 2>/dev/null || true
`;
}

function serviceStatusScript() {
  return `${remoteBase()}
systemctl --no-pager --full status mihomo.service | sed -n '1,35p'
`;
}

function logsScript(target, lines) {
  const unit = target === "subscription" ? "mihomo-subscription.service" : "mihomo.service";
  return `${remoteBase()}
journalctl -u ${shellQuote(unit)} -n ${Number(lines)} --no-pager
`;
}

function languageScript() {
  return `${remoteBase()}
if [ "$WEBUI_LANG" = zh ]; then
  printf '当前语言：%s\n' "$WEBUI_LANG"
else
  printf 'Current language: %s\n' "$WEBUI_LANG"
fi
`;
}

function setLanguageScript(lang) {
  return `${remoteBase()}
install -d -m 700 "$CONFIG_DIR"
tmp_file=$(mktemp)
{
  printf '# Managed by mihomo-manager-webui.\n'
  printf 'WEBUI_LANG=%s\n' ${shellQuote(lang)}
} > "$tmp_file"
install -m 600 "$tmp_file" "$WEBUI_ENV_FILE"
rm -f "$tmp_file"
if [ ${shellQuote(lang)} = zh ]; then
  printf '[信息] 语言已设置为：zh\n'
else
  printf '[INFO] Language set to: en\n'
fi
`;
}

function proxychainsConfigureScript() {
  return `${remoteBase()}
if ! command -v proxychains4 >/dev/null 2>&1; then
  if [ "$WEBUI_LANG" = zh ]; then printf '[错误] proxychains4 未安装。\n' >&2; else printf '[ERROR] proxychains4 is not installed.\n' >&2; fi
  exit 1
fi
if [ -f "$PROXYCHAINS_CONF" ] && [ ! -L "$PROXYCHAINS_CONF" ]; then
  cp -a "$PROXYCHAINS_CONF" "$PROXYCHAINS_CONF.backup.$(date +%Y%m%d%H%M%S)"
fi
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
if [ "$WEBUI_LANG" = zh ]; then printf '[信息] Proxychains 配置已更新：%s\n' "$PROXYCHAINS_CONF"; else printf '[INFO] Proxychains configured: %s\n' "$PROXYCHAINS_CONF"; fi
`;
}

function proxychainsShowScript() {
  return `${remoteBase()}
if [ "$WEBUI_LANG" = zh ]; then printf 'Proxychains 配置文件：%s\n' "$PROXYCHAINS_CONF"; else printf 'Proxychains config file: %s\n' "$PROXYCHAINS_CONF"; fi
if [ -r "$PROXYCHAINS_CONF" ]; then
  sed -n '1,120p' "$PROXYCHAINS_CONF"
else
  if [ "$WEBUI_LANG" = zh ]; then printf '配置文件不存在或不可读。\n'; else printf 'Config file is missing or unreadable.\n'; fi
fi
`;
}

function testScript() {
  return `${remoteBase()}
if ! command -v curl >/dev/null 2>&1; then
  if [ "$WEBUI_LANG" = zh ]; then printf '[错误] 缺少命令：curl\n' >&2; else printf '[ERROR] Missing command: curl\n' >&2; fi
  exit 1
fi
if [ "$WEBUI_LANG" = zh ]; then printf 'Mihomo 服务：'; else printf 'Mihomo service: '; fi
systemctl is-active mihomo.service 2>/dev/null || true
if [ "$WEBUI_LANG" = zh ]; then printf 'SOCKS5 Google 204：'; else printf 'SOCKS5 google 204: '; fi
curl -4 -sS -o /dev/null -w 'code=%{http_code} time=%{time_total}\n' --socks5-hostname 127.0.0.1:7891 --connect-timeout 8 --max-time 25 https://www.google.com/generate_204 || true
if [ "$WEBUI_LANG" = zh ]; then printf 'SOCKS5 出口 IP：'; else printf 'SOCKS5 exit IP: '; fi
curl -4 -sS --socks5-hostname 127.0.0.1:7891 --connect-timeout 8 --max-time 25 https://api.ipify.org || true
printf '\n'
if command -v proxychains4 >/dev/null 2>&1; then
  if [ "$WEBUI_LANG" = zh ]; then printf 'Proxychains Google 204：'; else printf 'Proxychains google 204: '; fi
  proxychains4 -q -f "$PROXYCHAINS_CONF" curl -4 -sS -o /dev/null -w 'code=%{http_code} time=%{time_total}\n' --connect-timeout 8 --max-time 25 https://www.google.com/generate_204 || true
  if [ "$WEBUI_LANG" = zh ]; then printf 'Proxychains 出口 IP：'; else printf 'Proxychains exit IP: '; fi
  proxychains4 -q -f "$PROXYCHAINS_CONF" curl -4 -sS --connect-timeout 8 --max-time 25 https://api.ipify.org || true
  printf '\n'
else
  if [ "$WEBUI_LANG" = zh ]; then printf '[警告] proxychains4 未安装。\n' >&2; else printf '[WARN] proxychains4 is not installed.\n' >&2; fi
fi
`;
}

function updateFunctionBody() {
  return String.raw`update_subscription() {
  load_subscription_env
  if [ -z "$SUBSCRIPTION_URL" ]; then
    if [ "$WEBUI_LANG" = zh ]; then printf '[错误] 订阅链接未设置。\n' >&2; else printf '[ERROR] Subscription URL is not set.\n' >&2; fi
    exit 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    if [ "$WEBUI_LANG" = zh ]; then printf '[错误] 缺少命令：curl\n' >&2; else printf '[ERROR] Missing command: curl\n' >&2; fi
    exit 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    if [ "$WEBUI_LANG" = zh ]; then printf '[错误] 缺少命令：python3\n' >&2; else printf '[ERROR] Missing command: python3\n' >&2; fi
    exit 1
  fi
  bin_path=$(mihomo_bin) || {
    if [ "$WEBUI_LANG" = zh ]; then printf '[错误] 未找到 mihomo。\n' >&2; else printf '[ERROR] Mihomo binary not found.\n' >&2; fi
    exit 1
  }
  install -d -m 700 "$CONFIG_DIR"
  tmp_dir=$(mktemp -d)
  trap 'rm -rf "$tmp_dir"' EXIT
  raw_file=$tmp_dir/subscription.yaml
  cfg_file=$tmp_dir/config.yaml
  if [ "$WEBUI_LANG" = zh ]; then printf '[信息] 正在拉取订阅...\n'; else printf '[INFO] Downloading subscription...\n'; fi
  curl -fsSL --retry 3 --connect-timeout 15 --max-time 90 -H 'Accept: */*' -A "$SUBSCRIPTION_UA" "$SUBSCRIPTION_URL" -o "$raw_file"
  python3 - "$raw_file" "$cfg_file" <<'PY'
import re
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
text = src.read_text(encoding="utf-8", errors="ignore")
if "proxies:" not in text:
    raise SystemExit("subscription does not look like Clash YAML")
remove = {
    "port", "socks-port", "mixed-port", "redir-port", "tproxy-port",
    "allow-lan", "bind-address", "external-controller", "log-level"
}
out = []
for line in text.splitlines():
    m = re.match(r"^([A-Za-z0-9_-]+)\s*:", line)
    if m and m.group(1) in remove:
        continue
    out.append(line.rstrip())
prefix = [
    "mixed-port: 7890",
    "socks-port: 7891",
    "allow-lan: false",
    "bind-address: 127.0.0.1",
    "log-level: info",
    "external-controller: 127.0.0.1:9090",
    "",
]
dst.write_text("\n".join(prefix + out) + "\n", encoding="utf-8")
PY
  check_log=/tmp/mihomo-config-check.log
  if "$bin_path" -t -d "$CONFIG_DIR" -f "$cfg_file" >"$check_log" 2>&1; then
    install -m 600 "$raw_file" "$RAW_FILE"
    if [ -f "$CONFIG_FILE" ]; then
      cp -a "$CONFIG_FILE" "$CONFIG_FILE.backup.$(date +%Y%m%d%H%M%S)"
    fi
    install -m 600 "$cfg_file" "$CONFIG_FILE"
  else
    cat "$check_log" >&2
    exit 1
  fi
  if systemctl is-active --quiet mihomo.service 2>/dev/null; then
    systemctl restart mihomo.service
  else
    systemctl start mihomo.service
  fi
  sleep 2
  if [ "$WEBUI_LANG" = zh ]; then printf '[信息] 订阅更新完成。\n'; else printf '[INFO] Subscription update finished.\n'; fi
}`;
}

function selectFunctionBody() {
  return String.raw`select_working_proxy() {
  python3 - <<'PY'
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:9090"
URL = "https://www.gstatic.com/generate_204"

def jget(path, timeout=10):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as resp:
        return json.load(resp)

def req(method, path, data=None, timeout=10):
    body = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(
        BASE + path,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as resp:
        return resp.read()

def hid(name):
    return hashlib.sha256(str(name).encode()).hexdigest()[:8]

last = None
for _ in range(20):
    try:
        proxies = jget("/proxies", timeout=3)["proxies"]
        break
    except Exception as exc:
        last = exc
        time.sleep(0.5)
else:
    raise SystemExit(f"controller unavailable: {last}")

groups = {name: item for name, item in proxies.items() if item.get("all")}
leafs = {
    name: item
    for name, item in proxies.items()
    if not item.get("all") and item.get("type") not in ("Direct", "Reject")
}
ordered = []
for group_name in ("Proxies", "default", "GLOBAL", "Proxy"):
    group = groups.get(group_name)
    if group:
        for name in group.get("all", []):
            if name in leafs and name not in ordered:
                ordered.append(name)
for name in leafs:
    if name not in ordered:
        ordered.append(name)

working = []
for name in ordered[:120]:
    encoded = urllib.parse.quote(name, safe="")
    path = f"/proxies/{encoded}/delay?timeout=5000&url={urllib.parse.quote(URL, safe='')}"
    try:
        data = jget(path, timeout=8)
        delay = data.get("delay")
        if isinstance(delay, (int, float)) and delay > 0:
            working.append((delay, name))
            if len(working) >= 3:
                break
    except Exception:
        pass

if not working:
    raise SystemExit("no working proxy found")

working.sort()
best = working[0][1]
changed = 0
for group_name, group in groups.items():
    if group.get("type") == "Selector" and best in group.get("all", []):
        encoded = urllib.parse.quote(group_name, safe="")
        try:
            req("PUT", f"/proxies/{encoded}", {"name": best}, timeout=5)
            changed += 1
        except Exception:
            pass
print(f"selected_working_proxy delay={working[0][0]} hash={hid(best)} groups={changed}")
PY
}`;
}

function updateScript() {
  return `${remoteBase()}
${updateFunctionBody()}
${selectFunctionBody()}
update_subscription
select_working_proxy || true
`;
}

function setSubscriptionUrlScript(url) {
  const encoded = Buffer.from(url, "utf8").toString("base64");
  return `${remoteBase()}
${updateFunctionBody()}
${selectFunctionBody()}
new_url=$(printf '%s' ${shellQuote(encoded)} | base64 -d)
case "$new_url" in
  http://*|https://*) ;;
  *) printf '[ERROR] Subscription URL must start with http:// or https://.\n' >&2; exit 1 ;;
esac
load_subscription_env
write_subscription_env "$new_url" "$SUBSCRIPTION_UA"
if [ "$WEBUI_LANG" = zh ]; then printf '[信息] 订阅链接已保存。\n'; else printf '[INFO] Subscription URL saved.\n'; fi
update_subscription
select_working_proxy || true
`;
}

function setSubscriptionUaScript(ua) {
  const encoded = Buffer.from(ua, "utf8").toString("base64");
  return `${remoteBase()}
${updateFunctionBody()}
${selectFunctionBody()}
new_ua=$(printf '%s' ${shellQuote(encoded)} | base64 -d)
if [ -z "$new_ua" ]; then
  printf '[ERROR] User-Agent cannot be empty.\n' >&2
  exit 1
fi
load_subscription_env
write_subscription_env "$SUBSCRIPTION_URL" "$new_ua"
if [ "$WEBUI_LANG" = zh ]; then printf '[信息] 订阅 User-Agent 已保存。\n'; else printf '[INFO] Subscription User-Agent saved.\n'; fi
update_subscription
select_working_proxy || true
`;
}

function selectOnlyScript() {
  return `${remoteBase()}
${selectFunctionBody()}
select_working_proxy
`;
}

function startServiceScript() {
  return `${remoteBase()}
${selectFunctionBody()}
systemctl start mihomo.service
sleep 2
select_working_proxy || true
systemctl is-active mihomo.service
`;
}

function stopServiceScript() {
  return `${remoteBase()}
systemctl stop mihomo.service
systemctl is-active mihomo.service || true
`;
}

function restartServiceScript() {
  return `${remoteBase()}
${selectFunctionBody()}
systemctl restart mihomo.service
sleep 2
select_working_proxy || true
systemctl is-active mihomo.service
`;
}

function runRemoteScript(script, timeoutMs = 90_000) {
  const sshArgs = [
    "-i",
    config.identityFile,
    "-p",
    String(config.port),
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=accept-new",
    `${config.user}@${config.host}`,
    "bash -s",
  ];

  return new Promise((resolveResult) => {
    const child = spawn("ssh", sshArgs, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveResult({ ok: false, code: -1, stdout, stderr, error: error.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveResult({
        ok: code === 0,
        code,
        signal,
        stdout: scrub(stdout),
        stderr: scrub(stderr),
      });
    });

    child.stdin.write(script);
    child.stdin.end();
  });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function scrub(text) {
  return String(text)
    .replace(/((?:token|access_token|key|secret|password|passwd)=)[^&\s]+/gi, "$1***")
    .replace(/ghp_[A-Za-z0-9_]+/g, "ghp_***");
}

function normalizeLines(value) {
  const lines = Number(value || 100);
  if (!Number.isInteger(lines) || lines < 1) return 100;
  return Math.min(lines, 1000);
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy();
        rejectBody(new Error("Request body too large."));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        rejectBody(new Error("Invalid JSON body."));
      }
    });
    req.on("error", rejectBody);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
