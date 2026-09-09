const test = require("node:test");
const assert = require("node:assert/strict");

const { runToolLoop, formatObservations } = require("../src/services/ToolLoop");
const registry = require("../src/services/tools/registry");
const { config } = require("../src/config/env");
const providerManager = require("../src/services/ProviderManager");

const USER_TURN = [{ role: "user", content: "who won the match today?" }];

// A fake adapter that replays a scripted list of provider responses, recording
// what it was asked each time so the test can assert on the loop's bookkeeping.
function scriptedAdapter(responses) {
  const calls = [];
  return {
    calls,
    supportsTools: true,
    async generateCompletion(messages, options) {
      calls.push({ messages: structuredClone(messages), options });
      const next = responses.shift();
      if (typeof next === "function") return next();
      return next ?? { content: "done", tool_calls: [] };
    },
  };
}

function toolCall(id, name, args) {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

test("the loop stops immediately when the model asks for no tools", async () => {
  const adapter = scriptedAdapter([{ content: "SKIP", tool_calls: [] }]);
  const result = await runToolLoop({ messages: USER_TURN, adapter, providerName: "test" });

  assert.equal(result.ran, true);
  assert.equal(result.steps, 1);
  assert.equal(result.stoppedReason, "model_done");
  assert.deepEqual(result.observations, []);
  assert.equal(adapter.calls.length, 1);
});

test("a tool call is executed and fed back as a tool message", async (t) => {
  t.mock.method(registry, "executeTool", async () => ({ ok: true, observation: "India won by 5 wickets." }));

  const adapter = scriptedAdapter([
    { content: "", tool_calls: [toolCall("c1", "web_search", { query: "match result today" })] },
    { content: "found it", tool_calls: [] },
  ]);

  const result = await runToolLoop({ messages: USER_TURN, adapter, providerName: "test" });

  assert.equal(result.steps, 2);
  assert.equal(result.stoppedReason, "model_done");
  assert.deepEqual(result.usedTools, ["web_search"]);
  assert.equal(result.observations[0].observation, "India won by 5 wickets.");

  // Second planner call must see the assistant tool_calls turn AND the result.
  const secondCall = adapter.calls[1].messages;
  const toolMessage = secondCall.find((m) => m.role === "tool");
  assert.equal(toolMessage.tool_call_id, "c1");
  assert.equal(toolMessage.content, "India won by 5 wickets.");
  assert.ok(secondCall.some((m) => m.role === "assistant" && m.tool_calls?.length === 1));
});

test("the loop chains steps and honours maxSteps", async (t) => {
  t.mock.method(registry, "executeTool", async (name) => ({ ok: true, observation: `${name} result` }));

  // A model that never stops asking for tools must still be cut off.
  const alwaysCalling = () => ({
    content: "",
    tool_calls: [toolCall(`c${Math.random()}`, "web_search", { query: `q${Math.random()}` })],
  });
  const adapter = scriptedAdapter([alwaysCalling, alwaysCalling, alwaysCalling, alwaysCalling, alwaysCalling]);

  const result = await runToolLoop({ messages: USER_TURN, adapter, providerName: "test", maxSteps: 3 });

  assert.equal(result.steps, 3);
  assert.equal(result.stoppedReason, "max_steps");
  assert.equal(adapter.calls.length, 3);
  assert.equal(result.observations.length, 3);
});

test("a repeated identical call is served from cache instead of re-running the tool", async (t) => {
  let executions = 0;
  t.mock.method(registry, "executeTool", async () => {
    executions++;
    return { ok: true, observation: "cached result" };
  });

  const sameCall = () => ({ content: "", tool_calls: [toolCall("c1", "web_search", { query: "same" })] });
  const adapter = scriptedAdapter([sameCall(), sameCall(), { content: "ok", tool_calls: [] }]);

  const result = await runToolLoop({ messages: USER_TURN, adapter, providerName: "test", maxSteps: 4 });

  assert.equal(executions, 1, "the identical second call should not hit the tool again");
  assert.equal(result.observations.length, 1, "a cached call is not recorded twice");
});

test("a failing tool degrades the answer instead of killing the turn", async (t) => {
  t.mock.method(registry, "executeTool", async () => ({ ok: false, observation: 'Tool "web_search" failed: boom.' }));

  const adapter = scriptedAdapter([
    { content: "", tool_calls: [toolCall("c1", "web_search", { query: "x" })] },
    { content: "giving up", tool_calls: [] },
  ]);

  const result = await runToolLoop({ messages: USER_TURN, adapter, providerName: "test" });

  assert.equal(result.observations[0].ok, false);
  assert.equal(result.stoppedReason, "model_done");
});

test("a planner error is reported so the orchestrator can fall back", async () => {
  const adapter = {
    supportsTools: true,
    async generateCompletion() { throw new Error("provider exploded"); },
  };

  const result = await runToolLoop({ messages: USER_TURN, adapter, providerName: "test" });

  assert.equal(result.ran, true);
  assert.equal(result.stoppedReason, "planner_error");
  assert.deepEqual(result.observations, []);
});

test("a provider without generateCompletion is refused up front", async () => {
  const result = await runToolLoop({ messages: USER_TURN, adapter: { generateStream() {} }, providerName: "gemini" });

  assert.equal(result.ran, false);
  assert.equal(result.stoppedReason, "provider_cannot_call_tools");
});

test("the planner sees the conversation but not the persona system prompt", async () => {
  const adapter = scriptedAdapter([{ content: "SKIP", tool_calls: [] }]);
  await runToolLoop({
    messages: [
      { role: "system", content: "GIANT VETROAI PERSONA PROMPT" },
      { role: "user", content: "hello there, what is the news" },
    ],
    adapter,
    providerName: "test",
  });

  const sent = adapter.calls[0].messages;
  assert.equal(sent.filter((m) => m.role === "system").length, 1);
  assert.doesNotMatch(sent[0].content, /GIANT VETROAI PERSONA PROMPT/);
  assert.match(sent[0].content, /research planner/i);
  assert.ok(sent.some((m) => m.role === "user" && /what is the news/.test(m.content)));
});

test("the planner does not inherit a model name from another provider", async () => {
  const adapter = scriptedAdapter([{ content: "SKIP", tool_calls: [] }]);
  await runToolLoop({
    messages: USER_TURN,
    adapter,
    providerName: "groq",
    options: { model: "mistral-small-latest", temperature: 0.3 },
  });

  const sent = adapter.calls[0].options;
  assert.equal(sent.model, undefined, "a model name is only valid for the provider it came from");
  assert.equal(sent.temperature, 0.3, "other options still pass through");
  assert.equal(sent.maxTokens, 800);
});

test("observations render into a prompt block that flags failures", () => {
  const block = formatObservations([
    { tool: "web_search", args: '{"query":"ipl final"}', ok: true, observation: "India won." },
    { tool: "cricket_live_scores", args: "{}", ok: false, observation: "Tool failed: timeout." },
  ]);

  assert.match(block, /\[TOOL RESULTS\]/);
  assert.match(block, /web_search \(query: ipl final\)/);
  assert.match(block, /India won\./);
  assert.match(block, /cricket_live_scores — FAILED/);
  assert.equal(formatObservations([]), "", "no observations means no injected block");
});

// ── registry ────────────────────────────────────────────────────────────────

test("unknown tools and malformed arguments are survivable observations, not throws", async () => {
  const unknown = await registry.executeTool("definitely_not_a_tool", {});
  assert.equal(unknown.ok, false);
  assert.match(unknown.observation, /Unknown tool/);

  const malformed = await registry.executeTool("web_search", "{not json");
  assert.equal(malformed.ok, false);
  assert.match(malformed.observation, /not valid JSON/);

  const missingArg = await registry.executeTool("web_search", {});
  assert.equal(missingArg.ok, false);
  assert.match(missingArg.observation, /missing required string argument "query"/);
});

test("observations are truncated so a long page cannot blow the context window", () => {
  const long = "x".repeat(registry.MAX_OBSERVATION_CHARS + 5000);
  const truncated = registry.truncate(long);
  assert.ok(truncated.length < long.length);
  assert.match(truncated, /truncated 5000 characters/);
});

test("every tool schema is well formed for the provider APIs", () => {
  const definitions = registry.getToolDefinitions();
  assert.equal(definitions.length, registry.TOOL_NAMES.length);
  for (const def of definitions) {
    assert.equal(def.type, "function");
    assert.ok(def.function.name && def.function.description, `${def.function?.name} needs a description`);
    assert.equal(def.function.parameters.type, "object");
    for (const required of def.function.parameters.required || []) {
      assert.ok(
        Object.hasOwn(def.function.parameters.properties, required),
        `${def.function.name} requires "${required}" but never declares it`
      );
    }
  }
});

// ── provider capability routing ─────────────────────────────────────────────

test("only the OpenAI-compatible providers are offered the tool loop", () => {
  for (const name of ["groq", "mistral", "sambanova", "agnes", "plugsky"]) {
    assert.equal(providerManager.supportsTools(name), true, `${name} should support tools`);
  }
  for (const name of ["gemini", "chatgpt", "fable"]) {
    assert.equal(providerManager.supportsTools(name), false, `${name} should not support tools`);
  }
});

test("a tool-incapable preference still routes the loop to a capable provider", () => {
  const keys = ["plugskyApiKey", "chatgptApiKey", "fableRapidApiKey", "groqApiKey",
    "mistralApiKey", "agnesApiKey", "sambanovaApiKey", "geminiApiKey"];
  const saved = Object.fromEntries(keys.map((k) => [k, config[k]]));
  try {
    for (const k of keys) config[k] = "";
    for (const p of Object.values(providerManager.providers)) { p.isSuspended = false; p.consecutiveErrors = 0; }

    // The user picked Gemini, which cannot call tools — the loop should still
    // run on Groq rather than being skipped entirely.
    config.geminiApiKey = "test-key";
    config.groqApiKey = "test-key";
    assert.equal(providerManager.getToolCapableProvider("gemini"), "groq");

    // Nothing tool-capable configured at all → no loop.
    config.groqApiKey = "";
    assert.equal(providerManager.getToolCapableProvider("gemini"), null);
  } finally {
    Object.assign(config, saved);
  }
});
