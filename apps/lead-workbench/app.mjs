import {
  SCHEMA_VERSION,
  CSV_IMPORT_FIELD_DEFINITIONS,
  DEVELOPMENT_EVENT_LABELS,
  assessEmailCandidates,
  checkCompanyDomainMatch,
  checkEmailCandidateLeadMatch,
  createCsvImportAudit,
  createEvidence,
  enrichmentFromEvidenceSelection,
  findDuplicateCandidates,
  generateEmailCandidates,
  getDevelopmentState,
  initializeDevelopmentTracking,
  inspectCsvImport,
  leadsFromCsv,
  listDuplicateDecisions,
  mergeEvidenceIntoLead,
  normalizeLead,
  normalizeCsvImportAudit,
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
  reviseLeadEvidence,
  recordDevelopmentEvent,
  summarizeDevelopment,
  voidDevelopmentEvent
} from "/packages/lead-core/src/index.mjs";
import {
  PERSISTED_UI_FIELD_IDS,
  assertPayloadMatchesWorkspace,
  createIndexedDbPersistence,
  createWorkspaceBackup,
  createWorkspaceFilename,
  createWorkspaceReference,
  createWorkbenchSnapshot
} from "./persistence.mjs";

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
let pendingDevelopmentLeadId = null;
let pendingCsvImport = null;
let workbenchPersistence = null;
let workspaceIndex = null;
let activeWorkspace = null;
let workspaceDialogMode = null;
let persistenceReady = false;
let persistenceBlocked = false;
let persistenceDirtyBeforeReady = false;
let persistenceRevision = 0;
let persistedRevision = 0;
let persistenceDrain = null;
let restoringSnapshot = false;

function updateStatus(selector, message, type = "neutral") {
  const status = $(selector);
  status.textContent = message;
  status.className = `status${type === "neutral" ? "" : ` ${type}`}`;
}

function setStatus(message, type = "neutral") {
  updateStatus("#status", message, type);
}

function collectUiState() {
  return Object.fromEntries(PERSISTED_UI_FIELD_IDS.map((id) => [id, $(`#${id}`)?.value || ""]));
}

function workbenchStateForPersistence() {
  return {
    currentResult,
    currentProspectPlan,
    currentProspectResult,
    currentProspectForWebsite,
    currentCompanyResearch,
    currentWebsiteResearch,
    selectedWebsiteEvidenceIds: [...selectedWebsiteEvidenceIds],
    currentEmailResearch,
    currentRelationshipResult,
    ui: collectUiState()
  };
}

function persistenceMessage(message, type = "neutral") {
  updateStatus("#persistenceStatus", message, type);
}

function workspaceMessage(message, type = "neutral") {
  updateStatus("#workspaceStatus", message, type);
}

function renderWorkspaceControls() {
  const selector = $("#workspaceSelect");
  selector.replaceChildren();
  activeWorkspace = workspaceIndex?.workspaces.find((workspace) => workspace.id === workspaceIndex.activeWorkspaceId) || null;
  for (const workspace of workspaceIndex?.workspaces || []) {
    const option = document.createElement("option");
    option.value = workspace.id;
    option.textContent = workspace.name;
    selector.append(option);
  }
  if (activeWorkspace) {
    selector.value = activeWorkspace.id;
    $("#activeWorkspaceName").textContent = activeWorkspace.name;
    $("#workspaceDeleteName").textContent = activeWorkspace.name;
    $("#clearWorkspaceName").textContent = activeWorkspace.name;
  }
  selector.disabled = !activeWorkspace;
  $("#renameWorkspace").disabled = !activeWorkspace;
  $("#deleteWorkspace").disabled = !activeWorkspace || workspaceIndex.workspaces.length <= 1;
  $("#createWorkspace").disabled = !workspaceIndex;
  $("#exportWorkspaceBackup").disabled = !activeWorkspace;
  $("#restoreWorkspaceBackup").disabled = !activeWorkspace;
}

async function drainPersistence() {
  if (!persistenceReady || persistenceBlocked || !workbenchPersistence || restoringSnapshot) return;
  while (persistedRevision < persistenceRevision) {
    const revision = persistenceRevision;
    const snapshot = createWorkbenchSnapshot(workbenchStateForPersistence());
    try {
      persistenceMessage("正在保存到这个浏览器……");
      const saved = await workbenchPersistence.saveWorkspace(activeWorkspace.id, snapshot);
      persistedRevision = revision;
      const time = new Date(saved.savedAt).toLocaleString("zh-CN");
      persistenceMessage(`“${activeWorkspace.name}”已自动保存 · ${time} · 未上传`, "success");
      $("#clearLocalData").disabled = false;
    } catch {
      persistenceBlocked = true;
      persistenceMessage("自动保存失败。请立即导出 JSON 备份；修复或清除本机数据前，不会显示保存成功。", "error");
      break;
    }
  }
}

function ensurePersistenceDrain() {
  if (!persistenceReady || persistenceBlocked || persistenceDrain || restoringSnapshot) return;
  if (!persistenceDrain) {
    persistenceDrain = drainPersistence().finally(() => {
      persistenceDrain = null;
      if (persistedRevision < persistenceRevision && !persistenceBlocked) ensurePersistenceDrain();
    });
  }
}

function schedulePersistence() {
  if (restoringSnapshot || persistenceBlocked) return;
  persistenceRevision += 1;
  if (!persistenceReady) {
    persistenceDirtyBeforeReady = true;
    return;
  }
  ensurePersistenceDrain();
}

async function flushCurrentWorkspace() {
  if (!persistenceReady || !workbenchPersistence || !activeWorkspace) {
    throw new Error("客户空间还没有准备好");
  }
  if (persistenceBlocked) throw new Error("当前自动保存失败，请先导出 JSON 再切换客户");
  schedulePersistence();
  while (persistenceDrain) await persistenceDrain;
  if (persistenceBlocked) throw new Error("当前客户数据保存失败，请先导出 JSON 再切换客户");
}

