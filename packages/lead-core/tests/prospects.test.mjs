import test from "node:test";
import assert from "node:assert/strict";
import {
  createProspectSearchPlan,
  normalizePublicProspect,
  prospectToLead,
  prospectsFromCsv,
  prospectsFromJson,
  prospectsFromSearchResults,
  rankPublicProspects
} from "../src/index.mjs";

test("prospect search plan covers demand, pain, timing and channels", () => {
  const plan = createProspectSearchPlan({
    product: "reusable bottle",
    market: "Exampleland",
    buyerType: "distributor",
    application: "corporate gifts"
  });
  assert.equal(plan.queries.length, 5);
  assert.match(plan.queries.map((item) => item.purpose).join(" "), /需求/);
  assert.match(plan.queries.map((item) => item.purpose).join(" "), /痛点/);
  assert.match(plan.queries.map((item) => item.purpose).join(" "), /变化/);
  assert.throws(() => createProspectSearchPlan({ product: "x", market: "Exampleland" }), /至少需要/);
});
test("search snippets stay below the shortlist threshold", () => {
  const [prospect] = prospectsFromSearchResults([{
    title: "Northstar Demo Distribution",
    url: "https://northstar.example/updates",
    publishedAt: "2026-09-01",
    highlights: "Public page mentions a new reusable bottle range."
  }], { product: "Reusable bottle", market: "Exampleland", buyerType: "Distributor" });
  assert.equal(prospect.qualification.stage, "search-candidate");
  assert.equal(prospect.qualification.cap, 49);
  assert.ok(prospect.qualification.score <= 49);
  assert.match(prospect.qualification.nextAction, /原始公开页面/);
});

test("a reviewed, strongly evidenced prospect can enter the primary shortlist", () => {
  const prospect = normalizePublicProspect({
    companyName: "Northstar Demo Distribution",
    sourceUrl: "https://northstar.example/news/new-range",
    signalExcerpt: "The company publicly announced a new reusable bottle range and invited supplier introductions.",
    originalPageReviewed: true,
    scoreInput: {
      needSignal: 5,
      productFit: 5,
      timing: 4,
      publicReachability: 4,
      evidenceQuality: 4
    }
  });
  assert.equal(prospect.qualification.stage, "primary");
  assert.ok(prospect.qualification.score >= 70);
});

test("missing source or signal cannot become a shortlist prospect", () => {
  const prospect = normalizePublicProspect({
    companyName: "Uncited Demo",
    originalPageReviewed: true,
    scoreInput: { needSignal: 5, productFit: 5, timing: 5, publicReachability: 5, evidenceQuality: 5 }
  });
  assert.equal(prospect.qualification.stage, "search-candidate");
  assert.equal(prospect.qualification.score, 49);
});

test("prospect imports normalize JSON and CSV without inventing verification", () => {
  const [jsonProspect] = prospectsFromJson({ prospects: [{
    company_name: "JSON Demo",
    url: "https://json-demo.example",
    snippet: "Public candidate signal"
  }] });
  assert.equal(jsonProspect.originalPageReviewed, false);
  const [csvProspect] = prospectsFromCsv(
    "company_name,source_url,signal_excerpt,original_page_reviewed\nCSV Demo,https://csv-demo.example,Public candidate signal,false\n"
  );
  assert.equal(csvProspect.companyName, "CSV Demo");
  assert.equal(csvProspect.qualification.stage, "search-candidate");
});

test("prospect ranking deduplicates company domains", () => {
  const ranked = rankPublicProspects([
    { companyName: "First", sourceUrl: "https://www.same.example/a", signalExcerpt: "Signal A" },
    { companyName: "Second", sourceUrl: "https://same.example/b", signalExcerpt: "Signal B" },
    { companyName: "Other", sourceUrl: "https://other.example", signalExcerpt: "Signal C" }
  ]);
  assert.equal(ranked.length, 2);
});

test("only an original-page-reviewed prospect can enter the development queue", () => {
  const prospect = normalizePublicProspect({
    companyName: "Northstar Demo Distribution",
    sourceUrl: "https://northstar.example/news",
    signalExcerpt: "Public candidate signal",
    product: "Reusable bottle",
    market: "Exampleland"
  });
  assert.throws(() => prospectToLead(prospect, { reviewedPageUrl: "https://northstar.example" }), /人工核查/);

  const lead = prospectToLead(prospect, {
    reviewedPageUrl: "https://northstar.example/about",
    originalPageReviewed: true,
    organization: { website: "https://northstar.example/about", address: "1 Example Road" },
    contact: { email: "sales@northstar.example", phone: "+1-555-0100" },
    evidence: [
      { id: "site", kind: "company-website", value: "https://northstar.example/about", sourceRef: "https://northstar.example/about", status: "candidate" },
      { id: "email", kind: "business-email", value: "sales@northstar.example", sourceRef: "https://northstar.example/contact", status: "candidate" },
      { id: "phone", kind: "business-phone", value: "+1-555-0100", sourceRef: "https://northstar.example/contact", status: "candidate" },
      { id: "address", kind: "business-address", value: "1 Example Road", sourceRef: "https://northstar.example/about", status: "candidate" }
    ],
    fieldEvidence: {
      "organization.website": "site",
      "organization.address": "address",
      "contact.email": "email",
      "contact.phone": "phone"
    },
    reviewedAt: "2026-09-08T00:00:00Z"
  });
  assert.equal(lead.source, "Public research");
  assert.equal(lead.organization.domain, "northstar.example");
  assert.equal(lead.contact.email, "sales@northstar.example");
  assert.ok(lead.fieldOrigins.some((item) => item.path === "contact.email" && item.evidenceId === "email"));
  assert.equal(lead.signals.explicitInquiry, false);
  assert.match(lead.notes, /不是客户主动询盘/);
});

test("unselected website fields never leak into the development queue", () => {
  const prospect = normalizePublicProspect({
    companyName: "Northstar Demo Distribution",
    sourceUrl: "https://directory.example/northstar",
    signalExcerpt: "Public candidate signal",
    product: "Reusable bottle"
  });
  const lead = prospectToLead(prospect, {
    reviewedPageUrl: "https://northstar.example/about",
    finalUrl: "https://northstar.example/about",
    title: "Unselected website title",
    addresses: ["Unselected address"],
    originalPageReviewed: true,
    contact: { email: "sales@northstar.example" },
    evidence: [{ id: "selected-email", kind: "business-email", value: "sales@northstar.example", sourceRef: "https://northstar.example/contact", status: "candidate" }],
    fieldEvidence: { "contact.email": "selected-email" }
  });
  assert.equal(lead.organization.website, null);
  assert.equal(lead.organization.address, null);
  assert.equal(lead.contact.email, "sales@northstar.example");
  assert.equal(lead.evidence.some((item) => item.value === "Unselected website title"), false);
});

test("a reviewed page from another company cannot enter the prospect queue", () => {
  const prospect = normalizePublicProspect({
    companyName: "Northstar Demo Distribution",
    companyDomain: "northstar.example",
    sourceUrl: "https://directory.example/northstar",
    signalExcerpt: "Public candidate signal"
  });
  assert.throws(() => prospectToLead(prospect, {
    reviewedPageUrl: "https://other.example/about",
    originalPageReviewed: true,
    evidence: [{ id: "other", kind: "company-website", value: "https://other.example/about", sourceRef: "https://other.example/about" }]
  }), /域名不一致/);
});
