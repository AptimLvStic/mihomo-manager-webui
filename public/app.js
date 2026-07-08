const state = {
  activeView: "dashboard",
  busy: false,
  proxyData: null,
  selectedProxyGroup: "",
  proxyDelays: {},
  testingDelays: false,
  proxyProgressText: "",
  subscriptionSettings: null,
};

const titles = {
  dashboard: "仪表盘",
  proxies: "代理",
  subscription: "订阅",
  rules: "规则",
  service: "服务",
  proxy: "系统",
  logs: "日志",
  settings: "设置",
};

const outputTargets = {
  dashboard: document.querySelector("#statusOutput"),
  proxies: document.querySelector("#proxyGroupMeta"),
  subscription: document.querySelector("#subscriptionOutput"),
  rules: document.querySelector("#rulesSummary"),
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

document.querySelector("#subscriptionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSubscriptionSettings(false);
});

document.querySelector("#saveAndUpdateSubscriptionBtn").addEventListener("click", async () => {
  await saveSubscriptionSettings(true);
});

document.querySelector("#ruleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const type = document.querySelector("#ruleType").value.trim();
  const payload = document.querySelector("#rulePayload").value.trim();
  const policy = document.querySelector("#rulePolicy").value.trim();
  if (type !== "MATCH" && !payload) {
    toast("请输入规则内容");
    return;
  }
  if (!policy) {
    toast("请选择代理策略");
    return;
  }
  const result = await postJson("/api/rules", { type, payload, policy }, "rules");
  if (result?.ok) {
    document.querySelector("#rulePayload").value = "";
    await loadRules();
  }
});

document.querySelector("#loadLogsBtn").addEventListener("click", async () => {
  const target = document.querySelector("#logTarget").value;
  const lines = document.querySelector("#logLines").value;
  await fetchResult(`/api/logs?target=${encodeURIComponent(target)}&lines=${encodeURIComponent(lines)}`, "logs");
});

document.querySelector("#reloadProxiesBtn").addEventListener("click", () => loadProxies(true));
document.querySelector("#delayGroupBtn").addEventListener("click", () => testSelectedGroupDelays());
document.querySelector("#loadRulesBtn").addEventListener("click", () => loadRules());

document.querySelector("#proxyGroups").addEventListener("click", (event) => {
  const button = event.target.closest("[data-proxy-group]");
  if (!button) return;
  state.selectedProxyGroup = button.dataset.proxyGroup;
  renderProxies();
});

document.querySelector("#proxyNodes").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-proxy-select]");
  if (!button) return;
  await selectProxyNode(button.dataset.proxyGroup, button.dataset.proxySelect);
});

await loadConfig();
await loadSubscriptionSettings();
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
  if (view === "proxies" && !state.proxyData) {
    loadProxies();
  }
  if (view === "rules") {
    loadRulePolicies();
  }
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const payload = await response.json();
  if (!payload.ok) {
    setConnection(false, payload.error || "连接配置读取失败");
    return;
  }
  const { host, port, user, mode, auth } = payload.data;
  const localMode = mode === "local";
  document.querySelector("#serverLabel").textContent = localMode ? "本地管理" : `${user}@${host}:${port}`;
  document.querySelector("#configHost").textContent = localMode ? "本机环境" : `${host}:${port}`;
  document.querySelector("#configUser").textContent = localMode ? "当前进程" : user;
  document.querySelector("#configScript").textContent = localMode ? "local" : `remote-ssh-${auth || "key"}`;
}

async function loadSubscriptionSettings() {
  try {
    const response = await fetch("/api/subscription/settings");
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || payload.stderr || "订阅设置读取失败");
    state.subscriptionSettings = payload.data;
    document.querySelector("#subscriptionName").value = payload.data.name || "默认订阅";
    document.querySelector("#subscriptionDescription").value = payload.data.description || "";
    document.querySelector("#subscriptionUa").value = payload.data.ua && payload.data.ua !== "User-Agent"
      ? payload.data.ua
      : "";
    document.querySelector("#subscriptionAutoUpdate").checked = Boolean(payload.data.autoUpdate);
    document.querySelector("#subscriptionSystemProxy").checked = Boolean(payload.data.systemProxy);
    document.querySelector("#subscriptionKernelUpdate").checked = Boolean(payload.data.kernelUpdate);
    writeSubscriptionSummary(payload.data);
  } catch (error) {
    writeOutput("subscription", error.message);
  }
}

