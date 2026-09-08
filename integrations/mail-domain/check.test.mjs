import test from "node:test";
import assert from "node:assert/strict";
import { checkMailDomain } from "./check.mjs";

function dnsError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

test("MX records verify only the mail domain infrastructure", async () => {
  const result = await checkMailDomain("https://www.buyer.example.com/contact", {
    observedAt: "2026-09-08T00:00:00Z",
    resolveMxImpl: async () => [
      { exchange: "mx2.example.net.", priority: 20 },
      { exchange: "mx1.example.net.", priority: 10 }
    ]
  });
  assert.equal(result.domain, "buyer.example.com");
  assert.equal(result.status, "mx-found");
  assert.deepEqual(result.exchanges, ["mx1.example.net", "mx2.example.net"]);
  assert.equal(result.evidence.kind, "mail-domain");
  assert.equal(result.evidence.status, "verified");
  assert.match(result.evidence.note, /不证明任何具体邮箱/);
});

test("null MX rejects candidates for a domain that does not accept mail", async () => {
  const result = await checkMailDomain("buyer.example.com", {
    resolveMxImpl: async () => [{ exchange: ".", priority: 0 }]
  });
  assert.equal(result.status, "no-mail-route");
  assert.equal(result.evidence.status, "rejected");
});

test("A record fallback remains inconclusive", async () => {
  const result = await checkMailDomain("buyer.example.com", {
    resolveMxImpl: async () => { throw dnsError("ENODATA"); },
    resolve4Impl: async () => ["93.184.216.34"],
    resolve6Impl: async () => { throw dnsError("ENODATA"); }
  });
  assert.equal(result.status, "address-fallback");
  assert.equal(result.addressRecordCount, 1);
  assert.equal(result.evidence.status, "inconclusive");
});

test("missing domain or DNS failures never produce verified email evidence", async () => {
  const missing = await checkMailDomain("buyer.example.com", {
    resolveMxImpl: async () => { throw dnsError("ENOTFOUND"); }
  });
  assert.equal(missing.status, "no-mail-route");
  assert.equal(missing.evidence.status, "rejected");

  const failed = await checkMailDomain("buyer.example.com", {
    resolveMxImpl: async () => { throw dnsError("ESERVFAIL"); }
  });
  assert.equal(failed.status, "inconclusive");
  assert.equal(failed.evidence.status, "inconclusive");
});
