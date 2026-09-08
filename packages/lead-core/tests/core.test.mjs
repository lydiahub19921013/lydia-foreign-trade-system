import test from "node:test";
import assert from "node:assert/strict";
import {
  createEvidence,
  assessEmailCandidates,
  checkCompanyDomainMatch,
  checkEmailCandidateLeadMatch,
  findDuplicateCandidates,
  generateEmailCandidates,
  leadsFromCsv,
  mergeEvidenceIntoLead,
  normalizeLead,
  parseCsv,
  qualifyLead,
  rankIntroductionPaths,
  relationshipsFromCsv,
  relationshipsFromJson
} from "../src/index.mjs";

test("CSV parser preserves commas and newlines inside quoted inquiry text", () => {
  const rows = parseCsv('company_name,message\n"Demo Co","Need 2,000 units,\nFOB Shanghai"\n');
  assert.equal(rows[0].company_name, "Demo Co");
  assert.equal(rows[0].message, "Need 2,000 units,\nFOB Shanghai");
});

test("strong evidence and buying signals produce an A lead", () => {
  const lead = normalizeLead({
    source: "Alibaba",
    sourceReference: "DEMO-001",
    organization: { name: "Demo Buyer", website: "https://buyer.example" },
    contact: { name: "Alex", role: "Sourcing Manager", email: "alex@buyer.example" },
    inquiry: {
      message: "Please quote",
      product: "Reusable bottle",
      quantity: "2000",
      timeline: "30 days",
      budget: "USD 4-5"
    },
    signals: {
      explicitInquiry: true,
      replied: true,
      requestedQuote: true,
      requestedSample: true,
      mutualIntroduction: true
    },
    evidence: [
      createEvidence({ kind: "company-website", value: "https://buyer.example", sourceRef: "https://buyer.example/about", status: "verified" }),
      createEvidence({ kind: "business-registration", value: "DEMO-REG", sourceRef: "registry:demo", status: "verified" }),
      createEvidence({ kind: "factory", value: "factory profile", sourceRef: "https://buyer.example/factory", status: "verified" }),
      createEvidence({ kind: "business-email", value: "alex@buyer.example", sourceRef: "company-site", status: "verified" })
    ]
  });

  const result = qualifyLead(lead);
  assert.equal(result.grade, "A");
  assert.ok(result.score >= 75);
});

test("do-not-contact always stops qualification", () => {
  const result = qualifyLead({
    sourceReference: "DEMO-002",
    organization: { name: "Demo" },
    compliance: { doNotContact: true }
  });
  assert.equal(result.grade, "HOLD");
  assert.match(result.reasons.join(" "), /不联系/);
});

test("country and personal identity do not affect score", () => {
  const base = {
    sourceReference: "DEMO-003",
    organization: { name: "Same Buyer" },
    inquiry: { product: "Part", quantity: "100" },
    signals: { explicitInquiry: true }
  };
  const left = qualifyLead({ ...base, organization: { ...base.organization, country: "Country A" } });
  const right = qualifyLead({ ...base, organization: { ...base.organization, country: "Country B" } });
  assert.equal(left.score, right.score);
});

test("an imported candidate email is not scored as verified", () => {
  const [lead] = leadsFromCsv("source,source_reference,company_name,email,email_status\nManual,DEMO-004,Demo Co,buyer@example.com,candidate\n");
  const result = qualifyLead(lead);
  assert.equal(result.dimensions.contactabilityAndTrust.score, 2);
  assert.ok(result.missingEvidence.includes("工作邮箱验证"));
});

test("relationship paths prioritize strong recent consented relationships", () => {
  const ranked = rankIntroductionPaths([
    { connectorId: "weak", targetId: "buyer", relationshipStrength: 2, lastContactAt: "2024-01-01", evidenceIds: ["e1"], consentStatus: "unknown" },
    { connectorId: "strong", targetId: "buyer", relationshipStrength: 5, lastContactAt: "2026-08-20", knownPersonally: true, sharedCompany: true, evidenceIds: ["e2"], consentStatus: "approved" }
  ], { now: "2026-09-08" });
  assert.equal(ranked[0].connectorId, "strong");
  assert.match(ranked[0].nextAction, /关系人/);
});

test("declined relationship paths are excluded", () => {
  const ranked = rankIntroductionPaths([
    { connectorId: "no", targetId: "buyer", relationshipStrength: 5, consentStatus: "declined" }
  ], { now: "2026-09-08" });
  assert.equal(ranked.length, 0);
});

test("relationship CSV imports owned relationship context and evidence", () => {
  const [path] = relationshipsFromCsv(
    "connector_id,connector_name,target_id,target_name,relationship_strength,last_contact_at,known_personally,shared_industry,consent_status,evidence_ids\nconnector-demo,林示例,target-demo,Northstar Demo,4,2026-08-28,是,true,approved,crm-demo-01|meeting-demo-02\n"
  );
  assert.equal(path.connectorName, "林示例");
  assert.equal(path.targetName, "Northstar Demo");
  assert.equal(path.relationshipStrength, 4);
  assert.equal(path.knownPersonally, true);
  assert.deepEqual(path.evidenceIds, ["crm-demo-01", "meeting-demo-02"]);
});

test("relationship JSON normalizes consent and never revives a declined path", () => {
  const ranked = rankIntroductionPaths(relationshipsFromJson({ paths: [{
    connector_id: "connector-demo",
    target_id: "target-demo",
    relationship_strength: 5,
    known_personally: true,
    consent_status: "DECLINED",
    evidence_ids: "crm-demo"
  }] }), { now: "2026-09-08" });
  assert.equal(ranked.length, 0);
});

