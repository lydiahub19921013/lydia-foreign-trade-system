export const STORAGE_KEY = "foreignTradeDevelopmentState";
export const SCHEMA_VERSION = 1;

function text(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

export function createInitialState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    customers: [],
    replyHistory: [],
    settings: {
      industryProfile: "",
      companyProfile: "",
      signature: "",
      tone: "professional",
      mode: "generic",
      ai: {
        enabled: false,
        endpoint: "",
        model: "",
        apiKey: ""
      }
    }
  };
}

function normalizeCustomer(customer) {
  const now = new Date().toISOString();
  return {
    id: text(customer?.id, 100) || crypto.randomUUID(),
    name: text(customer?.name, 80),
    company: text(customer?.company, 120),
    country: text(customer?.country, 80),
    notes: text(customer?.notes, 1000),
    createdAt: text(customer?.createdAt, 40) || now,
    updatedAt: text(customer?.updatedAt, 40) || now
  };
}

function normalizeHistory(item) {
  return {
    id: text(item?.id, 100) || crypto.randomUUID(),
    createdAt: text(item?.createdAt, 40) || new Date().toISOString(),
    customerId: text(item?.customerId, 100),
    inbound: text(item?.inbound, 8000),
    scenarioId: text(item?.scenarioId, 40) || "inquiry",
    reply: text(item?.reply, 12000),
    mode: text(item?.mode, 20) || "generic",
    provider: item?.provider === "ai" ? "ai" : "template"
  };
}

export function migrateState(input) {
  const base = createInitialState();
  if (!input || typeof input !== "object") return base;

  const ai = input.settings?.ai ?? {};
  return {
    schemaVersion: SCHEMA_VERSION,
    customers: list(input.customers).slice(0, 500).map(normalizeCustomer),
    replyHistory: list(input.replyHistory).slice(0, 200).map(normalizeHistory),
    settings: {
      industryProfile: text(input.settings?.industryProfile, 2000),
      companyProfile: text(input.settings?.companyProfile, 3000),
      signature: text(input.settings?.signature, 500),
      tone: ["concise", "professional", "warm"].includes(input.settings?.tone) ? input.settings.tone : base.settings.tone,
      mode: ["generic", "industry", "company"].includes(input.settings?.mode) ? input.settings.mode : base.settings.mode,
      ai: {
        enabled: Boolean(ai.enabled),
        endpoint: text(ai.endpoint, 1000),
        model: text(ai.model, 200),
        apiKey: text(ai.apiKey, 1000)
      }
    }
  };
}

export function upsertCustomer(state, customer, now = new Date().toISOString()) {
  const next = migrateState(state);
  const normalized = normalizeCustomer({ ...customer, updatedAt: now });
  const existingIndex = next.customers.findIndex((item) => item.id === normalized.id);

  if (existingIndex >= 0) {
    normalized.createdAt = next.customers[existingIndex].createdAt;
    next.customers[existingIndex] = normalized;
  } else {
    normalized.createdAt = now;
    next.customers.unshift(normalized);
  }

  return { state: next, customer: normalized };
}

export function addReplyHistory(state, item, now = new Date().toISOString()) {
  const next = migrateState(state);
  const entry = normalizeHistory({ ...item, createdAt: now });
  next.replyHistory = [entry, ...next.replyHistory].slice(0, 200);
  return { state: next, entry };
}

export function removeReplyHistory(state, id) {
  const next = migrateState(state);
  next.replyHistory = next.replyHistory.filter((item) => item.id !== id);
  return next;
}

export function exportPortableData(state) {
  const safe = migrateState(state);
  safe.settings.ai.apiKey = "";
  safe.settings.ai.enabled = false;
  return {
    format: "foreign-trade-development-plugin-backup",
    exportedAt: new Date().toISOString(),
    data: safe
  };
}

export function importPortableData(payload, currentState) {
  if (payload?.format !== "foreign-trade-development-plugin-backup" || !payload.data) {
    throw new Error("这不是有效的外贸开发插件备份文件");
  }

  const current = migrateState(currentState);
  const imported = migrateState(payload.data);
  imported.settings.ai.apiKey = current.settings.ai.apiKey;
  imported.settings.ai.enabled = false;
  return imported;
}
