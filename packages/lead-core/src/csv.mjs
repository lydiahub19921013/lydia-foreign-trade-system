import { createEvidence, normalizeLead } from "./model.mjs";

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

export function leadFromFlatRecord(record) {
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

export function leadsFromCsv(text) {
  return parseCsv(text).map(leadFromFlatRecord);
}
