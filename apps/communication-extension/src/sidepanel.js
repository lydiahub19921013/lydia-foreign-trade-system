import { detectScenario, getScenario } from "./core/scenarios.js";
import { buildAIChatMessages, createTemplateReply, extractChatCompletionText } from "./core/reply.js";
import {
  STORAGE_KEY,
  addReplyHistory,
  createInitialState,
  exportPortableData,
  importPortableData,
  migrateState,
  removeReplyHistory,
  upsertCustomer
} from "./core/data.js";

const $ = (selector) => document.querySelector(selector);
const extensionApi = window.chrome?.storage?.local ? window.chrome : null;
let state = createInitialState();
let activeScenario = getScenario("inquiry");

function setStatus(message, type = "neutral") {
  const element = $("#status");
  element.textContent = message;
  element.className = `status${type === "neutral" ? "" : ` ${type}`}`;
}

async function persistState() {
  if (extensionApi) await extensionApi.storage.local.set({ [STORAGE_KEY]: state });
}

function readCustomerForm() {
  return {
    id: $("#customerId").value || crypto.randomUUID(),
    name: $("#customerName").value,
    company: $("#customerCompany").value,
    country: $("#customerCountry").value,
    notes: $("#customerNotes").value
  };
}

function customerHasContent(customer) {
  return Boolean(customer.name.trim() || customer.company.trim() || customer.country.trim() || customer.notes.trim());
}

function clearCustomerForm() {
  $("#customerId").value = "";
  $("#customerSelect").value = "";
  $("#customerName").value = "";
  $("#customerCompany").value = "";
  $("#customerCountry").value = "";
  $("#customerNotes").value = "";
}

function fillCustomerForm(customer) {
  if (!customer) {
    clearCustomerForm();
    return;
  }

  $("#customerId").value = customer.id;
  $("#customerSelect").value = customer.id;
  $("#customerName").value = customer.name;
  $("#customerCompany").value = customer.company;
  $("#customerCountry").value = customer.country;
  $("#customerNotes").value = customer.notes;
}

function renderCustomers(selectedId = $("#customerId")?.value ?? "") {
  const select = $("#customerSelect");
  select.replaceChildren(new Option("未关联客户", ""));

  for (const customer of state.customers) {
    const label = [customer.name, customer.company, customer.country].filter(Boolean).join(" · ") || "未命名客户";
    select.add(new Option(label, customer.id));
  }

  if (state.customers.some((customer) => customer.id === selectedId)) {
    select.value = selectedId;
  }
}

function renderScenario(result) {
  activeScenario = result;
  $("#scenarioResult").classList.remove("muted");
  $("#scenarioLabel").textContent = `${result.label} · ${Math.round(result.confidence * 100)}%`;
  $("#scenarioHint").textContent = result.evidence?.length
    ? `依据：${result.evidence.slice(0, 3).join("、")}`
    : result.hint;
}

function renderHistory() {
  const list = $("#historyList");
  list.replaceChildren();
  $("#historyCount").textContent = `${state.replyHistory.length} 条`;

  if (!state.replyHistory.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "还没有回复记录。生成第一条回复后会自动保存在这里。";
    list.append(empty);
    return;
  }

  for (const item of state.replyHistory.slice(0, 20)) {
    const article = document.createElement("article");
    article.className = "history-item";
    article.dataset.id = item.id;

    const meta = document.createElement("div");
    meta.className = "history-meta";
    const scenario = document.createElement("strong");
    scenario.textContent = getScenario(item.scenarioId).label;
    const date = document.createElement("time");
    date.textContent = new Date(item.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    meta.append(scenario, date);

    const preview = document.createElement("p");
    preview.className = "history-preview";
    preview.textContent = item.inbound.slice(0, 110) || item.reply.slice(0, 110);

    const actions = document.createElement("div");
    actions.className = "history-actions";
    const provider = document.createElement("span");
    provider.className = "badge";
    provider.textContent = item.provider === "ai" ? "AI" : "离线模板";
    const buttons = document.createElement("div");
    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.dataset.action = "load";
    loadButton.textContent = "载入";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete";
    deleteButton.textContent = "删除";
    buttons.append(loadButton, deleteButton);
    actions.append(provider, buttons);

    article.append(meta, preview, actions);
    list.append(article);
  }
}

function renderStats() {
  $("#dataSummary").textContent = `${state.customers.length} 位客户 · ${state.replyHistory.length} 条回复`;
}

function fillSettings() {
  $("#industryProfile").value = state.settings.industryProfile;
  $("#companyProfile").value = state.settings.companyProfile;
  $("#signature").value = state.settings.signature;
  $("#tone").value = state.settings.tone;
  $("#mode").value = state.settings.mode;
  $("#aiEnabled").checked = state.settings.ai.enabled;
  $("#aiEndpoint").value = state.settings.ai.endpoint;
  $("#aiModel").value = state.settings.ai.model;
  $("#aiKey").value = state.settings.ai.apiKey;
}

function readSettingsForm() {
  state.settings = {
    industryProfile: $("#industryProfile").value.trim(),
    companyProfile: $("#companyProfile").value.trim(),
    signature: $("#signature").value.trim(),
    tone: $("#tone").value,
    mode: $("#mode").value,
    ai: {
      enabled: $("#aiEnabled").checked,
      endpoint: $("#aiEndpoint").value.trim(),
      model: $("#aiModel").value.trim(),
      apiKey: $("#aiKey").value.trim()
    }
  };
}

async function saveCustomer({ quiet = false } = {}) {
  const customer = readCustomerForm();
  if (!customerHasContent(customer)) return null;

  const result = upsertCustomer(state, customer);
  state = result.state;
  fillCustomerForm(result.customer);
  renderCustomers(result.customer.id);
  renderStats();
  await persistState();
  if (!quiet) setStatus("客户资料已保存在本机。", "success");
  return result.customer;
}

function validateEndpoint(rawEndpoint) {
  let url;
  try {
    url = new URL(rawEndpoint);
  } catch {
    throw new Error("AI 接口地址格式不正确");
  }

  const isLocal = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error("远程 AI 接口必须使用 HTTPS；HTTP 只允许本机地址");
  }
  return url;
}

