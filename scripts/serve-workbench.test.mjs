import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createWorkbenchServer } from "./serve-workbench.mjs";

async function withServer(run) {
  const server = createWorkbenchServer();
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

test("workbench server rejects writes and path traversal", async () => {
  await withServer(async (origin) => {
    assert.equal((await fetch(origin, { method: "POST" })).status, 405);
    const traversal = await fetch(`${origin}/%2e%2e/%2e%2e/etc/passwd`);
    assert.ok([403, 404].includes(traversal.status));
  });
});
