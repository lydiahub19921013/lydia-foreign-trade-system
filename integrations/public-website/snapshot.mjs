import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createEvidence } from "../../packages/lead-core/src/model.mjs";

const MAX_PAGE_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const CONTACT_LIMIT = 20;

function clean(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

function unique(values, limit = CONTACT_LIMIT) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))].slice(0, limit);
}

function hostnameValue(value) {
  return String(value || "").toLowerCase().replace(/\.$/u, "").replace(/^\[|\]$/gu, "");
}

function isPublicIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return true;
}

function isSyntheticProxyIpv4(address) {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts[0] === 198 && [18, 19].includes(parts[1]);
}

export function isPublicIp(address) {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) {
    const normalized = address.toLowerCase().split("%")[0];
    return normalized.startsWith("2") || normalized.startsWith("3");
  }
  return false;
}

export function normalizePublicWebsiteUrl(input) {
  let url;
  try {
    url = new URL(clean(input, 2_000));
  } catch {
    throw new Error("请输入完整的公开网站 URL，例如 https://example.com/contact");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("官网地址只支持 HTTP 或 HTTPS");
  if (url.username || url.password) throw new Error("官网地址不能包含用户名或密码");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("官网地址不能使用非标准端口");
  const hostname = hostnameValue(url.hostname);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("不能访问本机或内部网络地址");
  }
  if (isIP(hostname) && !isPublicIp(hostname)) throw new Error("不能访问本机或内部网络地址");
  url.hash = "";
  return url;
}

async function assertPublicDestination(url, lookupImpl) {
  const hostname = hostnameValue(url.hostname);
  if (isIP(hostname)) return;
  const addresses = await lookupImpl(hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((entry) => !isPublicIp(entry.address) && !isSyntheticProxyIpv4(entry.address))) {
    throw new Error("官网域名没有解析到可访问的公网地址");
  }
}

function siteKey(hostname) {
  return hostnameValue(hostname).replace(/^www\./u, "");
}

async function responseText(response, maxBytes = MAX_PAGE_BYTES) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("官网页面超过 1 MB 限制");

  if (!response.body?.getReader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error("官网页面超过 1 MB 限制");
    return new TextDecoder().decode(buffer);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("官网页面超过 1 MB 限制");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function decodeEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const codePoint = (raw, radix) => {
    const number = Number.parseInt(raw, radix);
    return Number.isInteger(number) && number >= 0 && number <= 0x10FFFF ? String.fromCodePoint(number) : " ";
  };
  return String(value || "")
    .replace(/&#(\d+);/gu, (_, code) => codePoint(code, 10))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => codePoint(code, 16))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/giu, (_, name) => named[name.toLowerCase()]);
}

function visibleText(html) {
  return clean(decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/giu, " ")
    .replace(/<[^>]+>/gu, " ")), 50_000);
}

function jsonLdNodes(html) {
  const nodes = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    if (nodes.length >= 10 || match[1].length > 100_000) continue;
    try {
      const payload = JSON.parse(decodeEntities(match[1]));
      const queue = Array.isArray(payload) ? [...payload] : [payload];
      while (queue.length && nodes.length < 50) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;
        nodes.push(item);
        if (Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
      }
    } catch {
      // Invalid JSON-LD is ignored; the page remains usable as plain HTML.
    }
  }
  return nodes;
}

function organizationNodes(html) {
  return jsonLdNodes(html).filter((item) => {
    const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
    return types.some((type) => /Organization|Corporation|LocalBusiness|Manufacturer/iu.test(String(type || "")));
  });
}

function addressText(value) {
  if (!value) return null;
  if (typeof value === "string") return clean(value, 500) || null;
  if (typeof value !== "object") return null;
  return clean([
    value.streetAddress,
    value.addressLocality,
    value.addressRegion,
    value.postalCode,
    value.addressCountry
  ].filter(Boolean).join(", "), 500) || null;
}

function hrefValues(html, scheme) {
  const expression = new RegExp(`href=["']${scheme}:([^"'#?]+)`, "giu");
  return [...html.matchAll(expression)].map((match) => {
    try {
      return decodeURIComponent(match[1]).trim();
    } catch {
      return match[1].trim();
    }
  });
}

function whatsappNumbers(html, nodes) {
  const candidates = [];
  for (const match of html.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\?[^"'\s>]*phone=|whatsapp:\/\/send\?[^"'\s>]*phone=)(\+?[\d(). -]{6,24})/giu)) {
    candidates.push(match[1]);
  }
  for (const node of nodes) {
    const links = Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs];
    for (const link of links) {
      const match = String(link || "").match(/(?:wa\.me\/|phone=)(\+?\d{6,20})/iu);
      if (match) candidates.push(match[1]);
    }
  }
  return unique(candidates.map((value) => value.replace(/[^+\d]/gu, "")), 10);
}