async function saveSubscriptionSettings(updateAfterSave) {
  const body = {
    name: document.querySelector("#subscriptionName").value.trim(),
    description: document.querySelector("#subscriptionDescription").value.trim(),
    url: document.querySelector("#subscriptionUrl").value.trim(),
    ua: document.querySelector("#subscriptionUa").value.trim(),
    autoUpdate: document.querySelector("#subscriptionAutoUpdate").checked,
    systemProxy: document.querySelector("#subscriptionSystemProxy").checked,
    kernelUpdate: document.querySelector("#subscriptionKernelUpdate").checked,
  };
  const result = await postJson("/api/subscription/settings", body, "subscription");
  if (!result?.ok) return;
  document.querySelector("#subscriptionUrl").value = "";
  await loadSubscriptionSettings();
  await refreshStatus();
  if (updateAfterSave) {
    await runAction("update");
  }
}

function writeSubscriptionSummary(data) {
  const output = outputTargets.subscription;
  const rows = [
    ["订阅名称", data.name || "默认订阅"],
    ["订阅描述", data.description || "无"],
    ["当前链接", data.maskedUrl || "未设置"],
    ["User-Agent", data.ua || "User-Agent"],
    ["允许自动更新", data.autoUpdate ? "已启用" : "未启用"],
    ["使用系统代理更新", data.systemProxy ? "已启用" : "未启用"],
    ["使用内核更新", data.kernelUpdate ? "已启用" : "未启用"],
    ["定时器", data.timer || "--"],
  ];
  output.textContent = rows.map(([label, value]) => `${label}：${value}`).join("\n");
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
    if (action === "select" && state.activeView === "proxies") {
      await loadProxies(true);
    }
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

async function loadProxies(force = false) {
  if (state.proxyData && !force) {
    renderProxies();
    return;
  }
  setBusy(true);
  document.querySelector("#proxyGroups").textContent = "正在读取代理组...";
  document.querySelector("#proxyNodes").textContent = "";
  try {
    const response = await fetch("/api/proxies");
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || payload.stderr || "读取代理组失败");
    state.proxyData = payload.data;
    if (!state.selectedProxyGroup) {
      const preferred = state.proxyData.groups.find((group) => group.name === "Proxies")
        || state.proxyData.groups.find((group) => group.name === "GLOBAL")
        || state.proxyData.groups[0];
      state.selectedProxyGroup = preferred?.name || "";
    }
    renderProxies();
    populateRulePolicyOptions();
    toast("代理组已刷新");
  } catch (error) {
    document.querySelector("#proxyGroups").textContent = error.message;
    toast("读取代理组失败");
  } finally {
    setBusy(false);
  }
}

