import { createEvidence } from "./model.mjs";

function firstValue(evidence, kind) {
  return evidence.find((item) => item.kind === kind && item.value)?.value || null;
}

export function enrichmentFromEvidenceSelection(inputEvidence = [], selectedIds = [], options = {}) {
  const selected = new Set(selectedIds);
  const evidence = inputEvidence
    .map(createEvidence)
    .filter((item) => selected.has(item.id))
    .map((item) => createEvidence({
      ...item,
      review: {
        decision: "accepted",
        reviewedAt: options.reviewedAt || new Date(),
        note: options.note || "使用者逐条选择保留；该决定不改变候选证据的验证状态"
      }
    }));
  if (!evidence.length) throw new Error("请至少选择一条要保留的证据");
  const websiteEvidence = evidence.find((item) => item.kind === "company-website");

  return {
    organization: {
      name: firstValue(evidence, "organization-name"),
      website: websiteEvidence?.value || websiteEvidence?.sourceRef || null,
      address: firstValue(evidence, "business-address"),
      factoryInfo: firstValue(evidence, "factory") || firstValue(evidence, "manufacturing-capability")
    },
    contact: {
      email: firstValue(evidence, "business-email") || firstValue(evidence, "work-email"),
      phone: firstValue(evidence, "business-phone"),
      whatsapp: firstValue(evidence, "whatsapp")
    },
    evidence
  };
}
