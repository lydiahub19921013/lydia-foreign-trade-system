import {
  SCHEMA_VERSION,
  assessEmailCandidates,
  checkCompanyDomainMatch,
  checkEmailCandidateLeadMatch,
  createEvidence,
  enrichmentFromEvidenceSelection,
  findDuplicateCandidates,
  generateEmailCandidates,
  leadsFromCsv,
  listDuplicateDecisions,
  mergeEvidenceIntoLead,
  normalizeLead,
  createProspectSearchPlan,
  prospectToLead,
  prospectsFromCsv,
  prospectsFromJson,
  prospectsFromSearchResults,
  qualifyLead,
  rankPublicProspects,
  rankIntroductionPaths,
  reviewLeadEvidence,
  relationshipsFromCsv,
  relationshipsFromJson,
  reviewDuplicatePair,
  reviseLeadEvidence
} from "/packages/lead-core/src/index.mjs";

const $ = (selector) => document.querySelector(selector);
let currentResult = null;
let currentProspectPlan = null;
let currentProspectResult = null;
let currentProspectForWebsite = null;
let currentCompanyResearch = null;
let currentWebsiteResearch = null;
let selectedWebsiteEvidenceIds = new Set();
let currentEmailResearch = null;
let currentRelationshipResult = null;
let pendingEvidenceAction = null;
let pendingDuplicateAction = null;

function updateStatus(selector, message, type = "neutral") {
  const status = $(selector);
  status.textContent = message;
  status.className = `status${type === "neutral" ? "" : ` ${type}`}`;
}

function setStatus(message, type = "neutral") {
  updateStatus("#status", message, type);
}

function leadsFromJson(payload) {
  if (Array.isArray(payload)) return payload.map(normalizeLead);
  if (Array.isArray(payload.leads)) return payload.leads.map(normalizeLead);
  if (payload.format === "lydia-qualified-leads" && Array.isArray(payload.results)) {
    return payload.results.map((item) => normalizeLead(item.lead));
  }
  throw new Error("JSON 必须是客户数组、包含 leads 数组，或是 Lydia 分级结果");
}

async function parseFile(file) {
  const text = await file.text();
  if (file.name.toLowerCase().endsWith(".csv")) {
    return leadsFromCsv(text, { channel: $("#channel").value });
  }
  return leadsFromJson(JSON.parse(text));
}

function buildResult(leads, sourceFile) {
  const normalizedLeads = leads.map(normalizeLead);
  return {
    format: "lydia-qualified-leads",
    schemaVersion: SCHEMA_VERSION,
    product: "Lydia 外贸系统",
    generatedAt: new Date().toISOString(),
    sourceFile,
    count: normalizedLeads.length,
    duplicateCandidates: findDuplicateCandidates(normalizedLeads),
    duplicateDecisions: listDuplicateDecisions(normalizedLeads),
    results: normalizedLeads.map((lead) => ({ lead, qualification: qualifyLead(lead) }))
  };
}

function leadDisplayName(leadId) {
  const lead = currentResult?.results.find((item) => item.lead.id === leadId)?.lead;
  return lead?.organization.name || lead?.contact.name || lead?.sourceReference || leadId;
}

function refreshLeadResult(leads) {
  currentResult.results = leads.map((lead) => ({ lead, qualification: qualifyLead(lead) }));
  currentResult.count = leads.length;
  currentResult.generatedAt = new Date().toISOString();
  currentResult.duplicateCandidates = findDuplicateCandidates(leads);
  currentResult.duplicateDecisions = listDuplicateDecisions(leads);
}

function populateResearchLeadTargets() {
  for (const selector of ["#companyTargetLead", "#websiteTargetLead", "#emailTargetLead"]) {
    const select = $(selector);
    const previous = select.value;
    select.replaceChildren();
    if (!currentResult?.results.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "请先导入询盘";
      select.append(option);
      select.disabled = true;
      continue;
    }
    for (const { lead } of currentResult.results) {
      const option = document.createElement("option");
      option.value = lead.id;
      option.textContent = lead.organization.name || lead.contact.name || lead.sourceReference || lead.id;
      select.append(option);
    }
    select.disabled = false;
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }
  prefillEmailInputs(false);
}

function prefillEmailInputs(force = true) {
  const targetId = $("#emailTargetLead")?.value;
  const item = currentResult?.results.find((result) => result.lead.id === targetId);
  if (!item) return;
  const nameInput = $("#emailContactName");
  const domainInput = $("#emailDomain");
  if (force || !nameInput.value) nameInput.value = item.lead.contact.name || "";
  if (force || !domainInput.value) domainInput.value = item.lead.organization.domain || item.lead.organization.website || "";
}

function attachResearchEvidence(targetSelector, enrichment, statusSelector, sourceLabel) {
  const targetId = $(targetSelector).value;
  if (!currentResult || !targetId) {
    updateStatus(statusSelector, "请先导入询盘并选择要关联的客户。", "error");
    return;
  }
  let targetName = targetId;
  currentResult.results = currentResult.results.map((item) => {
    if (item.lead.id !== targetId) return item;
    targetName = item.lead.organization.name || item.lead.contact.name || item.lead.id;
    const lead = mergeEvidenceIntoLead(item.lead, enrichment);
    return { lead, qualification: qualifyLead(lead) };
  });
  currentResult.generatedAt = new Date().toISOString();
  currentResult.duplicateCandidates = findDuplicateCandidates(currentResult.results.map((item) => item.lead));
  currentResult.duplicateDecisions = listDuplicateDecisions(currentResult.results.map((item) => item.lead));
  renderSummary();
  renderLeads();
  updateStatus(statusSelector, `${sourceLabel}已保存到「${targetName}」的询盘档案；原有人工字段不会被覆盖。`, "success");
}

function summaryCard(label, value, grade) {
  const card = document.createElement("div");
  card.className = "summary-card";
  if (grade) card.dataset.grade = grade;
  const text = document.createElement("span");
  text.textContent = label;
  const count = document.createElement("strong");
  count.textContent = value;
  card.append(text, count);
  return card;
}

function renderSummary() {
  const counts = Object.fromEntries(["A", "B", "C", "D", "HOLD"].map((grade) => [grade, 0]));
  for (const item of currentResult.results) counts[item.qualification.grade] += 1;
  const summary = $("#summary");
  summary.replaceChildren(
    summaryCard("全部线索", currentResult.count),
    ...Object.entries(counts).map(([grade, count]) => summaryCard(grade, count, grade))
  );

  const notice = $("#duplicateNotice");
  const strong = currentResult.duplicateCandidates.filter((item) => item.automaticHoldRecommended).length;
  if (currentResult.duplicateCandidates.length) {
    notice.textContent = `还有 ${currentResult.duplicateCandidates.length} 组可能属于同一客户，其中 ${strong} 组由相同域名、登记号、渠道编号或已验证邮箱触发。系统不会自动删除或覆盖资料，请人工指定主账户。`;
    notice.classList.remove("hidden");
  } else if (currentResult.duplicateDecisions.length) {
    notice.textContent = `重复客户候选已经处理完；${currentResult.duplicateDecisions.length} 组人工决定仍保留在下方，可随时重新判断。`;
    notice.classList.remove("hidden");
  } else {
    notice.classList.add("hidden");
  }
  renderDuplicateReviews();
}