function renderProxies() {
  const groupsContainer = document.querySelector("#proxyGroups");
  const nodesContainer = document.querySelector("#proxyNodes");
  groupsContainer.innerHTML = "";
  nodesContainer.innerHTML = "";

  const groups = state.proxyData?.groups || [];
  if (!groups.length) {
    groupsContainer.textContent = "没有读取到代理组。";
    document.querySelector("#proxyGroupTitle").textContent = "节点";
    document.querySelector("#proxyGroupMeta").textContent = "请先刷新代理组。";
    return;
  }

  if (!groups.some((group) => group.name === state.selectedProxyGroup)) {
    state.selectedProxyGroup = groups[0].name;
  }

  for (const group of groups) {
    const button = document.createElement("button");
    button.className = `proxy-group-item${group.name === state.selectedProxyGroup ? " active" : ""}`;
    button.type = "button";
    button.dataset.proxyGroup = group.name;
    button.innerHTML = `
      <span class="proxy-group-name">${escapeHtml(group.name)}</span>
      <span class="proxy-group-meta">${escapeHtml(group.type || "Group")} · ${group.optionCount} 节点</span>
      <span class="proxy-group-now">${escapeHtml(group.now || "--")}</span>
    `;
    groupsContainer.appendChild(button);
  }

  const group = groups.find((item) => item.name === state.selectedProxyGroup);
  document.querySelector("#proxyGroupTitle").textContent = group?.name || "节点";
  document.querySelector("#proxyGroupMeta").textContent = group
    ? state.proxyProgressText || `${group.type || "Group"} · 当前：${group.now || "--"}`
    : "选择一个代理组查看节点";

  for (const option of group?.options || []) {
    const node = state.proxyData.nodes[option] || { name: option, type: "Group" };
    const hasMeasuredDelay = Object.prototype.hasOwnProperty.call(state.proxyDelays, option);
    const delay = hasMeasuredDelay ? state.proxyDelays[option] : node.delay;
    const active = option === group.now;
    const delayState = delay === "testing" ? "pending" : delay ? "ok" : hasMeasuredDelay ? "fail" : "";
    const card = document.createElement("button");
    card.className = `node-card${active ? " active" : ""}`;
    card.type = "button";
    card.dataset.proxyGroup = group.name;
    card.dataset.proxySelect = option;
    card.innerHTML = `
      <span class="node-title">${escapeHtml(option)}</span>
      <span class="node-meta">${escapeHtml(node.type || "Node")}</span>
      <span class="node-delay ${delayState}">${formatDelay(delay)}</span>
    `;
    nodesContainer.appendChild(card);
  }
  document.querySelector("#delayGroupBtn").disabled = state.busy || state.testingDelays;
}

async function selectProxyNode(group, name) {
  setBusy(true);
  try {
    const response = await fetch("/api/proxies/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ group, name }),
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || payload.stderr || "切换节点失败");
    toast(`已切换：${name}`);
    await loadProxies(true);
  } catch (error) {
    toast(error.message);
  } finally {
    setBusy(false);
  }
}

async function testSelectedGroupDelays() {
  const group = state.proxyData?.groups?.find((item) => item.name === state.selectedProxyGroup);
  if (!group) {
    toast("请先选择代理组");
    return;
  }
  const names = group.options.filter((name) => state.proxyData.nodes[name]).slice(0, 120);
  if (!names.length) {
    toast("当前代理组没有可测速节点");
    return;
  }
  state.testingDelays = true;
  let okCount = 0;
  let doneCount = 0;
  renderProxies();
  try {
    for (const name of names) {
      state.proxyDelays[name] = "testing";
      state.proxyProgressText = `正在测试 ${doneCount + 1}/${names.length}：${name}`;
      renderProxies();
      const delay = await testProxyDelay(name);
      state.proxyDelays[name] = delay;
      if (delay) okCount += 1;
      doneCount += 1;
      state.proxyProgressText = `已测试 ${doneCount}/${names.length}，可用 ${okCount}`;
      renderProxies();
    }
    toast(`测速完成：${okCount}/${names.length} 可用`);
  } catch (error) {
    toast(error.message);
  } finally {
    state.testingDelays = false;
    state.proxyProgressText = "";
    renderProxies();
  }
}

async function testProxyDelay(name) {
  const response = await fetch("/api/proxies/delays", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ names: [name] }),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || payload.stderr || "测速失败");
  return payload.data.delays[name] || null;
}

async function loadRules() {
  setBusy(true);
  document.querySelector("#rulesSummary").textContent = "正在读取规则...";
  document.querySelector("#ruleStats").innerHTML = "";
  document.querySelector("#ruleList").textContent = "";
  try {
    const response = await fetch("/api/rules");
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || payload.stderr || "读取规则失败");
    renderRules(payload.data);
    toast("规则已读取");
  } catch (error) {
    document.querySelector("#rulesSummary").textContent = error.message;
    toast("读取规则失败");
  } finally {
    setBusy(false);
  }
}