function keywordSnippets(text) {
  const matches = [];
  const expression = /\b(factory|manufactur(?:e|er|ing)|production (?:line|facility|capacity)|plant)\b|工厂|生产线|制造能力/giu;
  for (const match of text.matchAll(expression)) {
    const start = Math.max(0, match.index - 90);
    const end = Math.min(text.length, match.index + match[0].length + 150);
    matches.push(clean(text.slice(start, end), 260));
  }
  return unique(matches, 5);
}

function titleFromHtml(html) {
  const siteName = html.match(/<meta\b[^>]*(?:property|name)=["']og:site_name["'][^>]*content=["']([^"']+)["']/iu)?.[1]
    || html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']og:site_name["']/iu)?.[1];
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  return clean(decodeEntities(siteName || title), 300) || null;
}

export function extractPublicWebsiteEvidence(html, pageUrl, options = {}) {
  const observedAt = options.observedAt || new Date().toISOString();
  const sourceRef = String(pageUrl);
  const nodes = organizationNodes(html);
  const pageText = visibleText(html);
  const title = clean(nodes.find((node) => node.name)?.name || titleFromHtml(html), 300) || null;
  const addresses = unique(nodes.map((node) => addressText(node.address)).filter(Boolean), 10);
  const emails = unique([
    ...hrefValues(html, "mailto").map((value) => value.split("?")[0]),
    ...nodes.map((node) => node.email),
    ...decodeEntities(html).matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/giu)
  ].map((value) => typeof value === "string" ? value : value?.[0]).filter(Boolean).map((value) => value.toLowerCase()));
  const phones = unique([
    ...hrefValues(html, "tel"),
    ...nodes.map((node) => node.telephone)
  ].filter(Boolean));
  const whatsapp = whatsappNumbers(html, nodes);
  const factorySignals = keywordSnippets(pageText);
  const evidence = [createEvidence({
    kind: "company-website",
    value: sourceRef,
    sourceRef,
    observedAt,
    confidence: 0.65,
    status: "candidate",
    note: "成功读取用户指定的公开页面；网站归属仍需与企业登记等独立来源交叉核查"
  })];

  const add = (kind, value, note, confidence = 0.65) => evidence.push(createEvidence({
    kind, value, sourceRef, observedAt, confidence, status: "candidate", note
  }));
  if (title) add("organization-name", title, "来自官网页面标题或 JSON-LD 的企业自述名称", 0.6);
  for (const value of addresses) add("business-address", value, "来自官网 JSON-LD 的公开地址，需与登记来源交叉核查");
  for (const value of emails) add("business-email", value, "官网页面公开邮箱；仅证明该页面列出，尚未验证联系人身份或可投递性");
  for (const value of phones) add("business-phone", value, "官网页面公开电话；尚未验证号码当前有效或对应角色");
  for (const value of whatsapp) add("whatsapp", value, "官网页面公开 WhatsApp 入口；尚未验证号码当前有效或对应角色");
  for (const value of factorySignals) add("factory", value, "官网页面中的生产/工厂自述片段，不能替代独立验厂证据", 0.55);

  return {
    provider: "public-website",
    observedAt,
    requestedUrl: options.requestedUrl || sourceRef,
    finalUrl: sourceRef,
    title,
    contacts: { emails, phones, whatsapp },
    addresses,
    factorySignals,
    evidence,
    disclaimer: "官网内容属于企业自述，所有结果先作为候选证据；不得把公开联系方式等同于营销同意。"
  };
}

export async function fetchPublicWebsiteSnapshot(input, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const lookupImpl = options.lookupImpl || lookup;
  const requestedUrl = normalizePublicWebsiteUrl(input);
  const requestedSite = siteKey(requestedUrl.hostname);
  let current = requestedUrl;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicDestination(current, lookupImpl);
    const response = await fetchImpl(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
        "User-Agent": "LydiaForeignTradeSystem/0.4 public-evidence-check"
      },
      signal: options.signal || AbortSignal.timeout(12_000)
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("官网返回了没有目标地址的跳转");
      const next = normalizePublicWebsiteUrl(new URL(location, current).href);
      if (siteKey(next.hostname) !== requestedSite) throw new Error("官网跳转到其他域名，已停止读取");
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`官网读取失败（HTTP ${response.status}）`);
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml") && !contentType.includes("text/plain")) {
      throw new Error("官网地址没有返回可分析的网页文本");
    }
    const html = await responseText(response, options.maxBytes || MAX_PAGE_BYTES);
    return extractPublicWebsiteEvidence(html, current, {
      requestedUrl: requestedUrl.href,
      observedAt: options.observedAt
    });
  }
  throw new Error("官网跳转次数过多，已停止读取");
}
