import { createEvidence } from "./model.mjs";

function firstEvidence(evidence, ...kinds) {
  return evidence.find((item) => kinds.includes(item.kind) && item.value) || null;
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
  const nameEvidence = firstEvidence(evidence, "organization-name");
  const addressEvidence = firstEvidence(evidence, "business-address");
  const factoryEvidence = firstEvidence(evidence, "factory", "manufacturing-capability");
  const emailEvidence = firstEvidence(evidence, "business-email", "work-email");
  const phoneEvidence = firstEvidence(evidence, "business-phone");
  const whatsappEvidence = firstEvidence(evidence, "whatsapp");

  return {
    organization: {
      name: nameEvidence?.value || null,
      website: websiteEvidence?.value || websiteEvidence?.sourceRef || null,
      address: addressEvidence?.value || null,
      factoryInfo: factoryEvidence?.value || null
    },
    contact: {
      email: emailEvidence?.value || null,
      phone: phoneEvidence?.value || null,
      whatsapp: whatsappEvidence?.value || null
    },
    fieldEvidence: Object.fromEntries([
      ["organization.name", nameEvidence?.id],
      ["organization.website", websiteEvidence?.id],
      ["organization.address", addressEvidence?.id],
      ["organization.factoryInfo", factoryEvidence?.id],
      ["contact.email", emailEvidence?.id],
      ["contact.phone", phoneEvidence?.id],
      ["contact.whatsapp", whatsappEvidence?.id]
    ].filter(([, evidenceId]) => evidenceId)),
    evidence
  };
}
