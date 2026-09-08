import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const distDirectory = path.join(projectRoot, "dist");
const releaseDirectory = path.join(projectRoot, "release");
const manifest = JSON.parse(await readFile(path.join(distDirectory, "manifest.json"), "utf8"));
const archive = path.join(releaseDirectory, `外贸开发插件-v${manifest.version}-chrome.zip`);
const checksumFile = `${archive}.sha256`;
const fixedTimestamp = new Date("2020-01-01T00:00:00.000Z");

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(absolute));
    if (entry.isFile()) files.push(path.relative(distDirectory, absolute));
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

if (path.dirname(archive) !== releaseDirectory || path.dirname(releaseDirectory) !== projectRoot) {
  throw new Error("Refusing to package into an unexpected directory");
}

await mkdir(releaseDirectory, { recursive: true });
await rm(archive, { force: true });
await rm(checksumFile, { force: true });
const files = await collectFiles(distDirectory);
if (!files.length || !(await stat(distDirectory)).isDirectory()) throw new Error("Build directory is empty");
for (const file of files) await utimes(path.join(distDirectory, file), fixedTimestamp, fixedTimestamp);
execFileSync("zip", ["-q", "-X", archive, ...files], {
  cwd: distDirectory,
  env: { ...process.env, TZ: "UTC" },
  stdio: "inherit"
});
execFileSync("unzip", ["-t", archive], { stdio: "ignore" });

const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
await writeFile(checksumFile, `${digest}  ${path.basename(archive)}\n`, "utf8");
console.log(`Packaged: ${archive}`);
console.log(`SHA-256: ${digest}`);
