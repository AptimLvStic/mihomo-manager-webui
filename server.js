import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const rootDir = resolve(".");
const publicDir = join(rootDir, "public");
const configFile = join(rootDir, "server.config.json");
const port = Number(process.env.PORT || 5178);
const listenHost = process.env.LISTEN_HOST || "127.0.0.1";
let config = loadConfig();

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
  const hasFileConfig = existsSync(configFile);
  const fileConfig = hasFileConfig
    ? JSON.parse(readFileSync(configFile, "utf8"))
    : {};
  const hasEnvConfig = Boolean(process.env.MIHOMO_MODE || process.env.MIHOMO_HOST || process.env.MIHOMO_KEY || process.env.MIHOMO_PASSWORD);
  if (!hasFileConfig && !hasEnvConfig) {
    return {
      configured: false,
      setupRequired: true,
      mode: "setup",
      host: "",
      port: 22,
      user: "root",
      auth: "key",
    };
  }
  const configuredMode = String(
    process.env.MIHOMO_MODE || fileConfig.mode || (process.env.MIHOMO_HOST || fileConfig.host ? "remote" : "local"),
  ).toLowerCase();
  if (!["local", "remote"].includes(configuredMode)) {
    throw new Error("MIHOMO_MODE must be local or remote.");
  }
  if (configuredMode === "local") {
    return {
      configured: true,
      setupRequired: false,
      mode: "local",
      host: "localhost",
      port: null,
      user: process.env.USER || process.env.USERNAME || "local",
      auth: "none",
    };
  }
  const identityFile = process.env.MIHOMO_KEY || fileConfig.identityFile || "";
  const password = process.env.MIHOMO_PASSWORD || fileConfig.password || "";
  const auth = String(
    process.env.MIHOMO_AUTH || fileConfig.auth || (password && !identityFile ? "password" : "key"),
  ).toLowerCase();
  if (!["key", "password"].includes(auth)) {
    throw new Error("MIHOMO_AUTH must be key or password.");
  }
  const merged = {
    configured: true,
    setupRequired: false,
    mode: "remote",
    host: process.env.MIHOMO_HOST || fileConfig.host,
    port: Number(process.env.MIHOMO_SSH_PORT || fileConfig.port || 22),
    user: process.env.MIHOMO_USER || fileConfig.user || "root",
    auth,
    identityFile,
    password,
  };
  if (!merged.host) {
    throw new Error("Missing server host. Create server.config.json or set MIHOMO_HOST.");
  }
  if (merged.auth === "key" && !merged.identityFile) {
    throw new Error("Missing SSH identity file. Create server.config.json or set MIHOMO_KEY.");
  }
  if (merged.auth === "password" && !merged.password) {
    throw new Error("Missing SSH password. Set MIHOMO_PASSWORD or configure password in server.config.json.");
  }
  return merged;
}

function buildConfigFromSetup(body) {
  const mode = String(body.mode || "").toLowerCase();
  if (!["local", "remote"].includes(mode)) {
    throw new Error("请选择本地管理或远端管理模式。");
  }
  if (mode === "local") {
    return {
      configured: true,
      setupRequired: false,
      mode: "local",
      host: "localhost",
      port: null,
      user: process.env.USER || process.env.USERNAME || "local",
      auth: "none",
    };
  }

  const auth = String(body.auth || "key").toLowerCase();
  if (!["key", "password"].includes(auth)) {
    throw new Error("远端管理认证方式必须是 key 或 password。");
  }
  const host = String(body.host || "").trim();
  const user = String(body.user || "root").trim();
  const portValue = Number(body.port || 22);
  const identityFile = String(body.identityFile || "").trim();
  const password = String(body.password || "");
  if (!host) throw new Error("请填写服务器地址。");
  if (!user) throw new Error("请填写 SSH 用户名。");
  if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) {
    throw new Error("SSH 端口必须是 1-65535 之间的整数。");
  }
  if (auth === "key" && !identityFile) {
    throw new Error("请选择密钥认证时必须填写私钥路径。");
  }
  if (auth === "password" && !password) {
    throw new Error("请选择密码认证时必须填写 SSH 密码。");
  }
  return {
    configured: true,
    setupRequired: false,
    mode: "remote",
    host,
    port: portValue,
    user,
    auth,
    identityFile,
    password,
  };
}