test("ranked relationship paths retain names and explain their evidence cap", () => {
  const [result] = rankIntroductionPaths([{ connectorName: "林示例", targetName: "Northstar Demo", relationshipStrength: 5 }], { now: "2026-09-08" });
  assert.equal(result.connectorName, "林示例");
  assert.equal(result.targetName, "Northstar Demo");
  assert.equal(result.score, 40);
  assert.ok(result.reasons.some((reason) => reason.includes("最高 49 分")));
});

test("stable lead IDs are identical for the same input in browser-safe core", () => {
  const input = { source: "Manual", sourceReference: "DEMO-005", organization: { name: "Demo" } };
  assert.equal(normalizeLead(input).id, normalizeLead(input).id);
});

test("duplicate detection distinguishes strong domain matches from weak name matches", () => {
  const duplicates = findDuplicateCandidates([
    { id: "a", organization: { name: "Demo Buyer", country: "Exampleland", website: "https://buyer.example/about" } },
    { id: "b", organization: { name: "Demo Buyer", country: "Exampleland", domain: "buyer.example" } }
  ]);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].confidence, 0.95);
  assert.equal(duplicates[0].automaticHoldRecommended, true);
  assert.ok(duplicates[0].reasons.includes("相同企业域名"));
});

test("common Chinese inquiry headers map into the Lydia model", () => {
  const [lead] = leadsFromCsv(
    "询盘编号,公司名称,买家姓名,国家/地区,询盘内容,产品名称,采购数量,工作邮箱\nDEMO-CN-01,虚构采购公司,林样例,示例国,请报价,收纳盒,500,buyer@example.com\n",
    { channel: "alibaba" }
  );
  assert.equal(lead.source, "Alibaba");
  assert.equal(lead.sourceReference, "DEMO-CN-01");
  assert.equal(lead.organization.name, "虚构采购公司");
  assert.equal(lead.contact.name, "林样例");
  assert.equal(lead.inquiry.product, "收纳盒");
  assert.equal(lead.inquiry.quantity, "500");
});

test("confirmed research evidence fills empty fields without overwriting customer data", () => {
  const lead = normalizeLead({
    sourceReference: "DEMO-MERGE",
    organization: { name: "Customer-entered name", address: "Existing address" },
    contact: { email: "manual@example.com" }
  });
  const evidence = createEvidence({
    kind: "business-registration",
    value: "DEMO-REG",
    sourceRef: "registry:demo",
    status: "verified"
  });
  const merged = mergeEvidenceIntoLead(lead, {
    organization: { name: "Registry name", address: "Registry address", registrationId: "DEMO-REG" },
    contact: { email: "public@example.com", whatsapp: "+1-555-0100" },
    evidence: [evidence, evidence]
  });
  assert.equal(merged.organization.name, "Customer-entered name");
  assert.equal(merged.organization.address, "Existing address");
  assert.equal(merged.organization.registrationId, "DEMO-REG");
  assert.equal(merged.contact.email, "manual@example.com");
  assert.equal(merged.contact.whatsapp, "+1-555-0100");
  assert.equal(merged.evidence.length, 1);
});

test("email candidates use a bounded explainable pattern set", () => {
  const candidates = generateEmailCandidates("Álex Morgan", "https://www.buyer.example.com/contact");
  assert.equal(candidates[0].email, "alex.morgan@buyer.example.com");
  assert.ok(candidates.some((item) => item.email === "amorgan@buyer.example.com"));
  assert.ok(candidates.some((item) => item.email === "export@buyer.example.com" && item.type === "role"));
  assert.ok(candidates.length <= 10);
  assert.ok(candidates.every((item) => item.status === "candidate"));
  assert.throws(() => generateEmailCandidates("Alex Morgan", "127.0.0.1"), /格式不正确/);
  assert.throws(() => generateEmailCandidates("Alex Morgan", "mail.internal"), /格式不正确/);
});

test("email candidates remain unverified even with MX or website evidence", () => {
  const candidates = generateEmailCandidates("Alex Morgan", "buyer.example.com");
  const assessed = assessEmailCandidates(candidates, { status: "mx-found" }, ["alex.morgan@buyer.example.com"]);
  assert.equal(assessed[0].email, "alex.morgan@buyer.example.com");
  assert.equal(assessed[0].listedOnWebsite, true);
  assert.equal(assessed[0].status, "candidate");
  assert.ok(assessed[0].signals.includes("域名存在 MX 邮件记录"));
});

test("email candidates are rejected when the domain has no mail route", () => {
  const assessed = assessEmailCandidates(generateEmailCandidates("Alex Morgan", "buyer.example.com"), { status: "no-mail-route" });
  assert.ok(assessed.every((item) => item.status === "rejected"));
});

test("candidate email cannot attach to a lead with a different company domain", () => {
  const match = checkEmailCandidateLeadMatch({ organization: { website: "https://www.northstar.example/contact" } }, "northstar.example");
  assert.equal(match.allowed, true);
  assert.equal(match.existingDomain, "northstar.example");
  const mismatch = checkEmailCandidateLeadMatch({ organization: { domain: "northstar.example" } }, "other.example");
  assert.equal(mismatch.allowed, false);
  assert.match(mismatch.reason, /不一致/);
});

test("website evidence accepts company subdomains but blocks another company", () => {
  const lead = { organization: { domain: "northstar.example" } };
  assert.equal(checkCompanyDomainMatch(lead, "www.northstar.example" ).allowed, true);
  assert.equal(checkCompanyDomainMatch(lead, "contact.northstar.example").allowed, true);
  const mismatch = checkCompanyDomainMatch(lead, "harbor.example");
  assert.equal(mismatch.allowed, false);
  assert.match(mismatch.reason, /企业域名不一致/);
});