function duplicatePairTitle(leadIds) {
  return leadIds.map(leadDisplayName).join(" ↔ ");
}

function openDuplicateDialog(pair, decision) {
  pendingDuplicateAction = { leadIds: pair.leadIds, decision };
  const labels = {
    same: ["确认为同一客户", "请选择一个主账户。另一条询盘只会被关联并暂停重复开发，原始内容不会被删除或覆盖。"],
    distinct: ["确认不是同一客户", "这组提示会被关闭，但人工判断和原因会继续保留。"],
    reopened: ["重新判断这组客户", "原来的人工决定会被撤销；如果重复证据仍然存在，这组候选会重新出现。"]
  };
  const [title, description] = labels[decision];
  $("#duplicateDialogTitle").textContent = title;
  $("#duplicateDialogDescription").textContent = `${duplicatePairTitle(pair.leadIds)}。${description}`;
  const primaryField = $("#duplicatePrimaryField");
  const primarySelect = $("#duplicatePrimaryLead");
  primaryField.hidden = decision !== "same";
  primarySelect.disabled = decision !== "same";
  primarySelect.required = decision === "same";
  primarySelect.replaceChildren();
  if (decision === "same") {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "请选择主账户";
    placeholder.disabled = true;
    placeholder.selected = true;
    primarySelect.append(placeholder);
    for (const leadId of pair.leadIds) {
      const option = document.createElement("option");
      option.value = leadId;
      option.textContent = leadDisplayName(leadId);
      primarySelect.append(option);
    }
  }
  $("#duplicateReviewNote").value = "";
  $("#duplicateDialogStatus").textContent = "";
  $("#duplicateReviewSubmit").textContent = decision === "same" ? "确认主账户" : decision === "distinct" ? "确认不同客户" : "撤销原决定";
  $("#duplicateReviewDialog").showModal();
  (decision === "same" ? primarySelect : $("#duplicateReviewNote")).focus();
}

function duplicateCandidateCard(pair) {
  const card = document.createElement("article");
  card.className = "duplicate-review-card pending";
  const body = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = duplicatePairTitle(pair.leadIds);
  const reason = document.createElement("p");
  reason.textContent = pair.reasons.join(" · ");
  const confidence = document.createElement("small");
  confidence.textContent = `匹配提示强度 ${Math.round(pair.confidence * 100)}% · 只表示需要人工核对`;
  body.append(title, reason, confidence);
  const actions = document.createElement("div");
  actions.className = "duplicate-review-actions";
  const same = document.createElement("button");
  same.className = "button primary compact";
  same.type = "button";
  same.textContent = "确认为同一客户";
  same.addEventListener("click", () => openDuplicateDialog(pair, "same"));
  const distinct = document.createElement("button");
  distinct.className = "button ghost compact";
  distinct.type = "button";
  distinct.textContent = "不是同一客户";
  distinct.addEventListener("click", () => openDuplicateDialog(pair, "distinct"));
  actions.append(same, distinct);
  card.append(body, actions);
  return card;
}

function duplicateDecisionCard(review) {
  const card = document.createElement("article");
  card.className = "duplicate-review-card resolved";
  const body = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = duplicatePairTitle(review.leadIds);
  const decision = document.createElement("p");
  decision.textContent = review.decision === "same"
    ? `已确认为同一客户 · 主账户：${leadDisplayName(review.primaryLeadId)}`
    : "已确认不是同一客户";
  const audit = document.createElement("small");
  const time = review.reviewedAt ? new Date(review.reviewedAt).toLocaleString("zh-CN") : "时间未记录";
  audit.textContent = `${time} · 原因：${review.note || "未填写"}`;
  body.append(title, decision, audit);
  const reopen = document.createElement("button");
  reopen.className = "button ghost compact";
  reopen.type = "button";
  reopen.textContent = "重新判断";
  reopen.addEventListener("click", () => openDuplicateDialog(review, "reopened"));
  card.append(body, reopen);
  return card;
}

