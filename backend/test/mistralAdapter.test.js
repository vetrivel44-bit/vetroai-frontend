const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const mistral = require("../src/providers/mistralAdapter");

function withFetch(responses, fn) {
  return async () => {
    const calls = [];
    const originalFetch = global.fetch;
    const saved = { key: config.mistralApiKey, model: config.mistralModel };
    config.mistralApiKey = "test-key";
    config.mistralModel = "mistral-small-latest";
    mistral.resetAcceptedModel();
    mistral.setRateLimitDelays([1, 1]);
    global.fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const next = responses.shift();
      return new Response(next.body, { status: next.status, headers: next.headers });
    };
    try {
      await fn(calls);
    } finally {
      global.fetch = originalFetch;
      config.mistralApiKey = saved.key;
      config.mistralModel = saved.model;
      mistral.setRateLimitDelays([1200, 2500]);
    }
  };
}

const OK = { status: 200, body: "data: [DONE]\n\n" };
const RATE_429 = { status: 429, body: '{"message":"Requests rate limit exceeded"}' };
const CAPACITY_429 = { status: 429, body: '{"object":"error","message":"Service tier capacity exceeded for this model.","type":"service_tier_capacity_exceeded","code":"3505"}' };
const INVALID_MODEL = { status: 400, body: '{"object":"error","message":"Invalid model: mistral-1","type":"invalid_model","code":"1500"}' };

test("a per-second 429 is retried on the same model instead of failing over", withFetch([RATE_429, OK], async (calls) => {
  assert.ok(await mistral.generateStream([{ role: "user", content: "hi" }]));
  assert.deepEqual(calls.map((c) => c.body.model), ["mistral-small-latest", "mistral-small-latest"]);
}));

test("a model out of free-tier capacity switches to a smaller Mistral model", withFetch([CAPACITY_429, CAPACITY_429, CAPACITY_429, OK, OK], async (calls) => {
  assert.ok(await mistral.generateStream([{ role: "user", content: "hi" }]));
  assert.equal(calls.at(-1).body.model, "ministral-8b-latest");
  // Capacity is temporary, so the next request starts from the configured model again.
  await mistral.generateStream([{ role: "user", content: "again" }]);
  assert.equal(calls.at(-1).body.model, "mistral-small-latest");
}));

test("an invalid configured model falls back to mistral-small-latest and is remembered", withFetch([INVALID_MODEL, OK, OK], async (calls) => {
  config.mistralModel = "mistral-1";
  await mistral.generateStream([{ role: "user", content: "hi" }]);
  await mistral.generateStream([{ role: "user", content: "again" }]);
  assert.deepEqual(calls.map((c) => c.body.model), ["mistral-1", "mistral-small-latest", "mistral-small-latest"]);
}));

test("auth errors are not retried", withFetch([{ status: 401, body: '{"message":"Unauthorized"}' }], async (calls) => {
  await assert.rejects(mistral.generateStream([{ role: "user", content: "hi" }]), /Mistral service error: 401/);
  assert.equal(calls.length, 1);
}));

test("a 429 that outlasts every model still reaches the orchestrator as a rate limit", withFetch(Array(9).fill(CAPACITY_429), async () => {
  await assert.rejects(mistral.generateStream([{ role: "user", content: "hi" }]), /Mistral service error: 429/);
}));

test("complete() returns the message text for titles and follow-ups", withFetch([
  { status: 200, body: '{"choices":[{"message":{"content":"Hello"}}]}' },
], async (calls) => {
  assert.equal(await mistral.complete([{ role: "user", content: "hi" }]), "Hello");
  assert.equal(calls[0].body.stream, false);
}));
