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
