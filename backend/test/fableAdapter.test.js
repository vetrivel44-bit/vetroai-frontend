const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFablePrompt,
  extractFableText,
} = require("../src/providers/fableAdapter");

test("buildFablePrompt converts recent conversation messages into one prompt", () => {
  const prompt = buildFablePrompt([
    { role: "system", content: "Be concise." },
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi!" },
    { role: "user", content: "Explain queues." },
  ]);

  assert.equal(
    prompt,
    "User: Hello\n\nAssistant: Hi!\n\nUser: Explain queues.\n\nAssistant:"
  );
});

test("extractFableText handles common RapidAPI response envelopes", () => {
  assert.equal(extractFableText({ result: "Done" }), "Done");
  assert.equal(extractFableText({ data: { response: { content: "Nested" } } }), "Nested");
  assert.equal(
    extractFableText({ choices: [{ message: { content: "Compatible" } }] }),
    "Compatible"
  );
});
