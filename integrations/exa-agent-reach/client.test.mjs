import test from "node:test";
import assert from "node:assert/strict";
import { parseExaAgentReachOutput, searchWithExaAgentReach } from "./client.mjs";

const demoEnvelope = JSON.stringify({
  content: [{
    type: "text",
    text: `Title: Northstar Demo Distribution
URL: https://northstar.example/news
Published: 2026-09-01T00:00:00.000Z
Author: N/A
Highlights:
Northstar Demo publicly announced a new product range.

---

Title: Harbor Demo Imports
URL: https://harbor.example/about
Published: N/A
Author: Demo Editorial Team
Highlights:
Harbor Demo describes its public distribution business.`
  }]
});

test("Exa agent-reach output becomes provider-neutral public candidates", () => {
  const results = parseExaAgentReachOutput(demoEnvelope);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, "Northstar Demo Distribution");
  assert.equal(results[0].url, "https://northstar.example/news");
  assert.equal(results[0].author, null);
  assert.equal(results[1].publishedAt, null);
});

test("Exa output ignores non-web URLs and malformed blocks", () => {
  const output = JSON.stringify({ content: [{ type: "text", text: "Title: Demo\nURL: file:///tmp/private\nHighlights:\nNo web source" }] });
  assert.deepEqual(parseExaAgentReachOutput(output), []);
  assert.throws(() => parseExaAgentReachOutput("not-json"), /JSON/);
});

test("Exa adapter bounds third-party titles and highlights", () => {
  const output = JSON.stringify({ content: [{ type: "text", text: `Title: ${"T".repeat(500)}\nURL: https://bounded.example\nHighlights:\n${"H".repeat(3000)}` }] });
  const [result] = parseExaAgentReachOutput(output);
  assert.equal(result.title.length, 300);
  assert.equal(result.highlights.length, 2000);
});

test("search calls mcporter without a shell and caps result count", async () => {
  const calls = [];
  const execFileImpl = (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(null, demoEnvelope, "");
  };
  const result = await searchWithExaAgentReach("reusable bottle distributor Exampleland", {
    numResults: 99,
    now: new Date("2026-09-08T00:00:00Z"),
    execFileImpl
  });
  assert.equal(result.provider, "exa-agent-reach");
  assert.equal(result.count, 2);
  assert.equal(calls[0].command, "mcporter");
  assert.equal(calls[0].args[0], "call");
  assert.equal(JSON.parse(calls[0].args[3]).numResults, 5);
  assert.equal(calls[0].options.encoding, "utf8");
});

test("search rejects short queries and hides provider details", async () => {
  await assert.rejects(() => searchWithExaAgentReach("x"), /至少需要/);
  await assert.rejects(() => searchWithExaAgentReach("valid query", {
    execFileImpl: (_command, _args, _options, callback) => callback(new Error("secret provider detail"), "", "token detail")
  }), /暂时不可用/);
});
