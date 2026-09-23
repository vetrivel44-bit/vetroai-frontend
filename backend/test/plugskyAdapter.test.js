const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const plugsky = require("../src/providers/plugskyAdapter");

function withFetch(responses, fn) {
  return async () => {
    const calls = [];
    const originalFetch = global.fetch;
    const saved = { key: config.plugskyApiKey, model: config.plugskyModel };
    config.plugskyApiKey = "test-key";
    plugsky.resetAcceptedModel();
    global.fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const next = responses.shift();
      return new Response(next.body, { status: next.status });
    };
    try {
      await fn(calls);
    } finally {
      global.fetch = originalFetch;
      config.plugskyApiKey = saved.key;
      config.plugskyModel = saved.model;
    }
  };
}

test("defaults to Plugsky's own plugsky-pro model", withFetch([{ status: 200, body: "data: [DONE]\n\n" }], async (calls) => {
  config.plugskyModel = "";
  await plugsky.generateStream([{ role: "user", content: "hi" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, "plugsky-pro");
  assert.match(calls[0].url, /\/chat\/completions$/);
}));

test("a rejected model name is retried once with plugsky-pro", withFetch([
  { status: 404, body: '{"error":{"message":"The model `plugsky-reasoner` does not exist"}}' },
  { status: 200, body: "data: [DONE]\n\n" },
], async (calls) => {
  config.plugskyModel = "plugsky-reasoner";
  const stream = await plugsky.generateStream([{ role: "user", content: "hi" }]);
  assert.ok(stream);
  assert.deepEqual(calls.map((c) => c.body.model), ["plugsky-reasoner", "plugsky-pro"]);
}));

test("errors unrelated to the model are not retried", withFetch([
  { status: 401, body: '{"error":"invalid api key"}' },
], async (calls) => {
  config.plugskyModel = "plugsky-reasoner";
  await assert.rejects(plugsky.generateStream([{ role: "user", content: "hi" }]), /Plugsky service error: 401/);
  assert.equal(calls.length, 1);
}));

test("a plan-restricted model switches to the model the plan allows, and remembers it", withFetch([
  { status: 400, body: '{"error":{"message":"Model \\"plugsky-pro\\" is not available on your \\"free\\" plan (cap: plugsky-lite). Upgrade your plan or use a model allowed on \\"free\\".","type":"invalid_request_error","code":"400"}}' },
  { status: 200, body: "data: [DONE]\n\n" },
  { status: 200, body: "data: [DONE]\n\n" },
], async (calls) => {
  config.plugskyModel = "";
  await plugsky.generateStream([{ role: "user", content: "hi" }]);
  await plugsky.generateStream([{ role: "user", content: "again" }]);
  assert.deepEqual(calls.map((c) => c.body.model), ["plugsky-pro", "plugsky-lite", "plugsky-lite"]);
}));
