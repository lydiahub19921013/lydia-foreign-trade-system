import { createHash } from "node:crypto";

export const SCHEMA_VERSION = 1;

const EVIDENCE_STATUSES = new Set([
  "candidate",
  "inconclusive",
  "verified",
  "rejected"
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
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

function stableLeadId(input) {
  const seed = [
    input.source,
    input.sourceReference,
    input.organization?.name,
    input.contact?.email,
    input.inquiry?.message
  ].map(clean).join("|");

  return `lead_${createHash("sha256").update(seed || "empty-lead").digest("hex").slice(0, 12)}`;
}

export function createEvidence(input = {}) {
  const status = EVIDENCE_STATUSES.has(input.status)
    ? input.status
    : "candidate";

  return {
    id: input.id || `ev_${createHash("sha256")
      .update(JSON.stringify([
        input.kind,
        input.value,
        input.sourceRef,
        input.observedAt
      ]))
      .digest("hex")
      .slice(0, 12)}`,
    kind: clean(input.kind) || "unknown",
    value: input.value ?? null,
    sourceRef: clean(input.sourceRef) || null,
    observedAt: isoDate(input.observedAt),
    confidence: boundedNumber(input.confidence, status === "verified" ? 1 : 0.5),
    status,
    note: clean(input.note) || null
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
