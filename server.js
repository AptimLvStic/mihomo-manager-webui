import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const rootDir = resolve(".");
const publicDir = join(rootDir, "public");
const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(rootDir, "data");
const authFile = process.env.AUTH_FILE ? resolve(process.env.AUTH_FILE) : join(dataDir, "auth.json");
const port = Number(process.env.PORT || 5178);
const listenHost = process.env.LISTEN_HOST || "127.0.0.1";
const sessionCookieName = "mihomo_manager_session";
const sessionTtlMs = Math.max(Number(process.env.SESSION_TTL_HOURS || 24), 1) * 60 * 60 * 1000;
const webuiUsername = String(process.env.WEBUI_USERNAME || "admin").trim() || "admin";
const webuiPassword = String(process.env.WEBUI_PASSWORD || "");
const sessionSecret = String(process.env.WEBUI_SESSION_SECRET || "");
const loginFailures = new Map();
if (!webuiPassword) {
  throw new Error("WEBUI_PASSWORD is required.");
}
if (!sessionSecret) {
  throw new Error("WEBUI_SESSION_SECRET is required.");
}
mkdirSync(dataDir, { recursive: true });
let config = loadConfig();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const readOnlyHandlers = {
  status: () => runLocalScript(statusScript()),
  test: () => runLocalScript(testScript(), 90_000),
  ports: () => runLocalScript(portsScript()),
  "show-url": () => runLocalScript(showUrlScript()),
  "proxy-status": () => runLocalScript(proxyStatusScript()),
  "proxy-env": () => runLocalScript(proxyEnvScript()),
  timer: () => runLocalScript(timerScript()),
  "service-status": () => runLocalScript(serviceStatusScript()),
  "proxychains-show": () => runLocalScript(proxychainsShowScript()),
  lang: () => runLocalScript(languageScript()),
};

const actionHandlers = {
  update: () => runLocalScript(updateScript(), 180_000),
  start: () => runLocalScript(startServiceScript(), 120_000),
  stop: () => runLocalScript(stopServiceScript(), 60_000),
  restart: () => runLocalScript(restartServiceScript(), 120_000),
  select: () => runLocalScript(selectOnlyScript(), 120_000),
  "proxy-on": () => runLocalScript(proxyOnScript()),
  "proxy-off": () => runLocalScript(proxyOffScript()),
  proxychains: () => runLocalScript(proxychainsConfigureScript()),
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
  return {
    configured: true,
    mode: "local",
    targetLabel: "Local Mihomo Host",
    runtimeLabel: "本地管理通道",
  };
}

function loadAuthStore() {
  if (!existsSync(authFile)) {
    return { users: [] };
  }
  try {
    const data = JSON.parse(readFileSync(authFile, "utf8"));
    return { users: Array.isArray(data.users) ? data.users : [] };
  } catch {
    return { users: [] };
  }
}

function saveAuthStore(store) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(authFile, JSON.stringify({ users: store.users || [] }, null, 2));
  chmodSync(authFile, 0o600);
}

