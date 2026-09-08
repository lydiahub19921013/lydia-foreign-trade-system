import test from "node:test";
import assert from "node:assert/strict";
import {
  getDevelopmentState,
  initializeDevelopmentTracking,
  normalizeLead,
  recordDevelopmentEvent,
  summarizeDevelopment,
  voidDevelopmentEvent
} from "../src/index.mjs";

function demoLead(overrides = {}) {
  return normalizeLead({
    id: "lead-development-demo",
    source: "Alibaba",
    sourceReference: "DEMO-DEV-01",
    organization: { name: "Northstar Demo Imports", domain: "northstar.example" },
    contact: { name: "Alex Demo", role: "Sourcing Manager", email: "buyer@northstar.example" },
    inquiry: { message: "Please quote", product: "Reusable bottle", quantity: "2000" },
    signals: { explicitInquiry: true },
    ...overrides
  });
}

test("development tracking freezes the pre-outcome qualification baseline", () => {
  const [tracked] = initializeDevelopmentTracking([demoLead()], { capturedAt: "2026-09-08T08:00:00Z" });
  assert.equal(tracked.schemaVersion, 4);
  assert.equal(tracked.development.qualificationBaseline.grade, "D");
  assert.equal(tracked.development.qualificationBaseline.score, 32);
  assert.equal(tracked.development.events.length, 0);
});

test("development events form an explainable funnel and keep the next follow-up", () => {
  let lead = demoLead();
  lead = recordDevelopmentEvent(lead, {
    type: "contact-attempted",
    channel: "email",
    note: "Sent a product-specific introduction"
  }, { now: "2026-09-08T08:00:00Z" }).lead;
  lead = recordDevelopmentEvent(lead, {
    type: "buyer-replied",
    channel: "email",
    note: "Buyer asked for lead time"
  }, { now: "2026-09-08T09:00:00Z" }).lead;
  lead = recordDevelopmentEvent(lead, {
    type: "quote-sent",
    channel: "email",
    amount: 8800,
    currency: "usd"
  }, { now: "2026-09-08T10:00:00Z" }).lead;
  lead = recordDevelopmentEvent(lead, {
    type: "follow-up-scheduled",
    dueAt: "2026-09-10T02:00:00Z",
    note: "Confirm quotation feedback"
  }, { now: "2026-09-08T10:01:00Z" }).lead;

  const state = getDevelopmentState(lead, { now: "2026-09-09T00:00:00Z" });
  assert.equal(state.stage, "quoted");
  assert.equal(state.milestones.contacted, true);
  assert.equal(state.milestones.replied, true);
  assert.equal(state.milestones.quoted, true);
  assert.equal(state.nextAction.note, "Confirm quotation feedback");
  assert.equal(state.overdue, false);
  assert.equal(lead.development.events[0].amount, null);
  assert.equal(lead.development.events[2].currency, "USD");
});

test("completing a follow-up preserves both the plan and completion in history", () => {
  const scheduled = recordDevelopmentEvent(demoLead(), {
    type: "follow-up-scheduled",
    dueAt: "2026-09-09T08:00:00Z",
    note: "Ask whether specifications are confirmed"
  }, { now: "2026-09-08T08:00:00Z" });
  const completed = recordDevelopmentEvent(scheduled.lead, {
    type: "follow-up-completed",
    relatedEventId: scheduled.event.id,
    note: "Follow-up completed"
  }, { now: "2026-09-09T07:00:00Z" });
  assert.equal(completed.state.openFollowUps.length, 0);
  assert.equal(completed.lead.development.events.length, 2);
  assert.throws(() => recordDevelopmentEvent(completed.lead, {
    type: "follow-up-completed",
    relatedEventId: scheduled.event.id
  }, { now: "2026-09-09T07:01:00Z" }), /仍在待办/);
});