function assertPayloadWorkspace(payload) {
  assertPayloadMatchesWorkspace(payload, activeWorkspace);
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
  const payload = JSON.parse(text);
  assertPayloadWorkspace(payload);
  return {
    leads: leadsFromJson(payload),
    importReview: normalizedCsvImportAuditOrNull(payload.importReview)
  };
}

function isCsvFile(file) {
  return file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
}

function normalizedCsvImportAuditOrNull(value) {
  if (!value) return null;
  try {
    return normalizeCsvImportAudit(value);
  } catch {
    return null;
  }
}

function csvFieldMapFromDialog() {
  return Object.fromEntries([...$("#csvMappingRows").querySelectorAll("select[data-source-header]")]
    .map((select) => [select.dataset.sourceHeader, select.value]));
}

function renderCsvReviewState(report) {
  $("#csvImportSummary").textContent = `${report.rowCount} 行数据 · ${report.usableRowCount} 行可形成客户记录 · ${report.mappedHeaderCount}/${report.mappings.length} 列已映射`;
  const issueList = $("#csvImportIssues");
  issueList.replaceChildren();
  for (const message of report.errors) {
    const item = document.createElement("li");
    item.className = "csv-error";
    item.textContent = message;
    issueList.append(item);
  }
  for (const message of report.warnings) {
    const item = document.createElement("li");
    item.textContent = message;
    issueList.append(item);
  }
  issueList.classList.toggle("hidden", !report.errors.length && !report.warnings.length);

  const rows = [...$("#csvMappingRows").children];
  report.mappings.forEach((mapping, index) => {
    const row = rows[index];
    if (!row) return;
    row.dataset.status = mapping.status;
    const label = row.querySelector(".csv-mapping-status");
    label.textContent = mapping.status === "mapped"
      ? "已识别"
      : mapping.status === "duplicate-target" ? "同一字段有多列" : "不会导入";
  });

  $("#confirmCsvImport").disabled = !report.canImport;
  if (report.canImport) {
    updateStatus("#csvImportStatus", `可以导入 ${report.usableRowCount} 条记录；确认前请抽查下方原列、样例值和 Lydia 字段。`, "success");
  } else {
    updateStatus("#csvImportStatus", report.errors[0] || "请先修正字段映射。", "error");
  }
}

function currentCsvReview() {
  if (!pendingCsvImport) throw new Error("没有待核对的 CSV 文件");
  return inspectCsvImport(pendingCsvImport.text, {
    channel: pendingCsvImport.channel,
    fieldMap: csvFieldMapFromDialog()
  });
}

function refreshCsvReview() {
  try {
    renderCsvReviewState(currentCsvReview());
  } catch (error) {
    $("#confirmCsvImport").disabled = true;
    updateStatus("#csvImportStatus", error.message || "字段映射不正确。", "error");
  }
}

function csvFieldSelect(mapping) {
  const select = document.createElement("select");
  select.dataset.sourceHeader = mapping.header;
  select.setAttribute("aria-label", `${mapping.header} 映射到 Lydia 字段`);
  const ignored = document.createElement("option");
  ignored.value = "";
  ignored.textContent = "忽略此列";
  select.append(ignored);
  for (const definition of CSV_IMPORT_FIELD_DEFINITIONS) {
    const option = document.createElement("option");
    option.value = definition.field;
    option.textContent = definition.label;
    select.append(option);
  }
  if (mapping.field && ![...select.options].some((option) => option.value === mapping.field)) {
    const technical = document.createElement("option");
    technical.value = mapping.field;
    technical.textContent = `Lydia 系统字段 · ${mapping.field}`;
    select.append(technical);
  }
  select.value = mapping.field || "";
  select.addEventListener("change", refreshCsvReview);
  return select;
}

function openCsvImportReview(file, text) {
  const channel = $("#channel").value;
  const report = inspectCsvImport(text, { channel });
  pendingCsvImport = { fileName: file.name, text, channel };
  $("#csvImportFileName").textContent = file.name;
  const mappingRows = $("#csvMappingRows");
  mappingRows.replaceChildren();
  for (const mapping of report.mappings) {
    const row = document.createElement("div");
    row.className = "csv-mapping-row";
    const source = document.createElement("div");
    source.className = "csv-source-column";
    const header = document.createElement("strong");
    header.textContent = mapping.header || "（空白表头）";
    const sample = document.createElement("small");
    sample.textContent = mapping.samples.length ? `样例：${mapping.samples.join(" ｜ ")}` : "这一列没有非空样例";
    source.append(header, sample);
    const status = document.createElement("span");
    status.className = "csv-mapping-status";
    row.append(source, csvFieldSelect(mapping), status);
    mappingRows.append(row);
  }
  renderCsvReviewState(report);
  const dialog = $("#csvImportDialog");
  dialog.showModal();
  dialog.scrollTop = 0;
  mappingRows.scrollTop = 0;
  $("#csvImportTitle").focus({ preventScroll: true });
}

function closeCsvImportReview() {
  pendingCsvImport = null;
  $("#leadFile").value = "";
  $("#csvImportDialog").close();
}

function buildResult(leads, sourceFile, options = {}) {
  const generatedAt = new Date().toISOString();
  const normalizedLeads = initializeDevelopmentTracking(leads.map(normalizeLead), {
    capturedAt: generatedAt
  });
  return {
    format: "lydia-qualified-leads",
    schemaVersion: SCHEMA_VERSION,
    product: "Lydia 外贸系统",
    generatedAt,
    sourceFile,
    importReview: normalizedCsvImportAuditOrNull(options.importReview),
    count: normalizedLeads.length,
    duplicateCandidates: findDuplicateCandidates(normalizedLeads),
    duplicateDecisions: listDuplicateDecisions(normalizedLeads),
    developmentSummary: summarizeDevelopment(normalizedLeads, { now: generatedAt }),
    results: normalizedLeads.map((lead) => ({ lead, qualification: qualifyLead(lead) }))
  };
}

