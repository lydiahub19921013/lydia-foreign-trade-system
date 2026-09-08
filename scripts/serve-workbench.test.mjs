import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createWorkbenchServer } from "./serve-workbench.mjs";

async function withServer(run, options = {}) {
  const server = createWorkbenchServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("workbench server serves the local UI and browser-safe core", async () => {
  await withServer(async (origin) => {
    const page = await fetch(`${origin}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Lydia 外贸系统/);
    assert.match(html, /\/apps\/lead-workbench\/app\.mjs/);

    const stylesheet = await fetch(`${origin}/apps/lead-workbench/styles.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type"), /text\/css/);

    const core = await fetch(`${origin}/packages/lead-core/src/index.mjs`);
    assert.equal(core.status, 200);
    assert.match(core.headers.get("content-type"), /javascript/);
  });
});

test("workbench server proxies only structured GLEIF searches", async () => {
  const calls = [];
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/gleif/search?q=Northstar%20Demo&jurisdiction=us-de`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    const result = await response.json();
    assert.equal(result.provider, "GLEIF");
    assert.equal(calls[0].query, "Northstar Demo");
    assert.equal(calls[0].options.jurisdiction, "us-de");
    assert.equal(calls[0].options.pageSize, 5);
  }, {
    gleifSearch: async (query, options) => {
      calls.push({ query, options });
      return { provider: "GLEIF", query, results: [] };
    }
  });
});

test("workbench server requires disclosure confirmation before public prospect search", async () => {
  const calls = [];
  await withServer(async (origin) => {
    const missingConfirmation = await fetch(`${origin}/api/prospects/search?q=reusable%20bottle`);
    assert.equal(missingConfirmation.status, 400);
    assert.match((await missingConfirmation.json()).error, /Exa/);

    const response = await fetch(`${origin}/api/prospects/search?confirmed=true&q=reusable%20bottle&limit=3`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).provider, "exa-agent-reach");
    assert.deepEqual(calls, [{ query: "reusable bottle", options: { numResults: 3 } }]);
  }, {
    prospectSearch: async (query, options) => {
      calls.push({ query, options });
      return { provider: "exa-agent-reach", query, results: [] };
    }
  });
});

test("workbench server separates public search input errors from provider failures", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/prospects/search?confirmed=true&q=x`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /至少需要/);
  }, {
    prospectSearch: async () => {
      throw new Error("公开搜索词至少需要 3 个字符");
    }
  });

  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/prospects/search?confirmed=true&q=valid%20query`);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "公开候选搜索暂时不可用；可改用 Lydia JSON/CSV 导入。" });
  }, {
    prospectSearch: async () => {
      throw new Error("private provider detail");
    }
  });
});

test("workbench server separates input errors from provider failures", async () => {
  await withServer(async (origin) => {
    const shortQuery = await fetch(`${origin}/api/gleif/search?q=a`);
    assert.equal(shortQuery.status, 400);
    assert.match((await shortQuery.json()).error, /至少需要/);
  }, {
    gleifSearch: async () => {
      throw new Error("企业名称至少需要 2 个字符");
    }
  });

  await withServer(async (origin) => {
    const failed = await fetch(`${origin}/api/gleif/search?q=Northstar`);
    assert.equal(failed.status, 502);
    assert.deepEqual(await failed.json(), { error: "GLEIF 企业核验暂时失败，请稍后重试。" });
  }, {
    gleifSearch: async () => {
      throw new Error("upstream secret detail");
    }
  });
});

test("workbench server requires confirmation before reading one public website page", async () => {
  const calls = [];
  await withServer(async (origin) => {
    const missingConsent = await fetch(`${origin}/api/website/snapshot?url=https%3A%2F%2Fexample.com`);
    assert.equal(missingConsent.status, 400);
    assert.match((await missingConsent.json()).error, /确认/);

    const response = await fetch(`${origin}/api/website/snapshot?confirmed=true&url=https%3A%2F%2Fexample.com%2Fcontact`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).provider, "public-website");
    assert.deepEqual(calls, ["https://example.com/contact"]);
  }, {
    websiteSnapshot: async (url) => {
      calls.push(url);
      return { provider: "public-website", finalUrl: url, evidence: [] };
    }
  });
});

test("workbench server requires confirmation and caps the public website dossier", async () => {
  const calls = [];
  await withServer(async (origin) => {
    const missingConsent = await fetch(`${origin}/api/website/dossier?url=https%3A%2F%2Fexample.com`);
    assert.equal(missingConsent.status, 400);
    assert.match((await missingConsent.json()).error, /确认/);

    const response = await fetch(`${origin}/api/website/dossier?confirmed=true&url=https%3A%2F%2Fexample.com`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).provider, "public-website-dossier");
    assert.deepEqual(calls, [{ url: "https://example.com", options: { maxPages: 5 } }]);
  }, {
    websiteDossier: async (url, options) => {
      calls.push({ url, options });
      return { provider: "public-website-dossier", finalUrl: url, pageCount: 1, evidence: [] };
    }
  });
});

test("workbench server hides unexpected website dossier failures", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/website/dossier?confirmed=true&url=https%3A%2F%2Fexample.com`);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "官网档案暂时无法整理，请检查网址或改用单页补证。" });
  }, {
    websiteDossier: async () => {
      throw new Error("private provider detail");
    }
  });
});

test("workbench server does not expose website provider failures", async () => {
  await withServer(async (origin) => {
    const blocked = await fetch(`${origin}/api/website/snapshot?confirmed=true&url=http%3A%2F%2F127.0.0.1`);
    assert.equal(blocked.status, 400);
    assert.match((await blocked.json()).error, /内部网络/);
  }, {
    websiteSnapshot: async () => {
      throw new Error("不能访问本机或内部网络地址");
    }
  });

  await withServer(async (origin) => {
    const failed = await fetch(`${origin}/api/website/snapshot?confirmed=true&url=https%3A%2F%2Fexample.com`);
    assert.equal(failed.status, 502);
    assert.deepEqual(await failed.json(), { error: "官网暂时无法读取，请检查网址或稍后重试。" });
  }, {
    websiteSnapshot: async () => {
      throw new Error("private upstream stack trace");
    }
  });
});

test("workbench server checks only a normalized mail domain", async () => {
  const calls = [];
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/mail-domain/check?domain=buyer.example.com`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "mx-found");
    assert.deepEqual(calls, ["buyer.example.com"]);
  }, {
    mailDomainCheck: async (domain) => {
      calls.push(domain);
      return { provider: "dns", domain, status: "mx-found" };
    }
  });
});

test("workbench server rejects invalid mail domain input", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/mail-domain/check`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /请输入/);
  }, {
    mailDomainCheck: async () => {
      throw new Error("请输入企业域名或官网地址");
    }
  });
});

test("workbench server rejects writes and path traversal", async () => {
  await withServer(async (origin) => {
    assert.equal((await fetch(origin, { method: "POST" })).status, 405);
    const traversal = await fetch(`${origin}/%2e%2e/%2e%2e/etc/passwd`);
    assert.ok([403, 404].includes(traversal.status));
    assert.equal((await fetch(`${origin}/.git/config`)).status, 403);
    assert.equal((await fetch(`${origin}/README.md`)).status, 403);
  });
});
