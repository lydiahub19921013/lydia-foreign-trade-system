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

export const CSV_IMPORT_FIELD_DEFINITIONS = Object.freeze([
  ["source", "渠道来源"],
  ["source_reference", "询盘编号或链接"],
  ["received_at", "收到时间"],
  ["company_name", "企业名称"],
  ["domain", "企业域名"],
  ["website", "企业官网"],
  ["country", "国家或地区"],
  ["address", "企业地址"],
  ["industry", "行业或业务类型"],
  ["employee_range", "员工规模"],
  ["registration_id", "企业登记编号"],
  ["factory_info", "工厂或产能信息"],
  ["contact_name", "联系人姓名"],
  ["contact_role", "联系人职位"],
  ["email", "工作邮箱候选"],
  ["whatsapp", "WhatsApp 候选"],
  ["phone", "联系电话候选"],
  ["message", "原始询盘内容"],
  ["product", "产品"],
  ["quantity", "采购数量"],
  ["timeline", "采购或交期"],
  ["budget", "预算或目标价格"],
  ["notes", "备注"]
].map(([field, label]) => Object.freeze({ field, label })));

const SUPPORTED_IMPORT_FIELDS = new Set([
  ...CSV_IMPORT_FIELD_DEFINITIONS.map(({ field }) => field),
  "id",
  "observed_at",
  "explicit_inquiry",
  "replied",
  "requested_quote",
  "requested_sample",
  "purchase_order",
  "mutual_introduction",
  "prior_relationship",
  "do_not_contact",
  "restricted_market",
  "duplicate_of",
  "consent_status",
  ...["website", "registration_id", "factory_info", "email", "whatsapp", "phone"]
    .flatMap((field) => [`${field}_status`, `${field}_confidence`])
]);

const MEANINGFUL_IMPORT_FIELDS = new Set([
  "source_reference",
  "company_name",
  "website",
  "contact_name",
  "email",
  "whatsapp",
  "phone",
  "message",
  "product"
]);

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

function mappedField(header, fieldMap) {
  if (fieldMap && typeof fieldMap === "object" && Object.hasOwn(fieldMap, header)) {
    const explicit = String(fieldMap[header] ?? "").trim();
    if (!explicit) return { field: null, explicit: true };
    if (!SUPPORTED_IMPORT_FIELDS.has(explicit)) throw new Error(`不支持的 Lydia 字段：${explicit}`);
    return { field: explicit, explicit: true };
  }
  const alias = aliasIndex.get(normalizedHeader(header));
  if (alias) return { field: alias, explicit: false };
  const canonical = String(header || "").trim();
  return {
    field: SUPPORTED_IMPORT_FIELDS.has(canonical) ? canonical : null,
    explicit: false
  };
}

export function canonicalizeFlatRecord(record, options = {}) {
  const canonical = {};
  for (const [header, value] of Object.entries(record || {})) {
    const resolved = mappedField(header, options.fieldMap);
    if (resolved.explicit && !resolved.field) continue;
    const field = resolved.field || header;
    if (canonical[field] === undefined || canonical[field] === "") canonical[field] = value;
  }

  if (!canonical.source) {
    if (options.channel === "alibaba") canonical.source = "Alibaba";
    if (options.channel === "made-in-china") canonical.source = "Made-in-China";
  }
  return canonical;
}

function parseCsvRows(text) {
  const source = String(text ?? "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
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

  if (quoted) throw new Error("CSV 中有未闭合的引号，请先修正原文件");

  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

function parseCsvDocument(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) return { headers: [], values: [], records: [] };

  const headers = rows.shift().map((header) => header.trim().replace(/^\uFEFF/, ""));
  const records = rows.map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index]?.trim() || ""])
  ));
  return { headers, values: rows, records };
}

export function parseCsv(text) {
  return parseCsvDocument(text).records;
}

function sampleValues(values, columnIndex) {
  return [...new Set(values
    .map((row) => String(row[columnIndex] ?? "").trim())
    .filter(Boolean)
    .map((value) => value.length > 80 ? `${value.slice(0, 79)}…` : value))]
    .slice(0, 2);
}

