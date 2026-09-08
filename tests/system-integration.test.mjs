import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SCHEMA_VERSION,
  findDuplicateCandidates,
  leadsFromCsv,
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

  assert.equal(imported.importedCount, 3);
  assert.equal(imported.updatedCount, 0);
  assert.equal(imported.state.schemaVersion, 3);
  const first = imported.state.customers.find((customer) => customer.company === "Northstar Demo Imports");
  assert.equal(first.leadProfile.grade, "B");
  assert.equal(first.leadProfile.score, 71);
  assert.equal(first.leadProfile.inquiryMessage, "Please quote 2,000 units, FOB Shanghai.");
  assert.equal(first.email, "buyer@northstar.example");
});
