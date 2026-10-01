const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const sambanova = require("../src/providers/sambanovaAdapter");

// Each entry is a response, or "hang" to simulate a model that never starts
// streaming (the fetch only settles when its abort signal fires).
function withFetch(responses, fn) {
  return async () => {
    const calls = [];
    const originalFetch = global.fetch;
    const saved = { key: config.sambanovaApiKey, model: config.sambanovaModel, backup: config.sambanovaBackupModel };
    config.sambanovaApiKey = "test-key";
    config.sambanovaModel = "Meta-Llama-3.3-70B-Instruct";
    config.sambanovaBackupModel = "gpt-oss-120b";
    sambanova.setTimeouts(20, 20);
    global.fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      const next = responses.shift();
      if (next === "hang") {
        // AbortSignal.timeout's timer doesn't hold the event loop open.
        const keepAlive = setInterval(() => {}, 1000);
        return new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => { clearInterval(keepAlive); reject(init.signal.reason); });
        });
      }
      return new Response(next.body, { status: next.status });
    };
    try {
      await fn(calls);
    } finally {
      global.fetch = originalFetch;
      config.sambanovaApiKey = saved.key;
      config.sambanovaModel = saved.model;
      config.sambanovaBackupModel = saved.backup;
      sambanova.setTimeouts(12000, 15000);
    }
  };
}

const OK = { status: 200, body: "data: [DONE]\n\n" };

test("uses the configured model", withFetch([OK], async (calls) => {
  config.sambanovaModel = "DeepSeek-V3.1";
  assert.ok(await sambanova.generateStream([{ role: "user", content: "hi" }]));
  assert.deepEqual(calls.map((c) => c.body.model), ["DeepSeek-V3.1"]);
}));

test("a model that never starts streaming falls back to the backup model", withFetch(["hang", OK], async (calls) => {
  assert.ok(await sambanova.generateStream([{ role: "user", content: "hi" }]));
  assert.deepEqual(calls.map((c) => c.body.model), ["Meta-Llama-3.3-70B-Instruct", "gpt-oss-120b"]);
}));

test("a busy or rejected model falls back to the backup model", withFetch([
  { status: 503, body: '{"error":"overloaded"}' },
  OK,
], async (calls) => {
  assert.ok(await sambanova.generateStream([{ role: "user", content: "hi" }]));
  assert.equal(calls[1].body.model, "gpt-oss-120b");
}));

test("a bad key is not retried with the backup model", withFetch([
  { status: 401, body: '{"error":{"message":"Incorrect API key provided"}}' },
], async (calls) => {
  await assert.rejects(sambanova.generateStream([{ role: "user", content: "hi" }]), /SambaNova service error: 401/);
  assert.equal(calls.length, 1);
}));

test("when both models stall the timeout still reaches the orchestrator", withFetch(["hang", "hang"], async () => {
  await assert.rejects(sambanova.generateStream([{ role: "user", content: "hi" }]), /abort|timeout/i);
}));

test("a pasted key with quotes and a Bearer prefix is cleaned up", withFetch([OK], async (calls) => {
  config.sambanovaApiKey = ' "Bearer abc123" ';
  await sambanova.generateStream([{ role: "user", content: "hi" }]);
  assert.equal(calls[0].headers.Authorization, "Bearer abc123");
}));
