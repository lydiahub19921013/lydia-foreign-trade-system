import { normalizeLead } from "./model.mjs";
import { qualifyLead } from "./scoring.mjs";

const EVENT_TYPES = new Set([
  "contact-attempted",
  "buyer-replied",
  "quote-sent",
  "sample-sent",
  "order-received",
  "won",
  "lost",
  "reopened",
  "follow-up-scheduled",
  "follow-up-completed",
  "note"
]);

const OUTBOUND_TYPES = new Set([
  "contact-attempted",
  "quote-sent",
  "sample-sent",
  "follow-up-scheduled"
]);

const STAGE_RANK = {
  new: 0,
  contacted: 1,
  replied: 2,
  quoted: 3,
  sampled: 4,
  ordered: 5
};

const EVENT_STAGE = {
  "contact-attempted": "contacted",
  "buyer-replied": "replied",
  "quote-sent": "quoted",
  "sample-sent": "sampled",
  "order-received": "ordered"
};

export const DEVELOPMENT_STAGE_LABELS = {
  new: "尚未开发",
  contacted: "已联系",
  replied: "已回复",
  quoted: "已报价",
  sampled: "已寄样",
  ordered: "已收到订单",
  won: "已成交",
  lost: "已流失"
};

export const DEVELOPMENT_EVENT_LABELS = {
  "contact-attempted": "已联系客户",
  "buyer-replied": "收到客户回复",
  "quote-sent": "已发送报价",
  "sample-sent": "已寄出样品",
  "order-received": "已收到订单",
  won: "确认成交",
  lost: "确认流失",
  reopened: "重新进入开发",
  "follow-up-scheduled": "安排下一步",
  "follow-up-completed": "完成跟进",
  note: "开发备注",
  "activity-voided": "撤回错误记录"
};

function asIso(value, fallback = null) {
  if (!value && fallback) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toISOString();
}

