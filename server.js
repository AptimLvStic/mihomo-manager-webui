import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const rootDir = resolve(".");
const publicDir = join(rootDir, "public");
const port = Number(process.env.PORT || 5178);

const config = loadConfig();
const scriptPath = config.scriptPath || "/usr/local/sbin/mihomo.sh";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const readOnlyCommands = {
  status: ["status"],
  test: ["test"],
  ports: ["ports"],
  "show-url": ["show-url"],
  "proxy-status": ["proxy", "status"],
  "proxy-env": ["proxy", "env"],
  timer: ["timer"],
  "service-status": ["service-status"],
  "proxychains-show": ["proxychains-show"],
  lang: ["lang"],
};

const actionCommands = {
  update: ["update"],
  start: ["start"],
  stop: ["stop"],
  restart: ["restart"],
  select: ["select"],
  "proxy-on": ["proxy", "on"],
  "proxy-off": ["proxy", "off"],
  "proxychains": ["proxychains"],
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
}).listen(port, "127.0.0.1", () => {
  console.log(`Mihomo Manager UI listening on http://127.0.0.1:${port}`);
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
    scriptPath: process.env.MIHOMO_SCRIPT || fileConfig.scriptPath,
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
        scriptPath,
      },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/run") {
    const command = url.searchParams.get("command") || "";
    if (!(command in readOnlyCommands)) {
      sendJson(res, 400, { ok: false, error: "Unknown read-only command." });
      return;
    }
    const result = await runMihomo(readOnlyCommands[command]);
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    const target = url.searchParams.get("target") === "subscription" ? "logs-sub" : "logs";
    const lines = normalizeLines(url.searchParams.get("lines"));
    const result = await runMihomo([target, String(lines)]);
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/action") {
    const body = await readBody(req);
    const action = String(body.action || "");
    if (!(action in actionCommands)) {
      sendJson(res, 400, { ok: false, error: "Unknown action." });
      return;
    }
    const result = await runMihomo(actionCommands[action]);
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
    const result = await runMihomo(["set-url"], `${subscriptionUrl}\n`, 180_000);
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
    const result = await runMihomo(["set-ua"], `${userAgent}\n`, 180_000);
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
    const result = await runMihomo(["set-lang", lang]);
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

function runMihomo(args, stdin = "", timeoutMs = 90_000) {
  const remoteArgs = [scriptPath, ...args].map(shellQuote).join(" ");
  return runSsh(remoteArgs, stdin, timeoutMs);
}

function runSsh(remoteCommand, stdin = "", timeoutMs = 90_000) {
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
    remoteCommand,
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

    if (stdin) {
      child.stdin.write(stdin);
    }
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
