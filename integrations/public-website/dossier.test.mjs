import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicWebsiteDossier } from "./dossier.mjs";

function page(url, options = {}) {
  return {
    provider: "public-website",
    observedAt: "2026-09-08T00:00:00Z",
    requestedUrl: url,
    finalUrl: url,
    title: options.title || null,
    contacts: options.contacts || { emails: [], phones: [], whatsapp: [] },
    addresses: options.addresses || [],
    factorySignals: options.factorySignals || [],
    pageLinks: options.pageLinks || [],
    evidence: options.evidence || [{ id: `ev-${url}`, kind: "company-website", sourceRef: url, status: "candidate" }]
  };
}

test("website dossier follows only discovered priority pages and keeps per-page sources", async () => {
  const calls = [];
  const pages = new Map([
    ["https://northstar.example/", page("https://northstar.example/", {
      title: "Northstar Demo",
      pageLinks: [
        { url: "https://northstar.example/contact", reason: "联系方式" },
        { url: "https://northstar.example/about", reason: "企业介绍" },
        { url: "https://northstar.example/factory", reason: "工厂与能力" }
      ]
    })],
    ["https://northstar.example/contact", page("https://northstar.example/contact", {
      contacts: { emails: ["sales@northstar.example"], phones: ["+1-555-0100"], whatsapp: [] }
    })],
    ["https://northstar.example/about", page("https://northstar.example/about", {
      addresses: ["1 Example Road"]
    })],
    ["https://northstar.example/factory", page("https://northstar.example/factory", {
      factorySignals: ["Fictional production facility statement"]
    })]
  ]);
  const result = await fetchPublicWebsiteDossier("https://northstar.example", {
    maxPages: 4,
    snapshotImpl: async (url) => {
      calls.push(url);
      return pages.get(url);
    }
  });
  assert.equal(result.pageCount, 4);
  assert.deepEqual(calls, [...pages.keys()]);
  assert.deepEqual(result.contacts.emails, ["sales@northstar.example"]);
  assert.deepEqual(result.addresses, ["1 Example Road"]);
  assert.deepEqual(result.factorySignals, ["Fictional production facility statement"]);
  assert.ok(result.evidence.every((item) => item.sourceRef));
});

test("website dossier caps pages at five and records non-root failures", async () => {
  const links = Array.from({ length: 8 }, (_, index) => ({
    url: `https://northstar.example/page-${index}`,
    reason: "产品与应用"
  }));
  const result = await fetchPublicWebsiteDossier("https://northstar.example", {
    maxPages: 99,
    snapshotImpl: async (url) => {
      if (url.endsWith("page-1")) throw new Error("private provider detail");
      return page(url, { pageLinks: url.endsWith("/") ? links : [] });
    }
  });
  assert.equal(result.maxPages, 5);
  assert.equal(result.pageCount, 5);
  assert.deepEqual(result.failures, [{ url: "https://northstar.example/page-1", reason: "页面未能读取" }]);
});

test("website dossier covers different evidence purposes before repeated contact pages", async () => {
  const calls = [];
  const rootLinks = [
    { url: "https://northstar.example/contact", reason: "联系方式" },
    { url: "https://northstar.example/contact/email", reason: "联系方式" },
    { url: "https://northstar.example/contact/phone", reason: "联系方式" },
    { url: "https://northstar.example/about", reason: "企业介绍" },
    { url: "https://northstar.example/factory", reason: "工厂与能力" },
    { url: "https://northstar.example/products", reason: "产品与应用" }
  ];
  await fetchPublicWebsiteDossier("https://northstar.example", {
    maxPages: 5,
    snapshotImpl: async (url) => {
      calls.push(url);
      return page(url, { pageLinks: url.endsWith("/") ? rootLinks : [] });
    }
  });
  assert.deepEqual(calls, [
    "https://northstar.example/",
    "https://northstar.example/contact",
    "https://northstar.example/about",
    "https://northstar.example/factory",
    "https://northstar.example/products"
  ]);
});

test("website dossier fails closed when the user-specified root page cannot be read", async () => {
  await assert.rejects(() => fetchPublicWebsiteDossier("https://northstar.example", {
    snapshotImpl: async () => { throw new Error("官网读取失败（HTTP 403）"); }
  }), /HTTP 403/);
});
