import { createEvidence } from "../../packages/lead-core/src/model.mjs";

export const GLEIF_API_BASE = "https://api.gleif.org/api/v1";
export const GLEIF_TERMS_URL = "https://www.gleif.org/en/meta/lei-data-terms-of-use";

function clean(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function addressText(address) {
  if (!address || typeof address !== "object") return null;
  return [
    ...(Array.isArray(address.addressLines) ? address.addressLines : []),
    address.city,
    address.region,
    address.postalCode,
    address.country
  ].map((value) => clean(value, 300)).filter(Boolean).join(", ") || null;
}

export function buildGleifSearchUrl(query, options = {}) {
  const legalName = clean(query, 200);
  if (legalName.length < 2) throw new Error("企业名称至少需要 2 个字符");
  const pageSize = Math.max(1, Math.min(10, Number(options.pageSize) || 5));
  const url = new URL(`${GLEIF_API_BASE}/lei-records`);
  url.searchParams.set("filter[entity.legalName]", legalName);
  url.searchParams.set("page[size]", String(pageSize));
  const jurisdiction = clean(options.jurisdiction, 20).toUpperCase();
  if (jurisdiction) url.searchParams.set("filter[entity.jurisdiction]", jurisdiction);
  return url;
}

export function mapGleifRecord(item, observedAt = new Date().toISOString()) {
  const attributes = item?.attributes || {};
  const entity = attributes.entity || {};
  const registration = attributes.registration || {};
  const lei = clean(attributes.lei || item?.id, 20);
  const sourceRef = `${GLEIF_API_BASE}/lei-records/${encodeURIComponent(lei)}`;
  const corroborated = registration.corroborationLevel === "FULLY_CORROBORATED";
  const recordStatus = registration.status === "ISSUED" && corroborated ? "verified" : "inconclusive";
  const legalName = clean(entity.legalName?.name, 500);
  const legalAddress = addressText(entity.legalAddress);
  const headquartersAddress = addressText(entity.headquartersAddress);
  const registeredAs = clean(entity.registeredAs || registration.validatedAs, 200);
  const evidence = [];

  if (legalName) evidence.push(createEvidence({
    kind: "legal-entity-record",
    value: legalName,
    sourceRef,
    observedAt,
    confidence: corroborated ? 0.95 : 0.7,
    status: recordStatus,
    note: `GLEIF LEI ${lei}; 不代表 Lydia 或 GLEIF 对交易信用作出保证`
  }));
  if (registeredAs) evidence.push(createEvidence({
    kind: "business-registration",
    value: registeredAs,
    sourceRef,
    observedAt,
    confidence: corroborated ? 0.95 : 0.7,
    status: recordStatus,
    note: `登记机构：${clean(entity.registeredAt?.id || registration.validatedAt?.id, 100) || "未提供"}`
  }));
  if (entity.status) evidence.push(createEvidence({
    kind: "business-status",
    value: clean(entity.status, 40),
    sourceRef,
    observedAt,
    confidence: 0.9,
    status: recordStatus,
    note: `LEI 注册状态：${clean(registration.status, 40) || "未知"}`
  }));
  if (legalAddress) evidence.push(createEvidence({
    kind: "business-address",
    value: legalAddress,
    sourceRef,
    observedAt,
    confidence: corroborated ? 0.9 : 0.65,
    status: recordStatus,
    note: "GLEIF 法定地址"
  }));

  return {
    provider: "GLEIF",
    lei,
    legalName: legalName || null,
    otherNames: Array.isArray(entity.otherNames)
      ? entity.otherNames.map((name) => clean(name?.name, 500)).filter(Boolean)
      : [],
    entityStatus: clean(entity.status, 40) || null,
    registrationStatus: clean(registration.status, 40) || null,
    corroborationLevel: clean(registration.corroborationLevel, 80) || null,
    jurisdiction: clean(entity.jurisdiction, 40) || null,
    registeredAt: clean(entity.registeredAt?.id || registration.validatedAt?.id, 100) || null,
    registeredAs: registeredAs || null,
    legalAddress,
    headquartersAddress,
    lastUpdateDate: clean(registration.lastUpdateDate, 40) || null,
    sourceRef,
    termsUrl: GLEIF_TERMS_URL,
    evidence
  };
}

export async function searchGleifEntities(query, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const url = buildGleifSearchUrl(query, options);
  const response = await fetchImpl(url, {
    headers: { Accept: "application/vnd.api+json" },
    signal: options.signal || AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`GLEIF 查询失败（HTTP ${response.status}）`);
  const payload = await response.json();
  const observedAt = options.observedAt || new Date().toISOString();
  return {
    provider: "GLEIF",
    query: clean(query, 200),
    observedAt,
    goldenCopyDate: payload.meta?.goldenCopy?.publishDate || null,
    total: Number(payload.meta?.pagination?.total) || 0,
    results: Array.isArray(payload.data)
      ? payload.data.map((item) => mapGleifRecord(item, observedAt))
      : [],
    termsUrl: GLEIF_TERMS_URL,
    disclaimer: "LEI 记录是企业身份证据之一，不是信用、付款能力或合作意愿保证。"
  };
}
