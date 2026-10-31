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
    config.airouterModel = "";
    airouter.resetResolvedModels();
    global.fetch = async (url, init) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
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

test("streams DeepSeek V4.1 Flash from AI Router", withFetch([OK], async (calls) => {
  await airouter.generateStream([{ role: "user", content: "hi" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.airouter.in/v1/chat/completions");
  assert.equal(calls[0].body.model, "deepseek/deepseek-v4.1-flash");
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].headers.Authorization, "Bearer test-key");
  assert.equal(calls[0].headers["x-api-key"], "test-key");
}));

test("the key fingerprint shows only the last 4 characters and the length", () => {
  const saved = config.airouterApiKey;
  try {
    config.airouterApiKey = ' "Bearer sk-abcdef123456" ';
    assert.equal(airouter.keyFingerprint(), "…3456 (15 chars)");
    config.airouterApiKey = "";
    assert.equal(airouter.keyFingerprint(), "");
  } finally {
    config.airouterApiKey = saved;
  }
});

test("a model name meant for another provider is never sent to AI Router", withFetch([OK], async (calls) => {
  await airouter.generateStream([{ role: "user", content: "hi" }], { model: "openai/gpt-5" });
  assert.equal(calls[0].body.model, airouter.MODEL);
}));

test("a pasted key with quotes and a Bearer prefix is cleaned up", withFetch([OK], async (calls) => {
  config.airouterApiKey = ' "Bearer abc123" ';
  await airouter.generateStream([{ role: "user", content: "hi" }]);
  assert.equal(calls[0].headers.Authorization, "Bearer abc123");
}));

test("errors other than a rate limit are not retried", withFetch([
  { status: 401, body: '{"error":{"message":"Invalid API key"}}' },
], async (calls) => {
  await assert.rejects(airouter.generateStream([{ role: "user", content: "hi" }]), /AI Router service error: 401/);
  assert.equal(calls.length, 1);
}));

const RATE_429 = { status: 429, body: '{"error":{"message":"Rate limit exceeded, retry shortly","type":"rate_limit_exceeded"}}' };

test("a short-lived 429 is retried after a pause instead of failing over", withFetch([
  RATE_429,
  { ...RATE_429, headers: { "retry-after": "0" } },
  OK,
], async (calls) => {
  airouter.setRateLimitDelays([1, 1]);
  try {
    assert.ok(await airouter.generateStream([{ role: "user", content: "hi" }]));
    assert.equal(calls.length, 3);
  } finally {
    airouter.setRateLimitDelays([1500, 3000]);
  }
}));

test("a 429 that outlasts the retries still reaches the orchestrator as a rate limit", withFetch([RATE_429, RATE_429, RATE_429], async () => {
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
  await assert.rejects(airouter.generateStream([{ role: "user", content: "hi" }]), /429/);
  assert.equal(calls.length, 1);
}));

test("no key configured is reported, not sent", withFetch([], async (calls) => {
  config.airouterApiKey = "";
  await assert.rejects(airouter.generateStream([{ role: "user", content: "hi" }]), /not configured/);
  assert.equal(calls.length, 0);
}));

test("complete() returns the reply text for short side tasks", withFetch([
  { status: 200, body: '{"choices":[{"message":{"content":"Paris"}}]}' },
], async (calls) => {
  assert.equal(await airouter.complete([{ role: "user", content: "capital of France?" }], { maxTokens: 10 }), "Paris");
  assert.equal(calls[0].body.model, airouter.MODEL);
  assert.equal(calls[0].body.stream, false);
  assert.equal(calls[0].body.max_tokens, 10);
}));

test("the picker label picks the AI Router model", () => {
  assert.equal(airouter.modelFor("Mercury 2.5"), "inception/mercury-2.5");
  assert.equal(airouter.modelFor("DeepSeek V4.1 Flash"), airouter.MODEL);
  assert.equal(airouter.modelFor("Groq"), null);
});

test("Mercury 2.5 is sent when picked, and DeepSeek otherwise", withFetch([OK, OK], async (calls) => {
  await airouter.generateStream([{ role: "user", content: "hi" }], { airouterModel: airouter.modelFor("Mercury 2.5") });
  await airouter.generateStream([{ role: "user", content: "hi" }]);
  assert.deepEqual(calls.map((c) => c.body.model), ["inception/mercury-2.5", "deepseek/deepseek-v4.1-flash"]);
}));

test("VetroAI is Qwen 3.7 Flash on AI Router", () => {
  assert.equal(airouter.modelFor("VetroAI"), "qwen/qwen3.7-flash");
  assert.equal(airouter.modelFor("vetroai"), "qwen/qwen3.7-flash");
  assert.equal(airouter.modelFor("VetroAI Computer"), null, "only the exact model name");
});

const MODELS = { status: 200, body: JSON.stringify({ data: [{ id: "deepseek-v4.1-flash" }, { id: "mercury-2.5" }, { id: "qwen3.7-flash" }] }) };
const NO_MODEL = { status: 400, body: '{"error":{"message":"model inception/mercury-2.5 does not exist"}}' };

test("a rejected model id is looked up in AI Router's model list, retried, and remembered", withFetch([NO_MODEL, MODELS, OK, OK], async (calls) => {
  const picked = { airouterModel: airouter.modelFor("Mercury 2.5") };
  await airouter.generateStream([{ role: "user", content: "hi" }], picked);
  assert.equal(calls[1].url, "https://api.airouter.in/v1/models");
  assert.equal(calls[2].body.model, "mercury-2.5");
  await airouter.generateStream([{ role: "user", content: "again" }], picked);
  assert.equal(calls.length, 4, "the next message goes straight to the right id");
  assert.equal(calls[3].body.model, "mercury-2.5");
}));

test("with no matching model in the list, the original error reaches the orchestrator", withFetch([
  { status: 404, body: '{"error":{"message":"model qwen/qwen3.7-flash not found"}}' },
  { status: 200, body: JSON.stringify({ data: [{ id: "deepseek-v4.1-flash" }] }) },
], async (calls) => {
  await assert.rejects(airouter.generateStream([{ role: "user", content: "hi" }], { airouterModel: airouter.QWEN_MODEL }), /AI Router service error: 404/);
  assert.equal(calls.length, 2);
}));

test("model names match across AI Router's naming styles", () => {
  assert.equal(airouter.matchModel("qwen/qwen3.7-flash", ["qwen-3.7-plus", "qwen-3.7-flash"]), "qwen-3.7-flash");
  assert.equal(airouter.matchModel("inception/mercury-2.5", ["inception/mercury-coder", "Mercury 2.5"]), "Mercury 2.5");
  assert.equal(airouter.matchModel("deepseek/deepseek-v4.1-flash", ["openai/gpt-5"]), null);
});
