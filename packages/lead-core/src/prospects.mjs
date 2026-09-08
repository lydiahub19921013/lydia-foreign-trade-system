import { parseCsv } from "./csv.mjs";
import { createEvidence, normalizeLead } from "./model.mjs";
import { mergeEvidenceIntoLead } from "./enrichment.mjs";
import { checkCompanyDomainMatch } from "./email-candidates.mjs";

const SCORE_WEIGHTS = Object.freeze({
  needSignal: 25,
  productFit: 25,
  timing: 20,
  publicReachability: 15,
  evidenceQuality: 15
});

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedText(value, maximum) {
  const text = clean(value);
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function cleanUrl(value) {
  try {
    const url = new URL(clean(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function bool(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "y", "是", "已核查"].includes(clean(value).toLowerCase());
}

function level(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(5, number)) : fallback;
}

function isoDate(value, fallback = null) {
  const date = value ? new Date(value) : fallback;
  return date && !Number.isNaN(date.valueOf()) ? date.toISOString() : null;
}

function digest(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function query(label, value, purpose) {
  return { id: `query_${digest(`${label}|${value}`)}`, label, query: value, purpose };
}

export function createProspectSearchPlan(input = {}) {
  const product = clean(input.product);
  const market = clean(input.market);
  const buyerType = clean(input.buyerType) || "importer distributor wholesaler";
  const application = clean(input.application);

  if (product.length < 2) throw new Error("产品至少需要 2 个字符");
  if (market.length < 2) throw new Error("目标市场至少需要 2 个字符");
  if (product.length > 160 || market.length > 100 || buyerType.length > 120 || application.length > 160) {
    throw new Error("搜索条件过长，请缩短后再试");
  }

  const context = [product, application].filter(Boolean).join(" ");
  return {
    format: "lydia-prospect-search-plan",
    schemaVersion: 1,
    product: "Lydia 外贸系统",
    context: { product, market, buyerType, application: application || null },
    queries: [
      query("目标买家", `${context} ${buyerType} ${market}`, "寻找匹配产品、市场和买家类型的公开企业页面"),
      query("明确需求", `\"looking for supplier\" ${context} ${market}`, "寻找公开表达供应商需求的页面"),
      query("问题与替代", `${context} sourcing challenge shortage alternative ${market}`, "寻找痛点、缺货或替代方案信号"),
      query("近期变化", `${context} launch expansion new range ${market} ${buyerType}`, "寻找新品、扩张、招聘或渠道变化"),
      query("行业渠道", `${context} importer distributor wholesale directory ${market}`, "寻找行业目录或公开展会入口，再回到企业原始页面核查")
    ],
    rules: [
      "搜索摘要只用于发现候选，不作为已核实事实",
      "进入优先名单前必须打开原始公开页面并保存来源",
      "只处理公开商业信息，不查私人联系方式、不自动发送消息"
    ]
  };
}

export function normalizePublicProspect(input = {}, defaults = {}) {
  const scoreInput = input.scoreInput || input.scoreInputs || input.signals || {};
  const sourceUrl = cleanUrl(input.sourceUrl || input.url || input.source_ref);
  const signalExcerpt = boundedText(input.signalExcerpt || input.snippet || input.highlights || input.signal, 2_000);
  const observedAt = isoDate(input.observedAt || defaults.observedAt, defaults.now || new Date());
  const originalPageReviewed = bool(input.originalPageReviewed || input.original_page_reviewed);
  const evidence = Array.isArray(input.evidence)
    ? input.evidence.map(createEvidence)
    : sourceUrl && signalExcerpt
      ? [createEvidence({
          kind: originalPageReviewed ? "public-business-signal" : "search-result-candidate",
          value: signalExcerpt,
          sourceRef: sourceUrl,
          observedAt,
          confidence: originalPageReviewed ? 0.65 : 0.25,
          status: "candidate",
          note: originalPageReviewed
            ? "使用者已阅读原始公开页面；内容仍需按具体主张逐项核查"
            : "仅来自搜索结果摘要，尚未核查原始页面"
        })]
      : [];

  const normalized = {
    id: clean(input.id) || `prospect_${digest(`${sourceUrl}|${input.companyName || input.title}|${signalExcerpt}`)}`,
    companyName: boundedText(input.companyName || input.company_name || input.company || input.organization || input.title, 300) || null,
    companyDomain: clean(input.companyDomain || input.company_domain) || null,
    title: boundedText(input.title, 300) || null,
    sourceUrl,
    publishedAt: isoDate(input.publishedAt || input.published || input.published_date),
    observedAt,
    signalExcerpt: signalExcerpt || null,
    signalType: clean(input.signalType || input.signal_type) || "public-search-result",
    product: clean(input.product || defaults.product) || null,
    market: clean(input.market || defaults.market) || null,
    buyerType: clean(input.buyerType || input.buyer_type || defaults.buyerType) || null,
    originalPageReviewed,
    scoreInput: {
      needSignal: level(scoreInput.needSignal ?? scoreInput.need_signal, originalPageReviewed ? 2 : 1),
      productFit: level(scoreInput.productFit ?? scoreInput.product_fit, originalPageReviewed ? 2 : 1),
      timing: level(scoreInput.timing, 0),
      publicReachability: level(scoreInput.publicReachability ?? scoreInput.public_reachability, sourceUrl ? 3 : 0),
      evidenceQuality: level(scoreInput.evidenceQuality ?? scoreInput.evidence_quality, originalPageReviewed ? 3 : sourceUrl ? 1 : 0)
    },
    evidence
  };

  return { ...normalized, qualification: scorePublicProspect(normalized) };
}

export function scorePublicProspect(input = {}) {
  const scoreInput = input.scoreInput || {};
  const dimensions = Object.fromEntries(Object.entries(SCORE_WEIGHTS).map(([name, weight]) => {
    const value = level(scoreInput[name]);
    return [name, { value, weight, score: Math.round((value / 5) * weight) }];
  }));
  const rawScore = Object.values(dimensions).reduce((sum, item) => sum + item.score, 0);
  const hasCitedSignal = Boolean(cleanUrl(input.sourceUrl) && clean(input.signalExcerpt));
  const originalPageReviewed = Boolean(input.originalPageReviewed);
  const cap = !hasCitedSignal || !originalPageReviewed ? 49 : 100;
  const score = Math.min(rawScore, cap);
  const stage = !hasCitedSignal || !originalPageReviewed
    ? "search-candidate"
    : score >= 70
      ? "primary"
      : score >= 50
        ? "shortlist"
        : "reviewed";
  const missingEvidence = [];
  if (!cleanUrl(input.sourceUrl)) missingEvidence.push("公开来源链接");
  if (!clean(input.signalExcerpt)) missingEvidence.push("与需求相关的原文信号");
  if (!originalPageReviewed) missingEvidence.push("原始页面人工核查");
  if (level(scoreInput.timing) < 2) missingEvidence.push("近期采购或业务变化信号");
  if (level(scoreInput.productFit) < 3) missingEvidence.push("产品与买家业务匹配证据");

  return {
    score,
    rawScore,
    cap,
    stage,
    dimensions,
    missingEvidence,
    nextAction: stage === "search-candidate"
      ? "先打开原始公开页面，确认公司身份、产品匹配和需求信号。"
      : stage === "primary"
        ? "进入优先开发名单；先人工确认联系人、合规基础和沟通角度。"
        : "继续补近期需求、角色或采购动作证据，再决定开发优先级。"
  };
}

function rowValue(row, ...names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && clean(row[name])) return row[name];
  }
  return undefined;
}

export function prospectsFromCsv(text, defaults = {}) {
  return parseCsv(text).map((row) => normalizePublicProspect({
    companyName: rowValue(row, "company_name", "company", "企业名称", "公司名称"),
    title: rowValue(row, "title", "页面标题"),
    sourceUrl: rowValue(row, "source_url", "url", "来源链接"),
    signalExcerpt: rowValue(row, "signal_excerpt", "snippet", "信号摘录"),
    signalType: rowValue(row, "signal_type", "信号类型"),
    publishedAt: rowValue(row, "published_at", "published_date", "发布日期"),
    observedAt: rowValue(row, "observed_at", "观察时间"),
    originalPageReviewed: rowValue(row, "original_page_reviewed", "已核查原页"),
    product: rowValue(row, "product", "产品"),
    market: rowValue(row, "market", "市场"),
    buyerType: rowValue(row, "buyer_type", "买家类型"),
    scoreInput: {
      needSignal: rowValue(row, "need_signal", "需求信号"),
      productFit: rowValue(row, "product_fit", "产品匹配"),
      timing: rowValue(row, "timing", "时机信号"),
      publicReachability: rowValue(row, "public_reachability", "公开可联系性"),
      evidenceQuality: rowValue(row, "evidence_quality", "证据质量")
    }
  }, defaults));
}

export function prospectsFromJson(payload, defaults = {}) {
  const items = Array.isArray(payload) ? payload : payload?.prospects || payload?.results;
  if (!Array.isArray(items)) throw new Error("JSON 必须是候选数组，或包含 prospects / results 数组");
  return items.map((item) => normalizePublicProspect(item.prospect || item, defaults));
}

export function prospectsFromSearchResults(results = [], context = {}, observedAt = new Date()) {
  return results.map((result) => normalizePublicProspect({
    companyName: result.title,
    title: result.title,
    sourceUrl: result.url,
    publishedAt: result.publishedAt,
    observedAt,
    signalExcerpt: result.highlights,
    signalType: "search-result",
    originalPageReviewed: false,
    product: context.product,
    market: context.market,
    buyerType: context.buyerType,
    scoreInput: {
      needSignal: 1,
      productFit: 1,
      timing: result.publishedAt ? 1 : 0,
      publicReachability: 3,
      evidenceQuality: 1
    }
  }, context));
}

export function rankPublicProspects(prospects = []) {
  const seen = new Set();
  return prospects
    .map((item) => item.qualification ? item : normalizePublicProspect(item))
    .filter((item) => {
      const key = item.sourceUrl
        ? new URL(item.sourceUrl).hostname.replace(/^www\./u, "").toLowerCase()
        : clean(item.companyName).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.qualification.score - left.qualification.score);
}

export function prospectToLead(input, websiteResearch = {}) {
  const prospect = input?.qualification ? input : normalizePublicProspect(input);
  const reviewedPageUrl = cleanUrl(websiteResearch.reviewedPageUrl || websiteResearch.finalUrl || websiteResearch.url);
  if (!reviewedPageUrl || !websiteResearch.originalPageReviewed) {
    throw new Error("加入开发队列前必须人工核查一张原始公开页面");
  }
  const domainMatch = checkCompanyDomainMatch({ organization: { domain: prospect.companyDomain } }, reviewedPageUrl);
  if (!domainMatch.allowed) throw new Error("核查页面与公开候选的企业域名不一致");

  const websiteEvidence = Array.isArray(websiteResearch.evidence) ? websiteResearch.evidence : [];
  const base = normalizeLead({
    source: "Public research",
    sourceReference: prospect.sourceUrl || reviewedPageUrl,
    receivedAt: prospect.observedAt,
    organization: {
      name: prospect.companyName,
      domain: prospect.companyDomain,
      country: prospect.market
    },
    inquiry: {
      message: prospect.signalExcerpt,
      product: prospect.product
    },
    evidence: prospect.evidence,
    notes: "由公开搜索候选转入人工开发队列；不是客户主动询盘，联系前仍需确认身份、需求与合规基础。"
  });
  const organization = { ...(websiteResearch.organization || {}) };
  const fieldEvidence = { ...(websiteResearch.fieldEvidence || {}) };
  if (organization.website && !organization.domain) {
    organization.domain = new URL(cleanUrl(organization.website)).hostname.replace(/^www\./u, "");
    if (fieldEvidence["organization.website"]) {
      fieldEvidence["organization.domain"] = fieldEvidence["organization.website"];
    }
  }
  return mergeEvidenceIntoLead(base, {
    organization,
    contact: websiteResearch.contact,
    evidence: websiteEvidence,
    fieldEvidence,
    appliedAt: websiteResearch.reviewedAt
  });
}
