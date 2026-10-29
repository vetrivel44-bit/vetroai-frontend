const test = require("node:test");
const assert = require("node:assert/strict");

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || "test-key";

// Stand-in SDK that records each request and can turn one down as too large.
const sdkPath = require.resolve("groq-sdk");
const requests = [];
let rejectFirst = false;
class FakeGroq {
  constructor() {
    this.models = { list: async () => ({ data: [] }) };
    this.chat = { completions: { create: async (body) => {
      requests.push(body);
      if (rejectFirst) {
        rejectFirst = false;
        throw Object.assign(new Error('413 {"error":{"message":"Request too large for model `llama-3.3-70b-versatile` on tokens per minute (TPM): Limit 12000, Requested 12940"}}'), { status: 413 });
      }
      return (async function* () { yield { choices: [{ delta: { content: "ok" } }] }; })();
    } } };
  }
}
require.cache[sdkPath] = { id: sdkPath, filename: sdkPath, loaded: true, exports: FakeGroq };
delete require.cache[require.resolve("../src/providers/groqAdapter")];
const { generateStream, fitRequest, estimateTokens } = require("../src/providers/groqAdapter");

const sys = { role: "system", content: "s".repeat(10500) }; // ~3k tokens, like VetroAI's prompt
const longAnswer = "a".repeat(14000); // ~4k tokens

test("a Deep/Max turn is fitted under Groq's per-request limit", () => {
  const msgs = [sys, { role: "user", content: "hi" }];
  const out = fitRequest(msgs, 16384, 11000);
  assert.ok(estimateTokens(out.messages) + out.maxTokens <= 11000);
  assert.ok(out.maxTokens >= 1024);
  assert.equal(out.messages.length, 2);
});

test("a short request is left untouched", () => {
  const msgs = [sys, { role: "user", content: "hi" }];
  assert.deepEqual(fitRequest(msgs, 2048, 11000), { messages: msgs, maxTokens: 2048 });
});

test("oldest history is dropped, keeping the system prompt and latest message", () => {
  const msgs = [sys,
    { role: "user", content: "q1" }, { role: "assistant", content: longAnswer },
    { role: "user", content: "q2" }, { role: "assistant", content: longAnswer },
    { role: "user", content: "latest question" }];
  const out = fitRequest(msgs, 4096, 11000);
  assert.ok(estimateTokens(out.messages) + out.maxTokens <= 11000);
  assert.equal(out.messages[0], sys);
  assert.equal(out.messages.at(-1).content, "latest question");
  assert.notEqual(out.messages[1].role, "assistant");
});

test("a 413 'Request too large' is retried once with a smaller request", async () => {
  requests.length = 0;
  rejectFirst = true;
  const stream = await generateStream([sys, { role: "user", content: "hi" }], { maxTokens: 8192 });
  assert.ok(stream);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].max_tokens < requests[0].max_tokens);
});

test("images go to Groq's vision model as image parts, at most the newest three", async () => {
  requests.length = 0;
  const img = (n) => ({ mimeType: "image/png", data: `img${n}` });
  const stream = await generateStream([
    { role: "user", content: "earlier", images: [img(1), img(2)] },
    { role: "assistant", content: "seen" },
    { role: "user", content: "what is in these?", images: [img(3), img(4)] },
  ], { maxTokens: 512 });
  for await (const _ of stream) { /* drain */ }
  const body = requests[0];
  assert.equal(body.model, "qwen/qwen3.8-27b");
  assert.equal(body.reasoning_effort, "none");
  const urls = body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === "image_url").map((p) => p.image_url.url);
  assert.deepEqual(urls, ["data:image/png;base64,img2", "data:image/png;base64,img3", "data:image/png;base64,img4"]);
  assert.ok(body.messages.every((m) => !("images" in m)), "the images key never reaches Groq");
});

test("a light turn asks the model not to reason at length; a text turn keeps its model", async () => {
  requests.length = 0;
  const stream = await generateStream([{ role: "user", content: "hi" }], { maxTokens: 256, light: true, model: "qwen/qwen3.8-27b" });
  for await (const _ of stream) { /* drain */ }
  assert.equal(requests[0].model, "qwen/qwen3.8-27b");
  assert.equal(requests[0].reasoning_effort, "none");
  assert.equal(requests[0].messages[0].content, "hi");
});
