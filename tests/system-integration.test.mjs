import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SCHEMA_VERSION,
  findDuplicateCandidates,
  leadsFromCsv,
  listDuplicateDecisions,
  reviewDuplicatePair,
  qualifyLead
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
