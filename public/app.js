const state = {
  activeView: "dashboard",
  busy: false,
  setupRequired: false,
  proxyData: null,
  selectedProxyGroup: "",
  proxyDelays: {},
  testingDelays: false,
  testingDelayNodes: new Set(),
  proxyProgressText: "",
  subscriptionSettings: null,
  mihomoProxySettings: null,
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

const inboundFieldMap = {
  http: { enabled: "#inboundHttpEnabled", port: "#inboundHttpPort", label: "HTTP" },
  socks: { enabled: "#inboundSocksEnabled", port: "#inboundSocksPort", label: "SOCKS5" },
  mixed: { enabled: "#inboundMixedEnabled", port: "#inboundMixedPort", label: "Mixed" },
  redir: { enabled: "#inboundRedirEnabled", port: "#inboundRedirPort", label: "Redir" },
  tproxy: { enabled: "#inboundTproxyEnabled", port: "#inboundTproxyPort", label: "TProxy" },
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

document.querySelector("#setupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSetup(event.submitter);
});

document.querySelector("#testSetupBtn").addEventListener("click", async (event) => {
  await testSetup(event.currentTarget);
});

document.querySelectorAll("[name='setupMode']").forEach((element) => {
  element.addEventListener("change", updateSetupVisibility);
});

document.querySelector("#setupAuth").addEventListener("change", updateSetupVisibility);

document.querySelector("#navTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  setView(button.dataset.view);
});

document.querySelector("#refreshBtn").addEventListener("click", () => refreshStatus());