function renderDuplicateReviews() {
  const container = $("#duplicateReviewList");
  container.replaceChildren();
  const pending = currentResult?.duplicateCandidates || [];
  const resolved = currentResult?.duplicateDecisions || [];
  if (!pending.length && !resolved.length) {
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");
  if (pending.length) {
    const heading = document.createElement("h3");
    heading.textContent = "待确认的重复客户";
    container.append(heading, ...pending.map(duplicateCandidateCard));
  }
  if (resolved.length) {
    const details = document.createElement("details");
    details.className = "duplicate-resolved";
    const summary = document.createElement("summary");
    summary.textContent = `已处理 ${resolved.length} 组（保留审计，可撤销）`;
    const list = document.createElement("div");
    list.className = "duplicate-resolved-list";
    list.append(...resolved.map(duplicateDecisionCard));
    details.append(summary, list);
    container.append(details);
  }
}

function applyDuplicateAction(event) {
  event.preventDefault();
  if (!pendingDuplicateAction || !currentResult) return;
  try {
    const result = reviewDuplicatePair(
      currentResult.results.map((item) => item.lead),
      pendingDuplicateAction.leadIds,
      {
        decision: pendingDuplicateAction.decision,
        primaryLeadId: $("#duplicatePrimaryLead").value,
        note: $("#duplicateReviewNote").value
      }
    );
    refreshLeadResult(result.leads);
    $("#duplicateReviewDialog").close();
    const message = result.decision === "same"
      ? `已建立主账户「${leadDisplayName(result.primaryLeadId)}」；另一条原始询盘仍完整保留。`
      : result.decision === "distinct"
        ? "已记录为不同客户，这组重复提示不再出现。"
        : "原决定已撤销；若匹配证据仍存在，这组候选已回到待确认列表。";
    pendingDuplicateAction = null;
    renderSummary();
    renderLeads();
    updateStatus("#duplicateReviewStatus", message, "success");
  } catch (error) {
    updateStatus("#duplicateDialogStatus", error.message || "重复客户复核失败。", "error");
  }
}

function evidenceReviewLabel(evidence) {
  if (evidence.review?.decision === "rejected") return "人工已拒绝";
  if (evidence.review?.history?.at(-1)?.action === "revised") return "人工已修订";
  if (evidence.review?.decision === "accepted") return "人工已选";
  return null;
}

function openEvidenceDialog(lead, evidence, action) {
  pendingEvidenceAction = { leadId: lead.id, evidenceId: evidence.id, action };
  const labels = {
    rejected: ["驳回这条证据", "说明为什么这条证据不能继续用于客户判断。由它自动填入且未被人工改过的字段会一并撤回。"],
    accepted: ["恢复使用这条证据", "说明为什么重新使用。只有当前仍为空的原字段才会恢复，不会覆盖人工修改。"],
    revised: ["修订这条证据", "修改证据内容或来源并填写原因。系统保留修改前后的差异。"]
  };
  const [title, description] = labels[action];
  $("#evidenceDialogTitle").textContent = title;
  $("#evidenceDialogDescription").textContent = description;
  $("#evidenceRevisionFields").hidden = action !== "revised";
  $("#evidenceRevisedValue").value = String(evidence.value ?? "");
  $("#evidenceRevisedSource").value = evidence.sourceRef || "";
  $("#evidenceReviewNote").value = "";
  $("#evidenceReviewSubmit").textContent = action === "rejected" ? "确认驳回" : action === "accepted" ? "确认恢复" : "保存修订";
  $("#evidenceDialogStatus").textContent = "";
  $("#evidenceReviewDialog").showModal();
  $("#evidenceReviewNote").focus();
}

function evidenceList(lead) {
  const details = document.createElement("details");
  details.className = "evidence-toggle";
  const summary = document.createElement("summary");
  const rejectedCount = lead.evidence.filter((item) => item.review?.decision === "rejected").length;
  summary.textContent = `查看证据（${lead.evidence.length} 条${rejectedCount ? `，${rejectedCount} 条已拒绝` : ""}）`;
  const list = document.createElement("ul");
  list.className = "evidence-list";

  if (!lead.evidence.length) {
    const item = document.createElement("li");
    item.textContent = "暂无来源证据，所有结论都应视为待核查。";
    list.append(item);
  } else {
    for (const evidence of lead.evidence) {
      const item = document.createElement("li");
      item.className = evidence.review?.decision === "rejected" ? "evidence-item rejected" : "evidence-item";
      const body = document.createElement("div");
      body.className = "evidence-item-body";
      const meta = document.createElement("strong");
      const reviewLabel = evidenceReviewLabel(evidence);
      meta.textContent = `${evidence.status}${reviewLabel ? ` · ${reviewLabel}` : ""} · ${evidence.kind}`;
      const value = document.createElement("span");
      const fullValue = String(evidence.value ?? "");
      value.textContent = fullValue.length > 400 ? `${fullValue.slice(0, 399)}…` : fullValue;
      const source = document.createElement("span");
      source.className = "evidence-source";
      if (/^https?:\/\//iu.test(evidence.sourceRef || "")) {
        const link = document.createElement("a");
        link.href = evidence.sourceRef;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = "查看来源 ↗";
        source.append(link);
      } else if (evidence.sourceRef) {
        source.textContent = `来源：${evidence.sourceRef}`;
      } else {
        source.textContent = "来源缺失";
      }
      body.append(meta, value, source);
      if (evidence.review?.history?.length) {
        const audit = document.createElement("small");
        audit.textContent = `复核历史 ${evidence.review.history.length} 次 · 最近原因：${evidence.review.note || "未填写"}`;
        body.append(audit);
      }
      item.append(body);

      if (lead.id) {
        const actions = document.createElement("div");
        actions.className = "evidence-item-actions";
        const decision = evidence.review?.decision === "rejected" ? "accepted" : "rejected";
        const decisionButton = document.createElement("button");
        decisionButton.className = "button ghost compact";
        decisionButton.type = "button";
        decisionButton.textContent = decision === "rejected" ? "驳回" : "恢复";
        decisionButton.addEventListener("click", () => openEvidenceDialog(lead, evidence, decision));
        actions.append(decisionButton);
        if (decision === "rejected" && evidence.value !== null && evidence.sourceRef) {
          const reviseButton = document.createElement("button");
          reviseButton.className = "button ghost compact";
          reviseButton.type = "button";
          reviseButton.textContent = "修订";
          reviseButton.addEventListener("click", () => openEvidenceDialog(lead, evidence, "revised"));
          actions.append(reviseButton);
        }
        item.append(actions);
      }
      list.append(item);
    }
  }
  details.append(summary, list);
  return details;
}

function evidenceActionMessage(action, result) {
  if (action === "rejected") {
    const cleared = result.clearedFields.length;
    const preserved = result.preservedFields.length;
    return `证据已驳回，撤回 ${cleared} 个由它填入且未被改动的字段${preserved ? `；${preserved} 个已有人工修改的字段保持不变` : ""}。`;
  }
  if (action === "accepted") {
    return `证据已恢复，恢复 ${result.restoredFields.length} 个仍可安全还原的字段${result.preservedFields.length ? `；${result.preservedFields.length} 个现有字段未被覆盖` : ""}。`;
  }
  return `证据修订已保存，更新 ${result.updatedFields.length} 个仍由该证据管理的字段${result.preservedFields.length ? `；${result.preservedFields.length} 个人工字段未被覆盖` : ""}。`;
}

function applyEvidenceAction(event) {
  event.preventDefault();
  if (!pendingEvidenceAction || !currentResult) return;
  const item = currentResult.results.find((result) => result.lead.id === pendingEvidenceAction.leadId);
  if (!item) return;
  const note = $("#evidenceReviewNote").value;
  try {
    const result = pendingEvidenceAction.action === "revised"
      ? reviseLeadEvidence(item.lead, pendingEvidenceAction.evidenceId, {
        value: $("#evidenceRevisedValue").value,
        sourceRef: $("#evidenceRevisedSource").value
      }, { note })
      : reviewLeadEvidence(item.lead, pendingEvidenceAction.evidenceId, {
        decision: pendingEvidenceAction.action,
        note
      });
    currentResult.results = currentResult.results.map((candidate) => candidate.lead.id === item.lead.id
      ? { lead: result.lead, qualification: qualifyLead(result.lead) }
      : candidate);
    currentResult.generatedAt = new Date().toISOString();
    currentResult.duplicateCandidates = findDuplicateCandidates(currentResult.results.map((candidate) => candidate.lead));
    currentResult.duplicateDecisions = listDuplicateDecisions(currentResult.results.map((candidate) => candidate.lead));
    const message = evidenceActionMessage(pendingEvidenceAction.action, result);
    $("#evidenceReviewDialog").close();
    pendingEvidenceAction = null;
    renderSummary();
    renderLeads();
    updateStatus("#evidenceAuditStatus", message, "success");
  } catch (error) {
    updateStatus("#evidenceDialogStatus", error.message || "证据复核失败。", "error");
  }
}

function leadCard(item) {
  const { lead, qualification } = item;
  const card = document.createElement("article");
  card.className = "lead-card";

  const grade = document.createElement("div");
  grade.className = `grade grade-${qualification.grade.toLowerCase()}`;
  grade.textContent = qualification.grade;

  const main = document.createElement("div");
  main.className = "lead-main";
  const title = document.createElement("h3");
  title.textContent = lead.organization.name || lead.contact.name || "未命名询盘";
  const meta = document.createElement("div");
  meta.className = "lead-meta";
  meta.textContent = [lead.source, lead.organization.country, lead.inquiry.product, lead.contact.role].filter(Boolean).join(" · ") || "缺少基础信息";
  const contacts = document.createElement("div");
  contacts.className = "lead-contacts";
  contacts.textContent = [lead.contact.email, lead.contact.whatsapp, lead.contact.phone].filter(Boolean).join(" · ") || "暂无联系信息";
  const action = document.createElement("p");
  action.className = "lead-action";
  action.textContent = qualification.nextAction;
  main.append(title, meta, contacts);
  if (lead.compliance.duplicateOf) {
    const master = document.createElement("p");
    master.className = "duplicate-master";
    master.textContent = `已归入主账户：${leadDisplayName(lead.compliance.duplicateOf)}；本条原始询盘保留。`;
    main.append(master);
  }
  main.append(action);

  if (qualification.missingEvidence.length) {
    const missing = document.createElement("div");
    missing.className = "missing";
    for (const value of qualification.missingEvidence.slice(0, 5)) {
      const badge = document.createElement("span");
      badge.textContent = `待补：${value}`;
      missing.append(badge);
    }
    main.append(missing);
  }

  const score = document.createElement("div");
  score.className = "score";
  const number = document.createElement("strong");
  number.textContent = qualification.score;
  const caption = document.createElement("span");
  caption.textContent = "开发优先分 / 100";
  score.append(number, caption);

  card.append(grade, main, score, evidenceList(lead));
  return card;
}

function renderLeads() {
  const filter = $("#gradeFilter").value;
  const list = $("#leadList");
  list.replaceChildren();
  const results = currentResult.results
    .filter((item) => filter === "ALL" || item.qualification.grade === filter)
    .sort((left, right) => right.qualification.score - left.qualification.score);

  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "这个等级暂时没有线索。";
    list.append(empty);
    return;
  }
  list.append(...results.map(leadCard));
}

