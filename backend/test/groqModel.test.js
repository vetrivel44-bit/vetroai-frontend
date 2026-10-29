const test = require("node:test");
const assert = require("node:assert/strict");

const { withGroqModel } = require("../src/utils/groqModel");

const notFound = (model) => Object.assign(
  new Error(`404 {"error":{"message":"The model \`${model}\` does not exist or you do not have access to it.","code":"model_not_found"}}`),
  { status: 404 }
);

function fakeClient(available) {
  return { models: { list: async () => ({ data: available.map((id) => ({ id, active: true })) }) } };
}

test("a retired model is swapped for an available one and remembered", async () => {
  const client = fakeClient(["whisper-large-v3", "openai/gpt-oss-120b", "llama-3.1-8b-instant"]);
  const tried = [];
  const call = async (model) => {
    tried.push(model);
    if (model === "retired-model-a") throw notFound(model);
    return `ok:${model}`;
  };

  assert.equal(await withGroqModel(client, "retired-model-a", call), "ok:openai/gpt-oss-120b");
  assert.equal(await withGroqModel(client, "retired-model-a", call), "ok:openai/gpt-oss-120b");
  assert.deepEqual(tried, ["retired-model-a", "openai/gpt-oss-120b", "openai/gpt-oss-120b"]);
});

test("other errors are passed through without switching models", async () => {
  const client = fakeClient(["openai/gpt-oss-120b"]);
  const rateLimited = Object.assign(new Error("429 rate limit"), { status: 429 });
  await assert.rejects(withGroqModel(client, "retired-model-b", async () => { throw rateLimited; }), /429/);
});

const dailyLimit = (model) => Object.assign(
  new Error(`429 {"error":{"message":"Rate limit reached for model \`${model}\` in organization \`org_x\` service tier \`on_demand\` on tokens per day (TPD): Limit 200000, Used 198823, Requested 3126. Please try again in 14m1.968s.","type":"tokens","code":"rate_limit_exceeded"}}`),
  { status: 429 }
);

test("a model that used up its daily tokens hands over to another Groq model", async () => {
  const { _exhaustedUntil } = require("../src/utils/groqModel");
  _exhaustedUntil.clear();
  const client = fakeClient(["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "whisper-large-v3"]);
  const tried = [];
  const call = async (model) => {
    tried.push(model);
    if (model === "openai/gpt-oss-120b") throw dailyLimit(model);
    return `ok:${model}`;
  };

  assert.equal(await withGroqModel(client, "openai/gpt-oss-120b", call), "ok:llama-3.3-70b-versatile");
  // The next request skips the exhausted model straight away.
  assert.equal(await withGroqModel(client, "openai/gpt-oss-120b", call), "ok:llama-3.3-70b-versatile");
  assert.deepEqual(tried, ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "llama-3.3-70b-versatile"]);
});

test("when every Groq model is out for the day, the error is passed on", async () => {
  const { _exhaustedUntil } = require("../src/utils/groqModel");
  _exhaustedUntil.clear();
  const client = fakeClient(["openai/gpt-oss-120b", "llama-3.3-70b-versatile"]);
  await assert.rejects(withGroqModel(client, "openai/gpt-oss-120b", async (m) => { throw dailyLimit(m); }), /tokens per day/);
});

test("the reset time is read from Groq's message", () => {
  const { dailyLimitResetMs } = require("../src/utils/groqModel");
  assert.equal(Math.round(dailyLimitResetMs(dailyLimit("m")) / 1000), 842);
  assert.equal(dailyLimitResetMs(Object.assign(new Error("429 rate limit per minute"), { status: 429 })), null);
});

test("a vision request is only moved to another model that can see", async () => {
  const { _replacements, _exhaustedUntil } = require("../src/utils/groqModel");
  _replacements.clear();
  _exhaustedUntil.clear(); // an earlier test used up gpt-oss-120b's day
  // The preview vision model is gone; only text-only models remain.
  const client = fakeClient(["openai/gpt-oss-120b", "llama-3.1-8b-instant"]);
  const call = async (model) => { if (model === "qwen/qwen3.8-27b") throw notFound(model); return `ok:${model}`; };
  await assert.rejects(withGroqModel(client, "qwen/qwen3.8-27b", call, { candidates: ["qwen/qwen3.8-27b"] }), /does not exist/);
  // A text request with the same model may still move on.
  assert.equal(await withGroqModel(client, "qwen/qwen3.8-27b", call), "ok:openai/gpt-oss-120b");
});

test("quiet reasoning: off for Qwen, low for gpt-oss, nothing for others", () => {
  const { quietReasoning } = require("../src/utils/groqModel");
  assert.deepEqual(quietReasoning("qwen/qwen3.8-27b"), { reasoning_effort: "none" });
  assert.deepEqual(quietReasoning("openai/gpt-oss-120b"), { reasoning_effort: "low" });
  assert.deepEqual(quietReasoning("llama-3.1-8b-instant"), {});
});

test("the preferred list no longer leads with models Groq shut down", () => {
  const { PREFERRED_MODELS } = require("../src/utils/groqModel");
  assert.equal(PREFERRED_MODELS[0], "openai/gpt-oss-120b");
  for (const gone of ["qwen/qwen3-32b", "meta-llama/llama-4-scout-17b-16e-instruct"]) assert.ok(!PREFERRED_MODELS.includes(gone), gone);
});
