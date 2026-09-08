import test from "node:test";
import assert from "node:assert/strict";
import {
  findDuplicateCandidates,
  listDuplicateDecisions,
  normalizeLead,
  qualifyLead,
  reviewDuplicatePair
} from "../src/index.mjs";

function duplicateLeads() {
  return [
    normalizeLead({
      id: "lead-primary",
      source: "Alibaba",
      sourceReference: "DEMO-A",
      organization: { name: "Northstar Demo Imports", domain: "northstar.example" },
      inquiry: { product: "Reusable bottle", quantity: "2000" },
      signals: { explicitInquiry: true }
    }),
    normalizeLead({
      id: "lead-secondary",
      source: "Made-in-China",
      sourceReference: "DEMO-B",
      organization: { name: "Northstar Imports Ltd", website: "https://northstar.example/about" },
      contact: { email: "sourcing@northstar.example" },
      inquiry: { message: "Please send a catalog", product: "Bottle" }
    })
  ];
}

test("human confirmation links a secondary record to a master without deleting either inquiry", () => {
  const result = reviewDuplicatePair(duplicateLeads(), ["lead-primary", "lead-secondary"], {
    decision: "same",
    primaryLeadId: "lead-primary",
    note: "官网域名和企业主体一致",
    reviewedAt: "2026-09-08T06:00:00Z"
  });
  const primary = result.leads.find((lead) => lead.id === "lead-primary");
  const secondary = result.leads.find((lead) => lead.id === "lead-secondary");
  assert.equal(primary.compliance.duplicateOf, null);
  assert.equal(secondary.compliance.duplicateOf, "lead-primary");
  assert.equal(secondary.inquiry.message, "Please send a catalog");
  assert.equal(qualifyLead(secondary).grade, "HOLD");
  assert.equal(findDuplicateCandidates(result.leads).length, 0);
  assert.equal(listDuplicateDecisions(result.leads)[0].decision, "same");
  assert.equal(listDuplicateDecisions(result.leads)[0].primaryLeadId, "lead-primary");
});

test("reopening a same-customer decision restores the candidate and keeps the audit trail", () => {
  const merged = reviewDuplicatePair(duplicateLeads(), ["lead-primary", "lead-secondary"], {
    decision: "same",
    primaryLeadId: "lead-primary",
    note: "官网域名和企业主体一致",
    reviewedAt: "2026-09-08T06:00:00Z"
  });
  const reopened = reviewDuplicatePair(merged.leads, ["lead-primary", "lead-secondary"], {
    decision: "reopened",
    note: "需要补查登记编号后再决定",
    reviewedAt: "2026-09-08T06:05:00Z"
  });
  assert.equal(reopened.leads.find((lead) => lead.id === "lead-secondary").compliance.duplicateOf, null);
  assert.equal(reopened.leads[0].duplicateReviews.length, 2);
  assert.equal(listDuplicateDecisions(reopened.leads).length, 0);
  assert.equal(findDuplicateCandidates(reopened.leads).length, 1);
});

test("a distinct-customer decision suppresses the warning without putting either lead on hold", () => {
  const result = reviewDuplicatePair(duplicateLeads(), ["lead-primary", "lead-secondary"], {
    decision: "distinct",
    note: "同一集团下的两个独立采购主体",
    reviewedAt: "2026-09-08T06:10:00Z"
  });
  assert.equal(result.leads.every((lead) => !lead.compliance.duplicateOf), true);
  assert.equal(findDuplicateCandidates(result.leads).length, 0);
  assert.equal(listDuplicateDecisions(result.leads)[0].decision, "distinct");
});

test("a distinct-customer decision can be reopened when new identity evidence arrives", () => {
  const distinct = reviewDuplicatePair(duplicateLeads(), ["lead-primary", "lead-secondary"], {
    decision: "distinct",
    note: "暂按两个采购主体分别处理",
    reviewedAt: "2026-09-08T06:10:00Z"
  });
  const reopened = reviewDuplicatePair(distinct.leads, ["lead-primary", "lead-secondary"], {
    decision: "reopened",
    note: "收到新的登记信息需要重查",
    reviewedAt: "2026-09-08T06:20:00Z"
  });
  assert.equal(findDuplicateCandidates(reopened.leads).length, 1);
  assert.equal(listDuplicateDecisions(reopened.leads).length, 0);
});

test("duplicate decisions require a reason and an explicit master", () => {
  assert.throws(() => reviewDuplicatePair(duplicateLeads(), ["lead-primary", "lead-secondary"], {
    decision: "same",
    primaryLeadId: "lead-primary",
    note: "短"
  }), /至少 3 个字/);
  assert.throws(() => reviewDuplicatePair(duplicateLeads(), ["lead-primary", "lead-secondary"], {
    decision: "same",
    note: "已经人工确认主体一致"
  }), /主账户/);
});

test("review cannot create a chain through a lead that already belongs to a third master", () => {
  const leads = duplicateLeads();
  leads[1] = normalizeLead({
    ...leads[1],
    compliance: { ...leads[1].compliance, duplicateOf: "lead-third-master" }
  });
  assert.throws(() => reviewDuplicatePair(leads, ["lead-primary", "lead-secondary"], {
    decision: "same",
    primaryLeadId: "lead-primary",
    note: "准备建立新的主账户关系"
  }), /其他主账户/);
});

test("a secondary record can contribute fingerprints to its master account", () => {
  const [primary, secondary] = duplicateLeads();
  const linkedSecondary = normalizeLead({
    ...secondary,
    compliance: { ...secondary.compliance, duplicateOf: primary.id }
  });
  const third = normalizeLead({
    id: "lead-third",
    organization: { name: "Different spelling" },
    contact: { email: "sourcing@northstar.example" },
    evidence: [{
      kind: "business-email",
      value: "sourcing@northstar.example",
      sourceRef: "https://northstar.example/contact",
      status: "verified"
    }]
  });
  linkedSecondary.evidence = third.evidence;
  const [candidate] = findDuplicateCandidates([primary, linkedSecondary, third]);
  assert.deepEqual(candidate.leadIds, ["lead-primary", "lead-third"]);
  assert.ok(candidate.reasons.includes("相同已验证工作邮箱"));
});

test("normalization preserves append-only duplicate review history", () => {
  const merged = reviewDuplicatePair(duplicateLeads(), ["lead-primary", "lead-secondary"], {
    decision: "same",
    primaryLeadId: "lead-primary",
    note: "官网域名和企业主体一致",
    reviewedAt: "2026-09-08T06:00:00Z"
  });
  const roundTrip = merged.leads.map((lead) => normalizeLead(JSON.parse(JSON.stringify(lead))));
  assert.deepEqual(roundTrip, merged.leads);
});
