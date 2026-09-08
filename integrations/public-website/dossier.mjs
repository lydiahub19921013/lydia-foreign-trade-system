import { fetchPublicWebsiteSnapshot, normalizePublicWebsiteUrl } from "./snapshot.mjs";

function boundedPageCount(value) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(1, Math.min(5, number)) : 5;
}

function unique(values, limit = 50) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function safeFailureReason(error) {
  const message = error instanceof Error ? error.message : "页面未能读取";
  const allowed = message.match(/HTTP \d{3}|没有返回可分析的网页文本|超过 1 MB|跳转到其他域名|跳转次数过多/iu)?.[0];
  return allowed || "页面未能读取";
}

function mergeEvidence(pages) {
  const byId = new Map();
  for (const page of pages) {
    for (const evidence of page.evidence || []) byId.set(evidence.id, evidence);
  }
  return [...byId.values()];
}

function enqueueDiverseLinks(links, state) {
  const candidates = (links || []).filter((link) => !state.queued.has(link.url) && !state.visited.has(link.url));
  const firstByReason = [];
  const repeats = [];
  const reasonsSeenHere = new Set();
  for (const link of candidates) {
    const reason = link.reason || "其他公开页面";
    if (!state.reasonCounts.has(reason) && !reasonsSeenHere.has(reason)) {
      firstByReason.push(link);
      reasonsSeenHere.add(reason);
    } else {
      repeats.push(link);
    }
  }
  for (const link of [...firstByReason, ...repeats]) {
    if (state.queue.length >= 20) break;
    const reason = link.reason || "其他公开页面";
    state.queued.add(link.url);
    state.reasonCounts.set(reason, (state.reasonCounts.get(reason) || 0) + 1);
    state.queue.push({ url: link.url, reason });
  }
}

export async function fetchPublicWebsiteDossier(input, options = {}) {
  const maxPages = boundedPageCount(options.maxPages);
  const requestedUrl = normalizePublicWebsiteUrl(input).href;
  const snapshotImpl = options.snapshotImpl || fetchPublicWebsiteSnapshot;
  const queue = [{ url: requestedUrl, reason: "使用者指定页面" }];
  const queued = new Set([requestedUrl]);
  const visited = new Set();
  const reasonCounts = new Map();
  const pages = [];
  const failures = [];

  while (queue.length && pages.length < maxPages) {
    const target = queue.shift();
    if (visited.has(target.url)) continue;
    visited.add(target.url);
    let page;
    try {
      page = await snapshotImpl(target.url, options);
    } catch (error) {
      if (!pages.length) throw error;
      failures.push({ url: target.url, reason: safeFailureReason(error) });
      continue;
    }
    pages.push({ ...page, discoveryReason: target.reason });
    visited.add(page.finalUrl);
    enqueueDiverseLinks(page.pageLinks, { queue, queued, visited, reasonCounts });
  }

  const contacts = {
    emails: unique(pages.flatMap((page) => page.contacts?.emails || []), 30),
    phones: unique(pages.flatMap((page) => page.contacts?.phones || []), 30),
    whatsapp: unique(pages.flatMap((page) => page.contacts?.whatsapp || []), 20)
  };
  const addresses = unique(pages.flatMap((page) => page.addresses || []), 20);
  const factorySignals = unique(pages.flatMap((page) => page.factorySignals || []), 15);
  const evidence = mergeEvidence(pages);

  return {
    provider: "public-website-dossier",
    observedAt: pages[0].observedAt,
    requestedUrl,
    finalUrl: pages[0].finalUrl,
    title: pages.find((page) => page.title)?.title || null,
    pageCount: pages.length,
    maxPages,
    pages: pages.map((page) => ({
      url: page.finalUrl,
      title: page.title,
      discoveryReason: page.discoveryReason,
      evidenceCount: page.evidence?.length || 0
    })),
    failures,
    contacts,
    addresses,
    factorySignals,
    evidence,
    disclaimer: "档案只整理最多 5 张同站公开页面。官网内容仍是企业自述，联系方式不等于营销同意，工厂信息不能替代独立验厂。"
  };
}