function renderRules(data) {
  document.querySelector("#rulesSummary").textContent = `共 ${data.total} 条规则，列表显示前 ${data.rules.length} 条`;
  const stats = document.querySelector("#ruleStats");
  stats.innerHTML = "";
  for (const [type, count] of Object.entries(data.types || {}).slice(0, 12)) {
    const chip = document.createElement("span");
    chip.className = "rule-chip";
    chip.textContent = `${type}: ${count}`;
    stats.appendChild(chip);
  }

  const list = document.querySelector("#ruleList");
  list.innerHTML = "";
  for (const rule of data.rules || []) {
    const row = document.createElement("div");
    row.className = "rule-row";
    row.innerHTML = `
      <span class="rule-index">${rule.index}</span>
      <span class="rule-type">${escapeHtml(rule.type || "--")}</span>
      <span class="rule-payload">${escapeHtml(rule.payload || "--")}</span>
      <span class="rule-policy">${escapeHtml(rule.proxy || "--")}</span>
    `;
    list.appendChild(row);
  }
}

async function loadRulePolicies() {
  if (!state.proxyData) {
    try {
      const response = await fetch("/api/proxies");
      const payload = await response.json();
      if (payload.ok) {
        state.proxyData = payload.data;
      }
    } catch {
      // Keep the built-in DIRECT/REJECT policies if the controller is unavailable.
    }
  }
  populateRulePolicyOptions();
}

function populateRulePolicyOptions() {
  const select = document.querySelector("#rulePolicy");
  if (!select) return;
  const current = select.value;
  const names = ["DIRECT", "REJECT"];
  for (const group of state.proxyData?.groups || []) {
    if (!names.includes(group.name)) names.push(group.name);
  }
  select.innerHTML = "";
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  if (names.includes(current)) {
    select.value = current;
  }
}

function writeResult(target, payload) {
  if (target === "dashboard" && payload.stdout) {
    renderStatusDetails(payload.stdout);
    if (payload.stderr || payload.error) {
      toast(payload.stderr || payload.error);
    }
    return;
  }
  const lines = [];
  if (payload.stdout) lines.push(payload.stdout.trimEnd());
  if (payload.stderr) lines.push(payload.stderr.trimEnd());
  if (payload.error) lines.push(payload.error);
  if (!lines.length) {
    lines.push(payload.ok ? "完成，无输出。" : "失败，无输出。");
  }
  writeOutput(target, lines.join("\n\n"));
}

function renderStatusDetails(text) {
  const output = outputTargets.dashboard;
  const details = parseStatusDetails(text);
  output.innerHTML = "";
  if (!details.length) {
    output.textContent = text || "暂无状态数据。";
    return;
  }
  for (const item of details) {
    const row = document.createElement("div");
    row.className = "status-row";
    row.innerHTML = `
      <span class="status-label">${escapeHtml(item.label)}</span>
      <span class="status-value">${escapeHtml(item.value)}</span>
    `;
    output.appendChild(row);
  }
}

function parseStatusDetails(text) {
  const rows = [];
  const portLines = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^LISTEN\b/.test(trimmed)) {
      portLines.push(trimmed.replace(/\s+/g, " "));
      continue;
    }
    const match = trimmed.match(/^([^:：]+)[：:]\s*(.*)$/);
    if (!match) continue;
    const label = match[1].trim();
    const value = match[2].trim();
    if (label === "监听端口" || label === "Listening ports") continue;
    rows.push({ label, value: value || "--" });
  }
  if (portLines.length) {
    rows.push({ label: "监听端口", value: portLines.join("\n") });
  }
  return rows;
}

function writeOutput(target, text) {
  const output = outputTargets[target] || outputTargets[state.activeView] || outputTargets.dashboard;
  if (target === "dashboard") {
    output.innerHTML = "";
  }
  output.textContent = text;
}

function formatDelay(delay) {
  if (delay === "testing") return "测试中";
  if (delay === null) return "超时";
  if (!delay) return "--";
  return `${Math.round(delay)} ms`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  document.querySelectorAll("button, input, select, textarea").forEach((element) => {
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