function showResult(leads, sourceFile) {
  currentResult = buildResult(leads, sourceFile);
  populateResearchLeadTargets();
  renderSummary();
  renderLeads();
  $("#dashboard").classList.remove("hidden");
  setStatus(`已在本机完成 ${leads.length} 条询盘分级。请人工复核来源和高优先级客户。`, "success");
  $("#dashboard").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadSelectedFile(file) {
  if (!file) return;
  try {
    setStatus(`正在读取 ${file.name}……`);
    const leads = await parseFile(file);
    if (!leads.length) throw new Error("文件中没有可识别的询盘");
    showResult(leads, file.name);
  } catch (error) {
    setStatus(error.message || "导入失败，请检查文件格式。", "error");
  }
}

function downloadResult() {
  if (!currentResult) return;
  downloadJson(currentResult, `Lydia-客户分级-${new Date().toISOString().slice(0, 10)}.json`);
  setStatus("Lydia 分级结果已导出，可在外贸开发插件中导入。", "success");
}

function downloadJson(payload, filename) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function fact(label, value) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value || "未提供";
  row.append(term, description);
  return row;
}

function prospectStageLabel(prospect) {
  if (prospect.qualification.stage === "primary") return "优先候选";
  if (prospect.qualification.stage === "shortlist") return "已核查候选";
  if (prospect.qualification.stage === "reviewed") return "已看原页，仍需补证";
  return "搜索候选，未核查原页";
}

