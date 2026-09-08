import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SCHEMA_VERSION,
  findDuplicateCandidates,
  initializeDevelopmentTracking,
  leadsFromCsv,
  listDuplicateDecisions,
  normalizeLead,
  recordDevelopmentEvent,
  reviewDuplicatePair,
  qualifyLead,
  summarizeDevelopment
} from "../packages/lead-core/src/index.mjs";
import {
  createInitialState,
  importQualifiedLeads
} from "../apps/communication-extension/src/core/data.js";

test("sample inquiries travel from qualification core into the communication extension", async () => {
  const csv = await readFile(new URL("../examples/inquiries.sample.csv", import.meta.url), "utf8");
  const leads = leadsFromCsv(csv);
  const payload = {
    format: "lydia-qualified-leads",
    schemaVersion: SCHEMA_VERSION,
    product: "Lydia 外贸系统",
    generatedAt: "2026-09-08T00:00:00.000Z",
    sourceFile: "inquiries.sample.csv",
    duplicateCandidates: findDuplicateCandidates(leads),
    results: leads.map((lead) => ({ lead, qualification: qualifyLead(lead) }))
  };

  const imported = importQualifiedLeads(
    payload,
    createInitialState(),
    "2026-09-08T00:01:00.000Z"
  );

  assert.equal(payload.duplicateCandidates.length, 1);
  assert.ok(payload.duplicateCandidates[0].reasons.includes("相同企业域名"));
  assert.equal(imported.importedCount, 4);
  assert.equal(imported.updatedCount, 0);
  assert.equal(imported.state.schemaVersion, 3);
  const first = imported.state.customers.find((customer) => customer.company === "Northstar Demo Imports");
  assert.equal(first.leadProfile.grade, "B");
  assert.equal(first.leadProfile.score, 71);
  assert.equal(first.leadProfile.inquiryMessage, "Please quote 2,000 units, FOB Shanghai.");
  assert.equal(first.email, "buyer@northstar.example");
});

test("a reviewed master-account relationship reaches the communication extension without deleting the secondary inquiry", async () => {
  const csv = await readFile(new URL("../examples/inquiries.sample.csv", import.meta.url), "utf8");
  const leads = leadsFromCsv(csv);
  const primary = leads.find((lead) => lead.organization.name === "Northstar Demo Imports");
  const secondary = leads.find((lead) => lead.organization.name === "Northstar Demo Imports Ltd");
  const reviewed = reviewDuplicatePair(leads, [primary.id, secondary.id], {
    decision: "same",
    primaryLeadId: primary.id,
    note: "官网域名一致，确认属于同一采购公司",
    reviewedAt: "2026-09-08T00:02:00.000Z"
  });
  const payload = {
    format: "lydia-qualified-leads",
    schemaVersion: SCHEMA_VERSION,
    product: "Lydia 外贸系统",
    generatedAt: "2026-09-08T00:03:00.000Z",
    sourceFile: "inquiries.sample.csv",
    duplicateCandidates: findDuplicateCandidates(reviewed.leads),
    duplicateDecisions: listDuplicateDecisions(reviewed.leads),
    results: reviewed.leads.map((lead) => ({ lead, qualification: qualifyLead(lead) }))
  };

  const imported = importQualifiedLeads(payload, createInitialState(), "2026-09-08T00:04:00.000Z");
  const importedSecondary = imported.state.customers.find((customer) => customer.company === "Northstar Demo Imports Ltd");
  assert.equal(payload.duplicateCandidates.length, 0);
  assert.equal(payload.duplicateDecisions[0].decision, "same");
  assert.equal(importedSecondary.leadProfile.grade, "HOLD");
  assert.equal(importedSecondary.leadProfile.inquiryMessage, "Need the updated catalog for our next range.");
});

test("schema 4 preserves the development baseline and timeline while remaining compatible with the communication extension", async () => {
  const csv = await readFile(new URL("../examples/inquiries.sample.csv", import.meta.url), "utf8");
  const leads = initializeDevelopmentTracking(leadsFromCsv(csv), {
    capturedAt: "2026-09-08T01:00:00.000Z"
  });
  const first = leads[0];
  const contacted = recordDevelopmentEvent(first, {
    type: "contact-attempted",
    channel: "email",
    note: "Sent a product-specific introduction"
  }, { now: "2026-09-08T02:00:00.000Z" }).lead;
  const replied = recordDevelopmentEvent(contacted, {
    type: "buyer-replied",
    channel: "email",
    note: "Buyer requested a formal quote"
  }, { now: "2026-09-08T03:00:00.000Z" }).lead;
  const updatedLeads = [replied, ...leads.slice(1)];
  const payload = JSON.parse(JSON.stringify({
    format: "lydia-qualified-leads",
    schemaVersion: SCHEMA_VERSION,
    product: "Lydia 外贸系统",
    generatedAt: "2026-09-08T04:00:00.000Z",
    sourceFile: "inquiries.sample.csv",
    developmentSummary: summarizeDevelopment(updatedLeads, { now: "2026-09-08T04:00:00.000Z" }),
    results: updatedLeads.map((lead) => ({ lead, qualification: qualifyLead(lead) }))
  }));

  const roundTripped = normalizeLead(payload.results[0].lead);
  assert.equal(payload.schemaVersion, 4);
  assert.equal(roundTripped.development.qualificationBaseline.grade, "B");
  assert.deepEqual(roundTripped.development.events.map((event) => event.type), ["contact-attempted", "buyer-replied"]);
  assert.equal(payload.developmentSummary.totals.replied, 1);

  const imported = importQualifiedLeads(payload, createInitialState(), "2026-09-08T04:01:00.000Z");
  const customer = imported.state.customers.find((item) => item.company === "Northstar Demo Imports");
  assert.equal(imported.importedCount, 4);
  assert.equal(customer.leadProfile.grade, "B");
  assert.equal(customer.leadProfile.inquiryMessage, "Please quote 2,000 units, FOB Shanghai.");
});
