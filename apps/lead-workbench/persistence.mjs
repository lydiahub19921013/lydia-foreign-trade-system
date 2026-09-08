export const WORKBENCH_SNAPSHOT_FORMAT = "lydia-workbench-snapshot";
export const WORKBENCH_SNAPSHOT_SCHEMA_VERSION = 1;
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
const CURRENT_SNAPSHOT_KEY = "current";
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

export function createIndexedDbPersistence(indexedDb, options = {}) {
  if (!indexedDb || typeof indexedDb.open !== "function") {
    throw new Error("当前浏览器不支持本机自动保存");
  }
  const databaseName = options.databaseName || DEFAULT_DATABASE_NAME;
  const storeName = options.storeName || DEFAULT_STORE_NAME;
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

  async function load() {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readonly");
    const finished = transactionFinished(transaction, "读取本机工作台数据失败");
    const request = transaction.objectStore(storeName).get(CURRENT_SNAPSHOT_KEY);
    const [value] = await Promise.all([
      requestResult(request, "无法读取本机工作台数据"),
      finished
    ]);
    return value === undefined ? null : normalizeWorkbenchSnapshot(value);
  }

  async function save(snapshot) {
    const value = normalizeWorkbenchSnapshot(snapshot);
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    const finished = transactionFinished(transaction, "保存本机工作台数据失败");
    transaction.objectStore(storeName).put(value, CURRENT_SNAPSHOT_KEY);
    await finished;
    return value;
  }

  async function clear() {
    const database = await openDatabase();
    const transaction = database.transaction(storeName, "readwrite");
    const finished = transactionFinished(transaction, "清除本机工作台数据失败");
    transaction.objectStore(storeName).delete(CURRENT_SNAPSHOT_KEY);
    await finished;
  }

  return { load, save, clear };
}
