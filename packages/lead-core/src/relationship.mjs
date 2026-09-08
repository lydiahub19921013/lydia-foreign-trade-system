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
    .filter((path) => path.consentStatus !== "declined")
    .map((path) => {
      const strength = Math.max(0, Math.min(5, Number(path.relationshipStrength) || 0));
      let score = strength * 8;
      score += recencyScore(daysSince(path.lastContactAt, now));
      if (path.knownPersonally) score += 15;
      if (path.sharedCompany) score += 10;
      if (path.sharedIndustry) score += 5;
      if (path.sharedEducation) score += 5;
      if (path.consentStatus === "approved") score += 5;

      const evidenceCount = Array.isArray(path.evidenceIds) ? path.evidenceIds.length : 0;
      if (evidenceCount === 0) score = Math.min(score, 49);

      return {
        connectorId: path.connectorId,
        targetId: path.targetId,
        score: Math.min(100, score),
        consentStatus: path.consentStatus || "unknown",
        evidenceIds: path.evidenceIds || [],
        nextAction: path.consentStatus === "approved"
          ? "由关系人自行决定何时、以何种方式完成介绍"
          : "先向关系人说明目的并取得明确同意，不要直接借用其名义"
      };
    })
    .sort((left, right) => right.score - left.score);
}