function prospectCard(prospect) {
  const card = document.createElement("article");
  card.className = "prospect-card";
  const heading = document.createElement("div");
  heading.className = "company-heading";
  const title = document.createElement("h3");
  title.textContent = prospect.companyName || prospect.title || "未命名公开候选";
  const badge = document.createElement("span");
  badge.className = prospect.qualification.stage === "primary" ? "evidence-badge verified" : "evidence-badge";
  badge.textContent = prospectStageLabel(prospect);
  heading.append(title, badge);

  const meta = document.createElement("p");
  meta.className = "prospect-meta";
  meta.textContent = [prospect.product, prospect.market, prospect.buyerType, prospect.publishedAt?.slice(0, 10)].filter(Boolean).join(" · ") || "缺少产品或市场背景";
  const excerpt = document.createElement("p");
  excerpt.className = "prospect-excerpt";
  const fullExcerpt = prospect.signalExcerpt || "没有可引用的公开信号，不能进入优先名单。";
  excerpt.textContent = fullExcerpt.length > 700 ? `${fullExcerpt.slice(0, 699)}…` : fullExcerpt;

  const score = document.createElement("div");
  score.className = "prospect-score";
  const scoreNumber = document.createElement("strong");
  scoreNumber.textContent = prospect.qualification.score;
  const scoreCaption = document.createElement("span");
  scoreCaption.textContent = prospect.qualification.cap === 49 ? "候选分 · 上限 49" : "公开信号分 / 100";
  score.append(scoreNumber, scoreCaption);

  const source = document.createElement("a");
  source.className = "source-link";
  source.href = prospect.sourceUrl;
  source.target = "_blank";
  source.rel = "noreferrer";
  source.textContent = "打开搜索来源 ↗";

  const review = document.createElement("button");
  review.className = "button primary compact";
  review.type = "button";
  review.textContent = "送去官网补证";
  review.disabled = !prospect.sourceUrl;
  review.addEventListener("click", () => {
    currentProspectForWebsite = prospect;
    $("#websiteUrl").value = prospect.sourceUrl || "";
    $("#websiteConfirmed").checked = false;
    updateStatus("#websiteStatus", "已带入候选来源。请确认它是否为企业原始公开页面；若是目录或社媒页，请改填该企业官网。", "neutral");
    $("#website-title").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(source, review);
  const body = document.createElement("div");
  body.append(heading, meta, excerpt, actions);
  card.append(body, score);
  return card;
}

function showProspectResults(prospects, source, provider = "local-import") {
  const ranked = rankPublicProspects(prospects);
  currentProspectResult = {
    format: "lydia-public-prospects",
    schemaVersion: 1,
    product: "Lydia 外贸系统",
    generatedAt: new Date().toISOString(),
    source,
    provider,
    count: ranked.length,
    prospects: ranked,
    disclaimer: "搜索摘要和导入候选都不是已核实事实；必须回到原始公开页面核查。"
  };
  const container = $("#prospectResults");
  container.replaceChildren();
  if (ranked.length) container.append(...ranked.map(prospectCard));
  else {
    const empty = document.createElement("p");
    empty.className = "empty bordered-empty";
    empty.textContent = "没有返回可识别的公开候选。可以换一个搜索方向或导入 Lydia 候选文件。";
    container.append(empty);
  }
  $("#exportProspects").disabled = false;
  updateStatus("#prospectStatus", `得到 ${ranked.length} 个公开候选；它们都还不能当作已确认客户，请先补看原始页面。`, ranked.length ? "success" : "neutral");
}

function renderProspectPlan(plan) {
  const container = $("#prospectQueries");
  container.replaceChildren();
  for (const item of plan.queries) {
    const card = document.createElement("article");
    card.className = "query-card";
    const label = document.createElement("strong");
    label.textContent = item.label;
    const queryText = document.createElement("p");
    queryText.textContent = item.query;
    const purpose = document.createElement("small");
    purpose.textContent = item.purpose;
    const search = document.createElement("button");
    search.className = "button ghost compact";
    search.type = "button";
    search.textContent = "搜索这个方向";
    search.addEventListener("click", () => searchPublicProspects(item, search));
    card.append(label, queryText, purpose, search);
    container.append(card);
  }
}

function buildProspectPlan(event) {
  event.preventDefault();
  try {
    currentProspectPlan = createProspectSearchPlan({
      product: $("#prospectProduct").value,
      market: $("#prospectMarket").value,
      buyerType: $("#prospectBuyerType").value,
      application: $("#prospectApplication").value
    });
    renderProspectPlan(currentProspectPlan);
    updateStatus("#prospectStatus", "已生成 5 个搜索方向。勾选公开信息确认后，选择一个方向搜索。", "success");
  } catch (error) {
    updateStatus("#prospectStatus", error.message || "无法生成搜索计划。", "error");
  }
}

async function searchPublicProspects(item, button) {
  if (!$("#prospectSearchConfirmed").checked) {
    updateStatus("#prospectStatus", "请先勾选公开商业信息与 Exa 数据去向确认。", "error");
    return;
  }
  button.disabled = true;
  updateStatus("#prospectStatus", `正在搜索「${item.label}」方向……`);
  try {
    const parameters = new URLSearchParams({ q: item.query, limit: "5", confirmed: "true" });
    const response = await fetch(`/api/prospects/search?${parameters}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "公开候选搜索失败");
    const prospects = prospectsFromSearchResults(payload.results, currentProspectPlan.context, payload.observedAt);
    showProspectResults(prospects, item.query, payload.provider);
  } catch (error) {
    updateStatus("#prospectStatus", error.message || "公开候选搜索失败。", "error");
  } finally {
    button.disabled = false;
  }
}

async function loadProspectFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const defaults = currentProspectPlan?.context || {};
    const prospects = file.name.toLowerCase().endsWith(".csv")
      ? prospectsFromCsv(text, defaults)
      : prospectsFromJson(JSON.parse(text), defaults);
    showProspectResults(prospects, file.name);
  } catch (error) {
    updateStatus("#prospectStatus", error.message || "候选文件导入失败。", "error");
  }
}

function addProspectToDevelopmentQueue(websiteResearch) {
  if (!currentProspectForWebsite) {
    updateStatus("#websiteStatus", "请先从主动找客户区域选择一个候选。", "error");
    return;
  }
  try {
    const lead = prospectToLead(currentProspectForWebsite, {
      ...websiteResearch,
      originalPageReviewed: true
    });
    if (currentResult?.results.some((item) => item.lead.id === lead.id)) {
      updateStatus("#websiteStatus", "这个公开候选已经在当前开发队列中。", "error");
      return;
    }
    const leads = currentResult ? [...currentResult.results.map((item) => item.lead), lead] : [lead];
    currentResult = buildResult(leads, currentResult?.sourceFile || "主动开发队列");
    populateResearchLeadTargets();
    renderSummary();
    renderLeads();
    $("#dashboard").classList.remove("hidden");
    updateStatus("#websiteStatus", `已把「${lead.organization.name || "公开候选"}」加入开发队列；它不是主动询盘，仍需补需求和联系人证据。`, "success");
  } catch (error) {
    updateStatus("#websiteStatus", error.message || "无法加入开发队列。", "error");
  }
}

function companyCard(company) {
  const card = document.createElement("article");
  card.className = "company-card";

  const heading = document.createElement("div");
  heading.className = "company-heading";
  const title = document.createElement("h3");
  title.textContent = company.legalName || "未命名法律实体";
  const badge = document.createElement("span");
  badge.className = company.evidence.some((item) => item.status === "verified") ? "evidence-badge verified" : "evidence-badge";
  badge.textContent = badge.classList.contains("verified") ? "GLEIF 已核实记录" : "需进一步核查";
  heading.append(title, badge);

  const facts = document.createElement("dl");
  facts.className = "fact-grid";
  facts.append(
    fact("LEI", company.lei),
    fact("实体 / LEI 状态", [company.entityStatus, company.registrationStatus].filter(Boolean).join(" / ")),
    fact("司法辖区", company.jurisdiction),
    fact("登记编号", company.registeredAs),
    fact("法定地址", company.legalAddress),
    fact("总部地址", company.headquartersAddress),
    fact("最后更新", company.lastUpdateDate)
  );

  const source = document.createElement("a");
  source.className = "source-link";
  source.href = company.sourceRef;
  source.target = "_blank";
  source.rel = "noreferrer";
  source.textContent = "查看 GLEIF 原始记录 ↗";

  const save = document.createElement("button");
  save.className = "button ghost compact";
  save.type = "button";
  save.textContent = "确认匹配并加入询盘";
  save.addEventListener("click", () => {
    const byKind = Object.fromEntries(company.evidence.map((item) => [item.kind, item.id]));
    attachResearchEvidence("#companyTargetLead", {
      organization: {
        name: company.legalName,
        address: company.legalAddress,
        registrationId: company.registeredAs
      },
      evidence: company.evidence,
      fieldEvidence: {
        "organization.name": byKind["legal-entity-record"],
        "organization.address": byKind["business-address"],
        "organization.registrationId": byKind["business-registration"]
      },
      appliedAt: currentCompanyResearch?.observedAt
    }, "#companyStatus", "GLEIF 企业证据");
  });

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(source, save);
  card.append(heading, facts, actions, evidenceList({ evidence: company.evidence }));
  return card;
}

function renderCompanyResearch() {
  const container = $("#companyResults");
  container.replaceChildren();
  if (!currentCompanyResearch.results.length) {
    const empty = document.createElement("p");
    empty.className = "empty bordered-empty";
    empty.textContent = "GLEIF 没有返回匹配项。这不代表公司不存在，许多中小企业没有 LEI；请继续查官方工商记录和公司官网。";
    container.append(empty);
    return;
  }
  container.append(...currentCompanyResearch.results.map(companyCard));
}

async function searchCompany(event) {
  event.preventDefault();
  const query = $("#companyQuery").value.trim();
  const jurisdiction = $("#companyJurisdiction").value.trim();
  const button = $("#searchCompany");
  button.disabled = true;
  updateStatus("#companyStatus", "正在查询 GLEIF 官方企业身份记录……");
  try {
    const parameters = new URLSearchParams({ q: query });
    if (jurisdiction) parameters.set("jurisdiction", jurisdiction);
    const response = await fetch(`/api/gleif/search?${parameters}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "企业核验失败");
    currentCompanyResearch = {
      format: "lydia-company-evidence",
      schemaVersion: 1,
      product: "Lydia 外贸系统",
      ...payload
    };
    renderCompanyResearch();
    $("#exportCompanyEvidence").disabled = false;
    const shown = payload.results.length;
    updateStatus(
      "#companyStatus",
      shown ? `找到 ${payload.total} 条可能记录，当前展示 ${shown} 条。请按法定名称、辖区和地址人工确认。` : "未找到 LEI 记录，请继续使用其他官方来源核查。",
      shown ? "success" : "neutral"
    );
  } catch (error) {
    currentCompanyResearch = null;
    $("#companyResults").replaceChildren();
    $("#exportCompanyEvidence").disabled = true;
    updateStatus("#companyStatus", error.message || "企业核验失败，请稍后重试。", "error");
  } finally {
    button.disabled = false;
  }
}

function contactGroup(label, values) {
  const group = document.createElement("div");
  group.className = "contact-group";
  const title = document.createElement("strong");
  title.textContent = label;
  const content = document.createElement("p");
  content.textContent = values?.length ? values.join(" · ") : "这张页面未发现";
  group.append(title, content);
  return group;
}

function dossierPages(result) {
  if (!Array.isArray(result.pages) || !result.pages.length) return null;
  const details = document.createElement("details");
  details.className = "dossier-pages";
  const summary = document.createElement("summary");
  summary.textContent = `查看已读取页面（${result.pages.length} 张）`;
  const list = document.createElement("ul");
  for (const page of result.pages) {
    const item = document.createElement("li");
    const source = document.createElement("a");
    source.href = page.url;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = page.title || page.url;
    const detail = document.createTextNode(` · ${page.discoveryReason || "公开页面"} · ${page.evidenceCount || 0} 条证据`);
    item.append(source, detail);
    list.append(item);
  }
  details.append(summary, list);
  return details;
}

function updateWebsiteSelectionActions() {
  if (currentWebsiteResearch) {
    currentWebsiteResearch.reviewedEvidenceIds = [...selectedWebsiteEvidenceIds];
    currentWebsiteResearch.reviewedAt = new Date().toISOString();
  }
  for (const button of document.querySelectorAll(".website-save-action")) {
    button.disabled = selectedWebsiteEvidenceIds.size === 0 || (button.dataset.requiresLead === "true" && !currentResult?.results.length);
  }
  const count = $("#websiteSelectionCount");
  if (count) count.textContent = `已选择 ${selectedWebsiteEvidenceIds.size} 条；未选择的内容不会进入客户档案。`;
}

function reviewableEvidenceList(result) {
  const details = document.createElement("details");
  details.className = "evidence-review";
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = `逐条选择要保留的证据（${result.evidence.length} 条）`;
  const count = document.createElement("p");
  count.id = "websiteSelectionCount";
  count.className = "selection-count";
  count.textContent = "已选择 0 条；未选择的内容不会进入客户档案。";
  const list = document.createElement("div");
  list.className = "evidence-choice-list";
  for (const evidence of result.evidence) {
    const label = document.createElement("label");
    label.className = "evidence-choice";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedWebsiteEvidenceIds.has(evidence.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedWebsiteEvidenceIds.add(evidence.id);
      else selectedWebsiteEvidenceIds.delete(evidence.id);
      updateWebsiteSelectionActions();
    });
    const body = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = evidence.kind;
    const value = document.createElement("span");
    const evidenceValue = String(evidence.value ?? "");
    value.textContent = evidenceValue.length > 260 ? `${evidenceValue.slice(0, 259)}…` : evidenceValue;
    const source = document.createElement("a");
    source.href = evidence.sourceRef;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = "查看来源 ↗";
    source.addEventListener("click", (event) => event.stopPropagation());
    body.append(title, value, source);
    label.append(checkbox, body);
    list.append(label);
  }
  details.append(summary, count, list);
  return details;
}

function selectedWebsiteResearch(result) {
  const selected = enrichmentFromEvidenceSelection(result.evidence, selectedWebsiteEvidenceIds, { reviewedAt: currentWebsiteResearch?.reviewedAt });
  return {
    ...selected,
    reviewedPageUrl: result.finalUrl,
    originalPageReviewed: true,
    reviewedAt: currentWebsiteResearch?.reviewedAt,
    reviewedEvidenceIds: [...selectedWebsiteEvidenceIds]
  };
}

function websiteCard(result) {
  const card = document.createElement("article");
  card.className = "company-card";
  const heading = document.createElement("div");
  heading.className = "company-heading";
  const title = document.createElement("h3");
  title.textContent = result.title || "公开官网页面";
  const badge = document.createElement("span");
  badge.className = "evidence-badge";
  badge.textContent = "全部为候选证据";
  heading.append(title, badge);

  const contacts = document.createElement("div");
  contacts.className = "contact-grid";
  contacts.append(
    contactGroup("公开邮箱", result.contacts?.emails),
    contactGroup("公开电话", result.contacts?.phones),
    contactGroup("公开 WhatsApp", result.contacts?.whatsapp)
  );

  const facts = document.createElement("dl");
  facts.className = "fact-grid";
  facts.append(
    fact("读取范围", result.pageCount ? `${result.pageCount} 张同站公开页面` : "使用者指定的 1 张页面"),
    fact("公开地址", result.addresses?.join("；")),
    fact("生产/工厂自述", result.factorySignals?.join("；")),
    fact("观察时间", result.observedAt)
  );

  const source = document.createElement("a");
  source.className = "source-link";
  source.href = result.finalUrl;
  source.target = "_blank";
  source.rel = "noreferrer";
  source.textContent = "打开来源页面 ↗";

  const save = document.createElement("button");
  save.className = "button ghost compact website-save-action";
  save.type = "button";
  save.dataset.requiresLead = "true";
  save.textContent = "把所选证据加入询盘";
  save.disabled = true;
  save.addEventListener("click", () => {
    try {
      const targetId = $("#websiteTargetLead").value;
      const target = currentResult?.results.find((item) => item.lead.id === targetId)?.lead;
      const match = checkCompanyDomainMatch(target, result.finalUrl);
      if (!match.allowed) {
        updateStatus("#websiteStatus", `不能加入：该询盘企业域名 ${match.existingDomain || "格式异常"} 与官网域名 ${match.candidateDomain} 不一致。`, "error");
        return;
      }
      attachResearchEvidence("#websiteTargetLead", enrichmentFromEvidenceSelection(result.evidence, selectedWebsiteEvidenceIds, { reviewedAt: currentWebsiteResearch?.reviewedAt }), "#websiteStatus", "所选官网证据");
    } catch (error) {
      updateStatus("#websiteStatus", error.message || "请选择要保留的证据。", "error");
    }
  });

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(source, save);
  if (currentProspectForWebsite) {
    const addToQueue = document.createElement("button");
    addToQueue.className = "button primary compact website-save-action";
    addToQueue.type = "button";
    addToQueue.textContent = "用所选证据加入开发队列";
    addToQueue.disabled = true;
    addToQueue.addEventListener("click", () => {
      try {
        addProspectToDevelopmentQueue(selectedWebsiteResearch(result));
      } catch (error) {
        updateStatus("#websiteStatus", error.message || "请选择要保留的证据。", "error");
      }
    });
    actions.append(addToQueue);
  }
  card.append(heading, contacts, facts);
  const pages = dossierPages(result);
  if (pages) card.append(pages);
  card.append(reviewableEvidenceList(result), actions);
  updateWebsiteSelectionActions();
  return card;
}

function renderWebsiteResearch() {
  const container = $("#websiteResults");
  container.replaceChildren(websiteCard(currentWebsiteResearch));
}

async function searchWebsite(event) {
  event.preventDefault();
  const websiteUrl = $("#websiteUrl").value.trim();
  const confirmed = $("#websiteConfirmed").checked;
  const mode = event.submitter?.dataset.mode === "dossier" ? "dossier" : "page";
  const buttons = [$("#searchWebsite"), $("#buildWebsiteDossier")];
  for (const button of buttons) button.disabled = true;
  updateStatus("#websiteStatus", mode === "dossier" ? "正在整理最多 5 张同站公开页面……" : "正在读取指定的公开官网页面……");
  try {
    const parameters = new URLSearchParams({ url: websiteUrl, confirmed: String(confirmed) });
    const response = await fetch(`/api/website/${mode === "dossier" ? "dossier" : "snapshot"}?${parameters}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || (mode === "dossier" ? "官网档案整理失败" : "官网读取失败"));
    currentWebsiteResearch = {
      format: mode === "dossier" ? "lydia-public-website-dossier" : "lydia-public-website-evidence",
      schemaVersion: 1,
      product: "Lydia 外贸系统",
      ...payload
    };
    selectedWebsiteEvidenceIds = new Set();
    renderWebsiteResearch();
    $("#exportWebsiteEvidence").disabled = false;
    const contacts = [
      ...(payload.contacts?.emails || []),
      ...(payload.contacts?.phones || []),
      ...(payload.contacts?.whatsapp || [])
    ].length;
    const pages = payload.pageCount || 1;
    const failureText = payload.failures?.length ? `，另有 ${payload.failures.length} 张候选页面未能读取` : "";
    updateStatus("#websiteStatus", `已读取 ${pages} 张页面，形成 ${payload.evidence.length} 条候选证据，其中 ${contacts} 条公开联系线索${failureText}。请逐项人工核查。`, "success");
  } catch (error) {
    currentWebsiteResearch = null;
    $("#websiteResults").replaceChildren();
    $("#exportWebsiteEvidence").disabled = true;
    updateStatus("#websiteStatus", error.message || "官网读取失败，请检查网址或稍后重试。", "error");
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

function candidateStatus(candidate) {
  if (candidate.status === "rejected") return { label: "域名无邮件路由", className: "rejected" };
  if (candidate.listedOnWebsite) return { label: "官网公开候选", className: "published" };
  if (candidate.domainStatus === "mx-found") return { label: "域名存在 MX", className: "" };
  return { label: "仍需补证", className: "" };
}

function emailCandidateCard(candidate) {
  const card = document.createElement("article");
  card.className = "email-card";
  const address = document.createElement("div");
  address.className = "email-address";
  const email = document.createElement("strong");
  email.textContent = candidate.email;
  const type = document.createElement("small");
  type.textContent = candidate.type === "role" ? "企业职能邮箱候选" : `联系人邮箱候选 · ${candidate.pattern}`;
  address.append(email, type);

  const signals = document.createElement("div");
  signals.className = "email-signals";
  signals.textContent = candidate.signals.length ? candidate.signals.join(" · ") : candidate.reason;

  const actions = document.createElement("div");
  const status = candidateStatus(candidate);
  const badge = document.createElement("span");
  badge.className = `email-status-badge${status.className ? ` ${status.className}` : ""}`;
  badge.textContent = status.label;
  const save = document.createElement("button");
  save.className = "button ghost compact";
  save.type = "button";
  save.textContent = "作为候选加入询盘";
  save.disabled = candidate.status === "rejected";
  save.addEventListener("click", () => {
    const targetId = $("#emailTargetLead").value;
    const target = currentResult?.results.find((item) => item.lead.id === targetId)?.lead;
    const match = checkEmailCandidateLeadMatch(target, candidate.domain);
    if (!match.allowed) {
      const detail = match.existingDomain
        ? `该询盘已有企业域名 ${match.existingDomain}，与候选域名 ${match.candidateDomain} 不一致。`
        : `${match.reason}，请先人工修正。`;
      updateStatus("#emailStatus", `不能加入：${detail}`, "error");
      return;
    }
    const sourceRef = candidate.listedOnWebsite
      ? currentEmailResearch.websiteSourceRef
      : currentEmailResearch.mailDomain.sourceRef;
    const confidence = candidate.listedOnWebsite ? 0.75 : candidate.domainStatus === "mx-found" ? 0.45 : 0.3;
    const emailEvidence = createEvidence({
      kind: "business-email",
      value: candidate.email,
      sourceRef,
      observedAt: currentEmailResearch.observedAt,
      confidence,
      status: candidate.status === "inconclusive" ? "inconclusive" : "candidate",
      note: candidate.listedOnWebsite
        ? "指定官网页面公开列出，但尚未验证当前可投递、联系人身份或营销同意"
        : "根据姓名/职能命名规则生成；DNS 只检查域名邮件路由，不证明该邮箱存在"
    });
    attachResearchEvidence("#emailTargetLead", {
      organization: { domain: candidate.domain },
      contact: { email: candidate.email },
      evidence: [currentEmailResearch.mailDomain.evidence, emailEvidence],
      fieldEvidence: {
        "organization.domain": emailEvidence.id,
        "contact.email": emailEvidence.id
      },
      appliedAt: currentEmailResearch.observedAt
    }, "#emailStatus", "候选邮箱" );
  });
  actions.className = "card-actions";
  actions.append(badge, save);
  card.append(address, signals, actions);
  return card;
}

function renderEmailCandidates() {
  const container = $("#emailResults");
  container.replaceChildren(...currentEmailResearch.candidates.map(emailCandidateCard));
}

async function generateAndCheckEmailCandidates(event) {
  event.preventDefault();
  const button = $("#generateEmailCandidates");
  button.disabled = true;
  updateStatus("#emailStatus", "正在生成候选并检查企业域名邮件路由……");
  try {
    const generated = generateEmailCandidates($("#emailContactName").value, $("#emailDomain").value);
    const domain = generated[0].domain;
    const response = await fetch(`/api/mail-domain/check?${new URLSearchParams({ domain })}`);
    const mailDomain = await response.json();
    if (!response.ok) throw new Error(mailDomain.error || "域名检查失败");
    const publishedEmails = currentWebsiteResearch?.contacts?.emails || [];
    const candidates = assessEmailCandidates(generated, mailDomain, publishedEmails);
    currentEmailResearch = {
      format: "lydia-email-candidates",
      schemaVersion: 1,
      product: "Lydia 外贸系统",
      generatedAt: new Date().toISOString(),
      observedAt: mailDomain.observedAt,
      contactName: $("#emailContactName").value.trim() || null,
      domain,
      mailDomain,
      websiteSourceRef: currentWebsiteResearch?.finalUrl || null,
      candidates,
      disclaimer: "所有具体邮箱仍是候选；MX、官网公开或命名规则都不等于可投递性、联系人身份或营销同意。"
    };
    renderEmailCandidates();
    $("#exportEmailCandidates").disabled = false;
    const publishedCount = candidates.filter((candidate) => candidate.listedOnWebsite).length;
    const routeText = mailDomain.status === "mx-found" ? "域名存在 MX" : mailDomain.status === "no-mail-route" ? "域名没有邮件路由" : "域名邮件路由仍不确定";
    updateStatus("#emailStatus", `生成 ${candidates.length} 个候选；${routeText}；${publishedCount} 个被当前官网页面公开列出。具体邮箱仍未验证。`, mailDomain.status === "no-mail-route" ? "error" : "success");
  } catch (error) {
    currentEmailResearch = null;
    $("#emailResults").replaceChildren();
    $("#exportEmailCandidates").disabled = true;
    updateStatus("#emailStatus", error.message || "候选邮箱生成失败。", "error");
  } finally {
    button.disabled = false;
  }
}

async function relationshipPathsFromFile(file) {
  const text = await file.text();
  if (file.name.toLowerCase().endsWith(".csv")) return relationshipsFromCsv(text);
  return relationshipsFromJson(JSON.parse(text));
}

function relationshipCard(path) {
  const card = document.createElement("article");
  card.className = "relationship-card";
  const score = document.createElement("div");
  score.className = "path-score";
  const number = document.createElement("strong");
  number.textContent = path.score;
  const caption = document.createElement("span");
  caption.textContent = "路径分";
  score.append(number, caption);

  const body = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = `${path.connectorName || path.connectorId || "未命名关系人"} → ${path.targetName || path.targetId || "目标客户"}`;
  const consent = document.createElement("p");
  consent.className = `consent consent-${path.consentStatus}`;
  consent.textContent = path.consentStatus === "approved" ? "已记录同意" : "尚未取得同意";
  const reasons = document.createElement("p");
  reasons.className = "path-reasons";
  reasons.textContent = path.reasons.join(" · ");
  const action = document.createElement("p");
  action.className = "lead-action";
  action.textContent = path.nextAction;
  body.append(title, consent, reasons, action);
  card.append(score, body);
  return card;
}

function showRelationshipPaths(paths, sourceFile) {
  const ranked = rankIntroductionPaths(paths);
  currentRelationshipResult = {
    format: "lydia-relationship-paths",
    schemaVersion: 1,
    product: "Lydia 外贸系统",
    generatedAt: new Date().toISOString(),
    sourceFile,
    inputCount: paths.length,
    excludedDeclinedCount: paths.filter((path) => path.consentStatus === "declined").length,
    paths: ranked
  };
  const container = $("#relationshipResults");
  container.replaceChildren();
  if (ranked.length) container.append(...ranked.map(relationshipCard));
  else {
    const empty = document.createElement("p");
    empty.className = "empty bordered-empty";
    empty.textContent = "没有可使用的候选关系路径。已拒绝参与的人不会进入结果。";
    container.append(empty);
  }
  $("#exportRelationshipPaths").disabled = false;
  updateStatus("#relationshipStatus", `已在本机评估 ${paths.length} 条关系记录，排除 ${currentRelationshipResult.excludedDeclinedCount} 条拒绝路径。`, "success");
}

async function loadRelationshipFile(file) {
  if (!file) return;
  try {
    updateStatus("#relationshipStatus", `正在读取 ${file.name}……`);
    const paths = await relationshipPathsFromFile(file);
    if (!paths.length) throw new Error("文件中没有关系记录");
    showRelationshipPaths(paths, file.name);
  } catch (error) {
    currentRelationshipResult = null;
    $("#relationshipResults").replaceChildren();
    $("#exportRelationshipPaths").disabled = true;
    updateStatus("#relationshipStatus", error.message || "关系文件导入失败。", "error");
  }
}

$("#prospectPlanForm").addEventListener("submit", buildProspectPlan);
$("#prospectFile").addEventListener("change", (event) => loadProspectFile(event.target.files[0]));
$("#loadProspectSample").addEventListener("click", async () => {
  try {
    const response = await fetch("/examples/prospects.sample.json");
    if (!response.ok) throw new Error("无法读取虚构候选样例");
    showProspectResults(prospectsFromJson(await response.json()), "prospects.sample.json");
  } catch (error) {
    updateStatus("#prospectStatus", error.message || "无法读取虚构候选样例。", "error");
  }
});
$("#exportProspects").addEventListener("click", () => {
  if (!currentProspectResult) return;
  downloadJson(currentProspectResult, `Lydia-公开候选-${new Date().toISOString().slice(0, 10)}.json`);
  updateStatus("#prospectStatus", "公开候选已导出；搜索摘要仍需回到原始页面核查。", "success");
});

$("#leadFile").addEventListener("change", (event) => loadSelectedFile(event.target.files[0]));
$("#gradeFilter").addEventListener("change", renderLeads);
$("#exportResults").addEventListener("click", downloadResult);
$("#loadSample").addEventListener("click", async () => {
  try {
    const response = await fetch("/examples/inquiries.sample.csv");
    if (!response.ok) throw new Error("无法读取虚构样例");
    showResult(leadsFromCsv(await response.text(), { channel: "auto" }), "inquiries.sample.csv");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

for (const eventName of ["dragenter", "dragover"]) {
  $("#dropZone").addEventListener(eventName, (event) => {
    event.preventDefault();
    $("#dropZone").classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  $("#dropZone").addEventListener(eventName, (event) => {
    event.preventDefault();
    $("#dropZone").classList.remove("dragging");
  });
}
$("#dropZone").addEventListener("drop", (event) => loadSelectedFile(event.dataTransfer.files[0]));

$("#companyResearchForm").addEventListener("submit", searchCompany);
$("#exportCompanyEvidence").addEventListener("click", () => {
  if (!currentCompanyResearch) return;
  downloadJson(currentCompanyResearch, `Lydia-企业核验-${new Date().toISOString().slice(0, 10)}.json`);
  updateStatus("#companyStatus", "企业核验证据已导出；使用前仍需人工确认是否为同一家公司。", "success");
});

$("#websiteResearchForm").addEventListener("submit", searchWebsite);
$("#exportWebsiteEvidence").addEventListener("click", () => {
  if (!currentWebsiteResearch) return;
  downloadJson(currentWebsiteResearch, `Lydia-官网证据-${new Date().toISOString().slice(0, 10)}.json`);
  updateStatus("#websiteStatus", "官网候选证据已导出；公开联系方式仍不等于营销同意。", "success");
});

$("#emailTargetLead").addEventListener("change", () => prefillEmailInputs(true));
$("#emailCandidateForm").addEventListener("submit", generateAndCheckEmailCandidates);
$("#exportEmailCandidates").addEventListener("click", () => {
  if (!currentEmailResearch) return;
  downloadJson(currentEmailResearch, `Lydia-候选邮箱-${new Date().toISOString().slice(0, 10)}.json`);
  updateStatus("#emailStatus", "候选邮箱已导出；使用前仍需取得合规基础并人工复核。", "success");
});

$("#relationshipFile").addEventListener("change", (event) => loadRelationshipFile(event.target.files[0]));
$("#loadRelationshipSample").addEventListener("click", async () => {
  try {
    const response = await fetch("/examples/relationships.sample.csv");
    if (!response.ok) throw new Error("无法读取虚构关系样例");
    showRelationshipPaths(relationshipsFromCsv(await response.text()), "relationships.sample.csv");
  } catch (error) {
    updateStatus("#relationshipStatus", error.message, "error");
  }
});
$("#exportRelationshipPaths").addEventListener("click", () => {
  if (!currentRelationshipResult) return;
  downloadJson(currentRelationshipResult, `Lydia-信任路径-${new Date().toISOString().slice(0, 10)}.json`);
  updateStatus("#relationshipStatus", "候选路径已导出。下一步仍应先征得关系人明确同意。", "success");
});

$("#evidenceReviewForm").addEventListener("submit", applyEvidenceAction);
$("#cancelEvidenceReview").addEventListener("click", () => {
  pendingEvidenceAction = null;
  $("#evidenceReviewDialog").close();
});

$("#duplicateReviewForm").addEventListener("submit", applyDuplicateAction);
$("#cancelDuplicateReview").addEventListener("click", () => {
  pendingDuplicateAction = null;
  $("#duplicateReviewDialog").close();
});
