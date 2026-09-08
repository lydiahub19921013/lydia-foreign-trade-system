import test from "node:test";
import assert from "node:assert/strict";
import {
  SCHEMA_VERSION,
  createEvidence,
  findDuplicateCandidates,
  mergeEvidenceIntoLead,
  normalizeLead,
  qualifyLead,
  reviewLeadEvidence,
  reviseLeadEvidence
} from "../src/index.mjs";

function enrichedLead() {
  const website = createEvidence({
    id: "site-evidence",
    kind: "company-website",
    value: "https://northstar.example/about",
    sourceRef: "https://northstar.example/about",
    status: "verified"
  });
  const email = createEvidence({
    id: "email-evidence",
    kind: "business-email",
    value: "sales@northstar.example",
    sourceRef: "https://northstar.example/contact",
    status: "verified"
  });
  const lead = normalizeLead({
    source: "Manual",
    sourceReference: "DEMO-REVIEW",
    organization: { name: "人工录入名称" },
    inquiry: { product: "Demo product" }
  });
  return mergeEvidenceIntoLead(lead, {
    organization: { website: website.value },
    contact: { email: email.value },
    evidence: [website, email],
    fieldEvidence: {
      "organization.website": website.id,
      "contact.email": email.id
    },
    appliedAt: "2026-09-08T01:00:00Z"
  });
}

test("enrichment records which evidence filled each empty field", () => {
  const lead = enrichedLead();
  assert.equal(lead.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(lead.fieldOrigins.map((item) => [item.path, item.evidenceId]), [
    ["organization.website", "site-evidence"],
    ["contact.email", "email-evidence"]
  ]);
  assert.equal(lead.organization.name, "人工录入名称");
  assert.equal(lead.fieldOrigins.some((item) => item.path === "organization.name"), false);
});

test("rejecting evidence rolls back only the unchanged field and changes qualification", () => {
  const before = enrichedLead();
  const beforeScore = qualifyLead(before).score;
  const result = reviewLeadEvidence(before, "email-evidence", {
    decision: "rejected",
    note: "官网已删除该邮箱",
    reviewedAt: "2026-09-08T02:00:00Z"
  });
  assert.equal(result.lead.contact.email, null);
  assert.deepEqual(result.clearedFields, ["contact.email"]);
  assert.equal(result.lead.evidence.find((item) => item.id === "email-evidence").review.decision, "rejected");
  assert.equal(result.lead.evidence.find((item) => item.id === "email-evidence").review.history.at(-1).action, "rejected");
  assert.ok(qualifyLead(result.lead).score < beforeScore);
});

test("rejecting evidence never overwrites a later manual field edit", () => {
  const lead = enrichedLead();
  lead.contact.email = "manual@northstar.example";
  const result = reviewLeadEvidence(lead, "email-evidence", {
    decision: "rejected",
    note: "改用人工确认邮箱",
    reviewedAt: "2026-09-08T02:00:00Z"
  });
  assert.equal(result.lead.contact.email, "manual@northstar.example");
  assert.deepEqual(result.preservedFields, ["contact.email"]);
  assert.equal(result.lead.fieldOrigins.find((item) => item.evidenceId === "email-evidence").endReason, "field-changed");
});

test("accepted evidence restores an empty rolled-back field without replacing manual data", () => {
  const rejected = reviewLeadEvidence(enrichedLead(), "site-evidence", {
    decision: "rejected",
    note: "暂时无法确认主体",
    reviewedAt: "2026-09-08T02:00:00Z"
  });
  const restored = reviewLeadEvidence(rejected.lead, "site-evidence", {
    decision: "accepted",
    note: "重新核对主体一致",
    reviewedAt: "2026-09-08T03:00:00Z"
  });
  assert.equal(restored.lead.organization.website, "https://northstar.example/about");
  assert.deepEqual(restored.restoredFields, ["organization.website"]);
  assert.deepEqual(restored.lead.evidence.find((item) => item.id === "site-evidence").review.history.map((item) => item.action), ["rejected", "accepted"]);
});

test("revising evidence updates its managed field and preserves the before-after history", () => {
  const revised = reviseLeadEvidence(enrichedLead(), "site-evidence", {
    value: "https://northstar.example/company",
    sourceRef: "https://northstar.example/company"
  }, {
    note: "官网栏目地址调整",
    reviewedAt: "2026-09-08T04:00:00Z"
  });
  assert.equal(revised.lead.organization.website, "https://northstar.example/company");
  assert.deepEqual(revised.updatedFields, ["organization.website"]);
  const evidence = revised.lead.evidence.find((item) => item.id === "site-evidence");
  assert.equal(evidence.review.history.at(-1).action, "revised");
  assert.equal(evidence.review.history.at(-1).changes.value.from, "https://northstar.example/about");
  assert.equal(evidence.review.history.at(-1).changes.value.to, "https://northstar.example/company");
});

test("export and reimport preserve field provenance and the complete review history", () => {
  const rejected = reviewLeadEvidence(enrichedLead(), "site-evidence", {
    decision: "rejected",
    note: "首次复核暂不采用",
    reviewedAt: "2026-09-08T02:00:00Z"
  });
  const restored = reviewLeadEvidence(rejected.lead, "site-evidence", {
    decision: "accepted",
    note: "二次核对恢复使用",
    reviewedAt: "2026-09-08T03:00:00Z"
  });
  const roundTrip = normalizeLead(JSON.parse(JSON.stringify(restored.lead)));
  assert.equal(roundTrip.schemaVersion, SCHEMA_VERSION);
  assert.equal(roundTrip.organization.website, "https://northstar.example/about");
  assert.equal(roundTrip.fieldOrigins.find((item) => item.path === "organization.website").active, true);
  assert.deepEqual(roundTrip.evidence.find((item) => item.id === "site-evidence").review.history.map((item) => item.action), ["rejected", "accepted"]);
});

test("evidence revision preserves a manually changed field", () => {
  const lead = enrichedLead();
  lead.organization.website = "https://manual.example";
  const revised = reviseLeadEvidence(lead, "site-evidence", {
    value: "https://northstar.example/company"
  }, {
    note: "来源内容发生变化",
    reviewedAt: "2026-09-08T04:00:00Z"
  });
  assert.equal(revised.lead.organization.website, "https://manual.example");
  assert.deepEqual(revised.preservedFields, ["organization.website"]);
});

test("evidence decisions require an auditable reason", () => {
  assert.throws(() => reviewLeadEvidence(enrichedLead(), "site-evidence", { decision: "rejected", note: "否" }), /至少 3 个字/);
  assert.throws(() => reviseLeadEvidence(enrichedLead(), "site-evidence", { sourceRef: "" }, { note: "删除错误来源" }), /来源不能为空/);
});

test("a human-rejected verified email no longer creates a duplicate fingerprint", () => {
  const first = normalizeLead({
    id: "first",
    organization: { name: "First Demo" },
    evidence: [{ id: "shared", kind: "business-email", value: "shared@example.com", sourceRef: "registry:demo", status: "verified" }]
  });
  const rejected = reviewLeadEvidence(first, "shared", {
    decision: "rejected",
    note: "确认并非该企业邮箱",
    reviewedAt: "2026-09-08T05:00:00Z"
  }).lead;
  const second = normalizeLead({
    id: "second",
    organization: { name: "Second Demo" },
    evidence: [{ kind: "business-email", value: "shared@example.com", sourceRef: "registry:demo", status: "verified" }]
  });
  assert.equal(findDuplicateCandidates([rejected, second]).length, 0);
});
