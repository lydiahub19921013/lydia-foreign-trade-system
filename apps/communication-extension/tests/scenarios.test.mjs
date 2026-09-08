import test from "node:test";
import assert from "node:assert/strict";
import { detectScenario } from "../src/core/scenarios.js";

const cases = [
  ["We are interested in your product range. Please send a catalogue.", "inquiry"],
  ["Could you quote your best FOB price for 2,000 units?", "quotation"],
  ["Can you send two samples and advise the sample shipping cost?", "sample"],
  ["The offer is too expensive. Can you meet our target price?", "negotiation"],
  ["We are ready to place an order and will send the purchase order today.", "order"],
  ["The deposit has been paid by bank transfer. Please check the payment.", "payment"],
  ["Please update us on the production progress and completion date.", "production"],
  ["Do you have the tracking number and latest shipment ETA?", "shipping"],
  ["The cartons arrived damaged and several pieces are defective.", "complaint"],
  ["Just following up. Have you reviewed our request?", "follow-up"]
];

for (const [message, expected] of cases) {
  test(`detects ${expected}`, () => {
    const result = detectScenario(message);
    assert.equal(result.id, expected);
    assert.ok(result.confidence >= 0.5);
  });
}

test("uses a low-confidence inquiry fallback for unknown text", () => {
  const result = detectScenario("Hello there");
  assert.equal(result.id, "inquiry");
  assert.equal(result.confidence, 0.25);
});
