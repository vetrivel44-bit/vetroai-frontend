const test = require("node:test");
const assert = require("node:assert/strict");

const orchestrator = require("../src/services/AIOrchestrator");
const { TEACHING, teachingNote } = require("../src/config/teaching");

test("a message that asks to be taught gets the teaching guide in every mode, lean ones included", async () => {
  for (const [mode, extra] of [["chat", {}], ["code", {}], ["chat", { lean: true }], ["chat", { inlineVisuals: false }]]) {
    for (const userQuery of ["teach me fractions", "i cant understand, explain again"]) {
      const sys = await orchestrator.buildSystemPrompt(mode, { userQuery, memories: [], clock: {}, ...extra });
      assert.ok(sys.includes(TEACHING), `${mode} ${JSON.stringify(extra)} ${userQuery}`);
    }
  }
  // Other messages don't spend its ~900 tokens (Groq's request cap is tight).
  const plain = await orchestrator.buildSystemPrompt("chat", { userQuery: "compare rainfall in chennai and mumbai", memories: [], clock: {} });
  assert.ok(!plain.includes(TEACHING));
});

test("a reply that didn't land is explained again a new way, not repeated", () => {
  assert.match(teachingNote("I still can't understand this"), /did not understand your last explanation/);
  assert.match(teachingNote("puriyala, explain again"), /completely different, simpler angle/);
  assert.equal(teachingNote("what's the time"), "");
});
