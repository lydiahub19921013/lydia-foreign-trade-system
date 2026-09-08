import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const target = path.resolve(process.argv[2] || path.join(projectRoot, "dist"));

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(absolute));
    if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const requiredFiles = [
  "manifest.json",
  "src/background.js",
  "src/sidepanel.html",
  "src/sidepanel.css",
  "src/sidepanel.js",
  "src/core/scenarios.js",
  "src/core/reply.js",
  "src/core/data.js"
];

for (const relative of requiredFiles) {
  const info = await stat(path.join(target, relative)).catch(() => null);
  if (!info?.isFile()) throw new Error(`Missing build file: ${relative}`);
}

const manifest = JSON.parse(await readFile(path.join(target, "manifest.json"), "utf8"));
const packageManifest = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("manifest_version must be 3");
if (manifest.name !== "外贸开发插件") throw new Error("Unexpected product name");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Version must use x.y.z format");
if (manifest.version !== packageManifest.version) throw new Error("Manifest and package versions must match");
if (manifest.host_permissions?.length) throw new Error("Permanent host_permissions are not allowed");

const sidepanel = await readFile(path.join(target, "src/sidepanel.html"), "utf8");
if (!sidepanel.includes(`v${manifest.version}`)) throw new Error("Sidepanel version must match manifest");

const allowedPermissions = new Set(["storage", "sidePanel", "contextMenus"]);
for (const permission of manifest.permissions ?? []) {
  if (!allowedPermissions.has(permission)) throw new Error(`Unexpected permission: ${permission}`);
}

const files = await collectFiles(target);
const readableExtensions = new Set([".json", ".js", ".mjs", ".html", ".css", ".md", ".txt"]);
const forbiddenBrandPatterns = [
  new RegExp(["trade", "cubic"].join("\\s*"), "i"),
  new RegExp(["wang", "leiming"].join(""), "i"),
  /Tianjin[-\s]?Yunmai/i,
  new RegExp(["天津", "云脉"].join(""), "i"),
  new RegExp(["云脉", "365"].join(""), "i")
];
const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bAIza[0-9A-Za-z_-]{25,}\b/,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/
];

for (const file of files) {
  if (file.endsWith(".map")) throw new Error(`Source maps must not ship: ${path.relative(target, file)}`);
  if (!readableExtensions.has(path.extname(file))) continue;
  const content = await readFile(file, "utf8");
  for (const pattern of forbiddenBrandPatterns) {
    if (pattern.test(content)) throw new Error(`Forbidden brand reference in ${path.relative(target, file)}`);
  }
  for (const pattern of secretPatterns) {
    if (pattern.test(content)) throw new Error(`Possible secret in ${path.relative(target, file)}`);
  }
}

console.log(`Verified ${files.length} build files for version ${manifest.version}.`);
