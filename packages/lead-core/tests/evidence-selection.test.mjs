import test from "node:test";
import assert from "node:assert/strict";
import { enrichmentFromEvidenceSelection } from "../src/index.mjs";

const evidence = [
  { id: "site", kind: "company-website", value: "https://northstar.example/about", sourceRef: "https://northstar.example/about", status: "candidate" },
  { id: "name", kind: "organization-name", value: "Northstar Demo", sourceRef: "https://northstar.example/about", status: "candidate" },
  { id: "email", kind: "business-email", value: "sales@northstar.example", sourceRef: "https://northstar.example/contact", status: "candidate" },
  { id: "phone", kind: "business-phone", value: "+1-555-0100", sourceRef: "https://northstar.example/contact", status: "candidate" },
  { id: "factory", kind: "factory", value: "Fictional production statement", sourceRef: "https://northstar.example/factory", status: "candidate" }
];

test("evidence selection writes only explicitly selected values", () => {
  const result = enrichmentFromEvidenceSelection(evidence, ["site", "email", "factory"], { reviewedAt: "2026-09-08T00:00:00Z" });
  assert.equal(result.organization.website, "https://northstar.example/about");
  assert.equal(result.organization.name, null);
  assert.equal(result.organization.factoryInfo, "Fictional production statement");
  assert.equal(result.contact.email, "sales@northstar.example");
  assert.equal(result.contact.phone, null);
  assert.deepEqual(result.evidence.map((item) => item.id), ["site", "email", "factory"]);
  assert.equal(result.fieldEvidence["organization.website"], "site");
  assert.equal(result.fieldEvidence["contact.email"], "email");
  assert.equal(result.fieldEvidence["organization.factoryInfo"], "factory");
  assert.ok(result.evidence.every((item) => item.status === "candidate"));
  assert.ok(result.evidence.every((item) => item.review.decision === "accepted"));
  assert.ok(result.evidence.every((item) => item.review.reviewedAt === "2026-09-08T00:00:00.000Z"));
});

test("evidence selection refuses an empty human decision", () => {
  assert.throws(() => enrichmentFromEvidenceSelection(evidence, []), /至少选择一条/);
});
