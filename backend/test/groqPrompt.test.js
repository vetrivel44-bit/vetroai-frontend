const test = require("node:test");
const assert = require("node:assert/strict");

const orchestrator = require("../src/services/AIOrchestrator");

// Groq's free tier turns down any request over ~12k tokens (prompt plus
// requested reply). The full system prompt reached ~10k tokens (~12k with
// search results), so nearly every Groq chat failed with "Request too large".
const tokens = (text) => Math.ceil(text.length / 3.5); // groqAdapter's estimate
const GROQ_BUDGET = 11000;
const results = "[1] Some source — a dated snippet about the question\n".repeat(110); // ~6k chars

test("Groq's prompt leaves room for the chat and a full reply, with search results", async () => {
  const tight = await orchestrator.buildSystemPrompt("chat", { userQuery: "compare rainfall in chennai and mumbai", webContext: results, memories: [], clock: {}, inlineVisuals: false });
  // A full 4k reply fits beside it; groqAdapter trims old history for the rest.
  assert.ok(tokens(tight) + 4096 < GROQ_BUDGET, `Groq prompt is ~${tokens(tight)} tokens`);
  assert.ok(tokens(tight) < 6000, `Groq prompt is ~${tokens(tight)} tokens`);
});

test("Groq still gets the chart, map and timeline blocks; only the long inline guide goes", async () => {
  const ctx = { userQuery: "compare rainfall in chennai and mumbai", memories: [], clock: {} };
  const full = await orchestrator.buildSystemPrompt("chat", ctx);
  const tight = await orchestrator.buildSystemPrompt("chat", { ...ctx, inlineVisuals: false });
  assert.match(full, /### INLINE VISUALS/);
  assert.doesNotMatch(tight, /### INLINE VISUALS/);
  assert.match(tight, /RICH VISUALIZATION INTENT SYSTEM/);
  assert.match(tight, /"type": "chart"/);
  assert.ok(tokens(full) > GROQ_BUDGET * 0.8, "the full prompt is what didn't fit");
});