function storedObject(value, format, arrayKey) {
  if (!value || typeof value !== "object" || value.format !== format) return null;
  if (arrayKey && !Array.isArray(value[arrayKey])) return null;
  return value;
}

function restoreUiState(ui) {
  if (!ui || typeof ui !== "object") return;
  for (const id of PERSISTED_UI_FIELD_IDS) {
    const field = $(`#${id}`);
    if (!field || typeof ui[id] !== "string") continue;
    const limit = Number(field.maxLength);
    const value = limit > 0 ? ui[id].slice(0, limit) : ui[id];
    if (field instanceof HTMLSelectElement) {
      if ([...field.options].some((option) => option.value === value)) field.value = value;
    } else {
      field.value = value;
    }
  }
  $("#prospectSearchConfirmed").checked = false;
  $("#websiteConfirmed").checked = false;
}

function restoreWorkbenchSnapshot(snapshot) {
  restoringSnapshot = true;
  try {
    const stored = snapshot.state;
    const storedResult = storedObject(stored.currentResult, "lydia-qualified-leads", "results");
    if (storedResult) {
      const leads = leadsFromJson(storedResult);
      if (leads.length) currentResult = buildResult(leads, storedResult.sourceFile || "本机自动恢复", {
        importReview: storedResult.importReview
      });
    }
    currentProspectPlan = stored.currentProspectPlan?.queries?.length ? stored.currentProspectPlan : null;
    currentProspectResult = storedObject(stored.currentProspectResult, "lydia-public-prospects", "prospects");
    currentProspectForWebsite = stored.currentProspectForWebsite?.sourceUrl ? stored.currentProspectForWebsite : null;
    currentCompanyResearch = storedObject(stored.currentCompanyResearch, "lydia-company-evidence", "results");
    currentWebsiteResearch = ["lydia-public-website-evidence", "lydia-public-website-dossier"].includes(stored.currentWebsiteResearch?.format)
      && Array.isArray(stored.currentWebsiteResearch?.evidence)
      ? stored.currentWebsiteResearch
      : null;
    const validWebsiteEvidenceIds = new Set((currentWebsiteResearch?.evidence || []).map((item) => item.id));
    selectedWebsiteEvidenceIds = new Set(
      (Array.isArray(stored.selectedWebsiteEvidenceIds) ? stored.selectedWebsiteEvidenceIds : [])
        .filter((id) => typeof id === "string" && validWebsiteEvidenceIds.has(id))
    );
    currentEmailResearch = storedObject(stored.currentEmailResearch, "lydia-email-candidates", "candidates");
    currentRelationshipResult = storedObject(stored.currentRelationshipResult, "lydia-relationship-paths", "paths");

    if (currentResult) populateResearchLeadTargets();
    restoreUiState(stored.ui);

    if (currentResult) {
      renderSummary();
      renderLeads();
      $("#dashboard").classList.remove("hidden");
      const reviewNote = currentResult.importReview
        ? `；原导入已核对 ${currentResult.importReview.mappings.length} 列映射`
        : "";
      setStatus(`已从这个浏览器恢复 ${currentResult.count} 条询盘和开发记录${reviewNote}。`, "success");
    }
    if (currentProspectPlan) renderProspectPlan(currentProspectPlan);
    if (currentProspectResult) renderProspectResults();
    if (currentCompanyResearch) {
      renderCompanyResearch();
      $("#exportCompanyEvidence").disabled = false;
      updateStatus("#companyStatus", `已恢复 ${currentCompanyResearch.results.length} 条企业核验候选。请继续人工确认。`, "success");
    }
    if (currentWebsiteResearch) {
      renderWebsiteResearch();
      $("#exportWebsiteEvidence").disabled = false;
      updateStatus("#websiteStatus", `已恢复 ${currentWebsiteResearch.evidence.length} 条官网候选证据。公开信息仍需人工确认。`, "success");
    }
    if (currentEmailResearch) {
      renderEmailCandidates();
      $("#exportEmailCandidates").disabled = false;
      updateStatus("#emailStatus", `已恢复 ${currentEmailResearch.candidates.length} 个候选邮箱；它们仍不是已验证联系人。`, "success");
    }
    if (currentRelationshipResult) renderRelationshipResults();
  } finally {
    restoringSnapshot = false;
  }
}

async function initializePersistence() {
  try {
    workbenchPersistence = createIndexedDbPersistence(window.indexedDB);
    workspaceIndex = await workbenchPersistence.initializeWorkspaces();
    renderWorkspaceControls();
    const snapshot = await workbenchPersistence.loadWorkspace(activeWorkspace.id);
    if (snapshot && !persistenceDirtyBeforeReady) restoreWorkbenchSnapshot(snapshot);
    persistenceReady = true;
    workspaceMessage(`当前只显示“${activeWorkspace.name}”的数据；切换前先保存，完整备份恢复时新建空间。`, "success");
    if (snapshot) {
      $("#clearLocalData").disabled = false;
      if (!currentResult && !currentProspectResult && !currentRelationshipResult) {
        persistenceMessage(`已读取“${activeWorkspace.name}”本机快照 · ${new Date(snapshot.savedAt).toLocaleString("zh-CN")}`, "success");
      } else {
        persistenceMessage(`“${activeWorkspace.name}”已自动恢复 · ${new Date(snapshot.savedAt).toLocaleString("zh-CN")} · 未上传`, "success");
      }
    } else {
      persistenceMessage(`“${activeWorkspace.name}”自动保存已开启 · 尚无本机数据 · 未上传`, "success");
    }
    if (persistenceDirtyBeforeReady) schedulePersistence();
  } catch (error) {
    persistenceBlocked = true;
    $("#workspaceSelect").disabled = true;
    $("#createWorkspace").disabled = true;
    $("#renameWorkspace").disabled = true;
    $("#deleteWorkspace").disabled = true;
    $("#exportWorkspaceBackup").disabled = true;
    $("#restoreWorkspaceBackup").disabled = true;
    $("#clearLocalData").disabled = !workbenchPersistence || !activeWorkspace;
    const recovery = workbenchPersistence
      ? "请先导出已有数据；不要切换客户空间。"
      : "请继续使用 JSON 导出备份，不要把当前页面当作已经自动保存。";
    workspaceMessage("客户空间初始化失败，当前页面不能证明客户数据已经隔离。", "error");
    persistenceMessage(`${error.message || "无法读取本机数据"}。${recovery}`, "error");
  }
}

