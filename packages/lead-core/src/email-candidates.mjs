function clean(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function normalizeCompanyDomain(input) {
  const raw = clean(input, 500).toLowerCase();
  if (!raw) throw new Error("请输入企业域名或官网地址");
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    throw new Error("企业域名格式不正确");
  }
  const domain = url.hostname.toLowerCase().replace(/^www\./u, "").replace(/\.$/u, "");
  const labels = domain.split(".");
  const numericIp = labels.length === 4 && labels.every((label) => /^\d{1,3}$/u.test(label));
  const internalName = domain.endsWith(".local") || domain.endsWith(".internal") || domain.endsWith(".localhost");
  if (!domain.includes(".") || domain.length > 253 || numericIp || internalName || !/^[a-z0-9.-]+$/u.test(domain) || labels.some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) {
    throw new Error("企业域名格式不正确");
  }
  return domain;
}

function nameParts(input) {
  return clean(input, 200)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

export function generateEmailCandidates(fullName, domainInput) {
  const domain = normalizeCompanyDomain(domainInput);
  const parts = nameParts(fullName);
  const first = parts[0] || "";
  const last = parts.length > 1 ? parts.at(-1) : "";
  const patterns = [];
  const add = (localPart, type, pattern) => {
    if (!localPart || patterns.some((item) => item.localPart === localPart)) return;
    patterns.push({ localPart, type, pattern });
  };

  if (first && last) {
    add(`${first}.${last}`, "person", "first.last");
    add(`${first[0]}${last}`, "person", "first-initial+last");
    add(`${first}${last}`, "person", "first+last");
    add(`${first}${last[0]}`, "person", "first+last-initial");
    add(`${last}.${first}`, "person", "last.first");
  }
  if (first) add(first, "person", "first");
  if (last) add(last, "person", "last");
  add("sales", "role", "sales-team");
  add("export", "role", "export-team");
  add("info", "role", "general-information");

  return patterns.slice(0, 10).map((item) => ({
    ...item,
    email: `${item.localPart}@${domain}`,
    domain,
    status: "candidate",
    reason: item.type === "role"
      ? "企业常见职能邮箱，仅为命名候选"
      : "根据联系人英文名和常见企业命名规则生成，未证明邮箱存在"
  }));
}

export function assessEmailCandidates(candidates, mailDomainResult, publishedEmails = []) {
  const published = new Set(publishedEmails.map((value) => clean(value, 320).toLowerCase()));
  return candidates.map((candidate) => {
    const listedOnWebsite = published.has(candidate.email.toLowerCase());
    const domainStatus = mailDomainResult?.status || "inconclusive";
    let status = "candidate";
    if (domainStatus === "no-mail-route") status = "rejected";
    if (domainStatus === "inconclusive") status = "inconclusive";
    return {
      ...candidate,
      status,
      listedOnWebsite,
      domainStatus,
      signals: [
        listedOnWebsite ? "指定官网页面公开列出" : null,
        domainStatus === "mx-found" ? "域名存在 MX 邮件记录" : null,
        domainStatus === "address-fallback" ? "域名只有 A/AAAA 回退，邮件能力不确定" : null,
        domainStatus === "no-mail-route" ? "未发现可用邮件路由" : null,
        domainStatus === "inconclusive" ? "DNS 检查未得出结论" : null
      ].filter(Boolean)
    };
  }).sort((left, right) => Number(right.listedOnWebsite) - Number(left.listedOnWebsite));
}

export function checkEmailCandidateLeadMatch(lead, candidateDomainInput) {
  const candidateDomain = normalizeCompanyDomain(candidateDomainInput);
  const existingInput = lead?.organization?.domain || lead?.organization?.website;
  if (!existingInput) return { allowed: true, candidateDomain, existingDomain: null, reason: "询盘尚无企业域名" };
  try {
    const existingDomain = normalizeCompanyDomain(existingInput);
    return {
      allowed: existingDomain === candidateDomain,
      candidateDomain,
      existingDomain,
      reason: existingDomain === candidateDomain ? "企业域名一致" : "候选邮箱域名与询盘企业域名不一致"
    };
  } catch {
    return { allowed: false, candidateDomain, existingDomain: null, reason: "询盘现有企业域名格式异常" };
  }
}
