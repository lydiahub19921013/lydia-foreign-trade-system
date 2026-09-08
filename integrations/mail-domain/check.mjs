import { resolve4, resolve6, resolveMx } from "node:dns/promises";
import { createEvidence } from "../../packages/lead-core/src/model.mjs";
import { normalizeCompanyDomain } from "../../packages/lead-core/src/email-candidates.mjs";

async function withTimeout(promise, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("DNS 查询超时");
      error.code = "DNS_TIMEOUT";
      reject(error);
    }, milliseconds);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function isNoData(error) {
  return ["ENODATA", "ENOTFOUND"].includes(error?.code);
}

async function addressFallback(domain, options) {
  const lookups = [options.resolve4Impl(domain), options.resolve6Impl(domain)];
  const results = await Promise.allSettled(lookups);
  const addresses = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const unknownFailure = results.some((result) => result.status === "rejected" && !isNoData(result.reason));
  if (addresses.length) return { status: "address-fallback", addressRecordCount: addresses.length };
  if (unknownFailure) return { status: "inconclusive", addressRecordCount: 0 };
  return { status: "no-mail-route", addressRecordCount: 0 };
}

export async function checkMailDomain(input, options = {}) {
  const domain = normalizeCompanyDomain(input);
  const observedAt = options.observedAt || new Date().toISOString();
  const sourceRef = `dns-mx:${domain}`;
  const resolverOptions = {
    resolveMxImpl: options.resolveMxImpl || resolveMx,
    resolve4Impl: options.resolve4Impl || resolve4,
    resolve6Impl: options.resolve6Impl || resolve6
  };

  try {
    const records = await withTimeout(resolverOptions.resolveMxImpl(domain), options.timeoutMs || 5_000);
    const exchanges = [...records]
      .filter((record) => record?.exchange && record.exchange !== ".")
      .sort((left, right) => Number(left.priority) - Number(right.priority))
      .map((record) => String(record.exchange).replace(/\.$/u, ""));
    const status = exchanges.length ? "mx-found" : "no-mail-route";
    return {
      provider: "dns",
      domain,
      observedAt,
      status,
      exchanges,
      addressRecordCount: 0,
      sourceRef,
      evidence: createEvidence({
        kind: "mail-domain",
        value: domain,
        sourceRef,
        observedAt,
        confidence: exchanges.length ? 0.95 : 0.9,
        status: exchanges.length ? "verified" : "rejected",
        note: exchanges.length
          ? "DNS 存在 MX 记录，只证明域名配置了邮件路由，不证明任何具体邮箱存在"
          : "DNS 返回空 MX，域名声明不接收邮件"
      }),
      disclaimer: "DNS 邮件路由不是邮箱可投递性或联系人身份验证。"
    };
  } catch (error) {
    if (error?.code === "ENOTFOUND") {
      return {
        provider: "dns", domain, observedAt, status: "no-mail-route", exchanges: [], addressRecordCount: 0, sourceRef,
        evidence: createEvidence({ kind: "mail-domain", value: domain, sourceRef, observedAt, confidence: 0.9, status: "rejected", note: "DNS 未找到该域名" }),
        disclaimer: "DNS 邮件路由不是邮箱可投递性或联系人身份验证。"
      };
    }
    if (error?.code === "ENODATA") {
      const fallback = await withTimeout(addressFallback(domain, resolverOptions), options.timeoutMs || 5_000);
      const evidenceStatus = fallback.status === "no-mail-route" ? "rejected" : "inconclusive";
      return {
        provider: "dns", domain, observedAt, exchanges: [], sourceRef, ...fallback,
        evidence: createEvidence({
          kind: "mail-domain",
          value: domain,
          sourceRef,
          observedAt,
          confidence: fallback.status === "address-fallback" ? 0.55 : 0.7,
          status: evidenceStatus,
          note: fallback.status === "address-fallback"
            ? "没有 MX，但域名有 A/AAAA 记录；按协议可能回退投递，结论仍不确定"
            : "未发现 MX 或 A/AAAA 邮件路由"
        }),
        disclaimer: "DNS 邮件路由不是邮箱可投递性或联系人身份验证。"
      };
    }
    return {
      provider: "dns",
      domain,
      observedAt,
      status: "inconclusive",
      exchanges: [],
      addressRecordCount: 0,
      sourceRef,
      evidence: createEvidence({ kind: "mail-domain", value: domain, sourceRef, observedAt, confidence: 0.3, status: "inconclusive", note: "DNS 查询未得出结论" }),
      disclaimer: "DNS 邮件路由不是邮箱可投递性或联系人身份验证。"
    };
  }
}
