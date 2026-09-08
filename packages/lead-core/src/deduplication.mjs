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

export function duplicatePairId(leftId, rightId) {
  const ids = [String(leftId || "").trim(), String(rightId || "").trim()].sort();
  if (!ids[0] || !ids[1] || ids[0] === ids[1]) throw new Error("重复候选必须包含两个不同的客户 ID");
  return `duplicate:${ids.map(encodeURIComponent).join(":")}`;
}

export function latestDuplicateDecision(leftInput, rightInput) {
  const left = normalizeLead(leftInput);
  const right = normalizeLead(rightInput);
  const pairId = duplicatePairId(left.id, right.id);
  let latest = null;
  let latestTime = -Infinity;
  let sequence = 0;
  let latestSequence = -1;

  for (const [lead, other] of [[left, right], [right, left]]) {
    for (const review of lead.duplicateReviews) {
      sequence += 1;
      const matches = review.otherLeadId === other.id
        && (!review.pairId || review.pairId === pairId);
      if (!matches) continue;
      const timestamp = review.reviewedAt ? Date.parse(review.reviewedAt) : -Infinity;
      if (timestamp > latestTime || (timestamp === latestTime && sequence > latestSequence)) {
        latest = { ...review, pairId, leadIds: [left.id, right.id].sort() };
        latestTime = timestamp;
        latestSequence = sequence;
      }
    }
  }
  return latest;
}

function canonicalLeadId(leadId, leadsById) {
  let current = leadId;
  const seen = new Set();
  while (leadsById.has(current) && !seen.has(current)) {
    seen.add(current);
    const next = leadsById.get(current).compliance.duplicateOf;
    if (!next || !leadsById.has(next)) break;
    current = next;
  }
  return current;
}

export function findDuplicateCandidates(inputs) {
  const leads = inputs.map(normalizeLead);
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const index = new Map();
  const pairs = new Map();

  for (const input of leads) {
    const { lead, values } = fingerprints(input);
    const canonicalId = canonicalLeadId(lead.id, leadsById);
    for (const fingerprint of values) {
      const previous = index.get(fingerprint.key) || [];
      for (const other of previous) {
        if (other.canonicalId === canonicalId) continue;
        const ids = [other.canonicalId, canonicalId].sort();
        const pairKey = duplicatePairId(...ids);
        const current = pairs.get(pairKey) || {
          pairId: pairKey,
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
      previous.push({ canonicalId, sourceLeadId: lead.id });
      index.set(fingerprint.key, previous);
    }
  }

  return [...pairs.values()]
    .filter((pair) => {
      const [left, right] = pair.leadIds.map((id) => leadsById.get(id));
      if (!left || !right) return false;
      const review = latestDuplicateDecision(left, right);
      return !review || review.decision === "reopened";
    })
    .sort((left, right) => right.confidence - left.confidence);
}

export function listDuplicateDecisions(inputs) {
  const leads = inputs.map(normalizeLead);
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const reviewedPairs = new Map();

  for (const lead of leads) {
    for (const review of lead.duplicateReviews) {
      if (!leadsById.has(review.otherLeadId) || review.otherLeadId === lead.id) continue;
      const leadIds = [lead.id, review.otherLeadId].sort();
      reviewedPairs.set(duplicatePairId(...leadIds), leadIds);
    }
  }

  return [...reviewedPairs.values()]
    .map((leadIds) => {
      const [left, right] = leadIds.map((id) => leadsById.get(id));
      return latestDuplicateDecision(left, right);
    })
    .filter((review) => review && review.decision !== "reopened")
    .sort((left, right) => String(right.reviewedAt || "").localeCompare(String(left.reviewedAt || "")));
}
