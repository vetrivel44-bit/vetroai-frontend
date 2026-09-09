const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const providerManager = require("../src/services/ProviderManager");
const orchestrator = require("../src/services/AIOrchestrator");
const registry = require("../src/services/tools/registry");

const PROVIDER_KEYS = ["plugskyApiKey", "chatgptApiKey", "fableRapidApiKey", "groqApiKey",
  "mistralApiKey", "agnesApiKey", "sambanovaApiKey", "geminiApiKey"];

function configureOnly(key) {
  const saved = Object.fromEntries(PROVIDER_KEYS.map((k) => [k, config[k]]));
  for (const k of PROVIDER_KEYS) config[k] = "";
  if (key) config[key] = "test-key";
  for (const p of Object.values(providerManager.providers)) { p.isSuspended = false; p.consecutiveErrors = 0; }
  return () => Object.assign(config, saved);
}

// Collects the SSE frames processRequest writes, so a test can read back the
// status line the user would actually have seen.
function fakeRes() {
  const events = [];
  return {
    events,
    write(frame) {
      const match = /^data: (.*)\n\n$/s.exec(frame);
      if (match) events.push(JSON.parse(match[1]));
      return true;
    },
    end() { this.ended = true; },
    statuses() { return events.filter((e) => e.type === "status").map((e) => e.data); },
  };
}

// Records the system prompt handed to the answering (streaming) call, which is
// where the loop's findings have to end up for any of this to matter.
function fakeAdapter({ toolCalls = [], answer = "final answer" } = {}) {
  const state = { plannerCalls: 0, streamedSystemPrompt: null, plannerToolsOffered: null };
  let remaining = [...toolCalls];
  return {
    state,
    supportsTools: true,
    async generateCompletion(messages, options) {
      state.plannerCalls++;
      state.plannerToolsOffered = options.tools?.map((t) => t.function.name);
      const next = remaining.shift();
      return next ? { content: "", tool_calls: next } : { content: "SKIP", tool_calls: [] };
    },
    async *generateStream(messages) {
      state.streamedSystemPrompt = messages.find((m) => m.role === "system")?.content ?? "";
      yield { choices: [{ delta: { content: answer } }] };
    },
  };
}

function call(id, name, args) {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

async function run(t, { adapter, params }) {
  t.mock.method(providerManager, "getAdapter", () => adapter);
  const res = fakeRes();
  const ok = await orchestrator.processRequest("test-req", { options: {}, ...params }, res);
  return { ok, res };
}

test("what the loop finds reaches the model that writes the answer", async (t) => {
  const restore = configureOnly("groqApiKey");
  t.after(restore);
  t.mock.method(registry, "executeTool", async () => ({ ok: true, observation: "Chennai beat Mumbai by 4 wickets." }));

  const adapter = fakeAdapter({ toolCalls: [[call("c1", "web_search", { query: "match result today" })]] });
  const { ok, res } = await run(t, {
    adapter,
    params: {
      messages: [{ role: "user", content: "who won the cricket match today?" }],
      mode: "normal",
      provider: "Auto",
      // The keyword path would also have fired here — the loop must own it.
      webSearch: true,
    },
  });

  assert.equal(ok, true);
  assert.equal(adapter.state.plannerCalls, 2, "one call to request the tool, one to confirm it is done");
  assert.match(adapter.state.streamedSystemPrompt, /\[TOOL RESULTS\]/);
  assert.match(adapter.state.streamedSystemPrompt, /Chennai beat Mumbai by 4 wickets\./);
  assert.doesNotMatch(
    adapter.state.streamedSystemPrompt,
    /LIVE SEARCH RESULTS/,
    "the keyword search must not run a second lookup behind the loop"
  );
  assert.ok(res.statuses().some((s) => /Deciding what to look up/.test(s)));
  assert.ok(res.statuses().some((s) => /Searching the web/.test(s)), "tool progress should be visible to the user");
});

test("the planner is offered the whole tool catalog", async (t) => {
  const restore = configureOnly("groqApiKey");
  t.after(restore);

  const adapter = fakeAdapter();
  await run(t, {
    adapter,
    params: { messages: [{ role: "user", content: "what is happening in the news" }], mode: "normal", provider: "Auto" },
  });

  assert.deepEqual(adapter.state.plannerToolsOffered, registry.TOOL_NAMES);
});

test("greetings and identity questions never spend a planner round", async (t) => {
  const restore = configureOnly("groqApiKey");
  t.after(restore);

  for (const content of ["hello", "who are you"]) {
    const adapter = fakeAdapter();
    await run(t, { adapter, params: { messages: [{ role: "user", content }], mode: "normal", provider: "Auto" } });
    assert.equal(adapter.state.plannerCalls, 0, `"${content}" should not run the loop`);
  }
});

test("an explicit search mode keeps its own pipeline instead of the loop", async (t) => {
  const restore = configureOnly("groqApiKey");
  t.after(restore);
  // deep_search really does fan out to the search providers. Cut the network
  // off so the assertion is about routing, not about live search results, and
  // so the test does not leave sockets open after it finishes.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network disabled in test"); };
  t.after(() => { globalThis.fetch = realFetch; });

  const adapter = fakeAdapter();
  await run(t, {
    adapter,
    params: { messages: [{ role: "user", content: "research the history of the transistor" }], mode: "deep_search", provider: "Auto" },
  });

  assert.equal(adapter.state.plannerCalls, 0, "deep_search already fetches its own sources");
});

test("a provider that cannot call tools falls back to the old behaviour", async (t) => {
  const restore = configureOnly("geminiApiKey");
  t.after(restore);

  // Gemini speaks its own API shape, so there is no tool-capable provider to
  // borrow — the request must still be answered, just without the loop.
  const adapter = fakeAdapter();
  const { ok } = await run(t, {
    adapter,
    params: { messages: [{ role: "user", content: "what is happening in the news" }], mode: "normal", provider: "gemini" },
  });

  assert.equal(ok, true);
  assert.equal(adapter.state.plannerCalls, 0);
  assert.doesNotMatch(adapter.state.streamedSystemPrompt, /\[TOOL RESULTS\]/);
});

test("a planner that throws still produces an answer", async (t) => {
  const restore = configureOnly("groqApiKey");
  t.after(restore);

  const adapter = fakeAdapter();
  adapter.generateCompletion = async () => { throw new Error("planner is down"); };

  const { ok } = await run(t, {
    adapter,
    params: { messages: [{ role: "user", content: "what is happening in the news" }], mode: "normal", provider: "Auto" },
  });

  assert.equal(ok, true, "a dead planner must not take the answer down with it");
  assert.doesNotMatch(adapter.state.streamedSystemPrompt, /\[TOOL RESULTS\]/);
});

test("the loop can be turned off entirely", async (t) => {
  const restore = configureOnly("groqApiKey");
  const savedFlag = config.toolsEnabled;
  t.after(() => { restore(); config.toolsEnabled = savedFlag; });
  config.toolsEnabled = false;

  const adapter = fakeAdapter();
  await run(t, {
    adapter,
    params: { messages: [{ role: "user", content: "what is happening in the news" }], mode: "normal", provider: "Auto" },
  });

  assert.equal(adapter.state.plannerCalls, 0);
});

test("tool executions do not leave timers holding the event loop open", async () => {
  const before = process.getActiveResourcesInfo().filter((h) => h === "Timeout").length;
  await registry.executeTool("web_search", {}); // fails instantly on the missing argument
  const after = process.getActiveResourcesInfo().filter((h) => h === "Timeout").length;
  assert.equal(after, before, "the timeout guard must be cleared when the tool settles first");
});
