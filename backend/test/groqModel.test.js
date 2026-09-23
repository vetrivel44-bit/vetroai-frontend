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
