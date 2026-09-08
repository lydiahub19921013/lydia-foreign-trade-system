import { normalizeLead } from "./model.mjs";

function normalizedDomain(lead) {
  const raw = lead.organization.domain || lead.organization.website || "";
  if (!raw) return null;
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/^www\./, "").replace(/\/$/, "");
  }
}

function normalizedName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function verifiedValues(lead, kinds) {
  const accepted = new Set(kinds);
  return lead.evidence
    .filter((item) => accepted.has(item.kind) && item.status === "verified" && item.review?.decision !== "rejected" && item.value)
    .map((item) => String(item.value).trim().toLowerCase());
}

function fingerprints(input) {
  const lead = normalizeLead(input);
  const values = [];
  if (lead.sourceReference) values.push({ key: `source:${lead.source}:${lead.sourceReference}`, confidence: 1, reason: "同一渠道询盘编号" });
  if (lead.organization.registrationId) values.push({ key: `registration:${lead.organization.registrationId.toLowerCase()}`, confidence: 1, reason: "相同企业登记编号" });

  const domain = normalizedDomain(lead);
  if (domain) values.push({ key: `domain:${domain}`, confidence: 0.95, reason: "相同企业域名" });

  for (const email of verifiedValues(lead, ["business-email", "work-email"])) {
    values.push({ key: `email:${email}`, confidence: 0.95, reason: "相同已验证工作邮箱" });
  }

  const name = normalizedName(lead.organization.name);
  const country = normalizedName(lead.organization.country);
  if (name && country) values.push({ key: `name-country:${name}:${country}`, confidence: 0.7, reason: "公司名和国家相同，需人工确认" });
  return { lead, values };
}

export function findDuplicateCandidates(inputs) {
  const index = new Map();
  const pairs = new Map();

  for (const input of inputs) {
    const { lead, values } = fingerprints(input);
    for (const fingerprint of values) {
      const previous = index.get(fingerprint.key) || [];
      for (const other of previous) {
        const ids = [other.id, lead.id].sort();
        const pairKey = ids.join("|");
        const current = pairs.get(pairKey) || {
          leadIds: ids,
          confidence: 0,
          automaticHoldRecommended: false,
          reasons: []
        };
        current.confidence = Math.max(current.confidence, fingerprint.confidence);
        current.automaticHoldRecommended ||= fingerprint.confidence >= 0.95;
        if (!current.reasons.includes(fingerprint.reason)) current.reasons.push(fingerprint.reason);
        pairs.set(pairKey, current);
      }
      previous.push(lead);
      index.set(fingerprint.key, previous);
    }
  }

  return [...pairs.values()].sort((left, right) => right.confidence - left.confidence);
}
