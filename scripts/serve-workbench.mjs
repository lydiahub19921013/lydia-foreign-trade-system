import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { searchGleifEntities } from "../integrations/gleif/client.mjs";
import { checkMailDomain } from "../integrations/mail-domain/check.mjs";
import { fetchPublicWebsiteSnapshot } from "../integrations/public-website/snapshot.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entryPage = resolve(repositoryRoot, "apps/lead-workbench/index.html");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml"
};

function requestedFile(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  if (pathname === "/") return entryPage;
  const path = resolve(repositoryRoot, pathname.replace(/^\/+/, ""));
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}${sep}`)) return null;
  return path;
}

function writeJson(response, status, payload, method = "GET") {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
  });
  response.end(method === "HEAD" ? undefined : `${JSON.stringify(payload)}\n`);
}

export function createWorkbenchServer(options = {}) {
  const gleifSearch = options.gleifSearch || searchGleifEntities;
  const mailDomainCheck = options.mailDomainCheck || checkMailDomain;
  const websiteSnapshot = options.websiteSnapshot || fetchPublicWebsiteSnapshot;

  return createServer(async (request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }

    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/gleif/search") {
      try {
        const result = await gleifSearch(url.searchParams.get("q") || "", {
          jurisdiction: url.searchParams.get("jurisdiction") || "",
          pageSize: 5
        });
        writeJson(response, 200, result, request.method);
      } catch (error) {
        const message = error instanceof Error ? error.message : "企业核验服务暂时不可用";
        const inputError = /至少需要/.test(message);
        writeJson(response, inputError ? 400 : 502, {
          error: inputError ? message : "GLEIF 企业核验暂时失败，请稍后重试。"
        }, request.method);
      }
      return;
    }

    if (url.pathname === "/api/website/snapshot") {
      if (url.searchParams.get("confirmed") !== "true") {
        writeJson(response, 400, { error: "请先确认该页面公开可访问或已获授权。" }, request.method);
        return;
      }
      try {
        writeJson(response, 200, await websiteSnapshot(url.searchParams.get("url") || ""), request.method);
      } catch (error) {
        const message = error instanceof Error ? error.message : "官网读取失败";
        const inputError = /请输入|只支持|不能|公网地址|其他域名|超过 1 MB|网页文本|跳转次数/iu.test(message);
        writeJson(response, inputError ? 400 : 502, {
          error: inputError ? message : "官网暂时无法读取，请检查网址或稍后重试。"
        }, request.method);
      }
      return;
    }

    if (url.pathname === "/api/mail-domain/check") {
      try {
        writeJson(response, 200, await mailDomainCheck(url.searchParams.get("domain") || ""), request.method);
      } catch (error) {
        const message = error instanceof Error ? error.message : "域名格式不正确";
        writeJson(response, 400, { error: message }, request.method);
      }
      return;
    }

    const path = requestedFile(request.url);
    if (!path) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    try {
      const info = await stat(path);
      if (!info.isFile()) throw new Error("Not a file");
      response.writeHead(200, {
        "Content-Type": contentTypes[extname(path)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(path).pipe(response);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.LYDIA_WORKBENCH_PORT || 4173);
  const server = createWorkbenchServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Lydia 外贸工作台已启动：http://127.0.0.1:${port}`);
    console.log("按 Ctrl+C 停止。导入文件只在浏览器处理；只有主动查询功能会联网。");
  });
}
