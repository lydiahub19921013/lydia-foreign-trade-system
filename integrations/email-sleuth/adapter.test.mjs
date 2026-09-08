import test from "node:test";
import assert from "node:assert/strict";
import { mapEmailSleuthResult } from "./adapter.mjs";

test("catch-all email results remain inconclusive", () => {
  const evidence = mapEmailSleuthResult({
    email: "buyer@example.com",
    domain: "example.com",
    status: "catch_all",
    confidence: 72
  }, { observedAt: "2026-09-08T00:00:00Z" });
  assert.equal(evidence.status, "inconclusive");
  assert.equal(evidence.confidence, 0.72);
});

test("deliverable result maps to sourced verified evidence", () => {
  const evidence = mapEmailSleuthResult({
    email: "buyer@example.com",
    status: "deliverable"
  }, { sourceRef: "email-check:demo", observedAt: "2026-09-08T00:00:00Z" });
  assert.equal(evidence.status, "verified");
  assert.equal(evidence.sourceRef, "email-check:demo");
});
