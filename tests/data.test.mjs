import test from "node:test";
import assert from "node:assert/strict";
import {
  addReplyHistory,
  createInitialState,
  exportPortableData,
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
