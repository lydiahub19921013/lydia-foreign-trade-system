import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ignored = new Set([".git", "node_modules", "coverage", "dist"]);
const textExtensions = new Set([".js", ".mjs", ".json", ".md", ".txt", ".yml", ".yaml", ".csv", ".html", ".css", ""]);
const forbiddenIdentities = [
  /trade\s*cubic/iu,
  /tianjin[-\s_]yunmai/iu,
  /天津云脉/gu
];
const probableSecrets = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /sk-[A-Za-z0-9_-]{20,}/u,
  /ghp_[A-Za-z0-9]{30,}/u
];

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else files.push(path);
  }
  return files;
}

const files = (await filesIn(root)).filter((path) => textExtensions.has(extname(path)));
const violations = [];
for (const path of files) {
  if (relative(root, path) === "scripts/verify-system.mjs") continue;
  const content = await readFile(path, "utf8");
  for (const pattern of [...forbiddenIdentities, ...probableSecrets]) {
    if (pattern.test(content)) violations.push(`${relative(root, path)} 匹配 ${pattern}`);
    pattern.lastIndex = 0;
  }
}

const brand = JSON.parse(await readFile(join(root, "config/brand.json"), "utf8"));
if (brand.productName !== "Lydia 外贸系统" || brand.owner !== "Lydia") {
  violations.push("品牌配置不是 Lydia 独立信息");
}

const sample = await readFile(join(root, "examples/inquiries.sample.csv"), "utf8");
const sampleEmails = [...sample.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/giu)];
if (sampleEmails.some((match) => match[1] !== "example.com" && !match[1].endsWith(".example"))) {
  violations.push("示例文件含有非保留示例域名邮箱");
}

if (violations.length) {
  console.error("Lydia 系统验证失败：");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Lydia 系统验证通过：检查 ${files.length} 个文本文件，未发现禁用品牌或常见密钥。`);
}
