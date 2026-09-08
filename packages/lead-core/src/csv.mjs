import { createEvidence, normalizeLead } from "./model.mjs";

const FIELD_ALIASES = {
  source: ["source", "channel", "platform", "来源", "渠道", "平台"],
  source_reference: ["source_reference", "inquiry_id", "inquiry_no", "inquiry_number", "inquiry_url", "rfq_id", "询盘编号", "询盘id", "询盘号", "询盘链接", "rfq编号"],
  received_at: ["received_at", "received_time", "inquiry_time", "created_at", "date", "收到时间", "询盘时间", "创建时间", "日期"],
  company_name: ["company_name", "company", "buyer_company", "organization", "公司名称", "公司", "买家公司", "企业名称"],
  domain: ["domain", "company_domain", "域名", "公司域名"],
  website: ["website", "company_website", "web_site", "官网", "公司网站", "网站"],
  country: ["country", "country_region", "market", "国家", "国家地区", "市场"],
  address: ["address", "company_address", "地址", "公司地址"],
  industry: ["industry", "business_type", "行业", "业务类型"],
  contact_name: ["contact_name", "buyer_name", "contact", "name", "联系人", "买家姓名", "姓名"],
  contact_role: ["contact_role", "job_title", "position", "title", "联系人职位", "职务", "职位"],
  email: ["email", "email_address", "business_email", "邮箱", "电子邮箱", "工作邮箱"],
  whatsapp: ["whatsapp", "whatsapp_number", "whats_app", "whatsapp号码"],
  phone: ["phone", "telephone", "mobile", "phone_number", "电话", "手机", "联系电话"],
  message: ["message", "inquiry_content", "content", "inquiry_message", "description", "询盘内容", "询盘信息", "留言", "内容"],
  product: ["product", "product_name", "subject", "inquiry_title", "产品", "产品名称", "询盘标题"],
  quantity: ["quantity", "order_quantity", "purchase_quantity", "数量", "采购数量", "订购数量"],
  timeline: ["timeline", "delivery_time", "purchase_time", "expected_date", "交期", "采购时间", "期望时间"],
  budget: ["budget", "target_price", "price", "预算", "目标价格", "价格"],
  notes: ["notes", "remark", "remarks", "备注"]
};

function normalizedHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const aliasIndex = new Map(
  Object.entries(FIELD_ALIASES).flatMap(([canonical, aliases]) =>
    aliases.map((alias) => [normalizedHeader(alias), canonical])
  )
);

export function canonicalizeFlatRecord(record, options = {}) {
  const canonical = {};
  for (const [header, value] of Object.entries(record || {})) {
    const field = aliasIndex.get(normalizedHeader(header)) || header;
    if (canonical[field] === undefined || canonical[field] === "") canonical[field] = value;
  }

  if (!canonical.source) {
    if (options.channel === "alibaba") canonical.source = "Alibaba";
    if (options.channel === "made-in-china") canonical.source = "Made-in-China";
  }
  return canonical;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  if (!rows.length) return [];

  const headers = rows.shift().map((header) => header.trim().replace(/^\uFEFF/, ""));
  return rows.map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index]?.trim() || ""])
  ));
}

function status(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["verified", "candidate", "inconclusive", "rejected"].includes(normalized)
    ? normalized
    : "candidate";
}

function addImportedEvidence(record, evidence, field, kind, sourceRef) {
  if (!record[field]) return;
  evidence.push(createEvidence({
    kind,
    value: record[field],
    sourceRef,
    observedAt: record.observed_at || record.received_at,
    status: status(record[`${field}_status`]),
    confidence: record[`${field}_confidence`] || undefined,
    note: "由 Lydia 导入模板生成"
  }));
}

export function leadFromFlatRecord(input, options = {}) {
  const record = canonicalizeFlatRecord(input, options);
  const sourceRef = record.source_reference || record.inquiry_url || record.inquiry_id || null;
  const evidence = [];

  if (sourceRef) {
    evidence.push(createEvidence({
      kind: "source-record",
      value: sourceRef,
      sourceRef,
      observedAt: record.received_at,
      status: "verified",
      confidence: 1
    }));
  }
  addImportedEvidence(record, evidence, "website", "company-website", sourceRef);
  addImportedEvidence(record, evidence, "registration_id", "business-registration", sourceRef);
  addImportedEvidence(record, evidence, "factory_info", "factory", sourceRef);
  addImportedEvidence(record, evidence, "email", "business-email", sourceRef);
  addImportedEvidence(record, evidence, "whatsapp", "whatsapp", sourceRef);
  addImportedEvidence(record, evidence, "phone", "business-phone", sourceRef);

  return normalizeLead({
    id: record.id,
    source: record.source,
    sourceReference: sourceRef,
    receivedAt: record.received_at,
    organization: {
      name: record.company_name,
      domain: record.domain,
      website: record.website,
      country: record.country,
      address: record.address,
      industry: record.industry,
      employeeRange: record.employee_range,
      registrationId: record.registration_id,
      factoryInfo: record.factory_info
    },
    contact: {
      name: record.contact_name,
      role: record.contact_role,
      email: record.email,
      whatsapp: record.whatsapp,
      phone: record.phone
    },
    inquiry: {
      message: record.message,
      product: record.product,
      quantity: record.quantity,
      timeline: record.timeline,
      budget: record.budget
    },
    signals: {
      explicitInquiry: record.explicit_inquiry || Boolean(record.message),
      replied: record.replied,
      requestedQuote: record.requested_quote,
      requestedSample: record.requested_sample,
      purchaseOrder: record.purchase_order,
      mutualIntroduction: record.mutual_introduction,
      priorRelationship: record.prior_relationship
    },
    evidence,
    compliance: {
      doNotContact: record.do_not_contact,
      restrictedMarket: record.restricted_market,
      duplicateOf: record.duplicate_of,
      consentStatus: record.consent_status
    },
    notes: record.notes
  });
}

export function leadsFromCsv(text, options = {}) {
  return parseCsv(text).map((record) => leadFromFlatRecord(record, options));
}