test("voiding a mistaken activity is append-only and recalculates the stage", () => {
  const replied = recordDevelopmentEvent(demoLead(), {
    type: "buyer-replied",
    channel: "platform"
  }, { now: "2026-09-08T08:00:00Z" });
  const quoted = recordDevelopmentEvent(replied.lead, {
    type: "quote-sent",
    channel: "email"
  }, { now: "2026-09-08T09:00:00Z" });
  const voided = voidDevelopmentEvent(quoted.lead, quoted.event.id, {
    note: "误把报价草稿记成已发送",
    now: "2026-09-08T09:05:00Z"
  });
  assert.equal(voided.state.stage, "replied");
  assert.equal(voided.lead.development.events.length, 3);
  assert.equal(voided.state.events.find((event) => event.id === quoted.event.id).voided, true);
  assert.equal(voided.lead.development.events.at(-1).type, "activity-voided");
});

test("a lost lead can be explicitly reopened without erasing the lost event", () => {
  const contacted = recordDevelopmentEvent(demoLead(), {
    type: "contact-attempted",
    channel: "email"
  }, { now: "2026-09-08T08:00:00Z" });
  const lost = recordDevelopmentEvent(contacted.lead, {
    type: "lost",
    note: "Buyer postponed the project",
    outcomeReason: "timing"
  }, { now: "2026-09-09T08:00:00Z" });
  assert.equal(lost.state.stage, "lost");
  const reopened = recordDevelopmentEvent(lost.lead, {
    type: "reopened",
    note: "Buyer restarted procurement"
  }, { now: "2026-09-10T08:00:00Z" });
  assert.equal(reopened.state.stage, "contacted");
  assert.equal(reopened.lead.development.events.some((event) => event.type === "lost"), true);
});

test("outbound work is blocked for protected records while inbound facts remain recordable", () => {
  const held = demoLead({ compliance: { doNotContact: true } });
  assert.throws(() => recordDevelopmentEvent(held, {
    type: "contact-attempted",
    channel: "email"
  }, { now: "2026-09-08T08:00:00Z" }), /不联系/);
  const inbound = recordDevelopmentEvent(held, {
    type: "buyer-replied",
    channel: "platform",
    note: "Inbound reply received before hold review"
  }, { now: "2026-09-08T08:00:00Z" });
  assert.equal(inbound.state.stage, "replied");
});

test("conversion summaries use the frozen baseline grade rather than a later score", () => {
  const [tracked] = initializeDevelopmentTracking([demoLead()], { capturedAt: "2026-09-08T07:00:00Z" });
  const enriched = normalizeLead({
    ...tracked,
    inquiry: { ...tracked.inquiry, timeline: "30 days", budget: "USD 4-5" },
    signals: { ...tracked.signals, replied: true, requestedQuote: true, requestedSample: true }
  });
  const won = recordDevelopmentEvent(enriched, {
    type: "won",
    amount: 8800,
    currency: "USD"
  }, { now: "2026-09-12T08:00:00Z" }).lead;
  const summary = summarizeDevelopment([won], { now: "2026-09-12T09:00:00Z" });
  assert.equal(summary.byGrade.D.leads, 1);
  assert.equal(summary.byGrade.D.won, 1);
  assert.equal(summary.byGrade.D.rates.won, 100);
  assert.equal(summary.byGrade.A.leads, 0);
});

test("a lost record without contact is not falsely counted as contacted", () => {
  const lost = recordDevelopmentEvent(demoLead(), {
    type: "lost",
    note: "Product is outside our manufacturing scope"
  }, { now: "2026-09-08T08:00:00Z" }).lead;
  const summary = summarizeDevelopment([lost]);
  assert.equal(summary.totals.lost, 1);
  assert.equal(summary.totals.contacted, 0);
});

