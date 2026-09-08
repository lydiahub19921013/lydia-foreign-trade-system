export const SCHEMA_VERSION = 3;

const EVIDENCE_STATUSES = new Set([
  "candidate",
  "inconclusive",
  "verified",
  "rejected"
]);

const REVIEW_ACTIONS = new Set(["accepted", "rejected", "revised"]);
const REVIEW_DECISIONS = new Set(["accepted", "rejected"]);
const DUPLICATE_REVIEW_DECISIONS = new Set(["same", "distinct", "reopened"]);
const LEAD_FIELD_PATHS = new Set([
  "organization.name",
  "organization.domain",
  "organization.website",
  "organization.country",
  "organization.address",
  "organization.industry",
  "organization.employeeRange",
  "organization.registrationId",
  "organization.factoryInfo",
  "contact.name",
  "contact.role",
  "contact.email",
  "contact.whatsapp",
  "contact.phone"
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedText(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function bool(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "y", "是"].includes(clean(value).toLowerCase());
}

function boundedNumber(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableDigest(value) {
  const text = String(value);
  return `${hashText(text)}${hashText([...text].reverse().join(""))}`;
}

function stableLeadId(input) {
  const seed = [
    input.source,
    input.sourceReference,
    input.organization?.name,
    input.contact?.email,
    input.inquiry?.message
  ].map(clean).join("|");

  return `lead_${stableDigest(seed || "empty-lead").slice(0, 12)}`;
}

function changePair(input = {}) {
  if (!input || typeof input !== "object") return null;
  return {
    from: input.from === null || input.from === undefined ? null : boundedText(input.from, 2000),
    to: input.to === null || input.to === undefined ? null : boundedText(input.to, 2000)
  };
}

function reviewEvent(input = {}) {
  if (!input || typeof input !== "object") return null;
  if (!REVIEW_ACTIONS.has(input.action)) return null;
  const changes = {};
  for (const field of ["value", "sourceRef"]) {
    const pair = changePair(input.changes?.[field]);
    if (pair && pair.from !== pair.to) changes[field] = pair;
  }
  return {
    action: input.action,
    reviewedAt: isoDate(input.reviewedAt),
    note: boundedText(input.note, 1000) || null,
    changes: Object.keys(changes).length ? changes : null
  };
}

function normalizeReview(input = {}) {
  if (!input || typeof input !== "object") return null;
  const decision = REVIEW_DECISIONS.has(input.decision) ? input.decision : null;
  const reviewedAt = isoDate(input.reviewedAt);
  const note = boundedText(input.note, 1000) || null;
  const history = (Array.isArray(input.history) ? input.history : [])
    .map(reviewEvent)
    .filter(Boolean)
    .slice(-50);
  if (decision && !history.length) {
    history.push({ action: decision, reviewedAt, note, changes: null });
  }
  return decision ? { decision, reviewedAt, note, history } : null;
}

function normalizeFieldOrigin(input = {}) {
  if (!input || typeof input !== "object") return null;
  const path = boundedText(input.path, 80);
  const evidenceId = boundedText(input.evidenceId, 120);
  if (!LEAD_FIELD_PATHS.has(path) || !evidenceId) return null;
  return {
    path,
    evidenceId,
    appliedValue: input.appliedValue === null || input.appliedValue === undefined
      ? null
      : boundedText(input.appliedValue, 2000),
    appliedAt: isoDate(input.appliedAt),
    updatedAt: isoDate(input.updatedAt),
    active: input.active !== false,
    endedAt: isoDate(input.endedAt),
    endReason: boundedText(input.endReason, 80) || null
  };
}

function normalizeDuplicateReview(input = {}) {
  if (!input || typeof input !== "object") return null;
  const decision = DUPLICATE_REVIEW_DECISIONS.has(input.decision) ? input.decision : null;
  const otherLeadId = boundedText(input.otherLeadId, 160);
  const primaryLeadId = boundedText(input.primaryLeadId, 160) || null;
  if (!decision || !otherLeadId || (decision === "same" && !primaryLeadId)) return null;
  return {
    pairId: boundedText(input.pairId, 380) || null,
    otherLeadId,
    decision,
    primaryLeadId: decision === "same" ? primaryLeadId : null,
    reviewedAt: isoDate(input.reviewedAt),
    note: boundedText(input.note, 1000) || null,
    confidence: boundedNumber(input.confidence, 0),
    reasons: (Array.isArray(input.reasons) ? input.reasons : [])
      .map((reason) => boundedText(reason, 240))
      .filter(Boolean)
      .slice(0, 20)
  };
}

export function createEvidence(input = {}) {
  const status = EVIDENCE_STATUSES.has(input.status)
    ? input.status
    : "candidate";

  return {
    id: input.id || `ev_${stableDigest(JSON.stringify([
        input.kind,
        input.value,
        input.sourceRef,
        input.observedAt
      ])).slice(0, 12)}`,
    kind: clean(input.kind) || "unknown",
    value: input.value ?? null,
    sourceRef: clean(input.sourceRef) || null,
    observedAt: isoDate(input.observedAt),
    confidence: boundedNumber(input.confidence, status === "verified" ? 1 : 0.5),
    status,
    note: clean(input.note) || null,
    review: normalizeReview(input.review)
  };
}

export function normalizeLead(input = {}) {
  const organization = input.organization || {};
  const contact = input.contact || {};
  const inquiry = input.inquiry || {};
  const signals = input.signals || {};
  const compliance = input.compliance || {};

  const normalized = {
    schemaVersion: SCHEMA_VERSION,
    id: clean(input.id) || null,
    source: clean(input.source) || "manual",
    sourceReference: clean(input.sourceReference) || null,
    receivedAt: isoDate(input.receivedAt),
    organization: {
      name: clean(organization.name) || null,
      domain: clean(organization.domain).toLowerCase() || null,
      website: clean(organization.website) || null,
      country: clean(organization.country) || null,
      address: clean(organization.address) || null,
      industry: clean(organization.industry) || null,
      employeeRange: clean(organization.employeeRange) || null,
      registrationId: clean(organization.registrationId) || null,
      factoryInfo: clean(organization.factoryInfo) || null
    },
    contact: {
      name: clean(contact.name) || null,
      role: clean(contact.role) || null,
      email: clean(contact.email).toLowerCase() || null,
      whatsapp: clean(contact.whatsapp) || null,
      phone: clean(contact.phone) || null
    },
    inquiry: {
      message: clean(inquiry.message) || null,
      product: clean(inquiry.product) || null,
      quantity: clean(inquiry.quantity) || null,
      timeline: clean(inquiry.timeline) || null,
      budget: clean(inquiry.budget) || null
    },
    signals: {
      explicitInquiry: bool(signals.explicitInquiry),
      replied: bool(signals.replied),
      requestedQuote: bool(signals.requestedQuote),
      requestedSample: bool(signals.requestedSample),
      purchaseOrder: bool(signals.purchaseOrder),
      mutualIntroduction: bool(signals.mutualIntroduction),
      priorRelationship: bool(signals.priorRelationship)
    },
    evidence: Array.isArray(input.evidence)
      ? input.evidence.map(createEvidence)
      : [],
    fieldOrigins: (Array.isArray(input.fieldOrigins) ? input.fieldOrigins : [])
      .map(normalizeFieldOrigin)
      .filter(Boolean)
      .slice(-200),
    duplicateReviews: (Array.isArray(input.duplicateReviews) ? input.duplicateReviews : [])
      .map(normalizeDuplicateReview)
      .filter(Boolean)
      .slice(-100),
    compliance: {
      doNotContact: bool(compliance.doNotContact),
      restrictedMarket: bool(compliance.restrictedMarket),
      duplicateOf: clean(compliance.duplicateOf) || null,
      consentStatus: clean(compliance.consentStatus) || "unknown"
    },
    notes: clean(input.notes) || null
  };

  normalized.id ||= stableLeadId(normalized);
  return normalized;
}
