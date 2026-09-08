#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { leadsFromCsv, normalizeLead, qualifyLead } from "../../packages/lead-core/src/index.mjs";

function usage() {
  return "用法：npm run qualify -- <inquiries.csv|json> [--output result.json]";
}

function parseArguments(args) {
  const input = args.find((item) => !item.startsWith("--"));
  const outputIndex = args.indexOf("--output");
  return {
    input,
    output: outputIndex >= 0 ? args[outputIndex + 1] : null
  };
}

async function loadLeads(path) {
  const content = await readFile(path, "utf8");
  if (extname(path).toLowerCase() === ".csv") return leadsFromCsv(content);

  const parsed = JSON.parse(content);
  const items = Array.isArray(parsed) ? parsed : parsed.leads;
  if (!Array.isArray(items)) throw new Error("JSON 必须是客户数组，或包含 leads 数组");
  return items.map(normalizeLead);
}

const args = parseArguments(process.argv.slice(2));
if (!args.input) {
  console.error(usage());
  process.exitCode = 1;
} else {
  try {
    const inputPath = resolve(args.input);
    const leads = await loadLeads(inputPath);
    const result = {
      product: "Lydia 外贸系统",
      generatedAt: new Date().toISOString(),
      sourceFile: inputPath,
      count: leads.length,
      results: leads.map((lead) => ({
        lead,
        qualification: qualifyLead(lead)
      }))
    };
    const output = `${JSON.stringify(result, null, 2)}\n`;

    if (args.output) {
      const outputPath = resolve(args.output);
      await writeFile(outputPath, output, "utf8");
      console.error(`已保存 ${leads.length} 条 Lydia 分级结果：${outputPath}`);
    } else {
      process.stdout.write(output);
    }
  } catch (error) {
    console.error(`处理失败：${error.message}`);
    process.exitCode = 1;
  }
}
