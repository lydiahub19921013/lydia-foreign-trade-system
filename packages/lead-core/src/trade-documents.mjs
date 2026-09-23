const DOCUMENT_TYPES = Object.freeze([
  "quotation",
  "proforma-invoice",
  "commercial-invoice",
  "packing-list",
  "sales-contract",
  "product-catalog"
]);

const TYPE_LABELS = Object.freeze({
  quotation: "报价单 / Quotation",
  "proforma-invoice": "形式发票 / Proforma Invoice",
  "commercial-invoice": "商业发票 / Commercial Invoice",
  "packing-list": "装箱单 / Packing List",
  "sales-contract": "销售合同草稿 / Sales Contract Draft",
  "product-catalog": "产品目录 / Product Catalog"
});

function text(value, field, { required = true, max = 500 } = {}) {
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  if (required && !result) throw new Error(`${field}不能为空`);
  if (result.length > max) throw new Error(`${field}不能超过 ${max} 个字符`);
  return result;
}

function positive(value, field) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`${field}必须大于 0`);
  return result;
}

function money(value) {
  return Number(value.toFixed(2));
}

function reference(prefix, value) {
  const raw = String(value ?? "").trim();
  if (raw) return text(raw, "文件编号", { max: 80 });
  return `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-DRAFT`;
}

function lineTotal(item) {
  return money(item.quantity * item.unitPrice);
}

export function normalizeTradeWorkspace(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("成交工作台数据格式不正确");
  const supplier = {
    name: text(input.supplier?.name, "卖方名称"),
    address: text(input.supplier?.address, "卖方地址"),
    contact: text(input.supplier?.contact, "卖方联系人")
  };
  const buyer = {
    name: text(input.buyer?.name, "买方名称"),
    address: text(input.buyer?.address, "买方地址"),
    contact: text(input.buyer?.contact, "买方联系人")
  };
  const currency = text(input.currency || "USD", "币种", { max: 3 }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("币种必须是三位 ISO 代码");
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) throw new Error("请填写 1 至 100 个产品行");
  const items = input.items.map((item, index) => ({
    sku: text(item?.sku, `第 ${index + 1} 行 SKU`, { max: 100 }),
    name: text(item?.name, `第 ${index + 1} 行产品名称`, { max: 240 }),
    specification: text(item?.specification, `第 ${index + 1} 行规格`, { required: false, max: 500 }),
    quantity: positive(item?.quantity, `第 ${index + 1} 行数量`),
    unit: text(item?.unit || "pcs", `第 ${index + 1} 行单位`, { max: 30 }),
    unitPrice: positive(item?.unitPrice, `第 ${index + 1} 行单价`),
    cartonCount: positive(item?.cartonCount || 1, `第 ${index + 1} 行箱数`),
    grossWeightKg: positive(item?.grossWeightKg || 0.01, `第 ${index + 1} 行毛重`),
    netWeightKg: positive(item?.netWeightKg || 0.01, `第 ${index + 1} 行净重`)
  }));
  const incoterm = text(input.incoterm || "FOB Shanghai", "贸易术语", { max: 120 });
  const paymentTerms = text(input.paymentTerms || "T/T 30% deposit, 70% before shipment", "付款条款", { max: 500 });
  return {
    supplier,
    buyer,
    currency,
    items,
    incoterm,
    paymentTerms,
    validityDays: Math.round(positive(input.validityDays || 30, "报价有效期")),
    reference: reference("Lydia", input.reference),
    issueDate: text(input.issueDate || new Date().toISOString().slice(0, 10), "出具日期", { max: 10 }),
    notes: text(input.notes, "备注", { required: false, max: 1000 })
  };
}

export function createTradeDocumentBundle(input) {
  const workspace = normalizeTradeWorkspace(input);
  const totals = {
    amount: money(workspace.items.reduce((sum, item) => sum + lineTotal(item), 0)),
    cartons: workspace.items.reduce((sum, item) => sum + item.cartonCount, 0),
    grossWeightKg: money(workspace.items.reduce((sum, item) => sum + item.grossWeightKg, 0)),
    netWeightKg: money(workspace.items.reduce((sum, item) => sum + item.netWeightKg, 0))
  };
  const documents = DOCUMENT_TYPES.map((type) => ({
    type,
    title: TYPE_LABELS[type],
    reference: `${workspace.reference}-${type.toUpperCase()}`,
    status: "draft",
    generatedFrom: "local-user-input",
    requiresHumanReview: true,
    fields: documentFields(type, workspace, totals)
  }));
  return { workspace, totals, documents };
}

function documentFields(type, workspace, totals) {
  const common = {
    issueDate: workspace.issueDate,
    seller: workspace.supplier,
    buyer: workspace.buyer,
    currency: workspace.currency,
    items: workspace.items.map((item) => ({ ...item, lineTotal: lineTotal(item) })),
    totalAmount: totals.amount,
    incoterm: workspace.incoterm,
    notes: workspace.notes
  };
  if (type === "packing-list") return { ...common, totalCartons: totals.cartons, grossWeightKg: totals.grossWeightKg, netWeightKg: totals.netWeightKg };
  if (type === "product-catalog") return { issueDate: workspace.issueDate, seller: workspace.supplier, items: common.items, notes: workspace.notes };
  if (type === "sales-contract") return { ...common, paymentTerms: workspace.paymentTerms, legalReviewRequired: true };
  if (type === "quotation") return { ...common, validUntilDays: workspace.validityDays, paymentTerms: workspace.paymentTerms };
  return { ...common, paymentTerms: workspace.paymentTerms, notProofOfPayment: true };
}

export function renderTradeDocumentText(document) {
  if (!document || typeof document !== "object" || !DOCUMENT_TYPES.includes(document.type)) throw new Error("单证类型不正确");
  const fields = document.fields;
  const lines = [
    document.title.toUpperCase(),
    `DRAFT · ${document.reference}`,
    `Issue date: ${fields.issueDate}`,
    `Seller: ${fields.seller.name} | ${fields.seller.address} | ${fields.seller.contact}`,
    fields.buyer ? `Buyer: ${fields.buyer.name} | ${fields.buyer.address} | ${fields.buyer.contact}` : "",
    "",
    "SKU | Product | Specification | Quantity | Unit price | Line total"
  ];
  for (const item of fields.items) lines.push(`${item.sku} | ${item.name} | ${item.specification || "-"} | ${item.quantity} ${item.unit} | ${fields.currency || ""} ${item.unitPrice ?? "-"} | ${fields.currency || ""} ${item.lineTotal ?? "-"}`);
  if (fields.totalAmount != null) lines.push(`Total: ${fields.currency} ${fields.totalAmount}`);
  if (fields.incoterm) lines.push(`Incoterm: ${fields.incoterm}`);
  if (fields.paymentTerms) lines.push(`Payment terms: ${fields.paymentTerms}`);
  if (fields.totalCartons != null) lines.push(`Packing: ${fields.totalCartons} cartons; G.W. ${fields.grossWeightKg} kg; N.W. ${fields.netWeightKg} kg`);
  if (fields.validUntilDays) lines.push(`Validity: ${fields.validUntilDays} days`);
  lines.push("", "STATUS: DRAFT — review commercial, customs, tax, banking and legal requirements before external use. No sending, signing or payment is performed by Lydia.");
  return lines.filter(Boolean).join("\n");
}
