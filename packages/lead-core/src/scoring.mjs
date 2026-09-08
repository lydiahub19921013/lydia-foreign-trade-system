import { normalizeLead } from "./model.mjs";

function hasVerifiedEvidence(lead, kinds) {
  const accepted = new Set(kinds);
  return lead.evidence.some((item) =>
    accepted.has(item.kind)
    && item.status === "verified"
    && item.review?.decision !== "rejected"
    && item.sourceRef
  );
}

function add(dimension, points, reason) {
  dimension.score += points;
  dimension.reasons.push(reason);
}

function cap(dimension) {
  dimension.score = Math.min(25, dimension.score);
  return dimension;
}

function holdReasons(lead) {
  const reasons = [];
  if (lead.compliance.doNotContact) reasons.push("客户已标记为不联系");
  if (lead.compliance.restrictedMarket) reasons.push("存在市场或合规限制");
  if (lead.compliance.duplicateOf) reasons.push(`已归入主账户：${lead.compliance.duplicateOf}`);

  const hasIdentity = Boolean(
    lead.organization.name ||
    lead.organization.domain ||
    lead.organization.website ||
    lead.sourceReference
  );
  if (!hasIdentity) reasons.push("缺少可核查的企业或来源身份");
  return reasons;
}

function gradeFor(score) {
  if (score >= 75) return "A";
  if (score >= 55) return "B";
  if (score >= 35) return "C";
  return "D";
}

function actionFor(grade, missingEvidence) {
  if (grade === "A") return "24 小时内人工复核证据并准备个性化报价或样品方案";
  if (grade === "B") return `先补齐关键证据：${missingEvidence.slice(0, 2).join("、") || "采购时间与决策角色"}`;
  if (grade === "C") return "进入培育队列，先确认公司身份、真实需求和联系人角色";
  return "暂不投入深度开发；保留记录并等待更强的购买信号";
}

export function qualifyLead(input) {
  const lead = normalizeLead(input);
  const holds = holdReasons(lead);
  if (holds.length) {
    return {
      leadId: lead.id,
      score: 0,
      grade: "HOLD",
      dimensions: {},
      reasons: holds,
      missingEvidence: [],
      nextAction: "暂停开发，先解决合规、重复或身份问题"
    };
  }

  const dimensions = {
    evidenceQuality: { score: 0, reasons: [] },
    demandClarity: { score: 0, reasons: [] },
    buyingReadiness: { score: 0, reasons: [] },
    contactabilityAndTrust: { score: 0, reasons: [] }
  };
  const missingEvidence = [];

  if (lead.sourceReference) add(dimensions.evidenceQuality, 5, "询盘保留了原始来源引用");
  else missingEvidence.push("原始询盘链接或编号");

  if (hasVerifiedEvidence(lead, ["company-website", "organization-domain"])) {
    add(dimensions.evidenceQuality, 8, "企业网站或域名已有来源验证");
  } else {
    missingEvidence.push("企业官网或域名证据");
  }

  if (hasVerifiedEvidence(lead, ["business-registration", "business-status"])) {
    add(dimensions.evidenceQuality, 7, "企业登记或经营状态已有来源验证");
  } else {
    missingEvidence.push("企业登记或经营状态");
  }

  if (hasVerifiedEvidence(lead, ["factory", "manufacturing-capability"])) {
    add(dimensions.evidenceQuality, 5, "工厂或生产能力已有来源验证");
  } else if (lead.organization.factoryInfo) {
    add(dimensions.evidenceQuality, 2, "询盘中提供了待核查的工厂信息");
  }

  if (lead.inquiry.message) add(dimensions.demandClarity, 4, "有明确询盘内容");
  if (lead.inquiry.product) add(dimensions.demandClarity, 7, "目标产品明确");
  else missingEvidence.push("目标产品");
  if (lead.inquiry.quantity) add(dimensions.demandClarity, 5, "采购数量明确");
  else missingEvidence.push("采购数量");
  if (lead.inquiry.timeline) add(dimensions.demandClarity, 5, "采购时间明确");
  else missingEvidence.push("采购时间");
  if (lead.inquiry.budget) add(dimensions.demandClarity, 4, "预算或目标价格明确");

  if (lead.signals.explicitInquiry) add(dimensions.buyingReadiness, 6, "客户主动发出询盘");
  if (lead.signals.replied) add(dimensions.buyingReadiness, 4, "客户已有回复互动");
  if (lead.signals.requestedQuote) add(dimensions.buyingReadiness, 5, "客户请求报价");
  if (lead.signals.requestedSample) add(dimensions.buyingReadiness, 6, "客户请求样品");
  if (lead.signals.purchaseOrder) add(dimensions.buyingReadiness, 10, "客户提供采购订单信号");
  if (dimensions.buyingReadiness.score === 0) missingEvidence.push("实际购买动作");

  if (hasVerifiedEvidence(lead, ["business-email", "work-email"])) {
    add(dimensions.contactabilityAndTrust, 8, "工作邮箱已由带来源证据验证");
  } else if (lead.contact.email) {
    add(dimensions.contactabilityAndTrust, 2, "有候选邮箱，但尚未验证");
    missingEvidence.push("工作邮箱验证");
  }

  if (hasVerifiedEvidence(lead, ["whatsapp", "business-phone"])) {
    add(dimensions.contactabilityAndTrust, 7, "企业电话或 WhatsApp 已验证");
  } else if (lead.contact.whatsapp || lead.contact.phone) {
    add(dimensions.contactabilityAndTrust, 2, "有候选电话，但尚未验证");
  }

  if (lead.contact.name && lead.contact.role) {
    add(dimensions.contactabilityAndTrust, 3, "联系人姓名和职务完整");
  } else {
    missingEvidence.push("联系人角色");
  }
  if (lead.signals.mutualIntroduction) add(dimensions.contactabilityAndTrust, 7, "存在双方认可的引荐信号");
  if (lead.signals.priorRelationship) add(dimensions.contactabilityAndTrust, 5, "存在历史业务关系");

  Object.values(dimensions).forEach(cap);
  const score = Object.values(dimensions).reduce((sum, item) => sum + item.score, 0);
  const grade = gradeFor(score);

  return {
    leadId: lead.id,
    score,
    grade,
    dimensions,
    reasons: Object.values(dimensions).flatMap((item) => item.reasons),
    missingEvidence: [...new Set(missingEvidence)],
    nextAction: actionFor(grade, missingEvidence)
  };
}
