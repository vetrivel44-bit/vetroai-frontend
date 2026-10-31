const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const airouter = require("../src/providers/airouterAdapter");

function withFetch(responses, fn) {
  return async () => {
    const calls = [];
    const originalFetch = global.fetch;
    const saved = { key: config.airouterApiKey, model: config.airouterModel };
    config.airouterApiKey = "test-key";
    airouter.resetAcceptedModel();
    global.fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      const next = responses.shift();
      return new Response(next.body, { status: next.status, headers: next.headers });
    };
    try {
      await fn(calls);
    } finally {
      global.fetch = originalFetch;
      config.airouterApiKey = saved.key;
      config.airouterModel = saved.model;
    }
  };
}

const OK = { status: 200, body: "data: [DONE]\n\n" };

test("streams from AI Router with the default model", withFetch([OK], async (calls) => {
  config.airouterModel = "";
  await airouter.generateStream([{ role: "user", content: "hi" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.ai-router.dev/v1/chat/completions");
  assert.equal(calls[0].body.model, airouter.DEFAULT_MODEL);
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].headers.Authorization, "Bearer test-key");
}));

test("a pasted key with quotes and a Bearer prefix is cleaned up", withFetch([OK], async (calls) => {
  config.airouterApiKey = ' "Bearer abc123" ';
  await airouter.generateStream([{ role: "user", content: "hi" }]);
  assert.equal(calls[0].headers.Authorization, "Bearer abc123");
}));

test("a rejected model name is retried once with the default model, and remembered", withFetch([
  { status: 404, body: '{"error":{"message":"Model not found: acme/unknown","type":"model_not_found"}}' },
  OK,
  OK,
], async (calls) => {
  config.airouterModel = "acme/unknown";
  await airouter.generateStream([{ role: "user", content: "hi" }]);
  await airouter.generateStream([{ role: "user", content: "again" }]);
  assert.deepEqual(calls.map((c) => c.body.model), ["acme/unknown", airouter.DEFAULT_MODEL, airouter.DEFAULT_MODEL]);
}));

test("errors unrelated to the model are not retried", withFetch([
  { status: 401, body: '{"error":{"message":"Invalid API key"}}' },
], async (calls) => {
  config.airouterModel = "openai/gpt-oss-120b";
  await assert.rejects(airouter.generateStream([{ role: "user", content: "hi" }]), /AI Router service error: 401/);
  assert.equal(calls.length, 1);
}));

const RATE_429 = { status: 429, body: '{"error":{"message":"Rate limit exceeded, retry shortly","type":"rate_limit_exceeded"}}' };

test("a short-lived 429 is retried after a pause instead of failing over", withFetch([
  RATE_429,
  { ...RATE_429, headers: { "retry-after": "0" } },
  OK,
], async (calls) => {
  config.airouterModel = "";
  airouter.setRateLimitDelays([1, 1]);
  try {
    assert.ok(await airouter.generateStream([{ role: "user", content: "hi" }]));
    assert.equal(calls.length, 3);
  } finally {
    airouter.setRateLimitDelays([1500, 3000]);
  }
}));

test("a 429 that outlasts the retries still reaches the orchestrator as a rate limit", withFetch([RATE_429, RATE_429, RATE_429], async () => {
  config.airouterModel = "";
  airouter.setRateLimitDelays([1, 1]);
  try {
    await assert.rejects(airouter.generateStream([{ role: "user", content: "hi" }]), /AI Router service error: 429/);
  } finally {
    airouter.setRateLimitDelays([1500, 3000]);
  }
}));

test("a credit or spend limit is not retried — waiting seconds won't clear it", withFetch([
  { status: 429, body: '{"error":{"message":"Insufficient credits. Add credits to continue."}}' },
], async (calls) => {
  config.airouterModel = "";
  await assert.rejects(airouter.generateStream([{ role: "user", content: "hi" }]), /429/);
  assert.equal(calls.length, 1);
}));

test("no key configured is reported, not sent", withFetch([], async (calls) => {
  config.airouterApiKey = "";
  await assert.rejects(airouter.generateStream([{ role: "user", content: "hi" }]), /not configured/);
  assert.equal(calls.length, 0);
}));

test("the default effort asks for light reasoning, and Deep or Max ask for more", withFetch([OK, OK, OK, OK], async (calls) => {
  config.airouterModel = "";
  await airouter.generateStream([{ role: "user", content: "hi" }]);
  await airouter.generateStream([{ role: "user", content: "hi" }], { effort: "balanced" });
  await airouter.generateStream([{ role: "user", content: "hi" }], { effort: "deep" });
  await airouter.generateStream([{ role: "user", content: "hi" }], { effort: "max" });
  assert.deepEqual(calls.map((c) => c.body.reasoning), [
    { effort: "low" }, { effort: "low" }, { effort: "medium" }, { effort: "high" },
  ]);
}));

test("a model that rejects the reasoning setting is retried once without it, and not sent it again", withFetch([
  { status: 400, body: '{"error":{"message":"reasoning is not supported by this model"}}' },
  OK,
  OK,
], async (calls) => {
  config.airouterModel = "openai/gpt-5-mini";
  await airouter.generateStream([{ role: "user", content: "hi" }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body.reasoning, { effort: "low" });
  assert.equal(calls[1].body.reasoning, undefined);
  assert.equal(calls[1].body.model, "openai/gpt-5-mini", "the user's model is kept");
  await airouter.generateStream([{ role: "user", content: "hello" }]);
  assert.equal(calls.length, 3, "the next message doesn't pay for the refusal again");
  assert.equal(calls[2].body.reasoning, undefined);
}));

test("a model that doesn't reason is never sent the reasoning setting", withFetch([OK], async (calls) => {
  config.airouterModel = "openai/gpt-4o-mini";
  await airouter.generateStream([{ role: "user", content: "hi" }], { effort: "max" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.reasoning, undefined);
}));

test("reasoning models are recognised so they aren't asked for a <think> block too", () => {
  const saved = config.airouterModel;
  airouter.resetAcceptedModel();
  try {
    for (const model of ["", "openai/gpt-oss-120b", "openai/o3-mini", "openai/gpt-5", "deepseek/deepseek-r1"]) {
      config.airouterModel = model;
      assert.equal(airouter.reasonsNatively(), true, model || "(default model)");
    }
    for (const model of ["openai/gpt-4o-mini", "meta/llama-3.3-70b", "anthropic/claude-3.5-haiku"]) {
      config.airouterModel = model;
      assert.equal(airouter.reasonsNatively(), false, model);
    }
  } finally {
    config.airouterModel = saved;
  }
});

test("complete() returns the reply text for short side tasks", withFetch([
  { status: 200, body: '{"choices":[{"message":{"content":"Paris"}}]}' },
], async (calls) => {
  config.airouterModel = "";
  assert.equal(await airouter.complete([{ role: "user", content: "capital of France?" }], { maxTokens: 10 }), "Paris");
  assert.equal(calls[0].body.stream, false);
  assert.equal(calls[0].body.max_tokens, 10);
  assert.equal(calls[0].body.reasoning, undefined);
}));