function registrationOpen(store = loadAuthStore()) {
  return !store.users.length || /^(1|true|yes|on)$/i.test(process.env.AUTH_ALLOW_REGISTRATION || "");
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

function validateUsername(username) {
  return /^[A-Za-z0-9_.-]{3,40}$/.test(username);
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, salt, expected] = String(storedHash || "").split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function getAuthUsers(store = loadAuthStore()) {
  const envUser = { username: webuiUsername, passwordPlain: webuiPassword, source: "env" };
  const storedUsers = Array.isArray(store.users) ? store.users : [];
  return [
    envUser,
    ...storedUsers.filter((user) => String(user.username || "").toLowerCase() !== webuiUsername.toLowerCase()),
  ];
}

function verifyUserPassword(user, password) {
  if (typeof user?.passwordPlain === "string") {
    return safeEqualText(password, user.passwordPlain);
  }
  return verifyPassword(password, user?.passwordHash);
}

function base64url(value) {
  return Buffer.from(String(value)).toString("base64url");
}

function signSessionPayload(payload) {
  return createHmac("sha256", sessionSecret).update(String(payload)).digest("base64url");
}

function safeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cookieSecureEnabled() {
  return /^(1|true|yes|on)$/i.test(process.env.WEBUI_COOKIE_SECURE || process.env.COOKIE_SECURE || "");
}

function setSessionCookie(res, value) {
  const attributes = [
    `${sessionCookieName}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.ceil(sessionTtlMs / 1000)}`,
  ];
  if (cookieSecureEnabled()) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

function clearSessionCookie(res) {
  const attributes = [
    `${sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (cookieSecureEnabled()) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function getAuthenticatedUser(req) {
  const token = parseCookies(req)[sessionCookieName];
  if (!token) return null;
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature || !safeEqualText(signature, signSessionPayload(payload))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session?.username || !session?.expiresAt || Number(session.expiresAt) <= Date.now()) return null;
    const users = getAuthUsers();
    if (!users.some((user) => user.username.toLowerCase() === String(session.username).toLowerCase())) return null;
    return { username: session.username };
  } catch {
    return null;
  }
}

function createSession(res, username) {
  const payload = base64url(JSON.stringify({
    username,
    expiresAt: Date.now() + sessionTtlMs,
    nonce: randomBytes(8).toString("hex"),
  }));
  setSessionCookie(res, `${payload}.${signSessionPayload(payload)}`);
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function failureState(ip) {
  const state = loginFailures.get(ip) || { count: 0, lastAt: 0 };
  if (Date.now() - state.lastAt > 10 * 60 * 1000) return { count: 0, lastAt: 0 };
  return state;
}

function recordLoginFailure(ip) {
  const state = failureState(ip);
  loginFailures.set(ip, { count: state.count + 1, lastAt: Date.now() });
}

function clearLoginFailure(ip) {
  loginFailures.delete(ip);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function registrationAllowed(user) {
  return Boolean(user) && /^(1|true|yes|on)$/i.test(process.env.AUTH_ALLOW_REGISTRATION || "");
}

async function handleAuthApi(req, res, url, currentUser = null) {
  const store = loadAuthStore();
  if (req.method === "GET" && url.pathname === "/api/auth/status") {
    const user = getAuthenticatedUser(req);
    sendJson(res, 200, {
      ok: true,
      authenticated: Boolean(user),
      user,
      registrationOpen: registrationAllowed(user),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const ip = clientIp(req);
    const failures = failureState(ip);
    if (failures.count >= 5) {
      await delay(Math.min(3000, failures.count * 500));
    }
    const body = await readBody(req);
    const username = normalizeUsername(body.username);
    const password = String(body.password || "");
    const user = getAuthUsers(store).find((item) => item.username.toLowerCase() === username.toLowerCase());
    if (!user || !verifyUserPassword(user, password)) {
      recordLoginFailure(ip);
      sendJson(res, 401, { ok: false, error: "Invalid username or password." });
      return;
    }
    clearLoginFailure(ip);
    createSession(res, user.username);
    sendJson(res, 200, { ok: true, user: { username: user.username }, registrationOpen: registrationAllowed({ username: user.username }) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    if (!registrationAllowed(currentUser)) {
      sendJson(res, 403, { ok: false, error: "Registration is disabled." });
      return;
    }
    const body = await readBody(req);
    const username = normalizeUsername(body.username);
    const password = String(body.password || "");
    if (!validateUsername(username)) {
      sendJson(res, 400, { ok: false, error: "Username must be 3-40 characters: letters, numbers, dot, underscore or hyphen." });
      return;
    }
    if (password.length < 8) {
      sendJson(res, 400, { ok: false, error: "Password must be at least 8 characters." });
      return;
    }
    if (getAuthUsers(store).some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      sendJson(res, 409, { ok: false, error: "Username already exists." });
      return;
    }
    store.users.push({ username, passwordHash: hashPassword(password), createdAt: new Date().toISOString() });
    saveAuthStore(store);
    sendJson(res, 200, { ok: true, user: { username }, registrationOpen: registrationAllowed(currentUser) });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found." });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/auth/status" || url.pathname === "/api/auth/login") {
    await handleAuthApi(req, res, url);
    return;
  }
  const user = getAuthenticatedUser(req);
  if (!user) {
    sendJson(res, 401, { ok: false, error: "Authentication required." });
    return;
  }
  if (url.pathname.startsWith("/api/auth/")) {
    await handleAuthApi(req, res, url, user);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, {
      ok: true,
      data: {
        mode: config.mode,
        host: config.host || "localhost",
        port: config.port || null,
        user: config.user || "root",
        auth: config.auth || "local",
        configured: config.configured,
        targetLabel: config.targetLabel,
        runtimeLabel: config.runtimeLabel,
      },
    });
    return;
  }

  if (!config.configured) {
    sendJson(res, 503, { ok: false, error: "Mihomo Manager runtime is not configured." });
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

  if (req.method === "GET" && url.pathname === "/api/mihomo/proxy-settings") {
    const result = await runLocalScript(mihomoProxySettingsScript(), 60_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/mihomo/proxy-settings") {
    const body = await readBody(req);
    const result = await runLocalScript(setMihomoProxySettingsScript(body), 120_000);
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/runtime-settings") {
    const result = await runLocalScript(runtimeSettingsScript(), 60_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/runtime-settings") {
    const body = await readBody(req);
    const result = await runLocalScript(setRuntimeSettingsScript(body), 90_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/traffic") {
    const result = await runLocalScript(trafficScript(), 20_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    const target = url.searchParams.get("target") === "subscription" ? "subscription" : "mihomo";
    const lines = normalizeLines(url.searchParams.get("lines"));
    const result = await runLocalScript(logsScript(target, lines), 60_000);
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/api/proxies" || url.pathname === "/api/groups")) {
    const result = await runLocalScript(proxiesScript(), 60_000);
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
    const result = await runLocalScript(selectProxyScript(group, name), 60_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/proxies/delays/stream") {
    const body = await readBody(req);
    const names = normalizeProxyNames(body.names);
    if (!names.length) {
      sendJson(res, 400, { ok: false, error: "At least one proxy node name is required." });
      return;
    }
    streamDelayResults(req, res, names);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/proxies/delays") {
    const body = await readBody(req);
    const names = normalizeProxyNames(body.names);
    if (!names.length) {
      sendJson(res, 400, { ok: false, error: "At least one proxy node name is required." });
      return;
    }
    const result = await runLocalScript(delayScript(names), 120_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/rules") {
    const result = await runLocalScript(rulesScript(), 60_000);
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
    const result = await runLocalScript(addRuleScript({ type: ruleType, payload, policy }), 120_000);
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

  if (req.method === "GET" && url.pathname === "/api/subscriptions") {
    const result = await runLocalScript(subscriptionsScript(), 60_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/subscriptions") {
    const body = await readBody(req);
    const nextUrl = String(body.url || "").trim();
    if (!/^https?:\/\//i.test(nextUrl)) {
      sendJson(res, 400, { ok: false, error: "Subscription URL must start with http:// or https://." });
      return;
    }
    const result = await runLocalScript(saveSubscriptionScript({
      id: String(body.id || "").trim(),
      name: String(body.name || "").trim(),
      description: String(body.description || "").trim(),
      url: nextUrl,
      ua: String(body.ua || "").trim(),
      autoUpdate: Boolean(body.autoUpdate),
      systemProxy: Boolean(body.systemProxy),
      kernelUpdate: Boolean(body.kernelUpdate),
      timeout: Number(body.timeout || 0),
      interval: Number(body.interval || 0),
      active: Boolean(body.active),
    }), 120_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/subscriptions/select") {
    const body = await readBody(req);
    const id = String(body.id || "").trim();
    if (!id) {
      sendJson(res, 400, { ok: false, error: "Subscription id is required." });
      return;
    }
    const result = await runLocalScript(selectSubscriptionScript(id), 60_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/subscriptions/update") {
    const body = await readBody(req);
    const id = String(body.id || "").trim();
    const result = await runLocalScript(updateSubscriptionByIdScript(id), 180_000);
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/subscriptions/delete") {
    const body = await readBody(req);
    const id = String(body.id || "").trim();
    if (!id) {
      sendJson(res, 400, { ok: false, error: "Subscription id is required." });
      return;
    }
    const result = await runLocalScript(deleteSubscriptionScript(id), 60_000);
    sendJsonResult(res, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/subscription/settings") {
    const result = await runLocalScript(subscriptionSettingsScript(), 60_000);
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
    const result = await runLocalScript(setSubscriptionSettingsScript({
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
    const result = await runLocalScript(setSubscriptionUrlScript(subscriptionUrl), 180_000);
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
    const result = await runLocalScript(setSubscriptionUaScript(userAgent), 180_000);
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
    const result = await runLocalScript(setLanguageScript(lang));
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found." });
}

function serveStatic(req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
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

function localBase() {
  return String.raw`set -euo pipefail
CONFIG_DIR=/etc/mihomo
ENV_FILE=$CONFIG_DIR/subscription.env
WEBUI_ENV_FILE=$CONFIG_DIR/webui.env
CONFIG_FILE=$CONFIG_DIR/config.yaml
RAW_FILE=$CONFIG_DIR/subscription.raw.yaml
SUBSCRIPTIONS_DIR=$CONFIG_DIR/subscriptions
PROFILE_PROXY=/etc/profile.d/mihomo-proxy.sh
APT_PROXY=/etc/apt/apt.conf.d/95mihomo-proxy
PROXYCHAINS_CONF=/etc/proxychains4.conf
PROXYCHAINS_LEGACY=/etc/proxychains.conf
HTTP_PROXY_URL=http://127.0.0.1:7890
SOCKS_PROXY_URL=socks5h://127.0.0.1:7891
NO_PROXY_LIST=localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
DEFAULT_UA=User-Agent
WEBUI_LANG=zh
HOST_PROJECT_DIR=\${MIHOMO_MANAGER_HOST_PROJECT_DIR:-/data/mihomo-manager-webui}

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
    print(re.sub(r"((?:token|access_token|key|secret|password|passwd)=)[^&]+", r"\\1***", url, flags=re.I))
PY
  else
    printf '%s\n' "$value" | sed -E 's/((token|access_token|key|secret|password|passwd)=)[^&[:space:]]+/\1***/Ig'
  fi
}

load_core_proxy_env() {
  HTTP_PROXY_URL=
  SOCKS_PROXY_URL=
  if command -v python3 >/dev/null 2>&1 && [ -r "$CONFIG_FILE" ]; then
    eval "$(python3 - "$CONFIG_FILE" <<'PY'
import re
import shlex
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="ignore")
values = {}
for line in text.splitlines():
    if line[:1].isspace():
        continue
    m = re.match(r"^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*(?:#.*)?$", line)
    if not m:
        continue
    key, value = m.group(1), m.group(2).strip().strip('"\'')
    values[key] = value

def port(name):
    raw = values.get(name, "")
    return raw if raw.isdigit() and 1 <= int(raw) <= 65535 else ""

http_port = port("mixed-port") or port("port")
socks_port = port("socks-port") or port("mixed-port")
if http_port:
    print("HTTP_PROXY_URL=" + shlex.quote(f"http://127.0.0.1:{http_port}"))
if socks_port:
    print("SOCKS_PROXY_URL=" + shlex.quote(f"socks5h://127.0.0.1:{socks_port}"))
PY
)"
  fi
  if [ -z "$HTTP_PROXY_URL" ]; then HTTP_PROXY_URL=http://127.0.0.1:7890; fi
  if [ -z "$SOCKS_PROXY_URL" ]; then SOCKS_PROXY_URL=socks5h://127.0.0.1:7891; fi
}
`;
}

function statusScript() {
  return `${localBase()}
load_subscription_env
active=$(systemctl is-active mihomo.service 2>/dev/null || true)
enabled=$(systemctl is-enabled mihomo.service 2>/dev/null || true)
timer=$(systemctl is-enabled mihomo-subscription.timer 2>/dev/null || true)
bin_path=$(mihomo_bin 2>/dev/null || true)
mode_value=$(awk -F: '/^mode[[:space:]]*:/ {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit}' "$CONFIG_FILE" 2>/dev/null || true)
if [ -z "$mode_value" ]; then mode_value=Rule; fi

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
ss -ltnp 2>/dev/null | grep -E 'mihomo|:9090\\b' || true
${proxyStatusBody()}
`;
}

function portsScript() {
  return `${localBase()}
if [ "$WEBUI_LANG" = zh ]; then printf 'Mihomo 监听端口：\n'; else printf 'Mihomo listening ports:\n'; fi
ss -ltnp 2>/dev/null | grep -E 'mihomo|:9090\\b' || true
`;
}

function controllerJsonPython(body) {
  return `${localBase()}
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

function mihomoProxySettingsScript() {
  return controllerJsonPython(String.raw`import json
import re
from pathlib import Path

CONFIG_FILE = Path("/etc/mihomo/config.yaml")
text = CONFIG_FILE.read_text(encoding="utf-8", errors="ignore") if CONFIG_FILE.exists() else ""

scalars = {}
lines = text.splitlines()
for index, line in enumerate(lines):
    if line[:1].isspace():
        continue
    m = re.match(r"^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*(?:#.*)?$", line)
    if m:
        scalars[m.group(1)] = m.group(2).strip().strip('"\'')

def to_bool(value, default=False):
    if value is None or value == "":
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}

def to_port(value, default):
    raw = str(value or "").strip()
    return int(raw) if raw.isdigit() and 1 <= int(raw) <= 65535 else default

def inbound(name, key, default_port):
    return {
        "name": name,
        "key": key,
        "enabled": key in scalars,
        "port": to_port(scalars.get(key), default_port),
        "defaultPort": default_port,
    }

def parse_tun():
    result = {
        "enabled": False,
        "stack": "system",
        "autoRoute": False,
        "strictRoute": False,
        "dnsHijack": "any:53",
    }
    for index, line in enumerate(lines):
        if re.match(r"^tun\s*:\s*(?:#.*)?$", line):
            block = []
            for item in lines[index + 1:]:
                if item and not item[:1].isspace() and re.match(r"^[A-Za-z0-9_-]+\s*:", item):
                    break
                block.append(item)
            dns_values = []
            in_dns = False
            for item in block:
                stripped = item.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                m = re.match(r"^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*(?:#.*)?$", stripped)
                if m:
                    key, value = m.group(1), m.group(2).strip().strip('"\'')
                    in_dns = key == "dns-hijack"
                    if key == "enable": result["enabled"] = to_bool(value)
                    elif key == "stack" and value in {"system", "gvisor", "mixed"}: result["stack"] = value
                    elif key == "auto-route": result["autoRoute"] = to_bool(value)
                    elif key == "strict-route": result["strictRoute"] = to_bool(value)
                    elif key == "dns-hijack" and value and not value.startswith("["):
                        dns_values.append(value)
                    elif key == "dns-hijack" and value.startswith("["):
                        dns_values.extend(part.strip().strip('"\'') for part in value.strip("[]").split(",") if part.strip())
                    continue
                if in_dns and stripped.startswith("-"):
                    dns_values.append(stripped[1:].strip().strip('"\''))
            if dns_values:
                result["dnsHijack"] = ", ".join(dns_values)
            break
    return result

mode = scalars.get("mode", "Rule")
mode_map = {"rule": "Rule", "global": "Global", "direct": "Direct"}
mode = mode_map.get(str(mode).lower(), "Rule")

print(json.dumps({
    "mode": mode,
    "allowLan": to_bool(scalars.get("allow-lan"), False),
    "bindAddress": scalars.get("bind-address", "127.0.0.1") or "127.0.0.1",
    "inbounds": {
        "http": inbound("HTTP", "port", 7890),
        "socks": inbound("SOCKS5", "socks-port", 7891),
        "mixed": inbound("Mixed", "mixed-port", 7890),
        "redir": inbound("Redir", "redir-port", 7892),
        "tproxy": inbound("TProxy", "tproxy-port", 7893),
    },
    "tun": parse_tun(),
}, ensure_ascii=False))`);
}

function setMihomoProxySettingsScript(settings) {
  const encoded = Buffer.from(JSON.stringify(settings || {}), "utf8").toString("base64");
  return `${localBase()}
payload=${shellQuote(encoded)}
tmp_file=$(python3 - "$payload" "$CONFIG_FILE" <<'PY'
import base64
import json
import re
import sys
from pathlib import Path

payload = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
config = Path(sys.argv[2])
text = config.read_text(encoding="utf-8", errors="ignore") if config.exists() else ""

mode_map = {"rule": "Rule", "global": "Global", "direct": "Direct"}
mode = mode_map.get(str(payload.get("mode", "Rule")).strip().lower())
if not mode:
    raise SystemExit("invalid proxy mode")

allow_lan = bool(payload.get("allowLan", False))
bind_address = str(payload.get("bindAddress") or "127.0.0.1").strip()
if not re.fullmatch(r"[0-9A-Fa-f:.%*]+|localhost", bind_address):
    raise SystemExit("invalid bind address")

def requires_allow_lan(address):
    value = str(address or "").strip().lower()
    if not value:
        return False
    return value not in {"127.0.0.1", "localhost", "::1"} and not value.startswith("127.")

if requires_allow_lan(bind_address):
    allow_lan = True

inbounds = payload.get("inbounds") or {}
known = {
    "http": ("port", "HTTP", 7890),
    "socks": ("socks-port", "SOCKS5", 7891),
    "mixed": ("mixed-port", "Mixed", 7890),
    "redir": ("redir-port", "Redir", 7892),
    "tproxy": ("tproxy-port", "TProxy", 7893),
}
selected = []
used_ports = {}
for name, (key, label, default_port) in known.items():
    item = inbounds.get(name) or {}
    if not item.get("enabled"):
        continue
    try:
        port = int(item.get("port") or default_port)
    except Exception:
        raise SystemExit(f"invalid {label} port")
    if not 1 <= port <= 65535:
        raise SystemExit(f"{label} port must be between 1 and 65535")
    if port in used_ports:
        raise SystemExit(f"port {port} is used by both {used_ports[port]} and {label}")
    used_ports[port] = label
    selected.append((key, port))

tun = payload.get("tun") or {}
tun_enabled = bool(tun.get("enabled", False))
stack = str(tun.get("stack") or "system").strip().lower()
if stack not in {"system", "gvisor", "mixed"}:
    raise SystemExit("invalid TUN stack")
auto_route = bool(tun.get("autoRoute", False))
strict_route = bool(tun.get("strictRoute", False))
dns_values = []
for part in re.split(r"[,\\n]", str(tun.get("dnsHijack") or "any:53")):
    value = part.strip()
    if not value:
        continue
    if not re.fullmatch(r"[A-Za-z0-9_.:/*+-]+", value):
        raise SystemExit("invalid TUN DNS hijack value")
    dns_values.append(value)
if tun_enabled and not dns_values:
    dns_values = ["any:53"]

if not selected and not tun_enabled:
    raise SystemExit("enable at least one Mihomo inbound or TUN mode")

skip_scalar = {"mode", "allow-lan", "bind-address", "port", "socks-port", "mixed-port", "redir-port", "tproxy-port"}
lines = text.splitlines()
out = []
i = 0
while i < len(lines):
    line = lines[i]
    if not line[:1].isspace():
        m = re.match(r"^([A-Za-z0-9_-]+)\s*:", line)
        if m and m.group(1) in skip_scalar:
            i += 1
            continue
        if m and m.group(1) == "tun":
            i += 1
            while i < len(lines):
                next_line = lines[i]
                if next_line and not next_line[:1].isspace() and re.match(r"^[A-Za-z0-9_-]+\s*:", next_line):
                    break
                i += 1
            continue
    out.append(line.rstrip())
    i += 1

prefix = [f"mode: {mode}"]
for key, port in selected:
    prefix.append(f"{key}: {port}")
prefix.extend([
    f"allow-lan: {str(allow_lan).lower()}",
    "bind-address: " + json.dumps(bind_address, ensure_ascii=False),
])
if tun_enabled:
    prefix.extend([
        "tun:",
        "  enable: true",
        f"  stack: {stack}",
        f"  auto-route: {str(auto_route).lower()}",
        f"  strict-route: {str(strict_route).lower()}",
        "  dns-hijack:",
    ])
    prefix.extend(f"    - {value}" for value in dns_values)

while out and not out[0].strip():
    out.pop(0)
new_text = "\\n".join(prefix + [""] + out).rstrip() + "\\n"
tmp = config.with_suffix(config.suffix + ".proxy.tmp")
tmp.write_text(new_text, encoding="utf-8")
print(tmp)
PY
)
bin_path=$(mihomo_bin) || { if [ "$WEBUI_LANG" = zh ]; then printf '[错误] 未找到 mihomo。\n' >&2; else printf '[ERROR] Mihomo binary not found.\n' >&2; fi; exit 1; }
check_log=/tmp/mihomo-proxy-settings-check.log
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
if [ "$WEBUI_LANG" = zh ]; then printf '[信息] Mihomo 内核代理配置已更新并通过校验。\n'; else printf '[INFO] Mihomo core proxy settings updated and validated.\n'; fi
`;
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
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "http://127.0.0.1:9090"
URL = "https://www.gstatic.com/generate_204"
payload = json.loads(base64.b64decode("${payload}").decode("utf-8"))
names = [str(name) for name in payload.get("names", [])[:120] if str(name)]
result = {}


def measure(name):
    encoded = urllib.parse.quote(name, safe="")
    url = BASE + f"/proxies/{encoded}/delay?timeout=5000&url={urllib.parse.quote(URL, safe='')}"
    try:
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.load(resp)
        delay = data.get("delay")
        return name, delay if isinstance(delay, (int, float)) and delay > 0 else None
    except Exception:
        return name, None

workers = min(48, max(1, len(names)))
with ThreadPoolExecutor(max_workers=workers) as executor:
    futures = [executor.submit(measure, name) for name in names]
    for future in as_completed(futures):
        name, delay = future.result()
        result[name] = delay

print(json.dumps({"delays": result}, ensure_ascii=False))`);
}

function delayStreamScript(names) {
  const payload = Buffer.from(JSON.stringify({ names }), "utf8").toString("base64");
  return controllerJsonPython(String.raw`import base64
import json
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "http://127.0.0.1:9090"
URL = "https://www.gstatic.com/generate_204"
payload = json.loads(base64.b64decode("${payload}").decode("utf-8"))
names = [str(name) for name in payload.get("names", [])[:120] if str(name)]
workers = min(48, max(1, len(names)))


def emit(event, **data):
    data["event"] = event
    print(json.dumps(data, ensure_ascii=False), flush=True)


def measure(name):
    encoded = urllib.parse.quote(name, safe="")
    url = BASE + f"/proxies/{encoded}/delay?timeout=5000&url={urllib.parse.quote(URL, safe='')}"
    try:
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.load(resp)
        delay = data.get("delay")
        if isinstance(delay, (int, float)) and delay > 0:
            return name, delay, ""
        return name, None, "timeout"
    except Exception as exc:
        return name, None, str(exc) or "timeout"

emit("start", total=len(names), concurrency=workers)
ok_count = 0
timeout_count = 0
with ThreadPoolExecutor(max_workers=workers) as executor:
    futures = [executor.submit(measure, name) for name in names]
    for future in as_completed(futures):
        name, delay, error = future.result()
        if delay:
            ok_count += 1
        else:
            timeout_count += 1
        payload = {"name": name, "delay": delay}
        if error:
            payload["error"] = error
        emit("delay", **payload)

emit("done", total=len(names), ok=ok_count, timeout=timeout_count)`);
}

function showUrlScript() {
  return `${localBase()}
load_subscription_env
mask_url "$SUBSCRIPTION_URL"
`;
}

function subscriptionSettingsScript() {
  return `${localBase()}
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

function subscriptionsScript() {
  return `${localBase()}
install -d -m 700 "$SUBSCRIPTIONS_DIR"
if ! ls "$SUBSCRIPTIONS_DIR"/*.env >/dev/null 2>&1 && [ -r "$ENV_FILE" ]; then
  cp -a "$ENV_FILE" "$SUBSCRIPTIONS_DIR/default.env"
  printf 'default\n' > "$SUBSCRIPTIONS_DIR/active"
fi
python3 - "$SUBSCRIPTIONS_DIR" "$ENV_FILE" <<'PY'
import json
import os
import re
import shlex
import sys
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlsplit, urlunsplit

subscriptions_dir = Path(sys.argv[1])
env_file = Path(sys.argv[2])
active_file = subscriptions_dir / "active"
active_id = active_file.read_text(encoding="utf-8", errors="ignore").strip() if active_file.exists() else ""
secret_keys = {"token", "access_token", "key", "secret", "password", "passwd"}

def parse_env(path):
    data = {}
    if not path.exists():
        return data
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        try:
            data[key] = shlex.split(value, posix=True)[0] if value else ""
        except Exception:
            data[key] = value.strip().strip("'").strip('"')
    return data

def mask_url(value):
    if not value:
        return ""
    try:
        parts = urlsplit(value)
        query = []
        for key, item in parse_qsl(parts.query, keep_blank_values=True):
            if key.lower() in secret_keys:
                item = "***"
            elif len(item) > 24:
                item = item[:8] + "..." + item[-4:]
            query.append((key, item))
        masked_query = "&".join(quote(k, safe="") + "=" + quote(v, safe="*") for k, v in query)
        return urlunsplit((parts.scheme, parts.netloc, parts.path, masked_query, parts.fragment))
    except Exception:
        return re.sub(r"((?:token|access_token|key|secret|password|passwd)=)[^&]+", r"\\1***", value, flags=re.I)

def to_bool(value):
    return str(value or "").lower() in {"1", "true", "yes", "on"}

items = []
for path in sorted(subscriptions_dir.glob("*.env")):
    sid = path.stem
    data = parse_env(path)
    url = data.get("SUBSCRIPTION_URL", "")
    split = urlsplit(url) if url else None
    stat = path.stat()
    items.append({
        "id": sid,
        "name": data.get("SUBSCRIPTION_NAME") or sid,
        "description": data.get("SUBSCRIPTION_DESCRIPTION", ""),
        "ua": data.get("SUBSCRIPTION_UA") or "User-Agent",
        "maskedUrl": mask_url(url),
        "rawUrl": url,
        "host": split.netloc if split else "",
        "autoUpdate": to_bool(data.get("SUBSCRIPTION_ALLOW_AUTO_UPDATE")),
        "systemProxy": to_bool(data.get("SUBSCRIPTION_USE_SYSTEM_PROXY")),
        "kernelUpdate": to_bool(data.get("SUBSCRIPTION_USE_KERNEL_UPDATE")),
        "timeout": int(data.get("SUBSCRIPTION_HTTP_TIMEOUT") or 0) or 30,
        "interval": int(data.get("SUBSCRIPTION_UPDATE_INTERVAL") or 0) or 1440,
        "active": sid == active_id,
        "updatedAt": int(stat.st_mtime),
    })
if items and not active_id:
    items[0]["active"] = True
    active_id = items[0]["id"]
print(json.dumps({"activeId": active_id, "subscriptions": items}, ensure_ascii=False))
PY
`;
}

function saveSubscriptionScript(settings) {
  const encoded = Buffer.from(JSON.stringify(settings || {}), "utf8").toString("base64");
  return `${localBase()}
install -d -m 700 "$SUBSCRIPTIONS_DIR"
python3 - ${shellQuote(encoded)} "$SUBSCRIPTIONS_DIR" "$ENV_FILE" <<'PY'
import base64
import json
import re
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

settings = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8"))
subscriptions_dir = Path(sys.argv[2])
env_file = Path(sys.argv[3])
subscriptions_dir.mkdir(parents=True, exist_ok=True)

def slug(value):
    value = re.sub(r"[^A-Za-z0-9_.-]+", "-", str(value or "").strip()).strip("-._")
    return value[:48] or "subscription"

sid = slug(settings.get("id"))
if not sid:
    sid = slug(settings.get("name"))
if sid == "subscription":
    host = urlsplit(settings.get("url", "")).netloc
    sid = slug(host) or f"sub-{int(time.time())}"
path = subscriptions_dir / f"{sid}.env"
name = str(settings.get("name") or sid).strip() or sid
ua = str(settings.get("ua") or "User-Agent").strip() or "User-Agent"
timeout = int(settings.get("timeout") or 30)
interval = int(settings.get("interval") or 1440)
timeout = min(max(timeout, 1), 3600)
interval = min(max(interval, 1), 43200)
url = str(settings.get("url") or "").strip()
if not re.match(r"^https?://", url, re.I):
    raise SystemExit("Subscription URL must start with http:// or https://.")

def q(value):
    return "'" + str(value).replace("'", "'\\''") + "'"

lines = [
    "# Managed by mihomo-manager-webui. Keep this file root-only.",
    "SUBSCRIPTION_URL=" + q(url),
    "SUBSCRIPTION_NAME=" + q(name),
    "SUBSCRIPTION_DESCRIPTION=" + q(str(settings.get("description") or "")),
    "SUBSCRIPTION_UA=" + q(ua),
    "SUBSCRIPTION_ALLOW_AUTO_UPDATE=" + ("1" if settings.get("autoUpdate") else "0"),
    "SUBSCRIPTION_USE_SYSTEM_PROXY=" + ("1" if settings.get("systemProxy") else "0"),
    "SUBSCRIPTION_USE_KERNEL_UPDATE=" + ("1" if settings.get("kernelUpdate") else "0"),
    f"SUBSCRIPTION_HTTP_TIMEOUT={timeout}",
    f"SUBSCRIPTION_UPDATE_INTERVAL={interval}",
]
path.write_text("\n".join(lines) + "\n", encoding="utf-8")
path.chmod(0o600)
if settings.get("active"):
    shutil.copy2(path, env_file)
    env_file.chmod(0o600)
    (subscriptions_dir / "active").write_text(sid + "\n", encoding="utf-8")
print(json.dumps({"id": sid, "active": bool(settings.get("active"))}, ensure_ascii=False))
PY
`;
}

function selectSubscriptionScript(id) {
  return `${localBase()}
install -d -m 700 "$SUBSCRIPTIONS_DIR"
id=${shellQuote(id)}
case "$id" in *[!A-Za-z0-9_.-]*|'') printf '[ERROR] Invalid subscription id.\n' >&2; exit 1 ;; esac
src="$SUBSCRIPTIONS_DIR/$id.env"
if [ ! -r "$src" ]; then printf '[ERROR] Subscription not found.\n' >&2; exit 1; fi
install -m 600 "$src" "$ENV_FILE"
printf '%s\n' "$id" > "$SUBSCRIPTIONS_DIR/active"
python3 - <<PY
import json
print(json.dumps({"id": ${JSON.stringify(id)}, "active": True}, ensure_ascii=False))
PY
`;
}

function deleteSubscriptionScript(id) {
  return `${localBase()}
id=${shellQuote(id)}
case "$id" in *[!A-Za-z0-9_.-]*|'') printf '[ERROR] Invalid subscription id.\n' >&2; exit 1 ;; esac
src="$SUBSCRIPTIONS_DIR/$id.env"
if [ ! -e "$src" ]; then printf '[ERROR] Subscription not found.\n' >&2; exit 1; fi
active=$(cat "$SUBSCRIPTIONS_DIR/active" 2>/dev/null || true)
rm -f "$src"
if [ "$active" = "$id" ]; then
  next=$(find "$SUBSCRIPTIONS_DIR" -maxdepth 1 -name '*.env' -printf '%f\n' | sed 's/\.env$//' | sort | head -1)
  if [ -n "$next" ]; then
    install -m 600 "$SUBSCRIPTIONS_DIR/$next.env" "$ENV_FILE"
    printf '%s\n' "$next" > "$SUBSCRIPTIONS_DIR/active"
  else
    rm -f "$SUBSCRIPTIONS_DIR/active"
  fi
fi
python3 - <<'PY'
import json
print(json.dumps({"deleted": True}, ensure_ascii=False))
PY
`;
}

function updateSubscriptionByIdScript(id) {
  const select = id ? selectSubscriptionScript(id) : "";
  return `${localBase()}
${id ? `id=${shellQuote(id)}
case "$id" in *[!A-Za-z0-9_.-]*|'') printf '[ERROR] Invalid subscription id.\n' >&2; exit 1 ;; esac
src="$SUBSCRIPTIONS_DIR/$id.env"
if [ ! -r "$src" ]; then printf '[ERROR] Subscription not found.\n' >&2; exit 1; fi
install -m 600 "$src" "$ENV_FILE"
printf '%s\n' "$id" > "$SUBSCRIPTIONS_DIR/active"` : ""}
${updateFunctionBody()}
update_subscription
`;
}

function trafficScript() {
  return `${localBase()}
python3 - <<'PY'
import json
import time
import urllib.request
from pathlib import Path

state_path = Path('/tmp/mihomo-manager-traffic.json')
now = time.time()
rx = tx = 0
for line in Path('/proc/net/dev').read_text().splitlines()[2:]:
    name, data = line.split(':', 1)
    name = name.strip()
    if name == 'lo':
        continue
    parts = data.split()
    rx += int(parts[0])
    tx += int(parts[8])
prev = {}
if state_path.exists():
    try:
        prev = json.loads(state_path.read_text())
    except Exception:
        prev = {}
delta = max(now - float(prev.get('time', now)), 0.001)
rx_rate = max(0, (rx - int(prev.get('rx', rx))) / delta)
tx_rate = max(0, (tx - int(prev.get('tx', tx))) / delta)
state_path.write_text(json.dumps({'time': now, 'rx': rx, 'tx': tx}))
connections = 0
try:
    with urllib.request.urlopen('http://127.0.0.1:9090/connections', timeout=2) as resp:
        payload = json.load(resp)
    connections = len(payload.get('connections') or [])
except Exception:
    pass
print(json.dumps({'rxRate': rx_rate, 'txRate': tx_rate, 'rxTotal': rx, 'txTotal': tx, 'connections': connections}, ensure_ascii=False))
PY
`;
}

function guardFirewallScriptBody() {
  return String.raw`#!/usr/bin/env bash
set -euo pipefail
ensure_ipv4() {
  iptables -N MIHOMO-GUARD 2>/dev/null || true
  iptables -F MIHOMO-GUARD
  iptables -A MIHOMO-GUARD -s 127.0.0.0/8 -j RETURN
  iptables -A MIHOMO-GUARD -s 10.0.0.0/8 -j RETURN
  iptables -A MIHOMO-GUARD -s 172.16.0.0/12 -j RETURN
  iptables -A MIHOMO-GUARD -s 192.168.0.0/16 -j RETURN
  iptables -A MIHOMO-GUARD -p tcp -m multiport --dports 7890,7891,1053 -j REJECT --reject-with tcp-reset
  iptables -A MIHOMO-GUARD -p udp --dport 1053 -j DROP
  iptables -A MIHOMO-GUARD -j RETURN
  iptables -C INPUT -j MIHOMO-GUARD 2>/dev/null || iptables -I INPUT 1 -j MIHOMO-GUARD
}
ensure_ipv6() {
  command -v ip6tables >/dev/null 2>&1 || return 0
  ip6tables -N MIHOMO-GUARD 2>/dev/null || true
  ip6tables -F MIHOMO-GUARD
  ip6tables -A MIHOMO-GUARD -s ::1/128 -j RETURN
  ip6tables -A MIHOMO-GUARD -p tcp -m multiport --dports 7890,7891,1053 -j REJECT --reject-with tcp-reset
  ip6tables -A MIHOMO-GUARD -p udp --dport 1053 -j DROP
  ip6tables -A MIHOMO-GUARD -j RETURN
  ip6tables -C INPUT -j MIHOMO-GUARD 2>/dev/null || ip6tables -I INPUT 1 -j MIHOMO-GUARD
}
ensure_ipv4
ensure_ipv6`;
}

function runtimeSettingsScript() {
  return `${localBase()}
python3 - <<'PY'
import json
import subprocess

def run(args):
    try:
        return subprocess.run(args, text=True, capture_output=True, timeout=5)
    except Exception as exc:
        return type('Result', (), {'returncode': 1, 'stdout': '', 'stderr': str(exc)})()

enabled = run(['systemctl', 'is-enabled', 'mihomo-guard-firewall.service'])
active = run(['systemctl', 'is-active', 'mihomo-guard-firewall.service'])
chain = run(['iptables', '-S', 'MIHOMO-GUARD'])
print(json.dumps({
    'guardEnabled': enabled.returncode == 0,
    'guardActive': active.returncode == 0,
    'guardInstalled': chain.returncode == 0,
    'guardPorts': [7890, 7891, 1053],
    'allowedNetworks': ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
}, ensure_ascii=False))
PY
`;
}

function setRuntimeSettingsScript(settings) {
  const enableGuard = settings.guardEnabled !== false;
  const guardBody = guardFirewallScriptBody().replace(/'/g, `'\\''`);
  return `${localBase()}
if [ ${enableGuard ? "1" : "0"} = 1 ]; then
  cat > /usr/local/sbin/mihomo-guard-firewall <<'EOF'
${guardFirewallScriptBody()}
EOF
  chmod 755 /usr/local/sbin/mihomo-guard-firewall
  cat > /etc/systemd/system/mihomo-guard-firewall.service <<'EOF'
[Unit]
Description=Protect Mihomo local proxy ports from public access
After=network-online.target docker.service
Before=mihomo.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/mihomo-guard-firewall
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now mihomo-guard-firewall.service >/dev/null
else
  systemctl disable --now mihomo-guard-firewall.service >/dev/null 2>&1 || true
  iptables -D INPUT -j MIHOMO-GUARD 2>/dev/null || true
  iptables -F MIHOMO-GUARD 2>/dev/null || true
  iptables -X MIHOMO-GUARD 2>/dev/null || true
  if command -v ip6tables >/dev/null 2>&1; then
    ip6tables -D INPUT -j MIHOMO-GUARD 2>/dev/null || true
    ip6tables -F MIHOMO-GUARD 2>/dev/null || true
    ip6tables -X MIHOMO-GUARD 2>/dev/null || true
  fi
fi
${runtimeSettingsScript().replace(`${localBase()}\n`, "")}
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
  return `${localBase()}
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
  return `${localBase()}
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
  return `${localBase()}
${proxyStatusBody()}
`;
}

function proxyEnvScript() {
  return `${localBase()}
load_core_proxy_env
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
  return `${localBase()}
load_core_proxy_env
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
  return `${localBase()}
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
  return `${localBase()}
systemctl --no-pager --full status mihomo-subscription.timer 2>/dev/null | sed -n '1,25p' || true
systemctl list-timers --all mihomo-subscription.timer --no-pager 2>/dev/null || true
`;
}

function serviceStatusScript() {
  return `${localBase()}
systemctl --no-pager --full status mihomo.service | sed -n '1,35p'
`;
}

function logsScript(target, lines) {
  const unit = target === "subscription" ? "mihomo-subscription.service" : "mihomo.service";
  return `${localBase()}
journalctl -u ${shellQuote(unit)} -n ${Number(lines)} --no-pager
`;
}

function languageScript() {
  return `${localBase()}
if [ "$WEBUI_LANG" = zh ]; then
  printf '当前语言：%s\n' "$WEBUI_LANG"
else
  printf 'Current language: %s\n' "$WEBUI_LANG"
fi
`;
}

function setLanguageScript(lang) {
  return `${localBase()}
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
  return `${localBase()}
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
  return `${localBase()}
if [ "$WEBUI_LANG" = zh ]; then printf 'Proxychains 配置文件：%s\n' "$PROXYCHAINS_CONF"; else printf 'Proxychains config file: %s\n' "$PROXYCHAINS_CONF"; fi
if [ -r "$PROXYCHAINS_CONF" ]; then
  sed -n '1,120p' "$PROXYCHAINS_CONF"
else
  if [ "$WEBUI_LANG" = zh ]; then printf '配置文件不存在或不可读。\n'; else printf 'Config file is missing or unreadable.\n'; fi
fi
`;
}

function testScript() {
  return `${localBase()}
if ! command -v curl >/dev/null 2>&1; then
  if [ "$WEBUI_LANG" = zh ]; then printf '[错误] 缺少命令：curl\n' >&2; else printf '[ERROR] Missing command: curl\n' >&2; fi
  exit 1
fi
load_core_proxy_env
if [ "$WEBUI_LANG" = zh ]; then printf 'Mihomo 服务：'; else printf 'Mihomo service: '; fi
systemctl is-active mihomo.service 2>/dev/null || true
if [ "$WEBUI_LANG" = zh ]; then printf 'HTTP/Mixed Google 204：'; else printf 'HTTP/Mixed google 204: '; fi
curl -4 -sS -o /dev/null -w 'code=%{http_code} time=%{time_total}\n' -x "$HTTP_PROXY_URL" --connect-timeout 8 --max-time 25 https://www.google.com/generate_204 || true
if [ "$WEBUI_LANG" = zh ]; then printf 'HTTP/Mixed 出口 IP：'; else printf 'HTTP/Mixed exit IP: '; fi
curl -4 -sS -x "$HTTP_PROXY_URL" --connect-timeout 8 --max-time 25 https://api.ipify.org || true
printf '\n'
if [ "$WEBUI_LANG" = zh ]; then printf 'SOCKS5/Mixed Google 204：'; else printf 'SOCKS5/Mixed google 204: '; fi
curl -4 -sS -o /dev/null -w 'code=%{http_code} time=%{time_total}\n' --socks5-hostname "\${SOCKS_PROXY_URL#socks5h://}" --connect-timeout 8 --max-time 25 https://www.google.com/generate_204 || true
if [ "$WEBUI_LANG" = zh ]; then printf 'SOCKS5/Mixed 出口 IP：'; else printf 'SOCKS5/Mixed exit IP: '; fi
curl -4 -sS --socks5-hostname "\${SOCKS_PROXY_URL#socks5h://}" --connect-timeout 8 --max-time 25 https://api.ipify.org || true
printf '\n'
`;
}

function updateFunctionBody() {
  return String.raw`update_subscription() {
  load_subscription_env
  if [ -z "$SUBSCRIPTION_URL" ]; then
    if [ "$WEBUI_LANG" = zh ]; then printf '[错误] 订阅链接未设置。\n' >&2; else printf '[ERROR] Subscription URL is not set.\n' >&2; fi
    exit 1
  fi
  updater=/usr/local/sbin/update-mihomo-subscription
  project_updater=$HOST_PROJECT_DIR/scripts/update-mihomo-subscription
  if [ ! -x "$updater" ]; then
    if [ -r "$project_updater" ]; then
      install -m 755 "$project_updater" "$updater"
    else
      if [ "$WEBUI_LANG" = zh ]; then printf '[错误] 缺少统一订阅更新脚本：%s\n' "$updater" >&2; else printf '[ERROR] Missing unified subscription updater: %s\n' "$updater" >&2; fi
      exit 1
    fi
  fi
  if [ "$WEBUI_LANG" = zh ]; then printf '[信息] 正在更新订阅，并保留本地配置改动...\n'; else printf '[INFO] Updating subscription while preserving local config changes...\n'; fi
  "$updater"
  if [ "$WEBUI_LANG" = zh ]; then printf '[信息] 订阅更新完成，本地配置改动已保留。\n'; else printf '[INFO] Subscription update finished; local config changes were preserved.\n'; fi
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
  return `${localBase()}
${updateFunctionBody()}
update_subscription
`;
}

function setSubscriptionUrlScript(url) {
  const encoded = Buffer.from(url, "utf8").toString("base64");
  return `${localBase()}
${updateFunctionBody()}
new_url=$(printf '%s' ${shellQuote(encoded)} | base64 -d)
case "$new_url" in
  http://*|https://*) ;;
  *) printf '[ERROR] Subscription URL must start with http:// or https://.\n' >&2; exit 1 ;;
esac
load_subscription_env
write_subscription_env "$new_url" "$SUBSCRIPTION_UA" "$SUBSCRIPTION_NAME" "$SUBSCRIPTION_DESCRIPTION" "$SUBSCRIPTION_ALLOW_AUTO_UPDATE" "$SUBSCRIPTION_USE_SYSTEM_PROXY" "$SUBSCRIPTION_USE_KERNEL_UPDATE"
if [ "$WEBUI_LANG" = zh ]; then printf '[信息] 订阅链接已保存。\n'; else printf '[INFO] Subscription URL saved.\n'; fi
update_subscription
`;
}

function setSubscriptionUaScript(ua) {
  const encoded = Buffer.from(ua, "utf8").toString("base64");
  return `${localBase()}
${updateFunctionBody()}
new_ua=$(printf '%s' ${shellQuote(encoded)} | base64 -d)
if [ -z "$new_ua" ]; then
  printf '[ERROR] User-Agent cannot be empty.\n' >&2
  exit 1
fi
load_subscription_env
write_subscription_env "$SUBSCRIPTION_URL" "$new_ua" "$SUBSCRIPTION_NAME" "$SUBSCRIPTION_DESCRIPTION" "$SUBSCRIPTION_ALLOW_AUTO_UPDATE" "$SUBSCRIPTION_USE_SYSTEM_PROXY" "$SUBSCRIPTION_USE_KERNEL_UPDATE"
if [ "$WEBUI_LANG" = zh ]; then printf '[信息] 订阅 User-Agent 已保存。\n'; else printf '[INFO] Subscription User-Agent saved.\n'; fi
update_subscription
`;
}

function selectOnlyScript() {
  return `${localBase()}
${selectFunctionBody()}
select_working_proxy
`;
}

function startServiceScript() {
  return `${localBase()}
${selectFunctionBody()}
systemctl start mihomo.service
sleep 2
select_working_proxy || true
systemctl is-active mihomo.service
`;
}

function stopServiceScript() {
  return `${localBase()}
systemctl stop mihomo.service
systemctl is-active mihomo.service || true
`;
}

function restartServiceScript() {
  return `${localBase()}
${selectFunctionBody()}
systemctl restart mihomo.service
sleep 2
select_working_proxy || true
systemctl is-active mihomo.service
`;
}

function runLocalScript(script, timeoutMs = 90_000) {
  const { command, args, env } = buildScriptProcess();
  return runScriptProcess(command, args, script, timeoutMs, env);
}

function buildScriptProcess() {
  const runner = String(process.env.MIHOMO_LOCAL_RUNNER || "direct").toLowerCase();
  if (runner === "nsenter") {
    const nsenter = process.env.NSENTER_BIN || "/usr/bin/nsenter";
    return {
      command: nsenter,
      args: ["--target", "1", "--mount", "--uts", "--ipc", "--net", "--pid", "bash", "-s"],
      env: process.env,
    };
  }
  return { command: "bash", args: ["-s"], env: process.env };
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

function normalizeProxyNames(value) {
  return Array.isArray(value)
    ? value.map((name) => String(name || "").trim()).filter(Boolean).slice(0, 120)
    : [];
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

function writeSseEvent(res, event, payload) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function streamDelayResults(req, res, names) {
  const { command, args, env } = buildScriptProcess(config);
  const child = spawn(command, args, { windowsHide: true, env });
  const timer = setTimeout(() => child.kill("SIGTERM"), 130_000);
  let stdoutBuffer = "";
  let stderr = "";
  let ended = false;

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  writeSseEvent(res, "ready", { ok: true, total: names.length });

  function finish() {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    if (!res.writableEnded) res.end();
  }

  function processLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const payload = JSON.parse(trimmed);
      writeSseEvent(res, String(payload.event || "message"), payload);
    } catch {
      writeSseEvent(res, "log", { line: scrub(trimmed) });
    }
  }

  req.on("close", () => {
    if (!ended && !res.writableEnded) child.kill("SIGTERM");
  });

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) processLine(line);
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  child.on("error", (error) => {
    writeSseEvent(res, "error", { ok: false, error: error.message });
    finish();
  });

  child.on("close", (code, signal) => {
    if (stdoutBuffer) processLine(stdoutBuffer);
    if (code !== 0) {
      writeSseEvent(res, "error", {
        ok: false,
        code,
        signal,
        error: "Delay test process failed.",
        stderr: scrub(stderr),
      });
    }
    writeSseEvent(res, "end", { ok: code === 0, code, signal, stderr: scrub(stderr) });
    finish();
  });

  child.stdin.write(delayStreamScript(names));
  child.stdin.end();
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