document.body.addEventListener("click", async (event) => {
  const runButton = event.target.closest("[data-run]");
  if (runButton) {
    await runCommand(runButton.dataset.run, runButton);
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    await runAction(actionButton.dataset.action, actionButton);
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

document.querySelector("#coreProxyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveCoreProxySettings(event.submitter);
});

document.querySelector("#reloadCoreProxySettingsBtn").addEventListener("click", async (event) => {
  await loadCoreProxySettings(true, event.currentTarget);
});

document.querySelectorAll("[data-inbound-toggle]").forEach((element) => {
  element.addEventListener("change", updateInboundPortStates);
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
  const delayButton = event.target.closest("[data-proxy-delay]");
  if (delayButton) {
    await testSingleNodeDelay(delayButton.dataset.proxyDelay);
    return;
  }

  const selectButton = event.target.closest("[data-proxy-select]");
  if (!selectButton) return;
  await selectProxyNode(selectButton.dataset.proxyGroup, selectButton.dataset.proxySelect, selectButton);
});

const initialConfig = await loadConfig();
if (initialConfig?.setupRequired) {
  showSetup();
} else {
  showApp();
  await loadSubscriptionSettings();
  await refreshStatus();
}

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
  if (view === "proxy" && !state.mihomoProxySettings) {
    loadCoreProxySettings();
  }
}

async function loadConfig() {
  const payload = await requestJson("/api/config", { timeoutMs: 8_000 });
  if (!payload.ok) {
    setConnection(false, payload.error || "连接配置读取失败");
    return null;
  }
  const { host, port, user, mode, auth } = payload.data;
  state.setupRequired = Boolean(payload.data.setupRequired);
  if (state.setupRequired) {
    return payload.data;
  }
  const localMode = mode === "local";
  document.querySelector("#serverLabel").textContent = localMode ? "本地管理" : `${user}@${host}:${port}`;
  document.querySelector("#configHost").textContent = localMode ? "本机环境" : `${host}:${port}`;
  document.querySelector("#configUser").textContent = localMode ? "当前进程" : user;
  document.querySelector("#configScript").textContent = localMode ? "local" : `remote-ssh-${auth || "key"}`;
  return payload.data;
}

function showSetup() {
  document.querySelector("#setupScreen").classList.remove("is-hidden");
  document.querySelector("#appShell").classList.add("is-hidden");
  updateSetupVisibility();
}

function showApp() {
  document.querySelector("#setupScreen").classList.add("is-hidden");
  document.querySelector("#appShell").classList.remove("is-hidden");
}

function updateSetupVisibility() {
  const mode = document.querySelector("[name='setupMode']:checked")?.value || "local";
  const auth = document.querySelector("#setupAuth").value;
  document.querySelector("#remoteSetupFields").classList.toggle("is-hidden", mode !== "remote");
  document.querySelector("#setupKeyField").classList.toggle("is-hidden", mode !== "remote" || auth !== "key");
  document.querySelector("#setupPasswordField").classList.toggle("is-hidden", mode !== "remote" || auth !== "password");
}

function readSetupConfig() {
  const mode = document.querySelector("[name='setupMode']:checked")?.value || "local";
  return {
    mode,
    auth: document.querySelector("#setupAuth").value,
    host: document.querySelector("#setupHost").value.trim(),
    port: document.querySelector("#setupPort").value.trim() || "22",
    user: document.querySelector("#setupUser").value.trim() || "root",
    identityFile: document.querySelector("#setupIdentityFile").value.trim(),
    password: document.querySelector("#setupPassword").value,
  };
}

async function testSetup(button = null) {
  const output = document.querySelector("#setupResult");
  setButtonLoading(button, true);
  output.textContent = "正在测试连接...";
  try {
    const payload = await requestJson("/api/setup/test", {
      method: "POST",
      body: readSetupConfig(),
      timeoutMs: 35_000,
    });
    writeSetupResult(payload);
    notifyPayload(payload);
    return payload;
  } catch (error) {
    output.textContent = error.message;
    toast("连接测试失败", "error", error.message);
    return null;
  } finally {
    setButtonLoading(button, false);
  }
}

async function saveSetup(button = null) {
  const output = document.querySelector("#setupResult");
  setButtonLoading(button, true);
  output.textContent = "正在测试并保存配置...";
  try {
    const payload = await requestJson("/api/setup/save", {
      method: "POST",
      body: readSetupConfig(),
      timeoutMs: 35_000,
    });
    writeSetupResult(payload);
    notifyPayload(payload);
    if (payload.ok) {
      const nextConfig = await loadConfig();
      if (!nextConfig?.setupRequired) {
        showApp();
        await loadSubscriptionSettings();
        await refreshStatus();
      }
    }
    return payload;
  } catch (error) {
    output.textContent = error.message;
    toast("初始化保存失败", "error", error.message);
    return null;
  } finally {
    setButtonLoading(button, false);
  }
}

function writeSetupResult(payload) {
  const lines = [];
  if (payload.stdout) lines.push(payload.stdout.trimEnd());
  if (payload.stderr) lines.push(payload.stderr.trimEnd());
  if (payload.error) lines.push(payload.error);
  document.querySelector("#setupResult").textContent = lines.join("\n\n") || (payload.ok ? "完成。" : "失败。");
}

async function loadSubscriptionSettings() {
  try {
    const payload = await requestJson("/api/subscription/settings");
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

async function loadCoreProxySettings(force = false, button = null) {
  if (state.mihomoProxySettings && !force) {
    renderCoreProxySettings(state.mihomoProxySettings);
    return;
  }
  setButtonLoading(button, true);
  document.querySelector("#coreProxySummary").textContent = "正在读取当前代理入口...";
  try {
    const payload = await requestJson("/api/mihomo/proxy-settings", { timeoutMs: 60_000 });
    if (!payload.ok) throw new Error(payload.error || payload.stderr || "读取 Mihomo 代理配置失败");
    state.mihomoProxySettings = payload.data;
    renderCoreProxySettings(payload.data);
  } catch (error) {
    document.querySelector("#coreProxySummary").textContent = error.message;
    toast("读取内核代理配置失败", "error", error.message);
  } finally {
    setButtonLoading(button, false);
  }
}

function renderCoreProxySettings(data) {
  document.querySelector("#coreProxyMode").value = data.mode || "Rule";
  document.querySelector("#coreBindAddress").value = data.bindAddress || "127.0.0.1";
  document.querySelector("#coreAllowLan").checked = Boolean(data.allowLan);
  for (const [name, fields] of Object.entries(inboundFieldMap)) {
    const inbound = data.inbounds?.[name] || {};
    document.querySelector(fields.enabled).checked = Boolean(inbound.enabled);
    document.querySelector(fields.port).value = inbound.port || inbound.defaultPort || "";
  }
  const tun = data.tun || {};
  document.querySelector("#tunEnabled").checked = Boolean(tun.enabled);
  document.querySelector("#tunStack").value = tun.stack || "system";
  document.querySelector("#tunAutoRoute").checked = Boolean(tun.autoRoute);
  document.querySelector("#tunStrictRoute").checked = Boolean(tun.strictRoute);
  document.querySelector("#tunDnsHijack").value = tun.dnsHijack || "any:53";
  updateInboundPortStates();
  writeCoreProxySummary(data);
}

function updateInboundPortStates() {
  for (const fields of Object.values(inboundFieldMap)) {
    const enabled = document.querySelector(fields.enabled).checked;
    const portInput = document.querySelector(fields.port);
    portInput.disabled = state.busy || !enabled;
  }
}

function readCoreProxySettings() {
  const inbounds = {};
  for (const [name, fields] of Object.entries(inboundFieldMap)) {
    inbounds[name] = {
      enabled: document.querySelector(fields.enabled).checked,
      port: Number(document.querySelector(fields.port).value || 0),
    };
  }
  return {
    mode: document.querySelector("#coreProxyMode").value,
    bindAddress: document.querySelector("#coreBindAddress").value.trim() || "127.0.0.1",
    allowLan: document.querySelector("#coreAllowLan").checked,
    inbounds,
    tun: {
      enabled: document.querySelector("#tunEnabled").checked,
      stack: document.querySelector("#tunStack").value,
      autoRoute: document.querySelector("#tunAutoRoute").checked,
      strictRoute: document.querySelector("#tunStrictRoute").checked,
      dnsHijack: document.querySelector("#tunDnsHijack").value.trim() || "any:53",
    },
  };
}

async function saveCoreProxySettings(button = null) {
  const body = readCoreProxySettings();
  const enabled = Object.values(body.inbounds).filter((item) => item.enabled);
  if (!enabled.length && !body.tun.enabled) {
    toast("至少启用一种 Mihomo 代理入口", "error");
    return;
  }
  const result = await postJson("/api/mihomo/proxy-settings", body, "proxy", button);
  if (!result?.ok) return;
  state.mihomoProxySettings = null;
  await loadCoreProxySettings(true);
  await refreshStatus();
}

function writeCoreProxySummary(data) {
  const enabled = [];
  for (const [name, fields] of Object.entries(inboundFieldMap)) {
    const inbound = data.inbounds?.[name];
    if (inbound?.enabled) enabled.push(`${fields.label}:${inbound.port}`);
  }
  if (data.tun?.enabled) enabled.push(`TUN:${data.tun.stack || "system"}`);
  document.querySelector("#coreProxySummary").textContent = enabled.length
    ? `${data.mode || "Rule"} · ${enabled.join(" · ")}`
    : `${data.mode || "Rule"} · 未启用入口`;
}

async function refreshStatus() {
  const result = await fetchResult("/api/run?command=status", "dashboard", false);
  if (!result) return;
  updateMetrics(result.stdout || "");
  setConnection(result.ok, result.ok ? "已连接" : "连接异常");
}

async function runCommand(command, button = null) {
  const target = commandTarget[command] || state.activeView;
  const result = await fetchResult(`/api/run?command=${encodeURIComponent(command)}`, target, true, button);
  if (command === "status" && result) {
    updateMetrics(result.stdout || "");
  }
}

async function runAction(action, button = null) {
  const target = actionTarget[action] || state.activeView;
  const result = await postJson("/api/action", { action }, target, button);
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

async function requestJson(url, options = {}) {
  const {
    method = "GET",
    body,
    timeoutMs = 120_000,
    retries = 0,
  } = options;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok && payload.ok !== false) {
        payload.ok = false;
        payload.error = `HTTP ${response.status}`;
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await sleep(400 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchResult(url, target, showToast = true, button = null) {
  setBusy(true);
  setButtonLoading(button, true);
  writeOutput(target, "正在执行...");
  try {
    const payload = await requestJson(url);
    writeResult(target, payload);
    if (showToast) notifyPayload(payload);
    return payload;
  } catch (error) {
    const payload = { ok: false, error: error.message };
    writeResult(target, payload);
    if (showToast) toast("请求失败", "error", error.message);
    return payload;
  } finally {
    setButtonLoading(button, false);
    setBusy(false);
  }
}

async function postJson(url, body, target, button = null) {
  setBusy(true);
  setButtonLoading(button, true);
  writeOutput(target, "正在执行...");
  try {
    const payload = await requestJson(url, {
      method: "POST",
      body,
    });
    writeResult(target, payload);
    notifyPayload(payload);
    return payload;
  } catch (error) {
    const payload = { ok: false, error: error.message };
    writeResult(target, payload);
    toast("请求失败", "error", error.message);
    return payload;
  } finally {
    setButtonLoading(button, false);
    setBusy(false);
  }
}

function notifyPayload(payload) {
  if (payload?.ok) {
    toast("操作完成", "success");
    return;
  }
  const friendly = friendlyError(payload);
  toast(friendly.title, "error", friendly.detail);
}

function friendlyError(payload = {}) {
  const detail = [payload.error, payload.stderr, payload.stdout]
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const source = detail.toLowerCase();
  if (/port\s+7890.*in use|address already in use|bind: address already in use/i.test(detail)) {
    return {
      title: "端口 7890 已被占用，请检查是否有其他代理服务正在运行。",
      detail,
    };
  }
  if (/yaml:|unmarshal|did not find expected|cannot unmarshal/i.test(detail)) {
    return {
      title: "配置文件格式错误，请检查 YAML 语法或刚新增的规则。",
      detail,
    };
  }
  if (/subscription url is not set|订阅链接未设置/i.test(detail)) {
    return {
      title: "订阅链接未设置，请先在订阅页保存订阅地址。",
      detail,
    };
  }
  if (/permission denied|publickey|authentication failed/i.test(detail)) {
    return {
      title: "SSH 认证失败，请检查服务器地址、用户、密码或私钥权限。",
      detail,
    };
  }
  if (/sshpass|spawn sshpass/i.test(detail)) {
    return {
      title: "当前环境缺少 sshpass，无法使用 SSH 密码模式。",
      detail,
    };
  }
  if (/controller unavailable|connection refused|127\.0\.0\.1:9090/i.test(source)) {
    return {
      title: "Mihomo 控制接口不可用，请确认服务已启动且 external-controller 为 127.0.0.1:9090。",
      detail,
    };
  }
  if (/no working proxy found/i.test(detail)) {
    return {
      title: "没有找到可用节点，请先更新订阅或手动测试节点延迟。",
      detail,
    };
  }
  return {
    title: payload.error || "操作失败，请查看详情。",
    detail,
  };
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
    const payload = await requestJson("/api/proxies");
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
    toast("读取代理组失败", "error", error.message);
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
    const delay = state.testingDelayNodes.has(option)
      ? "testing"
      : hasMeasuredDelay ? state.proxyDelays[option] : node.delay;
    const active = option === group.now;
    const delayState = delayClass(delay, hasMeasuredDelay);
    const testingNode = state.testingDelayNodes.has(option);
    const delayDisabled = state.busy || state.testingDelays || testingNode ? " disabled" : "";
    const selectDisabled = state.busy ? " disabled" : "";
    const card = document.createElement("article");
    card.className = `node-card${active ? " active" : ""}`;
    card.innerHTML = `
      <div class="node-main">
        <span class="node-title">${escapeHtml(option)}</span>
        <span class="node-meta">${escapeHtml(node.type || "Node")}${active ? " · 当前" : ""}</span>
      </div>
      <span class="node-delay ${delayState}">${formatDelay(delay)}</span>
      <div class="node-actions">
        <button class="ghost-button node-action${testingNode ? " loading" : ""}" data-proxy-delay="${escapeAttribute(option)}" type="button"${delayDisabled}>测速</button>
        <button class="node-action${active ? " active-choice" : ""}" data-proxy-group="${escapeAttribute(group.name)}" data-proxy-select="${escapeAttribute(option)}" type="button"${selectDisabled}>${active ? "已选" : "选择"}</button>
      </div>
    `;
    nodesContainer.appendChild(card);
  }
  document.querySelector("#delayGroupBtn").disabled = state.busy || state.testingDelays;
}

async function selectProxyNode(group, name, button = null) {
  setBusy(true);
  setButtonLoading(button, true);
  try {
    const payload = await requestJson("/api/proxies/select", {
      method: "POST",
      body: { group, name },
    });
    if (!payload.ok) throw new Error(payload.error || payload.stderr || "切换节点失败");
    toast(`已切换：${name}`, "success");
    await loadProxies(true);
  } catch (error) {
    toast("切换节点失败", "error", error.message);
  } finally {
    setButtonLoading(button, false);
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
      state.testingDelayNodes.add(name);
      state.proxyProgressText = `正在测试 ${doneCount + 1}/${names.length}：${name}`;
      renderProxies();
      const delay = await testProxyDelay(name);
      state.testingDelayNodes.delete(name);
      state.proxyDelays[name] = delay;
      if (delay) okCount += 1;
      doneCount += 1;
      state.proxyProgressText = `已测试 ${doneCount}/${names.length}，可用 ${okCount}`;
      renderProxies();
    }
    toast(`测速完成：${okCount}/${names.length} 可用`);
  } catch (error) {
    toast("测速失败", "error", error.message);
  } finally {
    state.testingDelays = false;
    state.testingDelayNodes.clear();
    state.proxyProgressText = "";
    renderProxies();
  }
}

async function testSingleNodeDelay(name) {
  if (!name || state.testingDelayNodes.has(name)) return;
  state.testingDelayNodes.add(name);
  renderProxies();
  try {
    const delay = await testProxyDelay(name);
    state.proxyDelays[name] = delay;
    toast(delay ? `${name}：${formatDelay(delay)}` : `${name}：超时`, delay ? "success" : "error");
  } catch (error) {
    state.proxyDelays[name] = null;
    toast("测速失败", "error", error.message);
  } finally {
    state.testingDelayNodes.delete(name);
    renderProxies();
  }
}

async function testProxyDelay(name) {
  const payload = await requestJson("/api/proxies/delays", {
    method: "POST",
    body: { names: [name] },
    timeoutMs: 15_000,
  });
  if (!payload.ok) throw new Error(payload.error || payload.stderr || "测速失败");
  return payload.data.delays[name] || null;
}

async function loadRules() {
  setBusy(true);
  document.querySelector("#rulesSummary").textContent = "正在读取规则...";
  document.querySelector("#ruleStats").innerHTML = "";
  document.querySelector("#ruleList").textContent = "";
  try {
    const payload = await requestJson("/api/rules");
    if (!payload.ok) throw new Error(payload.error || payload.stderr || "读取规则失败");
    renderRules(payload.data);
    toast("规则已读取");
  } catch (error) {
    document.querySelector("#rulesSummary").textContent = error.message;
    toast("读取规则失败", "error", error.message);
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
      const payload = await requestJson("/api/proxies");
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

function delayClass(delay, hasMeasuredDelay = false) {
  if (delay === "testing") return "pending";
  if (delay === null && hasMeasuredDelay) return "slow";
  if (!delay) return "";
  if (delay < 50) return "fast";
  if (delay < 200) return "medium";
  return "slow";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function updateMetrics(text) {
  const service = extractLine(text, ["Mihomo 服务：", "Mihomo service: "]);
  const timer = extractLine(text, ["订阅定时更新：", "Subscription timer: "]);
  const shellProxy = extractLine(text, ["系统 shell 代理：", "System shell proxy: "]);
  const aptProxy = extractLine(text, ["APT 代理：", "APT proxy: "]);
  const hasCoreListener = /LISTEN\s+.*(?:mihomo|:9090\b)/i.test(text);

  document.querySelector("#serviceMetric").textContent = compact(service);
  document.querySelector("#timerMetric").textContent = compact(timer);
  document.querySelector("#systemProxyMetric").textContent =
    [shellProxy, aptProxy].some((line) => /已启用|enabled/i.test(line)) ? "已启用" : "未启用";
  document.querySelector("#proxychainsMetric").textContent = hasCoreListener ? "已监听" : "未监听";
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
    if (element.classList.contains("nav-item")) return;
    element.disabled = busy;
  });
  if (document.querySelector("#coreProxyForm")) {
    updateInboundPortStates();
  }
}

function setButtonLoading(button, loading) {
  if (!button) return;
  button.classList.toggle("loading", loading);
  button.disabled = loading;
}

let toastTimer;
function toast(message, type = "info", detail = "") {
  const element = document.querySelector("#toast");
  element.className = `toast ${type}`;
  element.innerHTML = "";

  const content = document.createElement("div");
  content.className = "toast-content";
  const title = document.createElement("strong");
  title.textContent = message;
  content.appendChild(title);

  if (detail) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "查看详情";
    const pre = document.createElement("pre");
    pre.textContent = detail;
    details.appendChild(summary);
    details.appendChild(pre);
    content.appendChild(details);
  }

  const close = document.createElement("button");
  close.className = "toast-close";
  close.type = "button";
  close.textContent = "关闭";
  close.addEventListener("click", () => element.classList.remove("show"), { once: true });

  element.appendChild(content);
  element.appendChild(close);
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), detail ? 9000 : 2600);
}
