#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { SCHEMA_VERSION, findDuplicateCandidates, leadsFromCsv, normalizeLead, qualifyLead } from "../../packages/lead-core/src/index.mjs";

function usage() {
  return "用法：npm run qualify -- <inquiries.csv|json> [--channel auto|alibaba|made-in-china] [--output result.json]";
}

function parseArguments(args) {
  const parsed = { input: null, output: null, channel: "auto" };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--output") parsed.output = args[++index];
    else if (value === "--channel") parsed.channel = args[++index];
    else if (!value.startsWith("--") && !parsed.input) parsed.input = value;
    else throw new Error(`无法识别的参数：${value}`);
  }
  if (!["auto", "alibaba", "made-in-china"].includes(parsed.channel)) {
    throw new Error("channel 只能是 auto、alibaba 或 made-in-china");
  }
  return parsed;
}

async function loadLeads(path, channel) {
  const content = await readFile(path, "utf8");
  if (extname(path).toLowerCase() === ".csv") return leadsFromCsv(content, { channel });

  const parsed = JSON.parse(content);
  const items = Array.isArray(parsed) ? parsed : parsed.leads;
  if (!Array.isArray(items)) throw new Error("JSON 必须是客户数组，或包含 leads 数组");
  return items.map(normalizeLead);
}

let args;
try {
  args = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(`${error.message}\n${usage()}`);
  process.exitCode = 1;
}

if (args && !args.input) {
  console.error(usage());
  process.exitCode = 1;
} else if (args) {
  try {
    const inputPath = resolve(args.input);
    const leads = await loadLeads(inputPath, args.channel);
    const result = {
      format: "lydia-qualified-leads",
      schemaVersion: SCHEMA_VERSION,
      product: "Lydia 外贸系统",
      generatedAt: new Date().toISOString(),
      sourceFile: basename(inputPath),
      count: leads.length,
      duplicateCandidates: findDuplicateCandidates(leads),
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
