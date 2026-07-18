import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(".");

async function getFreePort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise((resolveClose) => server.close(resolveClose));
  return address.port;
}
async function waitForHealth(port, getOutput) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/api/health");
      if (response.ok) return;
    } catch {
      // The child process may still be starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Test server did not become healthy: " + getOutput());
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
  ]);
  if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
}

test("runtime remains local when obsolete remote variables are present", async (t) => {
  const port = await getFreePort();
  const dataDir = await mkdtemp(join(tmpdir(), "mihomo-manager-local-only-"));
  const username = "unit-admin";
  const password = "unit-password-123";
  let output = "";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      LISTEN_HOST: "127.0.0.1",
      DATA_DIR: dataDir,
      WEBUI_USERNAME: username,
      WEBUI_PASSWORD: password,
      WEBUI_SESSION_SECRET: "unit-session-secret-for-local-mode",
      MIHOMO_MODE: "remote",
      MIHOMO_HOST: "remote.example.invalid",
      MIHOMO_AUTH: "key",
      MIHOMO_KEY: "/tmp/not-used",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  t.after(async () => {
    await stop(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForHealth(port, () => output);
  const login = await fetch("http://127.0.0.1:" + port + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert(cookie);

  const response = await fetch("http://127.0.0.1:" + port + "/api/config", {
    headers: { cookie: cookie.split(";")[0] },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.mode, "local");
  assert.equal(payload.data.auth, "local");
  assert.equal(payload.data.host, "localhost");
});
