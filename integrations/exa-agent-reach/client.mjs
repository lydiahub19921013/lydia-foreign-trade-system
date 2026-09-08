import { execFile as nodeExecFile } from "node:child_process";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function boundedResultCount(value) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(1, Math.min(5, number)) : 5;
}

function run(command, args, options, execFileImpl) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.providerStderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function safeUrl(value) {
  try {
    const url = new URL(clean(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function parseBlock(block) {
  const title = block.match(/^Title:\s*(.*)$/imu)?.[1]?.trim().slice(0, 300) || null;
  const url = safeUrl(block.match(/^URL:\s*(.*)$/imu)?.[1]);
  const published = block.match(/^Published:\s*(.*)$/imu)?.[1]?.trim();
  const author = block.match(/^Author:\s*(.*)$/imu)?.[1]?.trim();
  const highlights = block.split(/^Highlights:\s*$/imu)[1]?.trim().slice(0, 2_000) || null;
  if (!url) return null;
  return {
    title,
    url,
    publishedAt: !published || published === "N/A" ? null : published,
    author: !author || author === "N/A" ? null : author,
    highlights
  };
}

export function parseExaAgentReachOutput(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new Error("Exa 返回的内容不是可识别 JSON");
  }
  const text = Array.isArray(envelope?.content)
    ? envelope.content.filter((item) => item?.type === "text").map((item) => clean(item.text)).filter(Boolean).join("\n\n---\n\n")
    : "";
  if (!text) throw new Error("Exa 没有返回可识别的文本结果");
  return text.split(/\n\s*---\s*\n/gu).map(parseBlock).filter(Boolean);
}

export async function searchWithExaAgentReach(query, options = {}) {
  const normalizedQuery = clean(query);
  if (normalizedQuery.length < 3) throw new Error("公开搜索词至少需要 3 个字符");
  if (normalizedQuery.length > 300) throw new Error("公开搜索词不能超过 300 个字符");
  const numResults = boundedResultCount(options.numResults);
  const args = JSON.stringify({ query: normalizedQuery, numResults });
  let stdout;
  try {
    stdout = await run("mcporter", [
      "call",
      "exa.web_search_exa",
      "--args",
      args,
      "--output",
      "json",
      "--timeout",
      "20000"
    ], {
      timeout: 25_000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8"
    }, options.execFileImpl || nodeExecFile);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("本机尚未安装或启用 agent-reach / mcporter");
    throw new Error("Exa 公开搜索暂时不可用");
  }

  const results = parseExaAgentReachOutput(stdout).slice(0, numResults);
  return {
    provider: "exa-agent-reach",
    query: normalizedQuery,
    observedAt: (options.now || new Date()).toISOString(),
    count: results.length,
    results,
    disclaimer: "搜索结果只是未核查候选；标题、摘要和日期都必须回到原始公开页面确认。"
  };
}
