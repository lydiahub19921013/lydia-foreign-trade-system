import { createEvidence } from "../../packages/lead-core/src/model.mjs";

function mapStatus(result) {
  const raw = String(result.status || result.verification?.status || "").toLowerCase();
  if (["valid", "deliverable", "verified", "ok"].includes(raw)) return "verified";
  if (["invalid", "undeliverable", "rejected"].includes(raw)) return "rejected";
  if (["unknown", "catch_all", "catch-all", "timeout", "blocked"].includes(raw)) {
    return "inconclusive";
  }
  return "candidate";
}

export function mapEmailSleuthResult(result, options = {}) {
  if (!result?.email) throw new Error("email-sleuth 结果缺少 email");
  const domain = result.domain || String(result.email).split("@")[1] || "unknown-domain";
  const status = mapStatus(result);
  const confidence = Number(result.confidence ?? result.score);

  return createEvidence({
    kind: "business-email",
    value: String(result.email).toLowerCase(),
    sourceRef: options.sourceRef || `email-sleuth:${domain}`,
    observedAt: options.observedAt || new Date().toISOString(),
    status,
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence > 1 ? confidence / 100 : confidence))
      : status === "verified" ? 0.8 : 0.5,
    note: status === "verified"
      ? "外部工具返回可投递；仍建议在重要开发前交叉核查联系人身份"
      : "外部工具未能给出确定结论，不能作为已确认邮箱"
  });
}
