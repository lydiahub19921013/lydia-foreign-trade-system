import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const manifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));
const checksum = path.join(projectRoot, "release", `外贸开发插件-v${manifest.version}-chrome.zip.sha256`);
const first = await readFile(checksum, "utf8");

execFileSync(process.execPath, [path.join(scriptDirectory, "package.mjs")], {
  cwd: projectRoot,
  stdio: "ignore"
});

const second = await readFile(checksum, "utf8");
if (first !== second) throw new Error("Repeated package builds produced different SHA-256 values");
console.log(`Reproducible package verified: ${second.trim()}`);
