import test from "node:test";
import assert from "node:assert/strict";
import {
  addReplyHistory,
  createInitialState,
  exportPortableData,
  importQualifiedLeads,
  importPortableData,
  migrateState,
  removeReplyHistory,
  upsertCustomer
} from "../src/core/data.js";

test("adds and updates a customer without losing its creation time", () => {
  const initial = createInitialState();
  const first = upsertCustomer(initial, { id: "c1", name: "Ana" }, "2026-01-01T00:00:00.000Z");
  const second = upsertCustomer(first.state, { id: "c1", name: "Ana", company: "Example" }, "2026-01-02T00:00:00.000Z");
  assert.equal(second.state.customers.length, 1);
  assert.equal(second.customer.company, "Example");
  assert.equal(second.customer.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(second.customer.updatedAt, "2026-01-02T00:00:00.000Z");
});

test("adds and removes reply history", () => {
  const added = addReplyHistory(createInitialState(), { id: "h1", inbound: "Quote please", reply: "Hello" });
  assert.equal(added.state.replyHistory.length, 1);
  assert.equal(removeReplyHistory(added.state, "h1").replyHistory.length, 0);
});

test("export never contains the API key and disables AI", () => {
  const state = createInitialState();
  state.settings.ai = { enabled: true, endpoint: "https://example.com/v1/chat/completions", model: "model", apiKey: "super-secret-value" };
  const exported = exportPortableData(state);
  assert.equal(exported.data.settings.ai.apiKey, "");
  assert.equal(exported.data.settings.ai.enabled, false);
  assert.doesNotMatch(JSON.stringify(exported), /super-secret-value/);
});

test("import validates format, preserves the local key, and leaves AI off", () => {
  const current = createInitialState();
  current.settings.ai.apiKey = "local-only";
  const payload = exportPortableData(createInitialState());
  payload.data.customers = [{ id: "c2", name: "Ben" }];
  const imported = importPortableData(payload, current);
  assert.equal(imported.customers[0].name, "Ben");
  assert.equal(imported.settings.ai.apiKey, "local-only");
  assert.equal(imported.settings.ai.enabled, false);
  assert.throws(() => importPortableData({ format: "wrong" }, current), /有效/);
});

test("migration caps stored histories", () => {
  const state = createInitialState();
  state.replyHistory = Array.from({ length: 250 }, (_, index) => ({ id: `h${index}`, reply: "ok" }));
  assert.equal(migrateState(state).replyHistory.length, 200);
});

test("old customer data migrates to schema 3 without losing fields", () => {
  const migrated = migrateState({
    schemaVersion: 1,
    customers: [{ id: "old", name: "Ana", company: "Example" }]
  });
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.customers[0].name, "Ana");
  assert.equal(migrated.customers[0].email, "");
  assert.equal(migrated.customers[0].leadProfile, null);
  assert.deepEqual(migrated.customers[0].leadManagedFields, {});
});

test("imports Lydia qualified leads while preserving existing manual notes", () => {
  const initial = createInitialState();
  initial.customers = [{ id: "lead_1", name: "Old", notes: "人工备注不要覆盖" }];
  const payload = {
    format: "lydia-qualified-leads",
    results: [{
      lead: {
        id: "lead_1",
        source: "Alibaba",
        sourceReference: "DEMO-001",
        organization: { name: "Demo Buyer", country: "Exampleland" },
        contact: { name: "Alex", email: "alex@buyer.example", whatsapp: "+1-555-0100" },
        inquiry: { message: "Please quote", product: "Bottle", quantity: "2000" },
        evidence: [{ id: "e1" }]
      },
      qualification: {
        grade: "A",
        score: 88,
        nextAction: "准备报价",
        missingEvidence: ["采购时间"]
      }
    }]
  };

  const imported = importQualifiedLeads(payload, initial, "2026-09-08T00:00:00.000Z");
  assert.equal(imported.importedCount, 0);
  assert.equal(imported.updatedCount, 1);
  assert.equal(imported.state.customers[0].notes, "人工备注不要覆盖");
  assert.equal(imported.state.customers[0].email, "alex@buyer.example");
  assert.equal(imported.state.customers[0].leadProfile.grade, "A");
  assert.equal(imported.state.customers[0].leadProfile.inquiryMessage, "Please quote");
});

test("rejects unrelated lead files", () => {
  assert.throws(
    () => importQualifiedLeads({ format: "other", results: [] }, createInitialState()),
    /Lydia 客户分级/
  );
});

test("a later Lydia import clears only an unchanged Lydia-managed email", () => {
  const payload = {
    format: "lydia-qualified-leads",
    results: [{
      lead: {
        id: "lead_managed",
        organization: { name: "Managed Demo" },
        contact: { email: "candidate@managed.example" },
        evidence: [{ id: "email", status: "candidate" }]
      },
      qualification: { grade: "C", score: 40, missingEvidence: [], nextAction: "人工复核" }
    }]
  };
  const first = importQualifiedLeads(payload, createInitialState(), "2026-09-08T00:00:00.000Z");
  assert.equal(first.state.customers[0].leadManagedFields.email, "candidate@managed.example");

  const rejectedPayload = structuredClone(payload);
  rejectedPayload.results[0].lead.contact.email = null;
  rejectedPayload.results[0].lead.evidence[0].review = { decision: "rejected" };
  const second = importQualifiedLeads(rejectedPayload, first.state, "2026-09-08T01:00:00.000Z");
  assert.equal(second.state.customers[0].email, "");
  assert.equal(second.state.customers[0].leadManagedFields.email, undefined);
  assert.equal(second.state.customers[0].leadProfile.evidenceCount, 0);
});

test("manual plugin edits survive later Lydia evidence rollback", () => {
  const payload = {
    format: "lydia-qualified-leads",
    results: [{
      lead: {
        id: "lead_manual",
        organization: { name: "Manual Demo" },
        contact: { email: "candidate@manual.example" },
        evidence: [{ id: "email", status: "candidate" }]
      },
      qualification: { grade: "C", score: 40, missingEvidence: [], nextAction: "人工复核" }
    }]
  };
  const imported = importQualifiedLeads(payload, createInitialState(), "2026-09-08T00:00:00.000Z");
  const customer = imported.state.customers[0];
  const edited = upsertCustomer(imported.state, { ...customer, email: "manual@manual.example" }, "2026-09-08T00:30:00.000Z");
  assert.equal(edited.state.customers[0].leadManagedFields.email, undefined);

  const rejectedPayload = structuredClone(payload);
  rejectedPayload.results[0].lead.contact.email = null;
  rejectedPayload.results[0].lead.evidence[0].review = { decision: "rejected" };
  const reimported = importQualifiedLeads(rejectedPayload, edited.state, "2026-09-08T01:00:00.000Z");
  assert.equal(reimported.state.customers[0].email, "manual@manual.example");
});
