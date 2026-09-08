export const STORAGE_KEY = "foreignTradeDevelopmentState";
export const SCHEMA_VERSION = 3;

const LYDIA_MANAGED_FIELDS = ["name", "company", "country", "email", "whatsapp"];

function text(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function score(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

function normalizeLeadManagedFields(input) {
  const result = {};
  if (!input || typeof input !== "object") return result;
  for (const field of LYDIA_MANAGED_FIELDS) {
    const value = text(input[field], field === "email" ? 254 : 120);
    if (value) result[field] = field === "email" ? value.toLowerCase() : value;
  }
  return result;
}

function normalizeLeadProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const grade = ["A", "B", "C", "D", "HOLD"].includes(profile.grade) ? profile.grade : "D";
  return {
    leadId: text(profile.leadId, 100),
    grade,
    score: score(profile.score),
    source: text(profile.source, 80),
    sourceReference: text(profile.sourceReference, 1000),
    product: text(profile.product, 300),
    quantity: text(profile.quantity, 200),
    timeline: text(profile.timeline, 200),
    budget: text(profile.budget, 200),
    inquiryMessage: text(profile.inquiryMessage, 8000),
    nextAction: text(profile.nextAction, 1000),
    missingEvidence: list(profile.missingEvidence).slice(0, 20).map((item) => text(item, 200)).filter(Boolean),
    evidenceCount: Math.max(0, Math.min(999, Number(profile.evidenceCount) || 0)),
    importedAt: text(profile.importedAt, 40)
  };
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
    email: text(customer?.email, 254).toLowerCase(),
    whatsapp: text(customer?.whatsapp, 80),
    notes: text(customer?.notes, 1000),
    leadProfile: normalizeLeadProfile(customer?.leadProfile),
    leadManagedFields: normalizeLeadManagedFields(customer?.leadManagedFields),
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

export function upsertCustomer(state, customer, now = new Date().toISOString(), options = {}) {
  const next = migrateState(state);
  const normalized = normalizeCustomer({ ...customer, updatedAt: now });
  const existingIndex = next.customers.findIndex((item) => item.id === normalized.id);

  if (existingIndex >= 0) {
    const existing = next.customers[existingIndex];
    normalized.createdAt = existing.createdAt;
    if (options.mode !== "lydia-import") {
      normalized.leadManagedFields = { ...existing.leadManagedFields };
      for (const field of LYDIA_MANAGED_FIELDS) {
        if (normalized[field] !== existing[field]) delete normalized.leadManagedFields[field];
      }
    }
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

function leadNotes(lead, qualification) {
  return [
    lead.inquiry?.product ? `产品：${lead.inquiry.product}` : "",
    lead.inquiry?.quantity ? `数量：${lead.inquiry.quantity}` : "",
    qualification.nextAction ? `下一步：${qualification.nextAction}` : ""
  ].filter(Boolean).join("\n");
}

function importedCustomerFields(existing, lead) {
  const incoming = {
    name: text(lead.contact?.name, 80),
    company: text(lead.organization?.name, 120),
    country: text(lead.organization?.country, 80),
    email: text(lead.contact?.email, 254).toLowerCase(),
    whatsapp: text(lead.contact?.whatsapp, 80)
  };
  const values = {};
  const managed = {};

  for (const field of LYDIA_MANAGED_FIELDS) {
    const current = existing?.[field] || "";
    const previousManaged = existing?.leadManagedFields?.[field] || "";
    if (!existing || !current) {
      values[field] = incoming[field];
      if (incoming[field]) managed[field] = incoming[field];
    } else if (previousManaged && current === previousManaged) {
      values[field] = incoming[field];
      if (incoming[field]) managed[field] = incoming[field];
    } else {
      values[field] = current;
    }
  }
  return { values, managed };
}

export function importQualifiedLeads(payload, currentState, now = new Date().toISOString()) {
  if (payload?.format !== "lydia-qualified-leads" || !Array.isArray(payload.results)) {
    throw new Error("这不是有效的 Lydia 客户分级文件");
  }

  let next = migrateState(currentState);
  let importedCount = 0;
  let updatedCount = 0;

  for (const item of payload.results.slice(0, 500)) {
    const lead = item?.lead;
    const qualification = item?.qualification;
    if (!lead || !qualification || typeof lead !== "object" || typeof qualification !== "object") continue;

    const leadId = text(lead.id, 100);
    if (!leadId) continue;
    const existing = next.customers.find((customer) => customer.id === leadId);
    const importedFields = importedCustomerFields(existing, lead);
    const activeEvidenceCount = Array.isArray(lead.evidence)
      ? lead.evidence.filter((evidence) => evidence?.status !== "rejected" && evidence?.review?.decision !== "rejected").length
      : 0;
    const result = upsertCustomer(next, {
      id: leadId,
      ...importedFields.values,
      notes: existing?.notes || leadNotes(lead, qualification),
      leadManagedFields: importedFields.managed,
      leadProfile: {
        leadId,
        grade: qualification.grade,
        score: qualification.score,
        source: lead.source,
        sourceReference: lead.sourceReference,
        product: lead.inquiry?.product,
        quantity: lead.inquiry?.quantity,
        timeline: lead.inquiry?.timeline,
        budget: lead.inquiry?.budget,
        inquiryMessage: lead.inquiry?.message,
        nextAction: qualification.nextAction,
        missingEvidence: qualification.missingEvidence,
        evidenceCount: activeEvidenceCount,
        importedAt: now
      }
    }, now, { mode: "lydia-import" });
    next = result.state;
    existing ? updatedCount += 1 : importedCount += 1;
  }

  return { state: next, importedCount, updatedCount };
}