async function requestApiOrigin(url) {
  if (!extensionApi) throw new Error("AI 接口只能在安装后的插件中调用");
  const origin = `${url.origin}/*`;
  const alreadyGranted = await extensionApi.permissions.contains({ origins: [origin] });
  if (alreadyGranted) return;

  const granted = await extensionApi.permissions.request({ origins: [origin] });
  if (!granted) throw new Error("没有获得该 AI 接口域名的访问权限");
}

async function generateWithAI({ message, customer }) {
  const { endpoint, model, apiKey } = state.settings.ai;
  if (!endpoint || !model || !apiKey) {
    throw new Error("请先在设置中填写接口地址、模型名称和 API Key");
  }

  const url = validateEndpoint(endpoint);
  await requestApiOrigin(url);
  const response = await fetch(url.href, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: buildAIChatMessages({
        message,
        scenarioId: activeScenario.id,
        customer,
        settings: state.settings,
        mode: state.settings.mode,
        tone: state.settings.tone
      }),
      temperature: 0.3
    })
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`AI 接口返回了无法读取的内容（HTTP ${response.status}）`);
  }

  if (!response.ok) {
    throw new Error(payload?.error?.message || `AI 接口请求失败（HTTP ${response.status}）`);
  }
  return extractChatCompletionText(payload);
}

async function generateReply() {
  const button = $("#generate");
  const message = $("#message").value.trim();
  if (!message) {
    setStatus("请先粘贴一条客户消息。", "error");
    $("#message").focus();
    return;
  }

  renderScenario(detectScenario(message));
  readSettingsForm();
  const customer = await saveCustomer({ quiet: true }) ?? readCustomerForm();
  button.disabled = true;
  button.textContent = state.settings.ai.enabled ? "AI 正在生成……" : "正在生成……";

  try {
    const provider = state.settings.ai.enabled ? "ai" : "template";
    const reply = provider === "ai"
      ? await generateWithAI({ message, customer })
      : createTemplateReply({
          scenarioId: activeScenario.id,
          customer,
          settings: state.settings,
          mode: state.settings.mode,
          tone: state.settings.tone
        });

    $("#reply").value = reply;
    $("#providerBadge").textContent = provider === "ai" ? "自己的 AI 接口" : "离线模板";
    const historyResult = addReplyHistory(state, {
      customerId: customerHasContent(customer) ? customer.id : "",
      inbound: message,
      scenarioId: activeScenario.id,
      reply,
      mode: state.settings.mode,
      provider
    });
    state = historyResult.state;
    await persistState();
    renderHistory();
    renderStats();
    setStatus(provider === "ai" ? "AI 回复已生成并保存在本机，请核对事实后发送。" : "离线回复已生成并保存在本机，请核对事实后发送。", "success");
  } catch (error) {
    setStatus(error.message || "生成失败，请检查设置后重试。", "error");
  } finally {
    button.disabled = false;
    button.textContent = "生成英文回复";
  }
}