export function inspectCsvImport(text, options = {}) {
  const document = parseCsvDocument(text);
  const normalizedHeaders = document.headers.map(normalizedHeader);
  const duplicateHeaderNames = [...new Set(document.headers.filter((header, index) => {
    const normalized = normalizedHeaders[index];
    return normalized && normalizedHeaders.indexOf(normalized) !== index;
  }))];
  const mappings = document.headers.map((header, index) => {
    const resolved = mappedField(header, options.fieldMap);
    return {
      header,
      field: resolved.field,
      explicit: resolved.explicit,
      populatedRows: document.values.filter((row) => String(row[index] ?? "").trim()).length,
      samples: sampleValues(document.values, index)
    };
  });
  const targetCounts = new Map();
  for (const { field } of mappings) {
    if (field) targetCounts.set(field, (targetCounts.get(field) || 0) + 1);
  }
  for (const mapping of mappings) {
    mapping.status = !mapping.field
      ? "unmapped"
      : targetCounts.get(mapping.field) > 1 ? "duplicate-target" : "mapped";
  }

  const canonicalRecords = document.records.map((record) => canonicalizeFlatRecord(record, options));
  const usableRows = canonicalRecords.filter((record) => [...MEANINGFUL_IMPORT_FIELDS]
    .some((field) => String(record[field] ?? "").trim()));
  const missingSourceReferenceRows = usableRows.filter((record) => !String(record.source_reference ?? "").trim()).length;
  const missingInquiryRows = usableRows.filter((record) => !String(record.message ?? "").trim()
    && !String(record.product ?? "").trim()).length;
  const missingOrganizationRows = usableRows.filter((record) => !["company_name", "domain", "website"]
    .some((field) => String(record[field] ?? "").trim())).length;
  const missingContactRows = usableRows.filter((record) => !["contact_name", "email", "whatsapp", "phone"]
    .some((field) => String(record[field] ?? "").trim())).length;
  const unmappedHeaders = mappings.filter((mapping) => !mapping.field && mapping.populatedRows > 0).map((mapping) => mapping.header);
  const duplicateTargets = [...targetCounts.entries()].filter(([, count]) => count > 1).map(([field]) => field);
  const shortRows = document.values.filter((row) => row.length < document.headers.length).length;
  const longRows = document.values.filter((row) => row.length > document.headers.length).length;
  const errors = [];
  const warnings = [];

  if (!document.headers.length) errors.push("CSV 没有表头");
  if (document.headers.some((header) => !normalizedHeader(header))) errors.push("CSV 存在空白表头");
  if (duplicateHeaderNames.length) errors.push(`CSV 存在重复表头：${duplicateHeaderNames.join("、")}`);
  if (!document.values.length) errors.push("CSV 没有数据行");
  if (!mappings.some((mapping) => mapping.field)) errors.push("尚未识别任何 Lydia 字段，请至少映射一个客户或询盘字段");
  if (document.values.length && !usableRows.length) errors.push("数据行里没有可识别的客户身份、联系方式或询盘内容");
  if (unmappedHeaders.length) warnings.push(`${unmappedHeaders.length} 列尚未映射，不会进入客户档案`);
  if (duplicateTargets.length) warnings.push(`${duplicateTargets.length} 个 Lydia 字段由多列提供；每行优先使用靠左的非空值`);
  if (shortRows) warnings.push(`${shortRows} 行末尾缺少部分单元格，缺失值会按空白处理`);
  if (longRows) warnings.push(`${longRows} 行比表头多出单元格，多余值不会导入`);
  if ((options.channel || "auto") === "auto" && !targetCounts.has("source")) {
    warnings.push("没有渠道来源列且当前选择自动识别，导入后来源会记为 manual");
  }
  if (missingSourceReferenceRows) warnings.push(`${missingSourceReferenceRows} 条可用记录没有来源编号或链接，后续追溯和去重会变弱`);
  if (missingInquiryRows) warnings.push(`${missingInquiryRows} 条可用记录没有询盘正文或产品，需求判断会受限`);
  if (missingOrganizationRows) warnings.push(`${missingOrganizationRows} 条可用记录没有企业名称、域名或官网，企业背调会受限`);
  if (missingContactRows) warnings.push(`${missingContactRows} 条可用记录没有联系人或联系方式，后续开发会受限`);

  return {
    format: "lydia-csv-import-review",
    schemaVersion: 1,
    channel: options.channel || "auto",
    rowCount: document.values.length,
    usableRowCount: usableRows.length,
    mappedHeaderCount: mappings.filter((mapping) => mapping.field).length,
    mappedFields: [...targetCounts.keys()],
    blankHeaderCount: document.headers.filter((header) => !normalizedHeader(header)).length,
    duplicateHeaders: duplicateHeaderNames,
    unmappedHeaders,
    duplicateTargets,
    shortRowCount: shortRows,
    longRowCount: longRows,
    missingSourceReferenceRows,
    missingInquiryRows,
    missingOrganizationRows,
    missingContactRows,
    mappings,
    errors,
    warnings,
    canImport: errors.length === 0
  };
}

