import { createTradeDocumentBundle, renderTradeDocumentText } from "/packages/lead-core/src/index.mjs";

const form = document.querySelector("#tradeForm");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const list = document.querySelector("#documentList");

form.elements.issueDate.value = new Date().toISOString().slice(0, 10);

function data() {
  const values = new FormData(form);
  return {
    supplier: { name: values.get("supplierName"), contact: values.get("supplierContact"), address: values.get("supplierAddress") },
    buyer: { name: values.get("buyerName"), contact: values.get("buyerContact"), address: values.get("buyerAddress") },
    currency: values.get("currency"), incoterm: values.get("incoterm"), validityDays: values.get("validityDays"), reference: values.get("reference"), issueDate: values.get("issueDate"), paymentTerms: values.get("paymentTerms"), notes: values.get("notes"),
    items: [{ sku: values.get("sku"), name: values.get("productName"), specification: values.get("specification"), quantity: values.get("quantity"), unit: values.get("unit"), unitPrice: values.get("unitPrice"), cartonCount: values.get("cartonCount"), grossWeightKg: values.get("grossWeightKg"), netWeightKg: values.get("netWeightKg") }]
  };
}

function download(tradeDocument) {
  const blob = new Blob([renderTradeDocumentText(tradeDocument)], { type: "text/plain;charset=utf-8" });
  const link = window.document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${tradeDocument.reference}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function render(bundle) {
  document.querySelector("#total").textContent = `${bundle.workspace.currency} ${bundle.totals.amount.toFixed(2)}`;
  list.replaceChildren();
  for (const tradeDocument of bundle.documents) {
    const article = document.createElement("article");
    const title = document.createElement("h3"); title.textContent = tradeDocument.title;
    const meta = document.createElement("p"); meta.textContent = `${tradeDocument.reference} · 草稿 · 必须人工复核`;
    const preview = document.createElement("pre"); preview.textContent = renderTradeDocumentText(tradeDocument);
    const button = document.createElement("button"); button.type = "button"; button.textContent = "下载 TXT 草稿"; button.addEventListener("click", () => download(tradeDocument));
    article.append(title, meta, preview, button); list.append(article);
  }
  results.classList.remove("hidden");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const bundle = createTradeDocumentBundle(data());
    render(bundle);
    status.textContent = "已在本机生成 6 份草稿；未发送、未签署、未上传。请逐份审核后再用于外部流程。";
  } catch (error) {
    status.textContent = error.message || "无法生成草稿，请核对字段。";
  }
});
