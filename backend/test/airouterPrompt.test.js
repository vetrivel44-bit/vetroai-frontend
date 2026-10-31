const test = require("node:test");
const assert = require("node:assert/strict");

const orchestrator = require("../src/services/AIOrchestrator");
const providerManager = require("../src/services/ProviderManager");
const airouter = require("../src/providers/airouterAdapter");

const streamOf = (lines) => (async function* () { for (const line of lines) yield `${line}\n`; })();

// Answers through a stub AI Router adapter (the real one's reasonsNatively) and
// returns the system prompt it was sent.
async function systemPromptFor(t, input) {
  let sent = null;
  const adapter = {
    reasonsNatively: airouter.reasonsNatively,
    generateStream: async (messages) => {
      sent = messages[0].content;
      return streamOf(['data: {"choices":[{"delta":{"content":"Hello!"}}]}', "data: [DONE]"]);
    },
  };
  const originals = [];
  const patch = (target, name, fn) => { originals.push([target, name, target[name]]); target[name] = fn; };
  patch(providerManager, "getBestProvider", () => "airouter");
  patch(providerManager, "getAdapter", () => adapter);
  patch(providerManager, "getAvailableProviders", () => ["airouter"]);
  patch(providerManager, "isConfigured", (name) => name === "airouter");
  patch(providerManager, "updateMetrics", () => {});
  t.after(() => { for (const [target, name, fn] of originals.reverse()) target[name] = fn; });

  const res = { write: () => {}, end: () => {}, writableEnded: false, locals: {} };
  await orchestrator.processRequest(`t_${Math.random()}`, {
    messages: [{ role: "user", content: input }], mode: "normal", provider: "airouter", options: { airouterModel: airouter.MODEL },
  }, res);
  return sent;
}

test("a greeting to AI Router gets the lean prompt, a real question the full one", async (t) => {
  const greeting = await systemPromptFor(t, "hi");
  const question = await systemPromptFor(t, "Compare the populations of India and China over the last 50 years");
  assert.ok(greeting && question);
  assert.ok(greeting.length < question.length * 0.6, `lean ${greeting.length} vs full ${question.length}`);
});

test("AI Router models are never asked for a <think> block on top of their own reasoning", async (t) => {
  const question = await systemPromptFor(t, "Explain how a car engine works in detail");
  assert.doesNotMatch(question, /<think>/);
});