function clean(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function createId(prefix, event) {
  const text = JSON.stringify(event);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function activeDevelopmentEvents(lead) {
  const voided = new Set(
    lead.development.events
      .filter((event) => event.type === "activity-voided" && event.relatedEventId)
      .map((event) => event.relatedEventId)
  );
  return lead.development.events.filter((event) => event.type !== "activity-voided" && !voided.has(event.id));
}

function stageFromEvents(events) {
  let stage = "new";
  let rank = 0;
  let terminal = null;
  const chronological = events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => String(left.event.occurredAt).localeCompare(String(right.event.occurredAt)) || left.index - right.index)
    .map((item) => item.event);
  for (const event of chronological) {
    if (event.type === "reopened") {
      terminal = null;
      continue;
    }
    if (event.type === "won" || event.type === "lost") {
      terminal = event.type;
      continue;
    }
    const nextStage = EVENT_STAGE[event.type];
    if (nextStage && STAGE_RANK[nextStage] > rank) {
      stage = nextStage;
      rank = STAGE_RANK[nextStage];
    }
  }
  return terminal || stage;
}

function openFollowUps(events) {
  const completed = new Set(
    events
      .filter((event) => event.type === "follow-up-completed" && event.relatedEventId)
      .map((event) => event.relatedEventId)
  );
  return events
    .filter((event) => event.type === "follow-up-scheduled" && event.dueAt && !completed.has(event.id))
    .sort((left, right) => String(left.dueAt).localeCompare(String(right.dueAt)));
}

function eventMilestones(events) {
  const types = new Set(events.map((event) => event.type));
  const stage = stageFromEvents(events);
  return {
    contacted: types.has("contact-attempted"),
    replied: types.has("buyer-replied"),
    quoted: types.has("quote-sent"),
    sampled: types.has("sample-sent"),
    ordered: types.has("order-received"),
    won: stage === "won",
    lost: stage === "lost"
  };
}

export function getDevelopmentState(input, { now = new Date().toISOString() } = {}) {
  const lead = normalizeLead(input);
  const activeEvents = activeDevelopmentEvents(lead);
  const followUps = openFollowUps(activeEvents);
  const nextAction = followUps[0] || null;
  const nowIso = asIso(now, new Date().toISOString());
  const overdueFollowUps = followUps.filter((event) => nowIso && event.dueAt < nowIso);
  const voidedIds = new Set(
    lead.development.events
      .filter((event) => event.type === "activity-voided")
      .map((event) => event.relatedEventId)
  );
  return {
    stage: stageFromEvents(activeEvents),
    stageLabel: DEVELOPMENT_STAGE_LABELS[stageFromEvents(activeEvents)],
    milestones: eventMilestones(activeEvents),
    nextAction,
    openFollowUps: followUps,
    overdueFollowUps,
    overdue: overdueFollowUps.length > 0,
    lastActivityAt: activeEvents
      .map((event) => event.occurredAt)
      .filter(Boolean)
      .sort()
      .at(-1) || null,
    events: lead.development.events.map((event) => ({
      ...event,
      voided: event.type !== "activity-voided" && voidedIds.has(event.id)
    }))
  };
}

function withBaseline(lead, capturedAt) {
  if (lead.development.qualificationBaseline) return lead;
  if (lead.development.events.length) return lead;
  const qualification = qualifyLead(lead);
  return normalizeLead({
    ...lead,
    development: {
      ...lead.development,
      qualificationBaseline: {
        grade: qualification.grade,
        score: qualification.score,
        capturedAt
      }
    }
  });
}

export function initializeDevelopmentTracking(inputs, { capturedAt = new Date().toISOString() } = {}) {
  const timestamp = asIso(capturedAt);
  if (!timestamp) throw new Error("开发基线时间格式不正确");
  return inputs.map((input) => withBaseline(normalizeLead(input), timestamp));
}

function ensureContactAllowed(lead, eventType) {
  if (!OUTBOUND_TYPES.has(eventType)) return;
  if (lead.compliance.doNotContact) throw new Error("客户已标记为不联系，不能安排外联");
  if (lead.compliance.restrictedMarket) throw new Error("客户存在市场或合规限制，不能安排外联");
  if (lead.compliance.duplicateOf) throw new Error("该记录已经归入主账户，请在主账户继续开发");
  if (qualifyLead(lead).grade === "HOLD") throw new Error("客户仍处于 HOLD，请先解决身份或合规阻断项");
}

function normalizeNewEvent(input, occurredAt) {
  if (!EVENT_TYPES.has(input.type)) throw new Error("无法识别的开发记录类型");
  const timestamp = asIso(input.occurredAt, occurredAt);
  if (!timestamp) throw new Error("开发记录时间格式不正确");
  const dueAt = input.dueAt ? asIso(input.dueAt) : null;
  if (input.type === "follow-up-scheduled" && !dueAt) throw new Error("安排下一步时必须填写截止时间");
  if (dueAt && dueAt < timestamp) throw new Error("下一步截止时间不能早于记录时间");
  const note = clean(input.note);
  if (["lost", "reopened", "note"].includes(input.type) && note.length < 3) {
    throw new Error("流失、重新开发或备注必须填写至少 3 个字的说明");
  }
  const amount = input.amount === "" || input.amount === null || input.amount === undefined
    ? null
    : Number(input.amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new Error("金额必须是非负数字");
  const currency = clean(input.currency, 3).toUpperCase();
  if (currency && !/^[A-Z]{3}$/u.test(currency)) throw new Error("币种必须是 3 位英文代码");
  const event = {
    id: clean(input.id, 160) || null,
    type: input.type,
    occurredAt: timestamp,
    channel: clean(input.channel, 30).toLowerCase() || null,
    note: note || null,
    dueAt,
    relatedEventId: clean(input.relatedEventId, 160) || null,
    amount,
    currency: currency || null,
    outcomeReason: clean(input.outcomeReason, 120) || null
  };
  event.id ||= createId("dev", { ...event, nonce: occurredAt });
  return event;
}

export function recordDevelopmentEvent(input, eventInput, { now = new Date().toISOString() } = {}) {
  const recordedAt = asIso(now);
  if (!recordedAt) throw new Error("记录时间格式不正确");
  let lead = withBaseline(normalizeLead(input), recordedAt);
  const event = normalizeNewEvent(eventInput, recordedAt);
  ensureContactAllowed(lead, event.type);
  if (lead.development.events.some((item) => item.id === event.id)) throw new Error("开发记录 ID 已存在");

  const currentState = getDevelopmentState(lead, { now: recordedAt });
  if (event.type === "follow-up-scheduled" && ["won", "lost"].includes(currentState.stage)) {
    throw new Error("已成交或已流失客户需要先重新进入开发，才能安排下一步");
  }

  if (event.type === "follow-up-completed") {
    const open = currentState.openFollowUps;
    if (!event.relatedEventId || !open.some((item) => item.id === event.relatedEventId)) {
      throw new Error("只能完成仍在待办中的下一步");
    }
  }
  if (event.type === "reopened" && !["won", "lost"].includes(currentState.stage)) {
    throw new Error("只有已成交或已流失客户需要重新进入开发");
  }

  lead = normalizeLead({
    ...lead,
    development: {
      ...lead.development,
      events: [...lead.development.events, event]
    }
  });
  return { lead, event, state: getDevelopmentState(lead, { now: recordedAt }) };
}

export function voidDevelopmentEvent(input, eventId, { note, now = new Date().toISOString() } = {}) {
  const lead = normalizeLead(input);
  const reason = clean(note);
  if (reason.length < 3) throw new Error("撤回开发记录必须填写至少 3 个字的原因");
  const target = lead.development.events.find((event) => event.id === eventId);
  if (!target || target.type === "activity-voided") throw new Error("找不到可撤回的开发记录");
  if (getDevelopmentState(lead, { now }).events.find((event) => event.id === eventId)?.voided) {
    throw new Error("这条开发记录已经撤回");
  }
  const occurredAt = asIso(now);
  if (!occurredAt) throw new Error("撤回时间格式不正确");
  const event = {
    id: createId("void", { eventId, note: reason, occurredAt }),
    type: "activity-voided",
    occurredAt,
    channel: null,
    note: reason,
    dueAt: null,
    relatedEventId: eventId,
    amount: null,
    currency: null,
    outcomeReason: null
  };
  const updatedLead = normalizeLead({
    ...lead,
    development: {
      ...lead.development,
      events: [...lead.development.events, event]
    }
  });
  return { lead: updatedLead, event, state: getDevelopmentState(updatedLead, { now: occurredAt }) };
}

function percent(count, total) {
  return total ? Math.round((count / total) * 1000) / 10 : null;
}

export function summarizeDevelopment(inputs, options = {}) {
  const leads = inputs.map(normalizeLead);
  const totals = {
    leads: leads.length,
    eligibleLeads: 0,
    duplicateRecords: 0,
    baselineTracked: 0,
    contacted: 0,
    replied: 0,
    quoted: 0,
    sampled: 0,
    ordered: 0,
    won: 0,
    lost: 0,
    openFollowUps: 0,
    overdue: 0
  };
  const byGrade = Object.fromEntries(["A", "B", "C", "D", "HOLD"].map((grade) => [grade, {
    grade,
    leads: 0,
    contacted: 0,
    replied: 0,
    quoted: 0,
    sampled: 0,
    ordered: 0,
    won: 0,
    lost: 0
  }]));

  for (const lead of leads) {
    if (lead.compliance.duplicateOf) {
      totals.duplicateRecords += 1;
      continue;
    }
    totals.eligibleLeads += 1;
    const state = getDevelopmentState(lead, options);
    for (const key of ["contacted", "replied", "quoted", "sampled", "ordered", "won", "lost"]) {
      if (state.milestones[key]) totals[key] += 1;
    }
    totals.openFollowUps += state.openFollowUps.length;
    totals.overdue += state.overdueFollowUps.length;
    const baseline = lead.development.qualificationBaseline;
    if (!baseline || !byGrade[baseline.grade]) continue;
    totals.baselineTracked += 1;
    const group = byGrade[baseline.grade];
    group.leads += 1;
    for (const key of ["contacted", "replied", "quoted", "sampled", "ordered", "won", "lost"]) {
      if (state.milestones[key]) group[key] += 1;
    }
  }

  for (const group of Object.values(byGrade)) {
    group.rates = Object.fromEntries(
      ["contacted", "replied", "quoted", "sampled", "ordered", "won"]
        .map((key) => [key, percent(group[key], group.leads)])
    );
  }
  return { totals, byGrade };
}
