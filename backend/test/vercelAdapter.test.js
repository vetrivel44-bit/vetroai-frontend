const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const vercel = require("../src/providers/vercelAdapter");

function withFetch(responses, fn) {
  return async () => {
    const calls = [];
    const originalFetch = global.fetch;
    const saved = { key: config.vercelApiKey, model: config.vercelModel };
    config.vercelApiKey = "test-key";
    vercel.resetAcceptedModel();
    global.fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      const next = responses.shift();
      return new Response(next.body, { status: next.status, headers: next.headers });
    };
    try {
      await fn(calls);
    } finally {
      global.fetch = originalFetch;
      config.vercelApiKey = saved.key;
      config.vercelModel = saved.model;
    }
  };
}

const OK = { status: 200, body: "data: [DONE]\n\n" };

test("streams from the Vercel AI Gateway with the default model", withFetch([OK], async (calls) => {
  config.vercelModel = "";
  await vercel.generateStream([{ role: "user", content: "hi" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://ai-gateway.vercel.sh/v1/chat/completions");
  assert.equal(calls[0].body.model, vercel.DEFAULT_MODEL);
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].headers.Authorization, "Bearer test-key");
}));

test("a pasted key with quotes and a Bearer prefix is cleaned up", withFetch([OK], async (calls) => {
  config.vercelApiKey = ' "Bearer abc123" ';
  await vercel.generateStream([{ role: "user", content: "hi" }]);
  assert.equal(calls[0].headers.Authorization, "Bearer abc123");
}));

test("a rejected model name is retried once with the default model, and remembered", withFetch([
  { status: 404, body: '{"error":{"message":"Model not found: acme/unknown","type":"model_not_found"}}' },
  OK,
  OK,
], async (calls) => {
  config.vercelModel = "acme/unknown";
  await vercel.generateStream([{ role: "user", content: "hi" }]);
  await vercel.generateStream([{ role: "user", content: "again" }]);
  assert.deepEqual(calls.map((c) => c.body.model), ["acme/unknown", vercel.DEFAULT_MODEL, vercel.DEFAULT_MODEL]);
}));

test("errors unrelated to the model are not retried", withFetch([
  { status: 401, body: '{"error":{"message":"Invalid API key"}}' },
], async (calls) => {
  config.vercelModel = "openai/gpt-oss-120b";
  await assert.rejects(vercel.generateStream([{ role: "user", content: "hi" }]), /Vercel AI Gateway service error: 401/);
  assert.equal(calls.length, 1);
}));

const RATE_429 = { status: 429, body: '{"error":{"message":"Rate limit exceeded, retry shortly","type":"rate_limit_exceeded"}}' };

test("a short-lived 429 is retried after a pause instead of failing over", withFetch([
  RATE_429,
  { ...RATE_429, headers: { "retry-after": "0" } },
  OK,
], async (calls) => {
  config.vercelModel = "";
  vercel.setRateLimitDelays([1, 1]);
  try {
    assert.ok(await vercel.generateStream([{ role: "user", content: "hi" }]));
    assert.equal(calls.length, 3);
  } finally {
    vercel.setRateLimitDelays([1500, 3000]);
  }
}));

test("a 429 that outlasts the retries still reaches the orchestrator as a rate limit", withFetch([RATE_429, RATE_429, RATE_429], async () => {
  config.vercelModel = "";
  vercel.setRateLimitDelays([1, 1]);
  try {
    await assert.rejects(vercel.generateStream([{ role: "user", content: "hi" }]), /Vercel AI Gateway service error: 429/);
  } finally {
    vercel.setRateLimitDelays([1500, 3000]);
  }
}));

test("a credit or spend limit is not retried — waiting seconds won't clear it", withFetch([
  { status: 429, body: '{"error":{"message":"Insufficient credits. Add credits to continue."}}' },
], async (calls) => {
  config.vercelModel = "";
  await assert.rejects(vercel.generateStream([{ role: "user", content: "hi" }]), /429/);
  assert.equal(calls.length, 1);
}));

test("no key configured is reported, not sent", withFetch([], async (calls) => {
  config.vercelApiKey = "";
  await assert.rejects(vercel.generateStream([{ role: "user", content: "hi" }]), /not configured/);
  assert.equal(calls.length, 0);
}));

test("the default effort asks for light reasoning, and Deep or Max ask for more", withFetch([OK, OK, OK, OK], async (calls) => {
  config.vercelModel = "";
  await vercel.generateStream([{ role: "user", content: "hi" }]);
  await vercel.generateStream([{ role: "user", content: "hi" }], { effort: "balanced" });
  await vercel.generateStream([{ role: "user", content: "hi" }], { effort: "deep" });
  await vercel.generateStream([{ role: "user", content: "hi" }], { effort: "max" });
  assert.deepEqual(calls.map((c) => c.body.reasoning), [
    { effort: "low" }, { effort: "low" }, { effort: "medium" }, { effort: "high" },
  ]);
}));

test("a model that rejects the reasoning setting is retried once without it, and not sent it again", withFetch([
  { status: 400, body: '{"error":{"message":"reasoning is not supported by this model"}}' },
  OK,
  OK,
], async (calls) => {
  config.vercelModel = "openai/gpt-5-mini";
  await vercel.generateStream([{ role: "user", content: "hi" }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.reasoning, { effort: "low" });
  assert.equal(calls[1].body.reasoning, undefined);
  assert.equal(calls[1].body.model, "openai/gpt-5-mini", "the user's model is kept");
  await vercel.generateStream([{ role: "user", content: "hello" }]);
  assert.equal(calls.length, 3, "the next message doesn't pay for the refusal again");
  assert.equal(calls[2].body.reasoning, undefined);
}));

test("a model that doesn't reason is never sent the reasoning setting", withFetch([OK], async (calls) => {
  config.vercelModel = "openai/gpt-4o-mini";
  await vercel.generateStream([{ role: "user", content: "hi" }], { effort: "max" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.reasoning, undefined);
}));

test("reasoning models are recognised so they aren't asked for a <think> block too", () => {
  const saved = config.vercelModel;
  vercel.resetAcceptedModel();
  try {
    for (const model of ["", "openai/gpt-oss-120b", "openai/o3-mini", "openai/gpt-5", "deepseek/deepseek-r1"]) {
      config.vercelModel = model;
      assert.equal(vercel.reasonsNatively(), true, model || "(default model)");
    }
    for (const model of ["openai/gpt-4o-mini", "meta/llama-3.3-70b", "anthropic/claude-3.5-haiku"]) {
      config.vercelModel = model;
      assert.equal(vercel.reasonsNatively(), false, model);
    }
  } finally {
    config.vercelModel = saved;
  }
});
