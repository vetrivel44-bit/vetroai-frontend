const test = require("node:test");
const assert = require("node:assert/strict");

const orchestrator = require("../src/services/AIOrchestrator");

// Code in every language should come with the fastest known algorithm, in
// every mode and on every provider — including the lean prompt for small budgets.
test("every system prompt asks for the lowest time complexity in code", async () => {
  const ctx = { userQuery: "find two numbers that add up to a target", memories: [], clock: {} };
  for (const [mode, extra] of [["chat", {}], ["code", {}], ["chat", { lean: true }], ["chat", { inlineVisuals: false }]]) {
    const sys = await orchestrator.buildSystemPrompt(mode, { ...ctx, ...extra });
    assert.match(sys, /# CODE: OPTIMAL TIME COMPLEXITY/, `${mode} ${JSON.stringify(extra)}`);
    assert.match(sys, /lowest time complexity/);
  }
});