export function normalizeCsvImportAudit(input) {
  if (!input || typeof input !== "object" || input.format !== "lydia-csv-import-audit") {
    throw new Error("CSV 导入核对记录格式不正确");
  }
  const schemaVersion = Number(input.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new Error("CSV 导入核对记录缺少有效版本");
  if (schemaVersion > 1) throw new Error("CSV 导入核对记录来自更新版本，请先升级 Lydia 外贸系统");
  const reviewedAt = new Date(input.reviewedAt);
  if (Number.isNaN(reviewedAt.valueOf())) throw new Error("CSV 导入核对时间无效");
  return {
    format: "lydia-csv-import-audit",
    schemaVersion,
    reviewedAt: reviewedAt.toISOString(),
    channel: String(input.channel || "auto").trim().slice(0, 40) || "auto",
    rowCount: Math.max(0, Number.parseInt(input.rowCount, 10) || 0),
    usableRowCount: Math.max(0, Number.parseInt(input.usableRowCount, 10) || 0),
    mappings: (Array.isArray(input.mappings) ? input.mappings : []).map((mapping) => {
      const field = SUPPORTED_IMPORT_FIELDS.has(mapping?.field) ? mapping.field : null;
      const status = ["mapped", "unmapped", "duplicate-target"].includes(mapping?.status)
        ? mapping.status
        : field ? "mapped" : "unmapped";
      return {
        header: String(mapping?.header ?? "").trim().slice(0, 200),
        field,
        status,
        populatedRows: Math.max(0, Number.parseInt(mapping?.populatedRows, 10) || 0)
      };
    }).slice(0, 200),
    warnings: (Array.isArray(input.warnings) ? input.warnings : [])
      .map((warning) => String(warning ?? "").trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 50)
  };
}

export function createCsvImportAudit(report, options = {}) {
  if (!report || typeof report !== "object" || report.format !== "lydia-csv-import-review") {
    throw new Error("请先完成 CSV 导入核对");
  }
  if (!report.canImport) throw new Error("CSV 字段核对尚未通过，不能生成导入记录");
  return normalizeCsvImportAudit({
    format: "lydia-csv-import-audit",
    schemaVersion: 1,
    reviewedAt: options.reviewedAt || Date.now(),
    channel: report.channel,
    rowCount: report.rowCount,
    usableRowCount: report.usableRowCount,
    mappings: report.mappings.map(({ header, field, status, populatedRows }) => ({
      header,
      field,
      status,
      populatedRows
    })),
    warnings: report.warnings
  });
}

function status(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["verified", "candidate", "inconclusive", "rejected"].includes(normalized)
    ? normalized
    : "candidate";
}

function addImportedEvidence(record, evidence, field, kind, sourceRef) {
  if (!record[field]) return null;
  const item = createEvidence({
    kind,
    value: record[field],
    sourceRef,
    observedAt: record.observed_at || record.received_at,
    status: status(record[`${field}_status`]),
    confidence: record[`${field}_confidence`] || undefined,
    note: "由 Lydia 导入模板生成"
  });
  evidence.push(item);
  return item;
}

function addImportedField(record, evidence, fieldOrigins, field, kind, path, sourceRef) {
  const item = addImportedEvidence(record, evidence, field, kind, sourceRef);
  if (!item) return;
  fieldOrigins.push({
    path,
    evidenceId: item.id,
    appliedValue: record[field],
    appliedAt: item.observedAt,
    active: true
  });
}

export function leadFromFlatRecord(input, options = {}) {
  const record = canonicalizeFlatRecord(input, options);
  const sourceRef = record.source_reference || record.inquiry_url || record.inquiry_id || null;
  const evidence = [];
  const fieldOrigins = [];

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
  addImportedField(record, evidence, fieldOrigins, "website", "company-website", "organization.website", sourceRef);
  addImportedField(record, evidence, fieldOrigins, "registration_id", "business-registration", "organization.registrationId", sourceRef);
  addImportedField(record, evidence, fieldOrigins, "factory_info", "factory", "organization.factoryInfo", sourceRef);
  addImportedField(record, evidence, fieldOrigins, "email", "business-email", "contact.email", sourceRef);
  addImportedField(record, evidence, fieldOrigins, "whatsapp", "whatsapp", "contact.whatsapp", sourceRef);
  addImportedField(record, evidence, fieldOrigins, "phone", "business-phone", "contact.phone", sourceRef);

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
    fieldOrigins,
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
