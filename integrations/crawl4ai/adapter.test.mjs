import test from "node:test";
import assert from "node:assert/strict";
import { mapWebsiteExtraction } from "./adapter.mjs";

test("website extraction keeps the page URL and remains candidate evidence", () => {
  const evidence = mapWebsiteExtraction({
    url: "https://buyer.example/about",
    extractedContent: {
      companyName: "Demo Buyer",
      address: "88 Sample Road",
      factoryInfo: "Self-reported assembly line"
    }
  }, { observedAt: "2026-09-08T00:00:00Z" });

  assert.equal(evidence.length, 3);
  assert.ok(evidence.every((item) => item.status === "candidate"));
  assert.ok(evidence.every((item) => item.sourceRef === "https://buyer.example/about"));
});

test("website extraction rejects results without a source page", () => {
  assert.throws(
    () => mapWebsiteExtraction({ extractedContent: { companyName: "Demo" } }),
    /页面 URL/
  );
});
