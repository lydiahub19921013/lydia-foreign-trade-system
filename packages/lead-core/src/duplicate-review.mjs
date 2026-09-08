import { normalizeLead } from "./model.mjs";
import {
  duplicatePairId,
  findDuplicateCandidates,
  latestDuplicateDecision
} from "./deduplication.mjs";

const DECISIONS = new Set(["same", "distinct", "reopened"]);

function reviewTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.valueOf())) throw new Error("复核时间格式不正确");
  return date.toISOString();
}

function reviewNote(value) {
  const note = String(value || "").trim().slice(0, 1000);
  if (note.length < 3) throw new Error("请填写至少 3 个字的重复客户判断原因");
  return note;
}

function pairMembers(inputs, leadIds) {
  const leads = inputs.map(normalizeLead);
  const ids = Array.isArray(leadIds) ? [...new Set(leadIds.map((id) => String(id || "").trim()))] : [];
  if (ids.length !== 2) throw new Error("请选择两个不同的重复候选");
  const members = ids.map((id) => leads.find((lead) => lead.id === id));
  if (members.some((lead) => !lead)) throw new Error("重复候选已不在当前客户列表中");
  return { leads, members };
}

function referencesThirdLead(lead, pairIds) {
  return lead.compliance.duplicateOf && !pairIds.includes(lead.compliance.duplicateOf);
}

export function reviewDuplicatePair(inputs, leadIds, options = {}) {
  const decision = DECISIONS.has(options.decision) ? options.decision : null;
  if (!decision) throw new Error("重复客户决定必须是同一客户、不同客户或重新判断");
  const note = reviewNote(options.note);
  const reviewedAt = reviewTime(options.reviewedAt);
  const { leads, members } = pairMembers(inputs, leadIds);
  const pairIds = members.map((lead) => lead.id).sort();
  const pairId = duplicatePairId(...pairIds);
  const activeReview = latestDuplicateDecision(...members);
  const candidate = findDuplicateCandidates(leads).find((item) => item.pairId === pairId);

  if (decision === "reopened") {
    if (!activeReview || activeReview.decision === "reopened") throw new Error("这组客户还没有可撤销的人工决定");
  } else {
    if (activeReview && activeReview.decision !== "reopened") throw new Error("这组客户已经处理；请先选择重新判断");
    if (!candidate) throw new Error("这组客户当前没有重复证据，请不要强行合并");
  }

  let primaryLeadId = null;
  let secondaryLeadId = null;
  if (decision === "same") {
    primaryLeadId = String(options.primaryLeadId || "").trim();
    if (!pairIds.includes(primaryLeadId)) throw new Error("主账户必须从这两个客户中选择");
    secondaryLeadId = pairIds.find((id) => id !== primaryLeadId);
    if (members.some((lead) => referencesThirdLead(lead, pairIds))) {
      throw new Error("其中一个客户已属于其他主账户，请先解除原关系");
    }
  }

  const basis = candidate || activeReview;
  const sharedReview = {
    pairId,
    decision,
    primaryLeadId,
    reviewedAt,
    note,
    confidence: basis?.confidence || 0,
    reasons: basis?.reasons || []
  };

  const updatedLeads = leads.map((lead) => {
    if (!pairIds.includes(lead.id)) return lead;
    let duplicateOf = lead.compliance.duplicateOf;
    if (pairIds.includes(duplicateOf)) duplicateOf = null;
    if (decision === "same" && lead.id === secondaryLeadId) duplicateOf = primaryLeadId;
    const otherLeadId = pairIds.find((id) => id !== lead.id);
    return normalizeLead({
      ...lead,
      duplicateReviews: [...lead.duplicateReviews, { ...sharedReview, otherLeadId }],
      compliance: { ...lead.compliance, duplicateOf }
    });
  });

  return {
    leads: updatedLeads,
    pairId,
    decision,
    primaryLeadId,
    secondaryLeadId,
    reviewedAt,
    note
  };
}