function leadDisplayName(leadId) {
  const lead = currentResult?.results.find((item) => item.lead.id === leadId)?.lead;
  return lead?.organization.name || lead?.contact.name || lead?.sourceReference || leadId;
}

function refreshLeadResult(leads) {
  const generatedAt = new Date().toISOString();
  const trackedLeads = initializeDevelopmentTracking(leads, { capturedAt: generatedAt });
  currentResult.results = trackedLeads.map((lead) => ({ lead, qualification: qualifyLead(lead) }));
  currentResult.count = trackedLeads.length;
  currentResult.generatedAt = generatedAt;
  currentResult.duplicateCandidates = findDuplicateCandidates(trackedLeads);
  currentResult.duplicateDecisions = listDuplicateDecisions(trackedLeads);
  currentResult.developmentSummary = summarizeDevelopment(trackedLeads, { now: generatedAt });
  schedulePersistence();
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
  schedulePersistence();
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

function developmentSummaryCard(label, value, overdue = false) {
  const card = document.createElement("div");
  card.className = `development-summary-card${overdue ? " overdue" : ""}`;
  const text = document.createElement("span");
  text.textContent = label;
  const count = document.createElement("strong");
  count.textContent = value;
  card.append(text, count);
  return card;
}

function renderConversionTable(summary) {
  const container = $("#conversionTable");
  container.replaceChildren();
  const groups = ["A", "B", "C", "D", "HOLD"]
    .map((grade) => summary.byGrade[grade])
    .filter((group) => group.leads > 0);
  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "empty-conversion";
    empty.textContent = "导入询盘后会冻结当时的等级；记录真实开发结果后，才能比较各等级的转化。";
    container.append(empty);
    return;
  }

  const columns = [
    ["等级", null],
    ["线索", "leads"],
    ["已联系", "contacted"],
    ["已回复", "replied"],
    ["已报价", "quoted"],
    ["已寄样", "sampled"],
    ["成交", "won"]
  ];
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const [label] of columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const group of groups) {
    const row = document.createElement("tr");
    for (const [label, key] of columns) {
      const cell = document.createElement(key ? "td" : "th");
      if (!key) {
        cell.scope = "row";
        cell.textContent = label === "等级" ? group.grade : label;
      } else if (key === "leads") {
        cell.textContent = String(group.leads);
      } else {
        const rate = group.rates[key];
        cell.textContent = `${group[key]}${rate === null ? "" : ` · ${rate}%`}`;
      }
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  container.append(table);
}

function renderDevelopmentSummary() {
  const now = new Date().toISOString();
  const summary = summarizeDevelopment(currentResult.results.map((item) => item.lead), { now });
  currentResult.developmentSummary = summary;
  const { totals } = summary;
  $("#developmentSummary").replaceChildren(
    developmentSummaryCard("待跟进 · 其中逾期", `${totals.openFollowUps} · ${totals.overdue}`, totals.overdue > 0),
    developmentSummaryCard("已联系", totals.contacted),
    developmentSummaryCard("已回复", totals.replied),
    developmentSummaryCard("已报价", totals.quoted),
    developmentSummaryCard("已寄样", totals.sampled),
    developmentSummaryCard("已成交", totals.won)
  );
  $("#developmentBaselineStatus").textContent = `已冻结 ${totals.baselineTracked}/${totals.eligibleLeads} 个独立账户的导入时等级${totals.duplicateRecords ? `；另有 ${totals.duplicateRecords} 条次记录不进入分母` : ""}。统计只认人工记录的真实动作。`;
  renderConversionTable(summary);
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
  renderDevelopmentSummary();
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
    schedulePersistence();
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

const DEVELOPMENT_CHANNEL_LABELS = {
  platform: "平台站内",
  email: "Email",
  whatsapp: "WhatsApp",
  phone: "电话",
  meeting: "会议",
  other: "其他"
};

function formatMoment(value) {
  return value ? new Date(value).toLocaleString("zh-CN") : "时间未记录";
}

function currentLocalDateTime() {
  const date = new Date();
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function openDevelopmentDialog(lead) {
  pendingDevelopmentLeadId = lead.id;
  const state = getDevelopmentState(lead);
  $("#developmentDialogTitle").textContent = `记录「${lead.organization.name || lead.contact.name || "未命名询盘"}」的进展`;
  $("#developmentDialogDescription").textContent = `当前阶段：${state.stageLabel}。这里记录已经发生的事实；草稿、猜测和搜索候选不要当成客户动作。`;
  $("#developmentEventType").value = ["won", "lost"].includes(state.stage) ? "reopened" : "contact-attempted";
  $("#developmentOccurredAt").value = currentLocalDateTime();
  $("#developmentChannel").value = "";
  $("#developmentOutcomeReason").value = "";
  $("#developmentAmount").value = "";
  $("#developmentCurrency").value = "";
  $("#developmentNote").value = "";
  $("#developmentNextAction").value = "";
  $("#developmentNextDueAt").value = "";
  $("#developmentDialogStatus").textContent = "";
  $("#developmentDialog").showModal();
  $("#developmentEventType").focus();
}

function replaceLead(updatedLead, message) {
  const leads = currentResult.results.map((item) => item.lead.id === updatedLead.id ? updatedLead : item.lead);
  refreshLeadResult(leads);
  renderSummary();
  renderLeads();
  updateStatus("#developmentStatus", message, "success");
}

function applyDevelopmentAction(event) {
  event.preventDefault();
  if (!pendingDevelopmentLeadId || !currentResult) return;
  const item = currentResult.results.find((candidate) => candidate.lead.id === pendingDevelopmentLeadId);
  if (!item) return;
  const nextAction = $("#developmentNextAction").value.trim();
  const nextDueAt = $("#developmentNextDueAt").value;
  if (Boolean(nextAction) !== Boolean(nextDueAt)) {
    updateStatus("#developmentDialogStatus", "安排下一步时，行动内容和截止时间必须同时填写。", "error");
    return;
  }
  try {
    let result = recordDevelopmentEvent(item.lead, {
      type: $("#developmentEventType").value,
      occurredAt: $("#developmentOccurredAt").value,
      channel: $("#developmentChannel").value,
      note: $("#developmentNote").value,
      outcomeReason: $("#developmentOutcomeReason").value,
      amount: $("#developmentAmount").value,
      currency: $("#developmentCurrency").value
    });
    if (nextAction) {
      result = recordDevelopmentEvent(result.lead, {
        type: "follow-up-scheduled",
        occurredAt: $("#developmentOccurredAt").value,
        dueAt: nextDueAt,
        note: nextAction
      });
    }
    const label = DEVELOPMENT_EVENT_LABELS[$("#developmentEventType").value];
    $("#developmentDialog").close();
    pendingDevelopmentLeadId = null;
    replaceLead(result.lead, `${label}已保存；导入时的等级基线没有被事后结果改写。`);
  } catch (error) {
    updateStatus("#developmentDialogStatus", error.message || "开发记录保存失败。", "error");
  }
}

function completeFollowUp(lead, followUp) {
  try {
    const result = recordDevelopmentEvent(lead, {
      type: "follow-up-completed",
      relatedEventId: followUp.id,
      note: `完成：${followUp.note || "既定跟进"}`
    });
    replaceLead(result.lead, "这项跟进已完成；原计划和完成时间都保留在记录中。");
  } catch (error) {
    updateStatus("#developmentStatus", error.message || "无法完成这项跟进。", "error");
  }
}

function voidActivity(lead, activity) {
  const reason = window.prompt("请输入撤回原因（至少 3 个字）。原记录不会删除，只会标记为已撤回。", "");
  if (reason === null) return;
  try {
    const result = voidDevelopmentEvent(lead, activity.id, { note: reason });
    replaceLead(result.lead, "错误记录已撤回；原内容和撤回原因仍保留在审计历史中。");
  } catch (error) {
    updateStatus("#developmentStatus", error.message || "无法撤回这条开发记录。", "error");
  }
}

function developmentTimeline(lead, state) {
  const details = document.createElement("details");
  details.className = "development-toggle";
  const summary = document.createElement("summary");
  summary.textContent = `开发记录（${lead.development.events.length} 条）· ${state.stageLabel}`;
  details.append(summary);
  if (!lead.development.events.length) {
    const empty = document.createElement("p");
    empty.className = "development-empty";
    empty.textContent = "还没有真实开发记录。分级是排序建议，不是客户已经回复或会成交。";
    details.append(empty);
    return details;
  }

  const list = document.createElement("ul");
  list.className = "development-list";
  for (const activity of [...state.events].reverse()) {
    const item = document.createElement("li");
    item.className = `development-item${activity.voided ? " voided" : ""}${activity.type === "activity-voided" ? " correction" : ""}`;
    const body = document.createElement("div");
    body.className = "development-item-body";
    const title = document.createElement("strong");
    title.textContent = DEVELOPMENT_EVENT_LABELS[activity.type] || activity.type;
    const meta = document.createElement("small");
    meta.textContent = [
      formatMoment(activity.occurredAt),
      DEVELOPMENT_CHANNEL_LABELS[activity.channel],
      activity.voided ? "已撤回" : null
    ].filter(Boolean).join(" · ");
    body.append(title, meta);
    if (activity.note) {
      const note = document.createElement("span");
      note.textContent = activity.note;
      body.append(note);
    }
    if (activity.dueAt) {
      const due = document.createElement("small");
      due.textContent = `截止：${formatMoment(activity.dueAt)}`;
      body.append(due);
    }
    if (activity.amount !== null) {
      const amount = document.createElement("small");
      amount.textContent = `金额：${activity.currency || "未指定币种"} ${activity.amount}`;
      body.append(amount);
    }
    item.append(body);
    if (activity.type !== "activity-voided" && !activity.voided) {
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "button ghost compact";
      undo.textContent = "撤回";
      undo.addEventListener("click", () => voidActivity(lead, activity));
      item.append(undo);
    }
    list.append(item);
  }
  details.append(list);
  return details;
}

function leadCard(item) {
  const { lead, qualification } = item;
  const developmentState = item.developmentState || getDevelopmentState(lead);
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
  const developmentRow = document.createElement("div");
  developmentRow.className = "development-state-row";
  const stage = document.createElement("span");
  stage.className = `development-stage ${developmentState.stage}`;
  stage.textContent = developmentState.stageLabel;
  const record = document.createElement("button");
  record.type = "button";
  record.className = "button ghost compact";
  record.textContent = "记录开发进展";
  record.addEventListener("click", () => openDevelopmentDialog(lead));
  developmentRow.append(stage, record);
  if (developmentState.nextAction) {
    const complete = document.createElement("button");
    complete.type = "button";
    complete.className = "button primary compact";
    complete.textContent = "完成待办";
    complete.addEventListener("click", () => completeFollowUp(lead, developmentState.nextAction));
    developmentRow.append(complete);
  }
  main.append(developmentRow);
  if (developmentState.nextAction) {
    const followUp = document.createElement("p");
    followUp.className = `next-follow-up${developmentState.overdue ? " overdue" : ""}`;
    followUp.textContent = `${developmentState.overdue ? "已逾期" : "下一步"}：${developmentState.nextAction.note || "跟进客户"} · ${formatMoment(developmentState.nextAction.dueAt)}`;
    main.append(followUp);
  }
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

  card.append(grade, main, score, developmentTimeline(lead, developmentState), evidenceList(lead));
  return card;
}

function renderLeads() {
  const filter = $("#gradeFilter").value;
  const developmentFilter = $("#developmentFilter").value;
  const list = $("#leadList");
  list.replaceChildren();
  const results = currentResult.results
    .map((item) => ({ ...item, developmentState: getDevelopmentState(item.lead) }))
    .filter((item) => filter === "ALL" || item.qualification.grade === filter)
    .filter((item) => {
      if (developmentFilter === "ALL") return true;
      if (developmentFilter === "FOLLOW_UP") return item.developmentState.openFollowUps.length > 0;
      if (developmentFilter === "OVERDUE") return item.developmentState.overdue;
      return item.developmentState.stage === developmentFilter;
    })
    .sort((left, right) => Number(right.developmentState.overdue) - Number(left.developmentState.overdue)
      || right.qualification.score - left.qualification.score);

  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "当前筛选条件下没有线索。";
    list.append(empty);
    return;
  }
  list.append(...results.map(leadCard));
}

function showResult(leads, sourceFile, options = {}) {
  currentResult = buildResult(leads, sourceFile, options);
  populateResearchLeadTargets();
  renderSummary();
  renderLeads();
  $("#dashboard").classList.remove("hidden");
  const mappingNote = currentResult.importReview
    ? `已核对 ${currentResult.importReview.mappings.length} 列映射。`
    : "";
  setStatus(`已在本机完成 ${leads.length} 条询盘分级。${mappingNote}请人工复核来源和高优先级客户。`, "success");
  $("#dashboard").scrollIntoView({ behavior: "smooth", block: "start" });
  schedulePersistence();
}

async function loadSelectedFile(file) {
  if (!file) return;
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error("询盘文件不能超过 25 MB");
    setStatus(`正在读取 ${file.name}……`);
    if (isCsvFile(file)) {
      const text = await file.text();
      openCsvImportReview(file, text);
      setStatus(`${file.name} 已在本机读取，等待字段核对；尚未写入当前客户空间。`);
      return;
    }
    const parsed = await parseFile(file);
    if (!parsed.leads.length) throw new Error("文件中没有可识别的询盘");
    showResult(parsed.leads, file.name, { importReview: parsed.importReview });
  } catch (error) {
    pendingCsvImport = null;
    $("#leadFile").value = "";
    setStatus(error.message || "导入失败，请检查文件格式。", "error");
  }
}

function downloadResult() {
  if (!currentResult) return;
  currentResult.generatedAt = new Date().toISOString();
  currentResult.developmentSummary = summarizeDevelopment(
    currentResult.results.map((item) => item.lead),
    { now: currentResult.generatedAt }
  );
  downloadJson(currentResult, workspaceFilename("客户分级"));
  setStatus("Lydia 分级结果已导出，可在外贸开发插件中导入。", "success");
  schedulePersistence();
}

function workspaceFilename(label) {
  return createWorkspaceFilename(activeWorkspace, label);
}

function payloadWithWorkspace(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !activeWorkspace) return payload;
  if (payload.format === "lydia-workspace-backup") return payload;
  return {
    ...payload,
    workspace: createWorkspaceReference(activeWorkspace)
  };
}

