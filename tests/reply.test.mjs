import test from "node:test";
import assert from "node:assert/strict";
import { buildAIChatMessages, createTemplateReply, extractChatCompletionText } from "../src/core/reply.js";

test("creates a complaint reply without inventing a resolution", () => {
  const reply = createTemplateReply({
    scenarioId: "complaint",
    customer: { name: "Maria" },
    settings: { signature: "Lydia", industryProfile: "", companyProfile: "" },
    mode: "generic",
    tone: "professional"
  });
  assert.match(reply, /Dear Maria/);
  assert.match(reply, /photos or video/);
  assert.match(reply, /Lydia/);
  assert.doesNotMatch(reply, /refund|replacement has been sent/i);
});

test("only includes selected background in AI messages", () => {
  const messages = buildAIChatMessages({
    message: "Please quote 100 units.",
    scenarioId: "quotation",
    settings: {
      industryProfile: "Industrial lighting projects",
      companyProfile: "Private company profile",
      signature: "Lydia"
    },
    mode: "industry",
    tone: "concise"
  });
  const prompt = messages.map((item) => item.content).join("\n");
  assert.match(prompt, /Industrial lighting projects/);
  assert.doesNotMatch(prompt, /Private company profile/);
  assert.match(prompt, /Do not invent prices/);
});

test("extracts compatible chat completion text", () => {
  assert.equal(extractChatCompletionText({ choices: [{ message: { content: " Hello " } }] }), "Hello");
  assert.throws(() => extractChatCompletionText({ choices: [] }), /没有可用/);
});
