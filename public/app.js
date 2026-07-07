const state = {
  activeView: "dashboard",
  busy: false,
};

const titles = {
  dashboard: "仪表盘",
  subscription: "订阅",
  service: "服务",
  proxy: "系统代理",
  logs: "日志",
  settings: "设置",
};

const outputTargets = {
  dashboard: document.querySelector("#statusOutput"),
  subscription: document.querySelector("#subscriptionOutput"),
  service: document.querySelector("#serviceOutput"),
  proxy: document.querySelector("#proxyOutput"),
  logs: document.querySelector("#logsOutput"),
  settings: document.querySelector("#settingsOutput"),
};

const commandTarget = {
  status: "dashboard",
  test: "dashboard",
  ports: "service",
  "show-url": "subscription",
  "proxy-status": "proxy",
  "proxy-env": "proxy",
  timer: "service",
  "service-status": "service",
  "proxychains-show": "proxy",
  lang: "settings",
};

const actionTarget = {
  update: "subscription",
  start: "service",
  stop: "service",
  restart: "service",
  select: "subscription",
  "proxy-on": "proxy",
  "proxy-off": "proxy",
  proxychains: "proxy",
};

document.querySelector("#navTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  setView(button.dataset.view);
});

document.querySelector("#refreshBtn").addEventListener("click", () => refreshStatus());

document.body.addEventListener("click", async (event) => {
  const runButton = event.target.closest("[data-run]");
  if (runButton) {
    await runCommand(runButton.dataset.run);
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    await runAction(actionButton.dataset.action);
    return;
  }

  const langButton = event.target.closest("[data-lang]");
  if (langButton) {
    await setLanguage(langButton.dataset.lang);
  }
});

document.querySelector("#urlForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#subscriptionUrl");
  const value = input.value.trim();
  if (!value) {
    toast("请输入订阅链接");
    return;
  }
  await postJson("/api/subscription/url", { url: value }, "subscription");
  input.value = "";
  await refreshStatus();
});

document.querySelector("#uaForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#subscriptionUa");
  const value = input.value.trim();
  if (!value) {
    toast("请输入 User-Agent");
    return;
  }
  await postJson("/api/subscription/ua", { ua: value }, "subscription");
  await refreshStatus();
});

document.querySelector("#loadLogsBtn").addEventListener("click", async () => {
  const target = document.querySelector("#logTarget").value;
  const lines = document.querySelector("#logLines").value;
  await fetchResult(`/api/logs?target=${encodeURIComponent(target)}&lines=${encodeURIComponent(lines)}`, "logs");
});

await loadConfig();
await refreshStatus();

function setView(view) {
  state.activeView = view;
  document.querySelectorAll(".view").forEach((element) => {
    element.classList.toggle("active", element.id === view);
  });
  document.querySelectorAll(".nav-item").forEach((element) => {
    element.classList.toggle("active", element.dataset.view === view);
  });
  document.querySelector("#viewTitle").textContent = titles[view] || view;
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const payload = await response.json();
  if (!payload.ok) {
    setConnection(false, payload.error || "连接配置读取失败");
    return;
  }
  const { host, port, user, mode } = payload.data;
  document.querySelector("#serverLabel").textContent = `${user}@${host}:${port}`;
  document.querySelector("#configHost").textContent = `${host}:${port}`;
  document.querySelector("#configUser").textContent = user;
  document.querySelector("#configScript").textContent = mode;
}

async function refreshStatus() {
  const result = await fetchResult("/api/run?command=status", "dashboard", false);
  if (!result) return;
  updateMetrics(result.stdout || "");
  setConnection(result.ok, result.ok ? "已连接" : "连接异常");
}

async function runCommand(command) {
  const target = commandTarget[command] || state.activeView;
  const result = await fetchResult(`/api/run?command=${encodeURIComponent(command)}`, target);
  if (command === "status" && result) {
    updateMetrics(result.stdout || "");
  }
}

async function runAction(action) {
  const target = actionTarget[action] || state.activeView;
  const result = await postJson("/api/action", { action }, target);
  if (result?.ok) {
    await refreshStatus();
  }
}

async function setLanguage(lang) {
  const result = await postJson("/api/lang", { lang }, "settings");
  if (result?.ok) {
    await refreshStatus();
  }
}

async function fetchResult(url, target, showToast = true) {
  setBusy(true);
  writeOutput(target, "正在执行...");
  try {
    const response = await fetch(url);
    const payload = await response.json();
    writeResult(target, payload);
    if (showToast) toast(payload.ok ? "操作完成" : "操作失败");
    return payload;
  } catch (error) {
    const payload = { ok: false, error: error.message };
    writeResult(target, payload);
    if (showToast) toast("请求失败");
    return payload;
  } finally {
    setBusy(false);
  }
}

async function postJson(url, body, target) {
  setBusy(true);
  writeOutput(target, "正在执行...");
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    writeResult(target, payload);
    toast(payload.ok ? "操作完成" : "操作失败");
    return payload;
  } catch (error) {
    const payload = { ok: false, error: error.message };
    writeResult(target, payload);
    toast("请求失败");
    return payload;
  } finally {
    setBusy(false);
  }
}

function writeResult(target, payload) {
  const lines = [];
  if (payload.stdout) lines.push(payload.stdout.trimEnd());
  if (payload.stderr) lines.push(payload.stderr.trimEnd());
  if (payload.error) lines.push(payload.error);
  if (!lines.length) {
    lines.push(payload.ok ? "完成，无输出。" : "失败，无输出。");
  }
  writeOutput(target, lines.join("\n\n"));
}

function writeOutput(target, text) {
  const output = outputTargets[target] || outputTargets[state.activeView] || outputTargets.dashboard;
  output.textContent = text;
}

function updateMetrics(text) {
  const service = extractLine(text, ["Mihomo 服务：", "Mihomo service: "]);
  const timer = extractLine(text, ["订阅定时更新：", "Subscription timer: "]);
  const shellProxy = extractLine(text, ["系统 shell 代理：", "System shell proxy: "]);
  const aptProxy = extractLine(text, ["APT 代理：", "APT proxy: "]);
  const proxychains = extractLine(text, ["Proxychains 配置：", "Proxychains config: "]);

  document.querySelector("#serviceMetric").textContent = compact(service);
  document.querySelector("#timerMetric").textContent = compact(timer);
  document.querySelector("#systemProxyMetric").textContent =
    [shellProxy, aptProxy].some((line) => /已启用|enabled/i.test(line)) ? "已启用" : "未启用";
  document.querySelector("#proxychainsMetric").textContent = proxychains && !/missing|缺失/i.test(proxychains)
    ? "已配置"
    : "未配置";
}

function extractLine(text, prefixes) {
  const lines = text.split(/\r?\n/);
  for (const prefix of prefixes) {
    const line = lines.find((item) => item.startsWith(prefix));
    if (line) return line.slice(prefix.length).trim();
  }
  return "--";
}

function compact(value) {
  if (!value) return "--";
  return value.replace(/\s*\(.+\)$/, "").trim();
}

function setConnection(ok, label) {
  const pill = document.querySelector("#connectionPill");
  pill.textContent = label;
  pill.classList.toggle("ok", ok);
  pill.classList.toggle("fail", !ok);
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll("button, input, select").forEach((element) => {
    element.disabled = busy;
  });
}

let toastTimer;
function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
}