function downloadJson(payload, filename) {
  const blob = new Blob([`${JSON.stringify(payloadWithWorkspace(payload), null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    schedulePersistence();
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
  renderProspectResults();
  schedulePersistence();
}

function renderProspectResults() {
  const ranked = currentProspectResult.prospects;
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
    schedulePersistence();
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
    let prospects;
    if (file.name.toLowerCase().endsWith(".csv")) {
      prospects = prospectsFromCsv(text, defaults);
    } else {
      const payload = JSON.parse(text);
      assertPayloadWorkspace(payload);
      prospects = prospectsFromJson(payload, defaults);
    }
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
    schedulePersistence();
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
    schedulePersistence();
  } catch (error) {
    currentCompanyResearch = null;
    $("#companyResults").replaceChildren();
    $("#exportCompanyEvidence").disabled = true;
    updateStatus("#companyStatus", error.message || "企业核验失败，请稍后重试。", "error");
    schedulePersistence();
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

function updateWebsiteSelectionActions(recordReview = false) {
  if (currentWebsiteResearch && recordReview) {
    currentWebsiteResearch.reviewedEvidenceIds = [...selectedWebsiteEvidenceIds];
    currentWebsiteResearch.reviewedAt = new Date().toISOString();
  }
  for (const button of document.querySelectorAll(".website-save-action")) {
    button.disabled = selectedWebsiteEvidenceIds.size === 0 || (button.dataset.requiresLead === "true" && !currentResult?.results.length);
  }
  const count = $("#websiteSelectionCount");
  if (count) count.textContent = `已选择 ${selectedWebsiteEvidenceIds.size} 条；未选择的内容不会进入客户档案。`;
  if (recordReview) schedulePersistence();
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
      updateWebsiteSelectionActions(true);
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
    schedulePersistence();
  } catch (error) {
    currentWebsiteResearch = null;
    $("#websiteResults").replaceChildren();
    $("#exportWebsiteEvidence").disabled = true;
    updateStatus("#websiteStatus", error.message || "官网读取失败，请检查网址或稍后重试。", "error");
    schedulePersistence();
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
    schedulePersistence();
  } catch (error) {
    currentEmailResearch = null;
    $("#emailResults").replaceChildren();
    $("#exportEmailCandidates").disabled = true;
    updateStatus("#emailStatus", error.message || "候选邮箱生成失败。", "error");
    schedulePersistence();
  } finally {
    button.disabled = false;
  }
}

async function relationshipPathsFromFile(file) {
  const text = await file.text();
  if (file.name.toLowerCase().endsWith(".csv")) return relationshipsFromCsv(text);
  const payload = JSON.parse(text);
  assertPayloadWorkspace(payload);
  return relationshipsFromJson(payload);
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
  renderRelationshipResults();
  schedulePersistence();
}

function renderRelationshipResults() {
  const ranked = currentRelationshipResult.paths;
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
  updateStatus("#relationshipStatus", `已在本机评估 ${currentRelationshipResult.inputCount ?? ranked.length} 条关系记录，排除 ${currentRelationshipResult.excludedDeclinedCount || 0} 条拒绝路径。`, "success");
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
    schedulePersistence();
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
  downloadJson(currentProspectResult, workspaceFilename("公开候选"));
  updateStatus("#prospectStatus", "公开候选已导出；搜索摘要仍需回到原始页面核查。", "success");
});

$("#leadFile").addEventListener("change", (event) => loadSelectedFile(event.target.files[0]));
$("#csvImportForm").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const report = currentCsvReview();
    if (!report.canImport) throw new Error(report.errors[0] || "字段核对尚未通过");
    const { text, channel, fileName } = pendingCsvImport;
    const fieldMap = csvFieldMapFromDialog();
    const leads = leadsFromCsv(text, { channel, fieldMap });
    if (!leads.length) throw new Error("文件中没有可识别的询盘");
    const importReview = createCsvImportAudit(report);
    pendingCsvImport = null;
    $("#leadFile").value = "";
    $("#csvImportDialog").close();
    showResult(leads, fileName, { importReview });
  } catch (error) {
    updateStatus("#csvImportStatus", error.message || "CSV 导入失败。", "error");
  }
});
$("#cancelCsvImport").addEventListener("click", () => {
  closeCsvImportReview();
  setStatus("已取消 CSV 导入，当前客户空间没有变化。");
});
$("#csvImportDialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeCsvImportReview();
  setStatus("已取消 CSV 导入，当前客户空间没有变化。");
});
$("#gradeFilter").addEventListener("change", () => {
  renderLeads();
  schedulePersistence();
});
$("#developmentFilter").addEventListener("change", () => {
  renderLeads();
  schedulePersistence();
});
$("#exportResults").addEventListener("click", downloadResult);
$("#loadSample").addEventListener("click", async () => {
  try {
    const response = await fetch("/examples/inquiries.sample.csv");
    if (!response.ok) throw new Error("无法读取虚构样例");
    openCsvImportReview({ name: "inquiries.sample.csv" }, await response.text());
    setStatus("虚构样例已在本机读取，等待字段核对；尚未写入当前客户空间。");
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
  downloadJson(currentCompanyResearch, workspaceFilename("企业核验"));
  updateStatus("#companyStatus", "企业核验证据已导出；使用前仍需人工确认是否为同一家公司。", "success");
});

$("#websiteResearchForm").addEventListener("submit", searchWebsite);
$("#exportWebsiteEvidence").addEventListener("click", () => {
  if (!currentWebsiteResearch) return;
  downloadJson(currentWebsiteResearch, workspaceFilename("官网证据"));
  updateStatus("#websiteStatus", "官网候选证据已导出；公开联系方式仍不等于营销同意。", "success");
});

$("#emailTargetLead").addEventListener("change", () => prefillEmailInputs(true));
$("#emailCandidateForm").addEventListener("submit", generateAndCheckEmailCandidates);
$("#exportEmailCandidates").addEventListener("click", () => {
  if (!currentEmailResearch) return;
  downloadJson(currentEmailResearch, workspaceFilename("候选邮箱"));
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
  downloadJson(currentRelationshipResult, workspaceFilename("信任路径"));
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

$("#developmentForm").addEventListener("submit", applyDevelopmentAction);
$("#cancelDevelopment").addEventListener("click", () => {
  pendingDevelopmentLeadId = null;
  $("#developmentDialog").close();
});

for (const id of PERSISTED_UI_FIELD_IDS.filter((field) => !["gradeFilter", "developmentFilter"].includes(field))) {
  $(`#${id}`).addEventListener("change", schedulePersistence);
}

$("#exportWorkspaceBackup").addEventListener("click", async () => {
  const button = $("#exportWorkspaceBackup");
  button.disabled = true;
  workspaceMessage(`正在整理“${activeWorkspace.name}”的完整备份……`);
  try {
    await flushCurrentWorkspace();
    const backup = createWorkspaceBackup(activeWorkspace, workbenchStateForPersistence());
    downloadJson(backup, workspaceFilename("完整空间备份"));
    workspaceMessage(`“${activeWorkspace.name}”完整备份已下载；文件未上传。`, "success");
  } catch (error) {
    workspaceMessage(error.message || "完整空间备份失败。", "error");
  } finally {
    button.disabled = false;
  }
});

$("#restoreWorkspaceBackup").addEventListener("click", () => $("#restoreWorkspaceFile").click());
$("#restoreWorkspaceFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const button = $("#restoreWorkspaceBackup");
  button.disabled = true;
  workspaceMessage(`正在检查并恢复 ${file.name}……`);
  try {
    if (file.size > 25 * 1024 * 1024) throw new Error("客户空间备份不能超过 25 MB");
    const payload = JSON.parse(await file.text());
    await flushCurrentWorkspace();
    const restored = await workbenchPersistence.restoreWorkspaceBackup(payload);
    workspaceMessage(`已恢复为新空间“${restored.workspace.name}”，正在载入……`, "success");
    window.location.reload();
  } catch (error) {
    workspaceMessage(error.message || "客户空间备份恢复失败。", "error");
    button.disabled = false;
  } finally {
    event.target.value = "";
  }
});

function openWorkspaceDialog(mode) {
  workspaceDialogMode = mode;
  $("#workspaceDialogLabel").textContent = mode === "create" ? "新增客户空间" : "重命名客户空间";
  $("#workspaceDialogTitle").textContent = mode === "create" ? "为另一个客户建立独立空间" : "修改当前客户空间名称";
  $("#workspaceName").value = mode === "create" ? "" : activeWorkspace?.name || "";
  $("#workspaceDialogStatus").textContent = "";
  $("#confirmWorkspaceAction").textContent = mode === "create" ? "新建并切换" : "保存名称";
  $("#workspaceDialog").showModal();
  $("#workspaceName").focus();
}

$("#workspaceSelect").addEventListener("change", async (event) => {
  const targetWorkspaceId = event.target.value;
  if (!activeWorkspace || targetWorkspaceId === activeWorkspace.id) return;
  event.target.disabled = true;
  workspaceMessage("正在保存当前客户并切换……");
  try {
    await flushCurrentWorkspace();
    await workbenchPersistence.setActiveWorkspace(targetWorkspaceId);
    window.location.reload();
  } catch (error) {
    event.target.value = activeWorkspace.id;
    renderWorkspaceControls();
    workspaceMessage(error.message || "无法切换客户空间。", "error");
  }
});

$("#createWorkspace").addEventListener("click", () => openWorkspaceDialog("create"));
$("#renameWorkspace").addEventListener("click", () => openWorkspaceDialog("rename"));
$("#cancelWorkspaceAction").addEventListener("click", () => {
  workspaceDialogMode = null;
  $("#workspaceDialog").close();
});
$("#workspaceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#confirmWorkspaceAction");
  button.disabled = true;
  updateStatus("#workspaceDialogStatus", workspaceDialogMode === "create" ? "正在建立独立客户空间……" : "正在保存客户空间名称……");
  try {
    await flushCurrentWorkspace();
    if (workspaceDialogMode === "create") {
      await workbenchPersistence.createWorkspace($("#workspaceName").value);
      updateStatus("#workspaceDialogStatus", "新客户空间已建立，正在切换……", "success");
      window.location.reload();
      return;
    }
    workspaceIndex = await workbenchPersistence.renameWorkspace(activeWorkspace.id, $("#workspaceName").value);
    renderWorkspaceControls();
    workspaceDialogMode = null;
    $("#workspaceDialog").close();
    workspaceMessage(`当前客户空间已重命名为“${activeWorkspace.name}”。`, "success");
    persistenceMessage(`“${activeWorkspace.name}”名称已更新 · 数据仍保存在此客户空间`, "success");
  } catch (error) {
    updateStatus("#workspaceDialogStatus", error.message || "客户空间操作失败。", "error");
  } finally {
    button.disabled = false;
  }
});

