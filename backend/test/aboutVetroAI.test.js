const test = require("node:test");
const assert = require("node:assert/strict");

const orchestrator = require("../src/services/AIOrchestrator");
const { needsLiveInfo } = require("../src/services/liveInfoIntent");

// "tell about VetroAi ceo" got nothing but VetroAI's name.
test("every system prompt carries VetroAI's own facts, Groq's shorter one too", async () => {
  for (const ctx of [{}, { inlineVisuals: false }, { lean: true }]) {
    const sys = await orchestrator.buildSystemPrompt("chat", { userQuery: "tell about VetroAi ceo", memories: [], clock: {}, ...ctx });
    assert.match(sys, /# ABOUT VETROAI/);
    assert.match(sys, /Founder & CEO: Vetrivel\./);
    assert.match(sys, /Started: 2024, in Bangalore, India\./);
    assert.match(sys, /never invent it/);
  }
});

test("questions about VetroAI itself are not sent to web search", () => {
  for (const q of ["tell about VetroAi ceo", "who is the founder of vetro ai", "who made you", "who is your ceo", "VetroAI pro plan price"]) {
    assert.equal(needsLiveInfo(q), false, q);
    assert.equal(orchestrator.needsWebSearch(q), false, q);
  }
  assert.equal(needsLiveInfo("who is the ceo of Infosys"), true);
});
