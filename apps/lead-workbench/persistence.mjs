export const WORKBENCH_SNAPSHOT_FORMAT = "lydia-workbench-snapshot";
export const WORKBENCH_SNAPSHOT_SCHEMA_VERSION = 1;
export const WORKSPACE_INDEX_FORMAT = "lydia-workspace-index";
export const WORKSPACE_INDEX_SCHEMA_VERSION = 1;
export const WORKSPACE_REFERENCE_FORMAT = "lydia-workspace-reference";
export const DEFAULT_WORKSPACE_NAME = "我的客户 1";
export const PERSISTED_UI_FIELD_IDS = Object.freeze([
  "channel",
  "gradeFilter",
  "developmentFilter",
  "prospectProduct",
  "prospectMarket",
  "prospectBuyerType",
  "prospectApplication",
  "companyQuery",
  "companyJurisdiction",
  "companyTargetLead",
  "websiteUrl",
  "websiteTargetLead",
  "emailContactName",
  "emailDomain",
  "emailTargetLead"
]);

const DEFAULT_DATABASE_NAME = "lydia-foreign-trade-system";
const DEFAULT_STORE_NAME = "workbench-snapshots";
const LEGACY_SNAPSHOT_KEY = "current";
const WORKSPACE_INDEX_KEY = "workspace-index";
const LEGACY_WORKSPACE_ID = "ws_legacy_current";
const MAX_WORKSPACES = 50;
const PERSISTED_STATE_FIELDS = [
  "currentResult",
  "currentProspectPlan",
  "currentProspectResult",
  "currentProspectForWebsite",
  "currentCompanyResearch",
  "currentWebsiteResearch",
  "currentEmailResearch",
  "currentRelationshipResult"
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function normalizedDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${field}无效`);
  return date.toISOString();
}

export function normalizeWorkspaceName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new Error("客户空间名称不能为空");
  if (name.length > 60) throw new Error("客户空间名称不能超过 60 个字符");
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error("客户空间名称包含不支持的字符");
  return name;
}

function normalizeWorkspaceId(value) {
  const id = String(value ?? "");
  if (!/^ws_[a-zA-Z0-9_-]{4,80}$/.test(id)) throw new Error("客户空间编号无效");
  return id;
}

function normalizeWorkspace(input) {
  if (!isObject(input)) throw new Error("客户空间记录格式不正确");
  return {
    id: normalizeWorkspaceId(input.id),
    name: normalizeWorkspaceName(input.name),
    createdAt: normalizedDate(input.createdAt, "客户空间创建时间"),
    updatedAt: normalizedDate(input.updatedAt || input.createdAt, "客户空间更新时间")
  };
}

function persistenceState(input) {
  const state = {};
  for (const field of PERSISTED_STATE_FIELDS) state[field] = clone(input[field] ?? null);
  state.selectedWebsiteEvidenceIds = (Array.isArray(input.selectedWebsiteEvidenceIds)
    ? input.selectedWebsiteEvidenceIds
    : [])
    .filter((id) => typeof id === "string")
    .slice(0, 500);
  const ui = isObject(input.ui) ? input.ui : {};
  state.ui = Object.fromEntries(PERSISTED_UI_FIELD_IDS.map((id) => [
    id,
    typeof ui[id] === "string" ? ui[id].slice(0, 2000) : ""
  ]));
  return state;
}

export function createWorkbenchSnapshot(state, options = {}) {
  if (!isObject(state)) throw new Error("工作台状态格式不正确");
  const savedAt = new Date(options.savedAt || Date.now()).toISOString();
  return {
    format: WORKBENCH_SNAPSHOT_FORMAT,
    schemaVersion: WORKBENCH_SNAPSHOT_SCHEMA_VERSION,
    savedAt,
    state: persistenceState(state)
  };
}

export function normalizeWorkbenchSnapshot(input) {
  if (!isObject(input) || input.format !== WORKBENCH_SNAPSHOT_FORMAT) {
    throw new Error("本机工作台快照格式不正确");
  }
  const schemaVersion = Number(input.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error("本机工作台快照缺少有效版本");
  }
  if (schemaVersion > WORKBENCH_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("本机数据来自更新版本，请先升级 Lydia 外贸系统");
  }
  if (!isObject(input.state)) throw new Error("本机工作台快照缺少状态数据");
  const savedAt = new Date(input.savedAt);
  if (Number.isNaN(savedAt.valueOf())) throw new Error("本机工作台快照保存时间无效");
  return {
    format: WORKBENCH_SNAPSHOT_FORMAT,
    schemaVersion,
    savedAt: savedAt.toISOString(),
    state: persistenceState(input.state)
  };
}

export function normalizeWorkspaceIndex(input) {
  if (!isObject(input) || input.format !== WORKSPACE_INDEX_FORMAT) {
    throw new Error("客户空间索引格式不正确");
  }
  const schemaVersion = Number(input.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error("客户空间索引缺少有效版本");
  }
  if (schemaVersion > WORKSPACE_INDEX_SCHEMA_VERSION) {
    throw new Error("客户空间数据来自更新版本，请先升级 Lydia 外贸系统");
  }
  if (!Array.isArray(input.workspaces) || !input.workspaces.length) {
    throw new Error("至少需要一个客户空间");
  }
  if (input.workspaces.length > MAX_WORKSPACES) {
    throw new Error(`客户空间不能超过 ${MAX_WORKSPACES} 个`);
  }
  const workspaces = input.workspaces.map(normalizeWorkspace);
  const ids = new Set();
  const names = new Set();
  for (const workspace of workspaces) {
    const normalizedName = workspace.name.toLocaleLowerCase("zh-CN");
    if (ids.has(workspace.id)) throw new Error("客户空间编号重复");
    if (names.has(normalizedName)) throw new Error("客户空间名称不能重复");
    ids.add(workspace.id);
    names.add(normalizedName);
  }
  const activeWorkspaceId = normalizeWorkspaceId(input.activeWorkspaceId);
  if (!ids.has(activeWorkspaceId)) throw new Error("当前客户空间不存在");
  return {
    format: WORKSPACE_INDEX_FORMAT,
    schemaVersion,
    activeWorkspaceId,
    workspaces
  };
}

export function createWorkspaceReference(workspace, options = {}) {
  if (!isObject(workspace)) throw new Error("当前客户空间格式不正确");
  return {
    format: WORKSPACE_REFERENCE_FORMAT,
    schemaVersion: 1,
    id: normalizeWorkspaceId(workspace.id),
    name: normalizeWorkspaceName(workspace.name),
    exportedAt: normalizedDate(options.exportedAt || Date.now(), "客户空间导出时间")
  };
}

export function assertPayloadMatchesWorkspace(payload, activeWorkspace) {
  if (!isObject(payload) || !isObject(payload.workspace) || payload.workspace.format !== WORKSPACE_REFERENCE_FORMAT) return;
  if (!isObject(activeWorkspace)) throw new Error("当前客户空间还没有准备好");
  const activeId = normalizeWorkspaceId(activeWorkspace.id);
  const activeName = normalizeWorkspaceName(activeWorkspace.name);
  const sourceId = normalizeWorkspaceId(payload.workspace.id);
  const sourceName = normalizeWorkspaceName(payload.workspace.name);
  const sameId = sourceId === activeId;
  const sameName = sourceName.toLocaleLowerCase("zh-CN") === activeName.toLocaleLowerCase("zh-CN");
  if (sameId || sameName) return;
  throw new Error(`这个文件属于“${sourceName}”，当前空间是“${activeName}”。为防止串客户，请先切换或新建同名客户空间。`);
}

export function createWorkspaceFilename(workspace, label, options = {}) {
  if (!isObject(workspace)) throw new Error("当前客户空间格式不正确");
  const name = normalizeWorkspaceName(workspace.name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 48);
  const safeLabel = String(label ?? "导出")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 32) || "导出";
  const date = normalizedDate(options.exportedAt || Date.now(), "导出时间").slice(0, 10);
  return `Lydia-${name}-${safeLabel}-${date}.json`;
}

function requestResult(request, errorMessage) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(errorMessage));
  });
}

function transactionFinished(transaction, errorMessage) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(errorMessage));
    transaction.onabort = () => reject(transaction.error || new Error(errorMessage));
  });
}

function workspaceSnapshotKey(workspaceId) {
  return `workspace:${normalizeWorkspaceId(workspaceId)}`;
}

function createWorkspaceId(idFactory) {
  const raw = typeof idFactory === "function"
    ? idFactory()
    : globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return normalizeWorkspaceId(`ws_${String(raw).replace(/[^a-zA-Z0-9_-]/g, "_")}`);
}

export function createIndexedDbPersistence(indexedDb, options = {}) {
  if (!indexedDb || typeof indexedDb.open !== "function") {
    throw new Error("当前浏览器不支持本机自动保存");
  }
  const databaseName = options.databaseName || DEFAULT_DATABASE_NAME;
  const storeName = options.storeName || DEFAULT_STORE_NAME;
  const idFactory = options.idFactory;
  let databasePromise = null;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDb.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error || new Error("无法打开本机数据存储"));
      request.onblocked = () => reject(new Error("本机数据存储正在被另一个页面占用"));
    });
    return databasePromise;
  }

  async function readEntry(key) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    const finished = transactionFinished(transaction, "读取本机工作台数据失败");
    const request = transaction.objectStore(storeName).get(key);
    const [value] = await Promise.all([
      requestResult(request, "无法读取本机工作台数据"),
      finished
    ]);
    return value === undefined ? null : value;
  }

  async function writeEntry(key, value) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    const finished = transactionFinished(transaction, "保存本机工作台数据失败");
    transaction.objectStore(storeName).put(clone(value), key);
    await finished;
  }

  async function deleteEntry(key) {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    const finished = transactionFinished(transaction, "清除本机工作台数据失败");
    transaction.objectStore(storeName).delete(key);
    await finished;
  }

  async function loadWorkspaceIndex() {
    const value = await readEntry(WORKSPACE_INDEX_KEY);
    return value ? normalizeWorkspaceIndex(value) : null;
  }

  async function saveWorkspaceIndex(index) {
    const value = normalizeWorkspaceIndex(index);
    await writeEntry(WORKSPACE_INDEX_KEY, value);
    return value;
  }

  async function initializeWorkspaces() {
    const existing = await loadWorkspaceIndex();
    if (existing) return existing;

    const legacyValue = await readEntry(LEGACY_SNAPSHOT_KEY);
    const legacySnapshot = legacyValue ? normalizeWorkbenchSnapshot(legacyValue) : null;
    const timestamp = legacySnapshot?.savedAt || new Date().toISOString();
    const workspace = {
      id: LEGACY_WORKSPACE_ID,
      name: DEFAULT_WORKSPACE_NAME,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const index = normalizeWorkspaceIndex({
      format: WORKSPACE_INDEX_FORMAT,
      schemaVersion: WORKSPACE_INDEX_SCHEMA_VERSION,
      activeWorkspaceId: workspace.id,
      workspaces: [workspace]
    });

    if (legacySnapshot) await writeEntry(workspaceSnapshotKey(workspace.id), legacySnapshot);
    await writeEntry(WORKSPACE_INDEX_KEY, index);
    if (legacySnapshot) await deleteEntry(LEGACY_SNAPSHOT_KEY);
    return index;
  }

  async function loadWorkspace(workspaceId) {
    const value = await readEntry(workspaceSnapshotKey(workspaceId));
    return value ? normalizeWorkbenchSnapshot(value) : null;
  }

  async function saveWorkspace(workspaceId, snapshot) {
    const id = normalizeWorkspaceId(workspaceId);
    const value = normalizeWorkbenchSnapshot(snapshot);
    const index = await initializeWorkspaces();
    const position = index.workspaces.findIndex((workspace) => workspace.id === id);
    if (position < 0) throw new Error("要保存的客户空间不存在");
    await writeEntry(workspaceSnapshotKey(id), value);
    const workspaces = index.workspaces.map((workspace) => workspace.id === id
      ? { ...workspace, updatedAt: value.savedAt }
      : workspace);
    await saveWorkspaceIndex({ ...index, workspaces });
    return value;
  }

  async function clearWorkspace(workspaceId) {
    const id = normalizeWorkspaceId(workspaceId);
    const index = await initializeWorkspaces();
    if (!index.workspaces.some((workspace) => workspace.id === id)) {
      throw new Error("要清除的客户空间不存在");
    }
    await deleteEntry(workspaceSnapshotKey(id));
  }

  async function createWorkspace(name) {
    const index = await initializeWorkspaces();
    if (index.workspaces.length >= MAX_WORKSPACES) {
      throw new Error(`客户空间不能超过 ${MAX_WORKSPACES} 个`);
    }
    const normalizedName = normalizeWorkspaceName(name);
    if (index.workspaces.some((workspace) => workspace.name.toLocaleLowerCase("zh-CN") === normalizedName.toLocaleLowerCase("zh-CN"))) {
      throw new Error("客户空间名称不能重复");
    }
    let id = createWorkspaceId(idFactory);
    while (index.workspaces.some((workspace) => workspace.id === id)) id = createWorkspaceId(idFactory);
    const timestamp = new Date().toISOString();
    const workspace = { id, name: normalizedName, createdAt: timestamp, updatedAt: timestamp };
    return saveWorkspaceIndex({
      ...index,
      activeWorkspaceId: id,
      workspaces: [...index.workspaces, workspace]
    });
  }

  async function renameWorkspace(workspaceId, name) {
    const id = normalizeWorkspaceId(workspaceId);
    const normalizedName = normalizeWorkspaceName(name);
    const index = await initializeWorkspaces();
    if (!index.workspaces.some((workspace) => workspace.id === id)) throw new Error("要重命名的客户空间不存在");
    if (index.workspaces.some((workspace) => workspace.id !== id
      && workspace.name.toLocaleLowerCase("zh-CN") === normalizedName.toLocaleLowerCase("zh-CN"))) {
      throw new Error("客户空间名称不能重复");
    }
    const timestamp = new Date().toISOString();
    return saveWorkspaceIndex({
      ...index,
      workspaces: index.workspaces.map((workspace) => workspace.id === id
        ? { ...workspace, name: normalizedName, updatedAt: timestamp }
        : workspace)
    });
  }

  async function setActiveWorkspace(workspaceId) {
    const id = normalizeWorkspaceId(workspaceId);
    const index = await initializeWorkspaces();
    if (!index.workspaces.some((workspace) => workspace.id === id)) throw new Error("要切换的客户空间不存在");
    return saveWorkspaceIndex({ ...index, activeWorkspaceId: id });
  }

  async function deleteWorkspace(workspaceId) {
    const id = normalizeWorkspaceId(workspaceId);
    const index = await initializeWorkspaces();
    if (index.workspaces.length <= 1) throw new Error("至少保留一个客户空间");
    if (!index.workspaces.some((workspace) => workspace.id === id)) throw new Error("要删除的客户空间不存在");
    const workspaces = index.workspaces.filter((workspace) => workspace.id !== id);
    const activeWorkspaceId = index.activeWorkspaceId === id ? workspaces[0].id : index.activeWorkspaceId;
    await deleteEntry(workspaceSnapshotKey(id));
    return saveWorkspaceIndex({ ...index, activeWorkspaceId, workspaces });
  }

  return {
    initializeWorkspaces,
    loadWorkspaceIndex,
    loadWorkspace,
    saveWorkspace,
    clearWorkspace,
    createWorkspace,
    renameWorkspace,
    setActiveWorkspace,
    deleteWorkspace
  };
}
