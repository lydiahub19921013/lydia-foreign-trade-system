import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPublicWebsiteEvidence,
  fetchPublicWebsiteSnapshot,
  isPublicIp,
  normalizePublicWebsiteUrl
} from "./snapshot.mjs";

function mockResponse(body, options = {}) {
  const headers = new Map(Object.entries({
    "content-type": "text/html; charset=utf-8",
    ...options.headers
  }).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    ok: options.status ? options.status >= 200 && options.status < 300 : true,
    status: options.status || 200,
    headers: { get: (name) => headers.get(name.toLowerCase()) || null },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer
  };
}

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("public website URL validation blocks internal targets and credentials", () => {
  assert.throws(() => normalizePublicWebsiteUrl("http://127.0.0.1/contact"), /内部网络/);
  assert.throws(() => normalizePublicWebsiteUrl("http://[::1]/contact"), /内部网络/);
  assert.throws(() => normalizePublicWebsiteUrl("https://user:pass@example.com"), /用户名/);
  assert.throws(() => normalizePublicWebsiteUrl("https://example.com:8443"), /非标准端口/);
  assert.equal(normalizePublicWebsiteUrl("https://example.com/contact#team").href, "https://example.com/contact");
});

test("IP classifier rejects private ranges", () => {
  assert.equal(isPublicIp("10.0.0.1"), false);
  assert.equal(isPublicIp("169.254.1.1"), false);
  assert.equal(isPublicIp("93.184.216.34"), true);
  assert.equal(isPublicIp("::1"), false);
  assert.equal(isPublicIp("2606:2800:220:1:248:1893:25c8:1946"), true);
});

test("website HTML becomes candidate evidence with public contact sources", () => {
  const html = `<!doctype html><html><head><title>Northstar Demo</title>
    <script type="application/ld+json">{"@type":"Organization","name":"Northstar Demo Imports","email":"sales@northstar.example.com","telephone":"+1 555 0100","address":{"streetAddress":"88 Sample Road","addressLocality":"Demo City","addressCountry":"US"}}</script>
    </head><body><a href="mailto:export@northstar.example.com">Email</a><a href="https://wa.me/15550101">WhatsApp</a><p>Our factory operates two production lines.</p></body></html>`;
  const result = extractPublicWebsiteEvidence(html, "https://northstar.example.com/contact", { observedAt: "2026-09-08T00:00:00Z" });
  assert.equal(result.title, "Northstar Demo Imports");
  assert.deepEqual(result.contacts.emails, ["export@northstar.example.com", "sales@northstar.example.com"]);
  assert.deepEqual(result.contacts.whatsapp, ["15550101"]);
  assert.equal(result.addresses[0], "88 Sample Road, Demo City, US");
  assert.ok(result.factorySignals[0].includes("factory"));
  assert.ok(result.evidence.every((item) => item.status === "candidate"));
  assert.ok(result.evidence.every((item) => item.sourceRef === "https://northstar.example.com/contact"));
});

test("website fetch allows same-site redirects and retains the final source", async () => {
  const calls = [];
  const result = await fetchPublicWebsiteSnapshot("http://example.com/contact", {
    lookupImpl: publicLookup,
    observedAt: "2026-09-08T00:00:00Z",
    fetchImpl: async (url) => {
      calls.push(url.href);
      if (calls.length === 1) return mockResponse("", { status: 301, headers: { location: "https://www.example.com/contact" } });
      return mockResponse("<html><title>Example Buyer</title><a href='mailto:sales@example.com'>Email</a></html>");
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(result.finalUrl, "https://www.example.com/contact");
  assert.equal(result.contacts.emails[0], "sales@example.com");
});

test("hostname lookup supports Clash-style fake IP without allowing direct reserved IP input", async () => {
  const result = await fetchPublicWebsiteSnapshot("https://example.com", {
    lookupImpl: async () => [{ address: "198.18.4.63", family: 4 }],
    fetchImpl: async () => mockResponse("<html><title>Example Buyer</title></html>")
  });
  assert.equal(result.title, "Example Buyer");
  assert.throws(() => normalizePublicWebsiteUrl("https://198.18.4.63"), /内部网络/);
});

test("website fetch blocks cross-site redirects and private DNS results", async () => {
  await assert.rejects(() => fetchPublicWebsiteSnapshot("https://example.com", {
    lookupImpl: publicLookup,
    fetchImpl: async () => mockResponse("", { status: 302, headers: { location: "https://tracker.example.net" } })
  }), /其他域名/);

  await assert.rejects(() => fetchPublicWebsiteSnapshot("https://example.com", {
    lookupImpl: async () => [{ address: "192.168.1.9", family: 4 }],
    fetchImpl: async () => mockResponse("unused")
  }), /公网地址/);
});

test("website fetch rejects oversized and non-text responses", async () => {
  await assert.rejects(() => fetchPublicWebsiteSnapshot("https://example.com", {
    lookupImpl: publicLookup,
    fetchImpl: async () => mockResponse("", { headers: { "content-length": "1000001" } })
  }), /超过 1 MB/);

  await assert.rejects(() => fetchPublicWebsiteSnapshot("https://example.com/file.pdf", {
    lookupImpl: publicLookup,
    fetchImpl: async () => mockResponse("pdf", { headers: { "content-type": "application/pdf" } })
  }), /网页文本/);
});
