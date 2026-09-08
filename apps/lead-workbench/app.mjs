import {
  findDuplicateCandidates,
  leadsFromCsv,
  normalizeLead,
  qualifyLead
} from "/packages/lead-core/src/index.mjs";

const $ = (selector) => document.querySelector(selector);
let currentResult = null;

function setStatus(message, type = "neutral") {
  const status = $("#status");
  status.textContent = message;
  status.className = `status${type === "neutral" ? "" : ` ${type}`}`;
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
  if (file.name.toLowerCase().endsWith(".csv")) return leadsFromCsv(text);
  return leadsFromJson(JSON.parse(text));
}

function buildResult(leads, sourceFile) {
  return {
    format: "lydia-qualified-leads",
    schemaVersion: 1,
    product: "Lydia 外贸系统",
    generatedAt: new Date().toISOString(),
    sourceFile,
    count: leads.length,
    duplicateCandidates: findDuplicateCandidates(leads),
    results: leads.map((lead) => ({ lead, qualification: qualifyLead(lead) }))
  };
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
    notice.textContent = `发现 ${currentResult.duplicateCandidates.length} 组可能重复线索，其中 ${strong} 组由相同域名、登记号、渠道编号或已验证邮箱触发。系统不会自动合并，请人工确认。`;
    notice.classList.remove("hidden");
  } else {
    notice.classList.add("hidden");
  }
}

function evidenceList(lead) {
  const details = document.createElement("details");
  details.className = "evidence-toggle";
  const summary = document.createElement("summary");
  summary.textContent = `查看证据（${lead.evidence.length} 条）`;
  const list = document.createElement("ul");
  list.className = "evidence-list";

  if (!lead.evidence.length) {
    const item = document.createElement("li");
    item.textContent = "暂无来源证据，所有结论都应视为待核查。";
    list.append(item);
  } else {
    for (const evidence of lead.evidence) {
      const item = document.createElement("li");
      item.textContent = `${evidence.status} · ${evidence.kind} · ${String(evidence.value ?? "")} · 来源：${evidence.sourceRef || "缺失"}`;
      list.append(item);
    }
  }
  details.append(summary, list);
  return details;
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
  const action = document.createElement("p");
  action.className = "lead-action";
  action.textContent = qualification.nextAction;
  main.append(title, meta, action);

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
  const blob = new Blob([`${JSON.stringify(currentResult, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Lydia-客户分级-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Lydia 分级结果已导出，可在外贸开发插件中导入。", "success");
}

$("#leadFile").addEventListener("change", (event) => loadSelectedFile(event.target.files[0]));
$("#gradeFilter").addEventListener("change", renderLeads);
$("#exportResults").addEventListener("click", downloadResult);
$("#loadSample").addEventListener("click", async () => {
  try {
    const response = await fetch("/examples/inquiries.sample.csv");
    if (!response.ok) throw new Error("无法读取虚构样例");
    showResult(leadsFromCsv(await response.text()), "inquiries.sample.csv");
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
