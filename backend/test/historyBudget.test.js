const test = require("node:test");
const assert = require("node:assert/strict");

const { historyWithinBudget } = require("../src/services/AIOrchestrator");

const turn = (i, size = 20) => ({ role: i % 2 ? "assistant" : "user", content: `${i}:`.padEnd(size, "x") });

// Was messages.slice(-10): anything said five exchanges back was forgotten.
test("a long chat keeps far more than the last 10 messages", () => {
  const chat = Array.from({ length: 50 }, (_, i) => turn(i));
  assert.deepEqual(historyWithinBudget(chat), chat);
});

test("history is trimmed from the oldest end to the character budget", () => {
  const chat = Array.from({ length: 10 }, (_, i) => turn(i, 1000));
  const kept = historyWithinBudget(chat, 3500);
  assert.deepEqual(kept, chat.slice(-3));
});

test("the latest message is always kept, even when it alone is over budget", () => {
  const chat = [turn(0), { role: "user", content: "y".repeat(5000) }];
  assert.deepEqual(historyWithinBudget(chat, 1000), chat.slice(-1));
  assert.deepEqual(historyWithinBudget([]), []);
});
