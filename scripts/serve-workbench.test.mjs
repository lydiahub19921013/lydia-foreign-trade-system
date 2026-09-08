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

test("workbench server rejects writes and path traversal", async () => {
  await withServer(async (origin) => {
    assert.equal((await fetch(origin, { method: "POST" })).status, 405);
    const traversal = await fetch(`${origin}/%2e%2e/%2e%2e/etc/passwd`);
    assert.ok([403, 404].includes(traversal.status));
  });
});
