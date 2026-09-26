import { createTradeDocumentBundle, renderTradeDocumentText } from "/packages/lead-core/src/index.mjs";

const form = document.querySelector("#tradeForm");
const status = document.querySelector("#status");
const paperMount = document.querySelector("#paperMount");
const switcher = document.querySelector("#documentList");
const downloadButton = document.querySelector("#downloadButton");
const total = document.querySelector("#total");
const bundleState = document.querySelector("#bundleState");
const previewState = document.querySelector("#previewState");
const sampleTag = document.querySelector("#sampleTag");
const shortNames = {
  quotation: "报价单",
  "proforma-invoice": "形式发票",
  "commercial-invoice": "商业发票",
  "packing-list": "装箱单",
  "sales-contract": "销售合同",
  "product-catalog": "产品目录"
};

let previewBundle;
let generatedBundle;
let selectedType = "quotation";
form.elements.issueDate.value = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const demoFields = ["supplierName", "supplierContact", "supplierAddress", "buyerName", "buyerContact", "buyerAddress", "sku", "productName", "specification", "quantity", "unitPrice", "cartonCount", "grossWeightKg", "netWeightKg"];
const demoValues = new Map(demoFields.map((name) => [name, form.elements[name].value]));

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content != null) element.textContent = String(content);
  return element;
}

function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) }).format(value);
}

function orderData() {
  const values = new FormData(form);
  return {
    supplier: { name: values.get("supplierName"), contact: values.get("supplierContact"), address: values.get("supplierAddress") },
    buyer: { name: values.get("buyerName"), contact: values.get("buyerContact"), address: values.get("buyerAddress") },
    currency: values.get("currency"), incoterm: values.get("incoterm"), validityDays: values.get("validityDays"), reference: values.get("reference"), issueDate: values.get("issueDate"), paymentTerms: values.get("paymentTerms"), notes: values.get("notes"),
    items: [{ sku: values.get("sku"), name: values.get("productName"), specification: values.get("specification"), quantity: values.get("quantity"), unit: values.get("unit"), unitPrice: values.get("unitPrice"), cartonCount: values.get("cartonCount"), grossWeightKg: values.get("grossWeightKg"), netWeightKg: values.get("netWeightKg") }]
  };
}

function addFact(parent, label, value) {
  const fact = node("div", "fact");
  fact.append(node("span", "", label), node("strong", "", value));
  parent.append(fact);
}

function addParty(parent, label, party) {
  const card = node("section", "party-card");
  card.append(node("h4", "", label), node("strong", "", party.name), node("p", "", party.address), node("p", "", party.contact));
  parent.append(card);
}

function addCell(row, value, className = "") {
  row.append(node("td", className, value));
}

function addProductTable(paper, tradeDocument) {
  const fields = tradeDocument.fields;
  const packing = tradeDocument.type === "packing-list";
  const catalog = tradeDocument.type === "product-catalog";
  const labels = packing ? ["SKU", "产品与规格", "数量", "箱数", "毛重 kg"] : catalog ? ["SKU", "产品与规格", "数量"] : ["SKU", "产品与规格", "数量", "单价", "金额"];
  const wrap = node("div", "doc-table-wrap");
  const table = node("table", "doc-table");
  const caption = node("caption", "visually-hidden", "本次订单产品明细");
  const head = node("thead", "");
  const headRow = node("tr", "");
  for (const [index, label] of labels.entries()) headRow.append(node("th", index > 1 ? "numeric" : "", label));
  head.append(headRow);
  const body = node("tbody", "");
  for (const item of fields.items) {
    const row = node("tr", "");
    addCell(row, item.sku);
    const product = node("td", "product-cell");
    product.append(node("strong", "", item.name));
    if (item.specification) product.append(node("small", "", item.specification));
    row.append(product);
    addCell(row, `${formatNumber(item.quantity, 0)} ${item.unit}`, "numeric");
    if (packing) {
      addCell(row, formatNumber(item.cartonCount, 0), "numeric");
      addCell(row, formatNumber(item.grossWeightKg), "numeric");
    } else if (!catalog) {
      addCell(row, formatNumber(item.unitPrice), "numeric");
      addCell(row, formatNumber(item.lineTotal), "numeric");
    }
    body.append(row);
  }
  table.append(caption, head, body);
  wrap.append(table);
  paper.append(wrap);
}