test("a lost lead keeps the real milestones reached before loss", () => {
  const quoted = recordDevelopmentEvent(demoLead(), {
    type: "quote-sent",
    channel: "email"
  }, { now: "2026-09-08T08:00:00Z" }).lead;
  const lost = recordDevelopmentEvent(quoted, {
    type: "lost",
    note: "Buyer selected a competing supplier"
  }, { now: "2026-09-09T08:00:00Z" }).lead;
  const summary = summarizeDevelopment([lost]);
  assert.equal(summary.totals.contacted, 0);
  assert.equal(summary.totals.replied, 0);
  assert.equal(summary.totals.quoted, 1);
  assert.equal(summary.totals.lost, 1);
});

test("backfilled activities use occurrence time instead of entry order for terminal state", () => {
  const reopened = recordDevelopmentEvent(
    recordDevelopmentEvent(demoLead(), {
      type: "lost",
      note: "Buyer postponed the project",
      occurredAt: "2026-09-08T08:00:00Z"
    }, { now: "2026-09-10T08:00:00Z" }).lead,
    {
      type: "reopened",
      note: "Buyer restarted procurement",
      occurredAt: "2026-09-09T08:00:00Z"
    },
    { now: "2026-09-10T08:01:00Z" }
  ).lead;
  const backfilled = recordDevelopmentEvent(reopened, {
    type: "contact-attempted",
    channel: "email",
    occurredAt: "2026-09-07T08:00:00Z"
  }, { now: "2026-09-10T08:02:00Z" });
  assert.equal(backfilled.state.stage, "contacted");
});

test("an imported activity history without a baseline is not retroactively labeled", () => {
  const imported = normalizeLead({
    ...demoLead(),
    development: {
      events: [{ type: "won", occurredAt: "2026-09-08T08:00:00Z" }]
    }
  });
  const [tracked] = initializeDevelopmentTracking([imported], { capturedAt: "2026-09-09T08:00:00Z" });
  assert.equal(tracked.development.qualificationBaseline, null);
  assert.equal(summarizeDevelopment([tracked]).totals.baselineTracked, 0);
});

test("confirmed duplicate records do not distort account conversion denominators", () => {
  const [tracked] = initializeDevelopmentTracking([demoLead({
    compliance: { duplicateOf: "lead-master" }
  })], { capturedAt: "2026-09-08T08:00:00Z" });
  const won = recordDevelopmentEvent(tracked, {
    type: "won"
  }, { now: "2026-09-09T08:00:00Z" }).lead;
  const summary = summarizeDevelopment([won]);
  assert.equal(summary.totals.leads, 1);
  assert.equal(summary.totals.eligibleLeads, 0);
  assert.equal(summary.totals.duplicateRecords, 1);
  assert.equal(summary.totals.baselineTracked, 0);
  assert.equal(summary.totals.won, 0);
});

test("overdue totals count open tasks rather than just affected leads", () => {
  let lead = demoLead();
  for (const [note, dueAt, now] of [
    ["First overdue action", "2026-09-09T08:00:00Z", "2026-09-08T08:00:00Z"],
    ["Second overdue action", "2026-09-09T09:00:00Z", "2026-09-08T08:01:00Z"]
  ]) {
    lead = recordDevelopmentEvent(lead, { type: "follow-up-scheduled", note, dueAt }, { now }).lead;
  }
  const summary = summarizeDevelopment([lead], { now: "2026-09-10T08:00:00Z" });
  assert.equal(summary.totals.openFollowUps, 2);
  assert.equal(summary.totals.overdue, 2);
});

test("normalization drops malformed imported development events", () => {
  const lead = normalizeLead({
    ...demoLead(),
    development: {
      events: [
        { type: "contact-attempted" },
        { type: "follow-up-scheduled", occurredAt: "2026-09-08T08:00:00Z" },
        { type: "follow-up-completed", occurredAt: "2026-09-08T09:00:00Z" },
        { type: "buyer-replied", occurredAt: "2026-09-08T10:00:00Z" }
      ]
    }
  });
  assert.deepEqual(lead.development.events.map((event) => event.type), ["buyer-replied"]);
});
