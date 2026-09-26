import test from "node:test";
import assert from "node:assert/strict";
import { createTradeDocumentBundle, renderTradeDocumentText } from "../src/index.mjs";

const fixture = {
  supplier: { name: "Lydia Demo Export Co., Ltd.", address: "88 Demo Road, Ningbo, China", contact: "Sales Desk" },
  buyer: { name: "Northstar Demo Imports", address: "1 Example Street, Seattle, US", contact: "Alex Buyer" },
  currency: "USD",
  incoterm: "FOB Ningbo",
  paymentTerms: "T/T 30% deposit, 70% before shipment",
  validityDays: 30,
  issueDate: "2026-09-23",
  items: [{ sku: "DEMO-01", name: "Demo Garden Light", specification: "Warm white", quantity: 2000, unit: "pcs", unitPrice: 4.5, cartonCount: 100, grossWeightKg: 1200, netWeightKg: 1100 }]
};

test("one reviewed transaction produces all six draft document types with consistent totals", () => {
  const bundle = createTradeDocumentBundle(fixture);
  assert.equal(bundle.documents.length, 6);
  assert.equal(bundle.totals.amount, 9000);
  assert.equal(bundle.documents.find((document) => document.type === "packing-list").fields.totalCartons, 100);
  assert.ok(bundle.documents.every((document) => document.status === "draft" && document.requiresHumanReview));
  assert.match(renderTradeDocumentText(bundle.documents[0]), /DRAFT/);
  assert.match(renderTradeDocumentText(bundle.documents[0]), /No sending, signing or payment/);
});

test("transaction documents reject incomplete buyer and non-positive commercial values", () => {
  assert.throws(() => createTradeDocumentBundle({ ...fixture, buyer: { ...fixture.buyer, name: "" } }), /买方名称不能为空/);
  assert.throws(() => createTradeDocumentBundle({ ...fixture, items: [{ ...fixture.items[0], unitPrice: 0 }] }), /单价必须大于 0/);
});

test("packing and catalog text exports match their document-specific previews", () => {
  const bundle = createTradeDocumentBundle(fixture);
  const packing = renderTradeDocumentText(bundle.documents.find((document) => document.type === "packing-list"));
  const catalog = renderTradeDocumentText(bundle.documents.find((document) => document.type === "product-catalog"));
  assert.match(packing, /Cartons \| Gross weight kg \| Net weight kg/);
  assert.match(packing, /DEMO-01 .*\| 100 \| 1200 \| 1100/);
  assert.doesNotMatch(packing, /Unit price|Total: USD/);
  assert.match(catalog, /SKU \| Product \| Specification \| Quantity/);
  assert.doesNotMatch(catalog, /Unit price|Total: USD|Buyer:/);
});
