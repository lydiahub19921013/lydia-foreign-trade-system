import { createEvidence } from "../../packages/lead-core/src/model.mjs";

const FIELD_KINDS = {
  companyName: "organization-name",
  domain: "organization-domain",
  address: "business-address",
  businessStatus: "business-status",
  factoryInfo: "factory",
  manufacturingCapability: "manufacturing-capability"
};

export function mapWebsiteExtraction(result, options = {}) {
  const pageUrl = options.pageUrl || result?.url;
  if (!pageUrl) throw new Error("官网提取结果必须保留页面 URL");

  const extracted = result?.extractedContent || result?.extracted_content || result?.data || {};
  if (!extracted || typeof extracted !== "object" || Array.isArray(extracted)) {
    throw new Error("官网提取结果必须是结构化对象");
  }

  const confidence = Math.min(0.75, Math.max(0, Number(options.confidence ?? 0.65)));
  return Object.entries(FIELD_KINDS)
    .filter(([field]) => extracted[field] !== undefined && extracted[field] !== null && extracted[field] !== "")
    .map(([field, kind]) => createEvidence({
      kind,
      value: extracted[field],
      sourceRef: pageUrl,
      observedAt: options.observedAt || result.observedAt || new Date().toISOString(),
      confidence,
      status: "candidate",
      note: "来自企业官网公开页面的自述信息，需用独立来源交叉核查后才能升级为 verified"
    }));
}