function configForStorage(nextConfig) {
  if (nextConfig.mode === "local") {
    return { mode: "local" };
  }
  const stored = {
    mode: "remote",
    auth: nextConfig.auth,
    host: nextConfig.host,
    port: nextConfig.port,
    user: nextConfig.user,
  };
  if (nextConfig.auth === "key") {
    stored.identityFile = nextConfig.identityFile;
  } else {
    stored.password = nextConfig.password;
  }
  return stored;
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
        mode: config.mode,
        auth: config.auth,
        configured: config.configured,
        setupRequired: config.setupRequired,
      },
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/setup/test") {
    const body = await readBody(req);
    const nextConfig = buildConfigFromSetup(body);
    const result = await runRemoteScript(setupTestScript(), 30_000, nextConfig);
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/setup/save") {
    const body = await readBody(req);
    const nextConfig = buildConfigFromSetup(body);
    const result = await runRemoteScript(setupTestScript(), 30_000, nextConfig);
    if (result.code !== 0) {
      sendJson(res, 500, result);
      return;
    }
    writeFileSync(configFile, `${JSON.stringify(configForStorage(nextConfig), null, 2)}\n`, { mode: 0o600 });
    config = loadConfig();
    sendJson(res, 200, {
      ok: true,
      stdout: "初始化配置已保存。",
      data: {
        mode: config.mode,
        auth: config.auth,
        host: config.host,
        port: config.port,
        user: config.user,
      },
    });
    return;
  }

  if (!config.configured) {
    sendJson(res, 428, { ok: false, error: "Please finish initial setup first." });
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

  if (req.method === "GET" && (url.pathname === "/api/proxies" || url.pathname === "/api/groups")) {
    const result = await runRemoteScript(proxiesScript(), 60_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/proxies/select") {
    const body = await readBody(req);
    const group = String(body.group || "").trim();
    const name = String(body.name || "").trim();
    if (!group || !name) {
      sendJson(res, 400, { ok: false, error: "Proxy group and node name are required." });
      return;
    }
    const result = await runRemoteScript(selectProxyScript(group, name), 60_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/proxies/delays") {
    const body = await readBody(req);
    const names = Array.isArray(body.names)
      ? body.names.map((name) => String(name || "").trim()).filter(Boolean).slice(0, 120)
      : [];
    if (!names.length) {
      sendJson(res, 400, { ok: false, error: "At least one proxy node name is required." });
      return;
    }
    const result = await runRemoteScript(delayScript(names), 120_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/rules") {
    const result = await runRemoteScript(rulesScript(), 60_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/rules") {
    const body = await readBody(req);
    const ruleType = String(body.type || "").trim();
    const payload = String(body.payload || "").trim();
    const policy = String(body.policy || "").trim();
    if (!ruleType || !policy) {
      sendJson(res, 400, { ok: false, error: "Rule type and policy are required." });
      return;
    }
    const result = await runRemoteScript(addRuleScript({ type: ruleType, payload, policy }), 120_000);
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

  if (req.method === "GET" && url.pathname === "/api/subscription/settings") {
    const result = await runRemoteScript(subscriptionSettingsScript(), 60_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/subscription/settings") {
    const body = await readBody(req);
    const nextUrl = String(body.url || "").trim();
    if (nextUrl && !/^https?:\/\//i.test(nextUrl)) {
      sendJson(res, 400, { ok: false, error: "Subscription URL must start with http:// or https://." });
      return;
    }
    const result = await runRemoteScript(setSubscriptionSettingsScript({
      name: String(body.name || "").trim(),
      description: String(body.description || "").trim(),
      url: nextUrl,
      ua: String(body.ua || "").trim(),
      autoUpdate: Boolean(body.autoUpdate),
      systemProxy: Boolean(body.systemProxy),
      kernelUpdate: Boolean(body.kernelUpdate),
    }), 120_000);
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
DEFAULT_UA=User-Agent
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
  SUBSCRIPTION_NAME=默认订阅
  SUBSCRIPTION_DESCRIPTION=
  SUBSCRIPTION_UA=$DEFAULT_UA
  SUBSCRIPTION_ALLOW_AUTO_UPDATE=1
  SUBSCRIPTION_USE_SYSTEM_PROXY=0
  SUBSCRIPTION_USE_KERNEL_UPDATE=0
  if [ -r "$ENV_FILE" ]; then
    . "$ENV_FILE"
  fi
  if [ -z "$SUBSCRIPTION_NAME" ]; then
    SUBSCRIPTION_NAME=默认订阅
  fi
  if [ -z "$SUBSCRIPTION_UA" ]; then
    SUBSCRIPTION_UA=$DEFAULT_UA
  fi
  case "$SUBSCRIPTION_ALLOW_AUTO_UPDATE" in 1|true|yes|on) SUBSCRIPTION_ALLOW_AUTO_UPDATE=1 ;; *) SUBSCRIPTION_ALLOW_AUTO_UPDATE=0 ;; esac
  case "$SUBSCRIPTION_USE_SYSTEM_PROXY" in 1|true|yes|on) SUBSCRIPTION_USE_SYSTEM_PROXY=1 ;; *) SUBSCRIPTION_USE_SYSTEM_PROXY=0 ;; esac
  case "$SUBSCRIPTION_USE_KERNEL_UPDATE" in 1|true|yes|on) SUBSCRIPTION_USE_KERNEL_UPDATE=1 ;; *) SUBSCRIPTION_USE_KERNEL_UPDATE=0 ;; esac
}

quote_sh() {
  printf "'"
  printf '%s' "$1" | sed "s/'/'\\\\''/g"
  printf "'"
}

write_subscription_env() {
  url_value=$1
  ua_value=$2
  name_value=\${3:-默认订阅}
  description_value=\${4:-}
  auto_update_value=\${5:-1}
  system_proxy_value=\${6:-0}
  kernel_update_value=\${7:-0}
  install -d -m 700 "$CONFIG_DIR"
  tmp_file=$(mktemp)
  {
    printf '# Managed by mihomo-manager-webui. Keep this file root-only.\n'
    printf 'SUBSCRIPTION_URL='
    quote_sh "$url_value"
    printf '\nSUBSCRIPTION_NAME='
    quote_sh "$name_value"
    printf '\nSUBSCRIPTION_DESCRIPTION='
    quote_sh "$description_value"
    printf '\nSUBSCRIPTION_UA='
    quote_sh "$ua_value"
    printf '\nSUBSCRIPTION_ALLOW_AUTO_UPDATE=%s' "$auto_update_value"
    printf '\nSUBSCRIPTION_USE_SYSTEM_PROXY=%s' "$system_proxy_value"
    printf '\nSUBSCRIPTION_USE_KERNEL_UPDATE=%s' "$kernel_update_value"
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
  printf '订阅名称：%s\n' "$SUBSCRIPTION_NAME"
  printf '订阅描述：%s\n' "\${SUBSCRIPTION_DESCRIPTION:-无}"
  printf '订阅链接：'
  mask_url "$SUBSCRIPTION_URL"
  printf '订阅 UA：%s\n' "$SUBSCRIPTION_UA"
  printf '允许自动更新：%s\n' "$SUBSCRIPTION_ALLOW_AUTO_UPDATE"
  printf '使用系统代理更新：%s\n' "$SUBSCRIPTION_USE_SYSTEM_PROXY"
  printf '使用内核更新：%s\n' "$SUBSCRIPTION_USE_KERNEL_UPDATE"
  printf 'Mihomo 程序：%s\n' "$bin_path"
  printf '监听端口：\n'
else
  if [ -z "$bin_path" ]; then bin_path='(not found)'; fi
  printf 'Language: %s\n' "$WEBUI_LANG"
  printf 'Mihomo service: %s\n' "$active"
  printf 'Mihomo enabled: %s\n' "$enabled"
  printf 'Subscription timer: %s\n' "$timer"
  printf 'Subscription name: %s\n' "$SUBSCRIPTION_NAME"
  printf 'Subscription description: %s\n' "\${SUBSCRIPTION_DESCRIPTION:-none}"
  printf 'Subscription URL: '
  mask_url "$SUBSCRIPTION_URL"
  printf 'Subscription UA: %s\n' "$SUBSCRIPTION_UA"
  printf 'Allow automatic updates: %s\n' "$SUBSCRIPTION_ALLOW_AUTO_UPDATE"
  printf 'Use system proxy for updates: %s\n' "$SUBSCRIPTION_USE_SYSTEM_PROXY"
  printf 'Use kernel reload for updates: %s\n' "$SUBSCRIPTION_USE_KERNEL_UPDATE"
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

function controllerJsonPython(body) {
  return `${remoteBase()}
python3 - <<'PY'
${body}
PY
`;
}

function proxiesScript() {
  return controllerJsonPython(String.raw`import json
import urllib.request

BASE = "http://127.0.0.1:9090"

def jget(path, timeout=10):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as resp:
        return json.load(resp)

payload = jget("/proxies")
proxies = payload.get("proxies", {})
groups = []
nodes = {}

for name, item in proxies.items():
    options = item.get("all") or []
    if options:
        groups.append({
            "name": name,
            "type": item.get("type"),
            "now": item.get("now"),
            "options": options,
            "optionCount": len(options),
        })
    else:
        history = item.get("history") or []
        delay = None
        if history:
            last = history[-1]
            delay = last.get("delay")
        nodes[name] = {
            "name": name,
            "type": item.get("type"),
            "udp": item.get("udp"),
            "delay": delay,
        }

print(json.dumps({"groups": groups, "nodes": nodes}, ensure_ascii=False))`);
}

function rulesScript() {
  return controllerJsonPython(String.raw`import collections
import json
import urllib.request

BASE = "http://127.0.0.1:9090"

def jget(path, timeout=10):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as resp:
        return json.load(resp)

payload = jget("/rules")
rules = payload.get("rules", [])
type_counter = collections.Counter()
policy_counter = collections.Counter()
items = []

for index, rule in enumerate(rules):
    rule_type = rule.get("type") or rule.get("Type") or "Unknown"
    payload_value = rule.get("payload") or rule.get("Payload") or ""
    proxy = rule.get("proxy") or rule.get("Proxy") or ""
    type_counter[rule_type] += 1
    if proxy:
        policy_counter[proxy] += 1
    if index < 500:
        items.append({
            "index": index + 1,
            "type": rule_type,
            "payload": payload_value,
            "proxy": proxy,
        })

print(json.dumps({
    "total": len(rules),
    "types": dict(type_counter.most_common()),
    "policies": dict(policy_counter.most_common(20)),
    "rules": items,
}, ensure_ascii=False))`);
}

function selectProxyScript(group, name) {
  const payload = Buffer.from(JSON.stringify({ group, name }), "utf8").toString("base64");
  return controllerJsonPython(String.raw`import base64
import json
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:9090"
payload = json.loads(base64.b64decode("${payload}").decode("utf-8"))
group = payload["group"]
name = payload["name"]
body = json.dumps({"name": name}).encode("utf-8")
request = urllib.request.Request(
    BASE + "/proxies/" + urllib.parse.quote(group, safe=""),
    data=body,
    method="PUT",
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(request, timeout=10) as resp:
    resp.read()
print(json.dumps({"selected": {"group": group, "name": name}}, ensure_ascii=False))`);
}

function delayScript(names) {
  const payload = Buffer.from(JSON.stringify({ names }), "utf8").toString("base64");
  return controllerJsonPython(String.raw`import base64
import json
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:9090"
URL = "https://www.gstatic.com/generate_204"
payload = json.loads(base64.b64decode("${payload}").decode("utf-8"))
result = {}

for name in payload.get("names", [])[:120]:
    encoded = urllib.parse.quote(name, safe="")
    url = BASE + f"/proxies/{encoded}/delay?timeout=5000&url={urllib.parse.quote(URL, safe='')}"
    try:
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.load(resp)
        delay = data.get("delay")
        result[name] = delay if isinstance(delay, (int, float)) and delay > 0 else None
    except Exception:
        result[name] = None

print(json.dumps({"delays": result}, ensure_ascii=False))`);
}

function showUrlScript() {
  return `${remoteBase()}
load_subscription_env
mask_url "$SUBSCRIPTION_URL"
`;
}

function setupTestScript() {
  return String.raw`set -euo pipefail
printf '连接测试：OK\n'
if command -v bash >/dev/null 2>&1; then
  printf 'Bash：OK\n'
fi
if command -v systemctl >/dev/null 2>&1; then
  printf 'systemd：OK\n'
fi
if command -v mihomo >/dev/null 2>&1 || [ -x /usr/local/bin/mihomo ]; then
  printf 'Mihomo：OK\n'
else
  printf 'Mihomo：未找到，请确认已安装或稍后安装。\n'
fi
`;
}

function subscriptionSettingsScript() {
  return `${remoteBase()}
load_subscription_env
masked_url=$(mask_url "$SUBSCRIPTION_URL")
timer_state=$(systemctl is-enabled mihomo-subscription.timer 2>/dev/null || true)
export SUBSCRIPTION_NAME SUBSCRIPTION_DESCRIPTION SUBSCRIPTION_UA SUBSCRIPTION_ALLOW_AUTO_UPDATE
export SUBSCRIPTION_USE_SYSTEM_PROXY SUBSCRIPTION_USE_KERNEL_UPDATE masked_url timer_state
python3 - <<'PY'
import json
import os

print(json.dumps({
    "name": os.environ.get("SUBSCRIPTION_NAME", ""),
    "description": os.environ.get("SUBSCRIPTION_DESCRIPTION", ""),
    "ua": os.environ.get("SUBSCRIPTION_UA", "User-Agent") or "User-Agent",
    "maskedUrl": os.environ.get("masked_url", ""),
    "autoUpdate": os.environ.get("SUBSCRIPTION_ALLOW_AUTO_UPDATE") == "1",
    "systemProxy": os.environ.get("SUBSCRIPTION_USE_SYSTEM_PROXY") == "1",
    "kernelUpdate": os.environ.get("SUBSCRIPTION_USE_KERNEL_UPDATE") == "1",
    "timer": os.environ.get("timer_state", ""),
}, ensure_ascii=False))
PY
`;
}

function setSubscriptionSettingsScript(settings) {
  const encoded = {
    name: Buffer.from(settings.name || "", "utf8").toString("base64"),
    description: Buffer.from(settings.description || "", "utf8").toString("base64"),
    url: Buffer.from(settings.url || "", "utf8").toString("base64"),
    ua: Buffer.from(settings.ua || "", "utf8").toString("base64"),
  };
  const autoUpdate = settings.autoUpdate ? "1" : "0";
  const systemProxy = settings.systemProxy ? "1" : "0";
  const kernelUpdate = settings.kernelUpdate ? "1" : "0";
  return `${remoteBase()}
load_subscription_env
new_name=$(printf '%s' ${shellQuote(encoded.name)} | base64 -d)
new_description=$(printf '%s' ${shellQuote(encoded.description)} | base64 -d)
new_url=$(printf '%s' ${shellQuote(encoded.url)} | base64 -d)
new_ua=$(printf '%s' ${shellQuote(encoded.ua)} | base64 -d)
if [ -n "$new_url" ]; then
  case "$new_url" in
    http://*|https://*) SUBSCRIPTION_URL=$new_url ;;
    *) printf '[ERROR] Subscription URL must start with http:// or https://.\n' >&2; exit 1 ;;
  esac
fi
if [ -z "$new_name" ]; then
  new_name=默认订阅
fi
if [ -z "$new_ua" ]; then
  new_ua=$DEFAULT_UA
fi
write_subscription_env "$SUBSCRIPTION_URL" "$new_ua" "$new_name" "$new_description" ${shellQuote(autoUpdate)} ${shellQuote(systemProxy)} ${shellQuote(kernelUpdate)}
if systemctl list-unit-files mihomo-subscription.timer --no-legend 2>/dev/null | grep -q '^mihomo-subscription\\.timer'; then
  if [ ${shellQuote(autoUpdate)} = 1 ]; then
    systemctl enable --now mihomo-subscription.timer >/dev/null
  else
    systemctl disable --now mihomo-subscription.timer >/dev/null || true
  fi
else
  if [ "$WEBUI_LANG" = zh ]; then printf '[警告] 未找到 mihomo-subscription.timer，仅保存自动更新偏好。\n'; else printf '[WARN] mihomo-subscription.timer not found; only saved the auto-update preference.\n'; fi
fi
if [ "$WEBUI_LANG" = zh ]; then
  printf '[信息] 订阅设置已保存。\n'
else
  printf '[INFO] Subscription settings saved.\n'
fi
`;
}

function addRuleScript(rule) {
  const encoded = Buffer.from(JSON.stringify(rule), "utf8").toString("base64");
  return `${remoteBase()}
payload=${shellQuote(encoded)}
tmp_file=$(python3 - "$payload" "$CONFIG_FILE" <<'PY'
import base64
import json
import re
import sys
from pathlib import Path

data = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
config = Path(sys.argv[2])
rule_type = str(data.get("type", "")).strip().upper()
payload = str(data.get("payload", "")).strip()
policy = str(data.get("policy", "")).strip()

if not re.fullmatch(r"[A-Z0-9_-]{2,40}", rule_type):
    raise SystemExit("invalid rule type")
for value, label in ((payload, "rule payload"), (policy, "policy")):
    if "\n" in value or "\r" in value:
        raise SystemExit(f"invalid {label}")
if not policy:
    raise SystemExit("policy is required")
if rule_type != "MATCH" and not payload:
    raise SystemExit("rule payload is required")

parts = [rule_type]
if rule_type != "MATCH":
    parts.append(payload)
parts.append(policy)
rule_value = ",".join(parts)
rule_line = "- '" + rule_value.replace("'", "''") + "'"

text = config.read_text(encoding="utf-8", errors="ignore") if config.exists() else ""
lines = text.splitlines()
insert_at = None
for index, line in enumerate(lines):
    if re.match(r"^rules\\s*:\\s*(?:#.*)?$", line):
        insert_at = index + 1
        break
if insert_at is None:
    if lines and lines[-1].strip():
        lines.append("")
    lines.append("rules:")
    insert_at = len(lines)
lines.insert(insert_at, rule_line)
tmp = config.with_suffix(config.suffix + ".rule.tmp")
tmp.write_text("\\n".join(lines) + "\\n", encoding="utf-8")
print(tmp)
PY
)
bin_path=$(mihomo_bin) || { if [ "$WEBUI_LANG" = zh ]; then printf '[错误] 未找到 mihomo。\n' >&2; else printf '[ERROR] Mihomo binary not found.\n' >&2; fi; exit 1; }
check_log=/tmp/mihomo-rule-check.log
if "$bin_path" -t -d "$CONFIG_DIR" -f "$tmp_file" >"$check_log" 2>&1; then
  if [ -f "$CONFIG_FILE" ]; then
    cp -a "$CONFIG_FILE" "$CONFIG_FILE.backup.$(date +%Y%m%d%H%M%S)"
  fi
  install -m 600 "$tmp_file" "$CONFIG_FILE"
  rm -f "$tmp_file"
else
  cat "$check_log" >&2
  rm -f "$tmp_file"
  exit 1
fi
if systemctl is-active --quiet mihomo.service 2>/dev/null; then
  systemctl restart mihomo.service
fi
if [ "$WEBUI_LANG" = zh ]; then printf '[信息] 规则已新增并通过校验。\n'; else printf '[INFO] Rule added and config validation passed.\n'; fi
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
  curl_args=(-fsSL --retry 3 --connect-timeout 15 --max-time 90 -H 'Accept: */*' -A "$SUBSCRIPTION_UA")
  if [ "$SUBSCRIPTION_USE_SYSTEM_PROXY" = 1 ]; then
    curl_args+=(--proxy "$HTTP_PROXY_URL")
  fi
  curl "\${curl_args[@]}" "$SUBSCRIPTION_URL" -o "$raw_file"
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
  reloaded=0
  if [ "$SUBSCRIPTION_USE_KERNEL_UPDATE" = 1 ] && systemctl is-active --quiet mihomo.service 2>/dev/null; then
    if python3 - "$CONFIG_FILE" <<'PY'
import json
import sys
import urllib.request

body = json.dumps({"path": sys.argv[1], "force": True}).encode("utf-8")
request = urllib.request.Request(
    "http://127.0.0.1:9090/configs",
    data=body,
    method="PUT",
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(request, timeout=10) as resp:
    resp.read()
PY
    then
      reloaded=1
      if [ "$WEBUI_LANG" = zh ]; then printf '[信息] 已通过 Mihomo 内核热加载配置。\n'; else printf '[INFO] Mihomo config reloaded through the core controller.\n'; fi
    fi
  fi
  if [ "$reloaded" != 1 ]; then
    if systemctl is-active --quiet mihomo.service 2>/dev/null; then
      systemctl restart mihomo.service
    else
      systemctl start mihomo.service
    fi
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
write_subscription_env "$new_url" "$SUBSCRIPTION_UA" "$SUBSCRIPTION_NAME" "$SUBSCRIPTION_DESCRIPTION" "$SUBSCRIPTION_ALLOW_AUTO_UPDATE" "$SUBSCRIPTION_USE_SYSTEM_PROXY" "$SUBSCRIPTION_USE_KERNEL_UPDATE"
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
write_subscription_env "$SUBSCRIPTION_URL" "$new_ua" "$SUBSCRIPTION_NAME" "$SUBSCRIPTION_DESCRIPTION" "$SUBSCRIPTION_ALLOW_AUTO_UPDATE" "$SUBSCRIPTION_USE_SYSTEM_PROXY" "$SUBSCRIPTION_USE_KERNEL_UPDATE"
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

function runRemoteScript(script, timeoutMs = 90_000, targetConfig = config) {
  if (targetConfig.mode === "local") {
    return runScriptProcess("bash", ["-s"], script, timeoutMs);
  }

  const sshArgs = ["-p", String(targetConfig.port), "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"];
  let command = "ssh";
  let args = sshArgs;
  let env = process.env;

  if (targetConfig.auth === "key") {
    args = ["-i", targetConfig.identityFile, "-o", "BatchMode=yes", ...sshArgs];
  } else {
    command = "sshpass";
    args = [
      "-e",
      "ssh",
      "-o",
      "PreferredAuthentications=password",
      "-o",
      "PubkeyAuthentication=no",
      ...sshArgs,
    ];
    env = { ...process.env, SSHPASS: targetConfig.password };
  }

  args = [...args, `${targetConfig.user}@${targetConfig.host}`, "bash -s"];
  return runScriptProcess(command, args, script, timeoutMs, env);
}

function runScriptProcess(command, args, script, timeoutMs, env = process.env) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { windowsHide: true, env });
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
      resolveResult({ ok: false, code: -1, stdout: scrub(stdout), stderr: scrub(stderr), error: error.message });
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
    .replace(/((?:token|access_token|key|secret|password|passwd)=)[^&\s"',}]+/gi, "$1***")
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

function sendJsonResult(res, result) {
  if (result.code !== 0) {
    sendJson(res, 500, result);
    return;
  }
  try {
    sendJson(res, 200, {
      ok: true,
      code: result.code,
      signal: result.signal,
      data: JSON.parse(result.stdout || "{}"),
      stderr: result.stderr,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      code: result.code,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      error: `Failed to parse controller JSON: ${error.message}`,
    });
  }
}
