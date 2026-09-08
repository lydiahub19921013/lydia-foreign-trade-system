import { createEvidence, normalizeLead } from "./model.mjs";

const ORGANIZATION_FIELDS = ["name", "domain", "website", "country", "address", "industry", "employeeRange", "registrationId", "factoryInfo"];
const CONTACT_FIELDS = ["name", "role", "email", "whatsapp", "phone"];

function fillEmpty(target, patch, fields) {
  const result = { ...target };
  for (const field of fields) {
    if (!result[field] && patch?.[field] !== undefined && patch[field] !== null && String(patch[field]).trim()) {
      result[field] = patch[field];
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

  return normalizeLead({
    ...lead,
    organization: fillEmpty(lead.organization, enrichment.organization, ORGANIZATION_FIELDS),
    contact: fillEmpty(lead.contact, enrichment.contact, CONTACT_FIELDS),
    evidence: [...mergedEvidence.values()]
  });
}
