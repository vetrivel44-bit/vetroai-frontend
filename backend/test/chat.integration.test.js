const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const app = require("../src/app");

function clearProviderKeys() {
  for (const key of [
    "chatgptApiKey",
    "groqApiKey",
    "agnesApiKey",
    "airouterApiKey",
    "geminiApiKey",
  ]) config[key] = "";
}

async function startServer(t) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("chat returns a clear SSE error when no AI provider is configured", async (t) => {
  clearProviderKeys();
  const baseUrl = await startServer(t);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: "Hello", provider: "Auto", mode: "normal" }),
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  assert.match(body, /not configured with an AI provider/i);
});

test("title and follow-up endpoints remain usable without Groq", async (t) => {
  clearProviderKeys();
  const baseUrl = await startServer(t);

  const titleResponse = await fetch(`${baseUrl}/api/generate-title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstMessage: "Explain operating system deadlock prevention" }),
  });
  const titleBody = await titleResponse.json();
  assert.equal(titleResponse.status, 200);
  assert.match(titleBody.data.title, /deadlock prevention/i);

  const followUpResponse = await fetch(`${baseUrl}/api/follow-ups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lastMessage: "A deadlock occurs when processes wait forever.", userQuery: "What is deadlock?" }),
  });
  const followUpBody = await followUpResponse.json();
  assert.equal(followUpResponse.status, 200);
  assert.deepEqual(followUpBody.data.suggestions, []);
});

test("processRequest reports failure when no provider is configured, so the turn is not billed", async () => {
  clearProviderKeys();
  config.fableRapidApiKey = "";
  const orchestrator = require("../src/services/AIOrchestrator");

  const written = [];
  const res = { write: (chunk) => written.push(chunk), end: () => {}, writableEnded: false };

  const answered = await orchestrator.processRequest("test_req", {
    messages: [{ role: "user", content: "Hello" }],
    mode: "normal",
    options: { temperature: 0.7, maxTokens: 256 },
  }, res);

  assert.equal(answered, false, "an unanswered turn must not report success");
  assert.match(written.join(""), /not configured with an AI provider/i);
});

test("Voice Mode uses only AI Router's non-reasoning model without a thinking prompt or token floor", async () => {
  const orchestrator = require("../src/services/AIOrchestrator");
  const providerManager = require("../src/services/ProviderManager");
  const airouter = require("../src/providers/airouterAdapter");
  const streamOf = (lines) => (async function* () { for (const line of lines) yield line + "\n"; })();
  const original = {};
  const patch = (target, name, fn) => { original[name] = [target, target[name]]; target[name] = fn; };
  const seen = [];
  const generatedProviders = [];
  const adapter = {
    reasoningAlwaysOn: () => true,
    generateStream: async (messages, options) => {
      seen.push({ messages, options });
      return streamOf(['data: {"choices":[{"delta":{"content":"A relational database organizes information into tables."}}]}']);
    },
  };
  const savedThinking = config.thinkingEnabled;
  config.thinkingEnabled = true;
  patch(providerManager, "isConfigured", (name) => name === "airouter");
  patch(providerManager, "getAdapter", (name) => ({
    ...adapter,
    generateStream: (...args) => { generatedProviders.push(name); return adapter.generateStream(...args); },
  }));
  patch(providerManager, "updateMetrics", () => {});

  try {
    const written = [];
    const res = { write: (chunk) => written.push(chunk), end: () => {}, writableEnded: false, locals: {} };
    const answered = await orchestrator.processRequest("test_voice_mode", {
      messages: [{ role: "user", content: "What does a relational database do and why is it useful?" }],
      mode: "normal",
      provider: "groq",
      effort: "balanced",
      voiceMode: true,
      options: { temperature: 0.7, maxTokens: 256 },
    }, res);

    assert.equal(answered, true);
    assert.equal(seen.length, 1);
    assert.deepEqual(generatedProviders, ["airouter"]);
    assert.equal(seen[0].options.airouterModel, config.airouterVoiceModel, "the voice model (Gemini 2.5 Flash Lite by default)");
    assert.equal(config.airouterVoiceModel, "google/gemini-2.5-flash-lite");
    assert.equal(seen[0].options.maxTokens, 256);
    assert.ok(seen[0].messages.every((message) => !message.content?.includes("<think>")));
  } finally {
    config.thinkingEnabled = savedThinking;
    for (const [name, [target, fn]] of Object.entries(original)) target[name] = fn;
  }
});

test("chat forwards the explicit Voice Mode flag and leaves it false when omitted", async (t) => {
  const orchestrator = require("../src/services/AIOrchestrator");
  const original = orchestrator.processRequest;
  const seen = [];
  orchestrator.processRequest = async (_reqId, params) => { seen.push(params.voiceMode); return true; };
  t.after(() => { orchestrator.processRequest = original; });

  const baseUrl = await startServer(t);
  for (const voiceMode of [true, false]) {
    const body = new FormData();
    body.append("input", "Say hello");
    body.append("messages", JSON.stringify([{ role: "user", content: "Say hello" }]));
    if (voiceMode) body.append("voiceMode", "true");
    const response = await fetch(`${baseUrl}/api/chat`, { method: "POST", body });
    await response.text();
    assert.equal(response.status, 200);
  }

  assert.deepEqual(seen, [true, false]);
});

