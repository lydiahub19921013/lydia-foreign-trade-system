import test from "node:test";
import assert from "node:assert/strict";
import {
  CSV_IMPORT_FIELD_DEFINITIONS,
  createCsvImportAudit,
  inspectCsvImport,
  leadsFromCsv,
  normalizeCsvImportAudit
} from "../src/index.mjs";

test("known channel headers receive a review report before import", () => {
  const csv = [
    "询盘编号,公司名称,国家/地区,询盘内容,产品名称,工作邮箱,平台备注",
    "DEMO-101,虚构采购公司,示例国,请提供报价,收纳盒,buyer@example.com,仅作虚构测试"
  ].join("\n");
  const report = inspectCsvImport(csv, { channel: "alibaba" });
  assert.equal(report.format, "lydia-csv-import-review");
  assert.equal(report.rowCount, 1);
  assert.equal(report.usableRowCount, 1);
  assert.equal(report.canImport, true);
  assert.ok(report.mappedFields.includes("source_reference"));
  assert.ok(report.mappedFields.includes("company_name"));
  assert.deepEqual(report.unmappedHeaders, ["平台备注"]);
  assert.deepEqual(report.mappings.find((item) => item.header === "公司名称").samples, ["虚构采购公司"]);
});

test("unknown export headers can be explicitly mapped without changing the source file", () => {
  const csv = [
    "Buyer Organization,Ticket,Body,Requested Item,Unneeded Column",
    "Northstar Demo Imports,DEMO-102,Please quote 500 units,Reusable bottle,ignore me"
  ].join("\n");
  const initial = inspectCsvImport(csv, { channel: "made-in-china" });
  assert.equal(initial.canImport, false);
  assert.equal(initial.mappedHeaderCount, 0);

  const fieldMap = {
    "Buyer Organization": "company_name",
    Ticket: "source_reference",
    Body: "message",
    "Requested Item": "product",
    "Unneeded Column": ""
  };
  const revised = inspectCsvImport(csv, { channel: "made-in-china", fieldMap });
  assert.equal(revised.canImport, true);
  assert.equal(revised.mappedHeaderCount, 4);
  assert.deepEqual(revised.unmappedHeaders, ["Unneeded Column"]);
  const [lead] = leadsFromCsv(csv, { channel: "made-in-china", fieldMap });
  assert.equal(lead.source, "Made-in-China");
  assert.equal(lead.sourceReference, "DEMO-102");
  assert.equal(lead.organization.name, "Northstar Demo Imports");
  assert.equal(lead.inquiry.message, "Please quote 500 units");
  assert.equal(lead.inquiry.product, "Reusable bottle");
  assert.equal(lead.notes, null);
});

test("import review exposes duplicate targets and weak traceability", () => {
  const csv = [
    "Company,公司名称,Product",
    ",虚构采购公司,Storage box",
    "Northstar Demo Imports,,"
  ].join("\n");
  const report = inspectCsvImport(csv);
  assert.equal(report.canImport, true);
  assert.deepEqual(report.duplicateTargets, ["company_name"]);
  assert.equal(report.missingSourceReferenceRows, 2);
  assert.equal(report.missingInquiryRows, 1);
  assert.equal(report.missingContactRows, 2);
  assert.ok(report.warnings.some((warning) => warning.includes("靠左")));
  assert.ok(report.warnings.some((warning) => warning.includes("追溯")));
  assert.ok(report.warnings.some((warning) => warning.includes("后续开发")));
});

test("malformed or structurally empty CSV fails closed", () => {
  assert.throws(() => inspectCsvImport('Company,Message\n"Unclosed,Please quote'), /未闭合/);
  assert.equal(inspectCsvImport("Unknown\nvalue").canImport, false);
  assert.equal(inspectCsvImport("Company\n").canImport, false);
  assert.equal(inspectCsvImport(",Message\nDemo,Please quote").canImport, false);
  assert.equal(inspectCsvImport("Company,company\nDemo,Duplicate").canImport, false);
});

test("manual mapping accepts only supported fields", () => {
  assert.ok(CSV_IMPORT_FIELD_DEFINITIONS.some((item) => item.field === "message"));
  assert.throws(() => inspectCsvImport("Unknown\nvalue", {
    fieldMap: { Unknown: "private_internal_field" }
  }), /不支持/);
});

test("confirmed mapping produces a versioned audit without copying sample values", () => {
  const report = inspectCsvImport([
    "Company,Message,Private Column",
    "Northstar Demo Imports,Please quote,do not copy this ignored value"
  ].join("\n"), {
    fieldMap: { Company: "company_name", Message: "message", "Private Column": "" }
  });
  const audit = createCsvImportAudit(report, { reviewedAt: "2026-09-08T17:00:00.000Z" });
  assert.equal(audit.format, "lydia-csv-import-audit");
  assert.equal(audit.reviewedAt, "2026-09-08T17:00:00.000Z");
  assert.equal(audit.mappings.find((mapping) => mapping.header === "Private Column").field, null);
  assert.equal(JSON.stringify(audit).includes("do not copy this ignored value"), false);
  assert.deepEqual(normalizeCsvImportAudit(audit), audit);
  assert.throws(() => normalizeCsvImportAudit({ ...audit, schemaVersion: 2 }), /更新版本/);
});