async function copyReply() {
  const reply = $("#reply").value.trim();
  if (!reply) {
    setStatus("还没有可复制的回复。", "error");
    return;
  }
  await navigator.clipboard.writeText(reply);
  setStatus("回复已复制。", "success");
}

function downloadBackup() {
  const payload = exportPortableData(state);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `外贸开发插件-备份-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus("备份已导出，API Key 未包含在文件中。", "success");
}

async function importBackup(file) {
  const payload = JSON.parse(await file.text());
  state = importPortableData(payload, state);
  await persistState();
  clearCustomerForm();
  renderCustomers();
  renderHistory();
  renderStats();
  fillSettings();
  setStatus("备份已导入。出于安全考虑，AI 功能保持关闭。", "success");
}

function bindEvents() {
  $("#detect").addEventListener("click", () => {
    const message = $("#message").value.trim();
    if (!message) {
      setStatus("请先粘贴一条客户消息。", "error");
      return;
    }
    renderScenario(detectScenario(message));
    setStatus("场景已识别；你仍可以根据业务判断调整回复。", "success");
  });
  $("#generate").addEventListener("click", generateReply);
  $("#copyReply").addEventListener("click", () => copyReply().catch((error) => setStatus(error.message, "error")));
  $("#saveCustomer").addEventListener("click", () => saveCustomer());
  $("#newCustomer").addEventListener("click", clearCustomerForm);
  $("#clearDraft").addEventListener("click", () => {
    $("#message").value = "";
    $("#reply").value = "";
    $("#scenarioResult").classList.add("muted");
    $("#scenarioLabel").textContent = "等待识别";
    $("#scenarioHint").textContent = "粘贴消息后可自动判断沟通阶段";
    $("#providerBadge").textContent = "尚未生成";
  });

  $("#customerSelect").addEventListener("change", (event) => {
    const customer = state.customers.find((item) => item.id === event.target.value);
    fillCustomerForm(customer);
  });

  $("#saveSettings").addEventListener("click", async () => {
    readSettingsForm();
    state = migrateState(state);
    await persistState();
    fillSettings();
    setStatus(state.settings.ai.enabled ? "设置已保存。AI 只会在你点击生成时调用。" : "设置已保存，当前保持离线模式。", "success");
  });

  $("#clearKey").addEventListener("click", async () => {
    $("#aiKey").value = "";
    $("#aiEnabled").checked = false;
    readSettingsForm();
    await persistState();
    setStatus("API Key 已从本机设置中清除。", "success");
  });

  $("#exportData").addEventListener("click", downloadBackup);
  $("#importData").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      await importBackup(file);
    } catch (error) {
      setStatus(error.message || "备份导入失败。", "error");
    } finally {
      event.target.value = "";
    }
  });

  $("#historyList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    const article = event.target.closest(".history-item");
    if (!button || !article) return;
    const item = state.replyHistory.find((entry) => entry.id === article.dataset.id);
    if (!item) return;

    if (button.dataset.action === "load") {
      $("#message").value = item.inbound;
      $("#reply").value = item.reply;
      $("#mode").value = item.mode;
      $("#providerBadge").textContent = item.provider === "ai" ? "自己的 AI 接口" : "离线模板";
      renderScenario({ ...getScenario(item.scenarioId), confidence: 1, evidence: [] });
      fillCustomerForm(state.customers.find((customer) => customer.id === item.customerId));
      window.scrollTo({ top: 0, behavior: "smooth" });
      setStatus("历史记录已载入。", "success");
    }

    if (button.dataset.action === "delete") {
      state = removeReplyHistory(state, item.id);
      await persistState();
      renderHistory();
      renderStats();
      setStatus("这条回复记录已删除。", "success");
    }
  });
}

async function initialize() {
  const stored = extensionApi
    ? await extensionApi.storage.local.get([STORAGE_KEY, "pendingSelection"])
    : {};
  state = migrateState(stored[STORAGE_KEY]);
  await persistState();
  fillSettings();
  renderCustomers();
  renderHistory();
  renderStats();
  bindEvents();

  if (!extensionApi) {
    setStatus("界面预览模式：功能可试用，但刷新后不会保存数据。", "success");
  }

  if (stored.pendingSelection) {
    $("#message").value = stored.pendingSelection;
    renderScenario(detectScenario(stored.pendingSelection));
    await extensionApi.storage.local.remove("pendingSelection");
    setStatus("已载入网页中选中的客户消息。", "success");
  }
}

initialize().catch((error) => setStatus(`初始化失败：${error.message}`, "error"));
