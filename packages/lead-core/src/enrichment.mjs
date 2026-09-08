import { createEvidence, normalizeLead } from "./model.mjs";

const ORGANIZATION_FIELDS = ["name", "domain", "website", "country", "address", "industry", "employeeRange", "registrationId", "factoryInfo"];
const CONTACT_FIELDS = ["name", "role", "email", "whatsapp", "phone"];
const FIELD_EVIDENCE_KINDS = {
  "organization.name": ["organization-name", "legal-entity-record"],
  "organization.domain": ["organization-domain", "company-website", "business-email", "work-email"],
  "organization.website": ["company-website"],
  "organization.country": ["business-country", "legal-jurisdiction"],
  "organization.address": ["business-address"],
  "organization.industry": ["business-industry"],
  "organization.employeeRange": ["employee-range"],
  "organization.registrationId": ["business-registration"],
  "organization.factoryInfo": ["factory", "manufacturing-capability"],
  "contact.name": ["contact-name"],
  "contact.role": ["contact-role"],
  "contact.email": ["business-email", "work-email"],
  "contact.whatsapp": ["whatsapp"],
  "contact.phone": ["business-phone"]
};

function comparable(value) {
  return String(value ?? "").trim().toLowerCase();
}

function evidenceIdFor(path, value, evidence, explicit = {}) {
  const requested = explicit[path];
  if (requested && evidence.some((item) => item.id === requested)) return requested;
  const acceptedKinds = new Set(FIELD_EVIDENCE_KINDS[path] || []);
  const expected = comparable(value);
  const match = evidence.find((item) =>
    acceptedKinds.has(item.kind)
    && (comparable(item.value) === expected || (path === "organization.website" && comparable(item.sourceRef) === expected))
  );
  return match?.id || null;
}

function fillEmpty(target, patch, group, fields, evidence, fieldEvidence, origins, appliedAt) {
  const result = { ...target };
  for (const field of fields) {
    if (!result[field] && patch?.[field] !== undefined && patch[field] !== null && String(patch[field]).trim()) {
      result[field] = patch[field];
      const path = `${group}.${field}`;
      const evidenceId = evidenceIdFor(path, patch[field], evidence, fieldEvidence);
      if (evidenceId && !origins.some((item) => item.path === path && item.evidenceId === evidenceId && item.active)) {
        origins.push({
          path,
          evidenceId,
          appliedValue: String(patch[field]).trim(),
          appliedAt,
          active: true,
          endedAt: null,
          endReason: null
        });
      }
    }
  }
  return result;
}

export function mergeEvidenceIntoLead(input, enrichment = {}) {
  const lead = normalizeLead(input);
  const mergedEvidence = new Map(lead.evidence.map((item) => [item.id, item]));
  for (const inputEvidence of enrichment.evidence || []) {
    const evidence = createEvidence(inputEvidence);
    mergedEvidence.set(evidence.id, evidence);
  }
  const evidence = [...mergedEvidence.values()];
  const origins = [...lead.fieldOrigins];
  const appliedAt = enrichment.appliedAt || new Date().toISOString();
  const fieldEvidence = enrichment.fieldEvidence && typeof enrichment.fieldEvidence === "object"
    ? enrichment.fieldEvidence
    : {};

  return normalizeLead({
    ...lead,
    organization: fillEmpty(lead.organization, enrichment.organization, "organization", ORGANIZATION_FIELDS, evidence, fieldEvidence, origins, appliedAt),
    contact: fillEmpty(lead.contact, enrichment.contact, "contact", CONTACT_FIELDS, evidence, fieldEvidence, origins, appliedAt),
    evidence,
    fieldOrigins: origins
  });
}