function renderPaper(tradeDocument) {
  const fields = tradeDocument.fields;
  const paper = node("article", "paper");
  const head = node("div", "paper-head");
  head.append(node("strong", "paper-brand", "Lydia"), node("span", "draft-seal", "待审核草稿"));
  paper.append(head);

  const [name, englishName] = tradeDocument.title.split(" / ");
  const title = node("h3", "document-title", name);
  if (englishName) title.append(node("small", "", englishName));
  paper.append(title);

  const meta = node("div", "doc-meta");
  meta.append(node("span", "", `编号  ${tradeDocument.reference}`), node("span", "", `日期  ${fields.issueDate}`));
  paper.append(meta);

  const parties = node("div", "party-grid");
  addParty(parties, "卖方", fields.seller);
  if (fields.buyer) addParty(parties, "买方", fields.buyer);
  paper.append(parties);
  addProductTable(paper, tradeDocument);

  const facts = node("div", "facts");
  if (fields.incoterm) addFact(facts, "贸易术语", fields.incoterm);
  if (fields.paymentTerms) addFact(facts, "付款条款", fields.paymentTerms);
  if (fields.validUntilDays) addFact(facts, "有效期", `${fields.validUntilDays} 天`);
  if (fields.totalCartons != null) {
    addFact(facts, "包装", `${formatNumber(fields.totalCartons, 0)} 箱`);
    addFact(facts, "净重", `${formatNumber(fields.netWeightKg)} kg`);
  }
  if (fields.notes) addFact(facts, "备注", fields.notes);
  if (facts.childElementCount) paper.append(facts);

  if (fields.totalAmount != null && tradeDocument.type !== "packing-list") {
    const amount = node("div", "amount-total");
    amount.append(node("span", "", "订单金额"), node("strong", "", `${fields.currency} ${formatNumber(fields.totalAmount)}`));
    paper.append(amount);
  }
  paper.append(node("p", "paper-foot", "由本次订单资料生成。价格、数量、包装及交易条款须由业务人员逐项复核。"));
  paperMount.replaceChildren(paper);
}

function renderSwitcher() {
  switcher.replaceChildren();
  if (!previewBundle) return;
  for (const tradeDocument of previewBundle.documents) {
    const button = node("button", "", shortNames[tradeDocument.type]);
    button.type = "button";
    button.setAttribute("aria-pressed", String(tradeDocument.type === selectedType));
    button.setAttribute("aria-label", tradeDocument.title);
    button.addEventListener("click", () => {
      selectedType = tradeDocument.type;
      for (const tab of switcher.querySelectorAll("button")) tab.setAttribute("aria-pressed", String(tab === button));
      renderSelected();
    });
    switcher.append(button);
  }
}

function renderSelected() {
  if (!previewBundle) return;
  const tradeDocument = previewBundle.documents.find((item) => item.type === selectedType);
  renderPaper(tradeDocument);
  previewState.textContent = generatedBundle ? "已生成 · 待人工审核" : "填写预览 · 尚未生成";
  downloadButton.disabled = !generatedBundle;
}

function renderInvalid(message) {
  previewBundle = undefined;
  generatedBundle = undefined;
  switcher.replaceChildren();
  paperMount.replaceChildren(node("p", "preview-message", message));
  bundleState.textContent = "待补齐资料";
  previewState.textContent = "待补齐资料";
  total.textContent = "—";
  downloadButton.disabled = true;
}

function refreshPreview() {
  generatedBundle = undefined;
  if (!form.checkValidity()) {
    renderInvalid("请补齐订单资料，单证预览会在右侧出现。");
    return;
  }
  try {
    previewBundle = createTradeDocumentBundle(orderData());
    total.textContent = `${previewBundle.workspace.currency} ${formatNumber(previewBundle.totals.amount)}`;
    bundleState.textContent = "填写预览";
    renderSwitcher();
    renderSelected();
  } catch (error) {
    renderInvalid(error.message || "请核对订单资料。");
  }
}

function download(tradeDocument) {
  const blob = new Blob([renderTradeDocumentText(tradeDocument)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${tradeDocument.reference}.txt`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

form.addEventListener("input", () => {
  refreshPreview();
  sampleTag.textContent = demoFields.some((name) => form.elements[name].value === demoValues.get(name)) ? "含示例资料" : "本次订单";
  status.textContent = previewBundle
    ? "资料已更新。确认右侧预览后，再生成待审草稿。"
    : "请补齐或修正资料，右侧才会更新预览。";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    generatedBundle = createTradeDocumentBundle(orderData());
    previewBundle = generatedBundle;
    total.textContent = `${generatedBundle.workspace.currency} ${formatNumber(generatedBundle.totals.amount)}`;
    bundleState.textContent = "六份待审草稿";
    renderSwitcher();
    renderSelected();
    status.textContent = "六份草稿已在本机生成。可切换查看、逐份核对并下载；不会自动发送。";
  } catch (error) {
    renderInvalid(error.message || "无法生成草稿，请核对字段。");
    status.textContent = error.message || "无法生成草稿，请核对字段。";
  }
});

downloadButton.addEventListener("click", () => {
  const tradeDocument = generatedBundle?.documents.find((item) => item.type === selectedType);
  if (tradeDocument) download(tradeDocument);
});

refreshPreview();
