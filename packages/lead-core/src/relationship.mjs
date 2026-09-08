import { parseCsv } from "./csv.mjs";

const CONSENT_STATUSES = new Set(["unknown", "approved", "declined"]);

function clean(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function bool(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "y", "是"].includes(clean(value, 20).toLowerCase());
}

function evidenceIds(value) {
  if (Array.isArray(value)) return value.map((item) => clean(item, 200)).filter(Boolean).slice(0, 20);
  return clean(value, 2_000).split(/[|;；]/u).map((item) => clean(item, 200)).filter(Boolean).slice(0, 20);
}

export function normalizeRelationshipPath(input = {}) {
  const consentStatus = clean(input.consentStatus ?? input.consent_status, 20).toLowerCase();
  return {
    connectorId: clean(input.connectorId ?? input.connector_id, 200) || null,
    connectorName: clean(input.connectorName ?? input.connector_name, 300) || null,
    targetId: clean(input.targetId ?? input.target_id, 200) || null,
    targetName: clean(input.targetName ?? input.target_name, 300) || null,
    relationshipStrength: Math.max(0, Math.min(5, Number(input.relationshipStrength ?? input.relationship_strength) || 0)),
    lastContactAt: clean(input.lastContactAt ?? input.last_contact_at, 60) || null,
    knownPersonally: bool(input.knownPersonally ?? input.known_personally),
    sharedCompany: bool(input.sharedCompany ?? input.shared_company),
    sharedIndustry: bool(input.sharedIndustry ?? input.shared_industry),
    sharedEducation: bool(input.sharedEducation ?? input.shared_education),
    consentStatus: CONSENT_STATUSES.has(consentStatus) ? consentStatus : "unknown",
    evidenceIds: evidenceIds(input.evidenceIds ?? input.evidence_ids)
  };
}

export function relationshipsFromCsv(text) {
  return parseCsv(text).map(normalizeRelationshipPath);
}

export function relationshipsFromJson(payload) {
  const paths = Array.isArray(payload) ? payload : payload?.paths;
  if (!Array.isArray(paths)) throw new Error("JSON 必须是关系路径数组，或包含 paths 数组");
  return paths.map(normalizeRelationshipPath);
}

function daysSince(value, now) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return Infinity;
  return Math.max(0, (now.valueOf() - date.valueOf()) / 86_400_000);
}

function recencyScore(days) {
  if (days <= 30) return 20;
  if (days <= 90) return 15;
  if (days <= 365) return 10;
  if (days <= 730) return 5;
  return 0;
}

export function rankIntroductionPaths(paths, options = {}) {
  const now = new Date(options.now || Date.now());

  return paths
    .map(normalizeRelationshipPath)
    .filter((path) => path.consentStatus !== "declined")
    .map((path) => {
      const strength = path.relationshipStrength;
      let score = strength * 8;
      const reasons = [`关系强度 ${strength}/5`];
      const recency = recencyScore(daysSince(path.lastContactAt, now));
      score += recency;
      if (recency) reasons.push("近期有联系");
      if (path.knownPersonally) { score += 15; reasons.push("确认彼此认识"); }
      if (path.sharedCompany) { score += 10; reasons.push("有共同公司经历"); }
      if (path.sharedIndustry) { score += 5; reasons.push("有共同从业背景"); }
      if (path.sharedEducation) { score += 5; reasons.push("有共同教育经历"); }
      if (path.consentStatus === "approved") { score += 5; reasons.push("已同意协助"); }

      const evidenceCount = Array.isArray(path.evidenceIds) ? path.evidenceIds.length : 0;
      if (evidenceCount === 0) {
        score = Math.min(score, 49);
        reasons.push("暂无证据，候选路径最高 49 分");
      }

      return {
        connectorId: path.connectorId,
        connectorName: path.connectorName,
        targetId: path.targetId,
        targetName: path.targetName,
        score: Math.min(100, score),
        consentStatus: path.consentStatus || "unknown",
        evidenceIds: path.evidenceIds || [],
        reasons,
        nextAction: path.consentStatus === "approved"
          ? "由关系人自行决定何时、以何种方式完成介绍"
          : "先向关系人说明目的并取得明确同意，不要直接借用其名义"
      };
    })
    .sort((left, right) => right.score - left.score);
}