$("#deleteWorkspace").addEventListener("click", () => {
  $("#deleteWorkspaceStatus").textContent = "";
  $("#deleteWorkspaceDialog").showModal();
});
$("#cancelDeleteWorkspace").addEventListener("click", () => $("#deleteWorkspaceDialog").close());
$("#deleteWorkspaceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#confirmDeleteWorkspace");
  button.disabled = true;
  updateStatus("#deleteWorkspaceStatus", `正在删除“${activeWorkspace.name}”及其本机数据……`);
  const wasBlocked = persistenceBlocked;
  try {
    persistenceBlocked = true;
    if (persistenceDrain) await persistenceDrain;
    await workbenchPersistence.deleteWorkspace(activeWorkspace.id);
    updateStatus("#deleteWorkspaceStatus", "客户空间已删除，正在切换到保留的空间……", "success");
    window.location.reload();
  } catch (error) {
    persistenceBlocked = wasBlocked;
    updateStatus("#deleteWorkspaceStatus", error.message || "删除客户空间失败。", "error");
    button.disabled = false;
  }
});

$("#clearLocalData").addEventListener("click", () => {
  $("#clearLocalDataStatus").textContent = "";
  $("#clearLocalDataDialog").showModal();
});
$("#cancelClearLocalData").addEventListener("click", () => $("#clearLocalDataDialog").close());
$("#clearLocalDataForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#confirmClearLocalData");
  button.disabled = true;
  updateStatus("#clearLocalDataStatus", `正在清除“${activeWorkspace.name}”中的工作台数据……`);
  const wasBlocked = persistenceBlocked;
  try {
    persistenceBlocked = true;
    if (persistenceDrain) await persistenceDrain;
    await workbenchPersistence.clearWorkspace(activeWorkspace.id);
    updateStatus("#clearLocalDataStatus", "当前客户空间的数据已清除，正在重新载入……", "success");
    window.location.reload();
  } catch {
    persistenceBlocked = wasBlocked;
    updateStatus("#clearLocalDataStatus", "清除失败。其他客户空间和已导出的 JSON 不受影响；请关闭其他 Lydia 工作台页面后重试。", "error");
    button.disabled = false;
  }
});

void initializePersistence();