test("processRequest falls back to the next provider when one streams an empty answer", async () => {
  const orchestrator = require("../src/services/AIOrchestrator");
  const providerManager = require("../src/services/ProviderManager");

  const streamOf = (lines) => (async function* () { for (const line of lines) yield line + "\n"; })();
  const adapters = {
    first: { generateStream: async () => streamOf(['data: {"choices":[{"delta":{"content":"<think>planning a reply"}}]}']) },
    second: { generateStream: async () => streamOf(['data: {"choices":[{"delta":{"content":"Hello there!"}}]}']) },
  };

  const originals = {};
  const patch = (target, name, fn) => { originals[name] = [target, target[name]]; target[name] = fn; };
  patch(providerManager, "getBestProvider", () => "first");
  patch(providerManager, "getAdapter", (name) => adapters[name]);
  patch(providerManager, "getAvailableProviders", () => ["first", "second"]);
  patch(providerManager, "isConfigured", (name) => name in adapters);
  patch(providerManager, "updateMetrics", () => {});
  patch(providerManager, "suspendProvider", () => {});
  patch(orchestrator, "nextFallback", (failed, attempted) => ["first", "second"].find((n) => !attempted.has(n)) || null);

  try {
    const written = [];
    const res = { write: (chunk) => written.push(chunk), end: () => {}, writableEnded: false };
    const answered = await orchestrator.processRequest("test_empty", {
      messages: [{ role: "user", content: "hi" }],
      mode: "normal",
      options: { temperature: 0.7, maxTokens: 256 },
    }, res);

    const events = written.join("").split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    assert.equal(answered, true);
    assert.ok(events.some((e) => e.type === "clear"), "the empty attempt is cleared before the retry");
    assert.equal(events.filter((e) => e.type === "content").map((e) => e.data).join(""), "Hello there!");
  } finally {
    for (const [name, [target, fn]] of Object.entries(originals)) target[name] = fn;
  }
});

test("a native-reasoning model skips the <think> prompt, and a failed provider hands over without a pause", async () => {
  const orchestrator = require("../src/services/AIOrchestrator");
  const providerManager = require("../src/services/ProviderManager");

  const streamOf = (lines) => (async function* () { for (const line of lines) yield line + "\n"; })();
  const seen = {};
  const adapters = {
    reasoner: {
      reasonsNatively: () => true,
      generateStream: async (messages, options) => {
        seen.reasoner = { system: messages[0].content, effort: options.effort };
        throw new Error("503 service unavailable");
      },
    },
    plain: {
      generateStream: async (messages, options) => {
        seen.plain = { system: messages[0].content, effort: options.effort };
        return streamOf(['data: {"choices":[{"delta":{"content":"DBMS stores data."}}]}']);
      },
    },
  };

  const originals = {};
  const patch = (target, name, fn) => { originals[name] = [target, target[name]]; target[name] = fn; };
  patch(providerManager, "getBestProvider", () => "reasoner");
  patch(providerManager, "getAdapter", (name) => adapters[name]);
  patch(providerManager, "getAvailableProviders", () => ["reasoner", "plain"]);
  patch(providerManager, "isConfigured", (name) => name in adapters);
  patch(providerManager, "updateMetrics", () => {});
  patch(providerManager, "suspendProvider", () => {});
  patch(orchestrator, "nextFallback", (failed, attempted) => ["reasoner", "plain"].find((n) => !attempted.has(n)) || null);
  const savedThinking = config.thinkingEnabled;
  config.thinkingEnabled = true;

  try {
    const written = [];
    const res = { write: (chunk) => written.push(chunk), end: () => {}, writableEnded: false };
    const startedAt = Date.now();
    const answered = await orchestrator.processRequest("test_reasoner", {
      messages: [{ role: "user", content: "What is a DBMS used for?" }],
      mode: "normal",
      effort: "balanced",
      options: { temperature: 0.7, maxTokens: 256 },
    }, res);

    assert.equal(answered, true);
    assert.ok(Date.now() - startedAt < 1500, "switching providers no longer waits seconds");
    assert.doesNotMatch(seen.reasoner.system, /<think>/, "a native reasoner is not asked to think twice");
    assert.match(seen.plain.system, /<think>/, "other models still get the thinking prompt");
    assert.equal(seen.reasoner.effort, "balanced");
    assert.equal(seen.plain.effort, "balanced");
  } finally {
    config.thinkingEnabled = savedThinking;
    for (const [name, [target, fn]] of Object.entries(originals)) target[name] = fn;
  }
});
