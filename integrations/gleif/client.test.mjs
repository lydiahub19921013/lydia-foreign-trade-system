import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGleifSearchUrl,
  mapGleifRecord,
  searchGleifEntities
} from "./client.mjs";

const record = {
  id: "DEMOLEI0000000000001",
  attributes: {
    lei: "DEMOLEI0000000000001",
    entity: {
      legalName: { name: "Northstar Demo Imports", language: "en" },
      legalAddress: { addressLines: ["88 Sample Road"], city: "Demo City", country: "US" },
      headquartersAddress: { addressLines: ["1 Example Way"], city: "Sample City", country: "US" },
      registeredAt: { id: "RA-DEMO" },
      registeredAs: "DEMO-REG-001",
      jurisdiction: "US-DE",
      status: "ACTIVE",
      otherNames: []
    },
    registration: {
      status: "ISSUED",
      corroborationLevel: "FULLY_CORROBORATED",
      lastUpdateDate: "2026-09-01T00:00:00Z"
    }
  }
};

test("GLEIF search URL is fixed to the official API and bounds page size", () => {
  const url = buildGleifSearchUrl("Northstar Demo", { pageSize: 99, jurisdiction: "us-de" });
  assert.equal(url.origin, "https://api.gleif.org");
  assert.equal(url.searchParams.get("filter[entity.legalName]"), "Northstar Demo");
  assert.equal(url.searchParams.get("filter[entity.jurisdiction]"), "US-DE");
  assert.equal(url.searchParams.get("page[size]"), "10");
});

test("fully corroborated issued LEI becomes sourced verified evidence", () => {
  const mapped = mapGleifRecord(record, "2026-09-08T00:00:00Z");
  assert.equal(mapped.legalName, "Northstar Demo Imports");
  assert.equal(mapped.registeredAs, "DEMO-REG-001");
  assert.equal(mapped.evidence.length, 4);
  assert.ok(mapped.evidence.every((item) => item.status === "verified"));
  assert.ok(mapped.evidence.every((item) => item.sourceRef.includes("api.gleif.org")));
});

test("lapsed or uncorroborated LEI never becomes verified", () => {
  const input = structuredClone(record);
  input.attributes.registration.status = "LAPSED";
  input.attributes.registration.corroborationLevel = "ENTITY_SUPPLIED_ONLY";
  const mapped = mapGleifRecord(input, "2026-09-08T00:00:00Z");
  assert.ok(mapped.evidence.every((item) => item.status === "inconclusive"));
});

test("search maps provider response without making a live request", async () => {
  const result = await searchGleifEntities("Northstar Demo", {
    observedAt: "2026-09-08T00:00:00Z",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        meta: { goldenCopy: { publishDate: "2026-09-07T16:00:00Z" }, pagination: { total: 1 } },
        data: [record]
      })
    })
  });
  assert.equal(result.total, 1);
  assert.equal(result.results[0].lei, "DEMOLEI0000000000001");
  assert.match(result.disclaimer, /不是信用/);
});

test("GLEIF rejects empty searches", () => {
  assert.throws(() => buildGleifSearchUrl("a"), /至少需要 2 个字符/);
});
