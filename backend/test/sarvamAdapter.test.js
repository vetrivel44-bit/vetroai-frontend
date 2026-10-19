const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const sarvam = require("../src/providers/sarvamAdapter");
const providerManager = require("../src/services/ProviderManager");
const { tierFor } = require("../src/config/usageLimits");

function withFetch(responses, fn) {
  return async () => {
    const calls = [];
    const originalFetch = global.fetch;
    const saved = { key: config.sarvamApiKey, model: config.sarvamModel };
    config.sarvamApiKey = "test-key";
    config.sarvamModel = "sarvam-105b";
    global.fetch = async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      const next = responses.shift();
      return new Response(next.body, { status: next.status });
    };
    try {
      await fn(calls);
    } finally {
      global.fetch = originalFetch;
      config.sarvamApiKey = saved.key;
      config.sarvamModel = saved.model;
    }
  };
}

test("the picker's names choose the Sarvam model", () => {
  assert.equal(sarvam.modelFor("Sarvam 30B"), "sarvam-30b");
  assert.equal(sarvam.modelFor("Sarvam 105B"), "sarvam-105b");
  assert.equal(sarvam.modelFor("sarvam"), config.sarvamModel || "sarvam-105b");
  // Any other model leaves the field unset, so no other provider gets it.
  assert.equal(sarvam.modelFor("Mistral"), null);
  assert.equal(sarvam.modelFor(""), null);
});

test("picking Sarvam routes to the sarvam provider once its key is set", () => {
  const saved = config.sarvamApiKey;
  config.sarvamApiKey = "test-key";
  try {
    assert.equal(providerManager.getBestProvider("chat", "Sarvam 30B"), "sarvam");
    assert.equal(providerManager.getBestProvider("chat", "Sarvam 105B"), "sarvam");
  } finally {
    config.sarvamApiKey = saved;
  }
  assert.equal(providerManager.isConfigured("sarvam"), Boolean(saved));
});

test("history is folded into alternating turns with one system message first", () => {
  const shaped = sarvam.shapeMessages([
    { role: "system", content: "Be brief." },
    { role: "assistant", content: "Hello!" },
    { role: "user", content: "Hi" },
    { role: "user", content: "Are you there?" },
    { role: "system", content: "Answer in Tamil." },
    { role: "assistant", content: "" },
    { role: "assistant", content: "ஆம்" },
  ]);
  assert.deepEqual(shaped.map((m) => m.role), ["system", "user", "assistant", "user", "assistant"]);
  assert.equal(shaped[0].content, "Be brief.\n\nAnswer in Tamil.");
  assert.equal(shaped[3].content, "Hi\n\nAre you there?");
});

test("a chat streams from Sarvam with the chosen model and the key in its header", withFetch([{ status: 200, body: "data: [DONE]\n\n" }], async (calls) => {
  assert.ok(await sarvam.generateStream([{ role: "user", content: "vanakkam" }], { sarvamModel: "sarvam-30b", maxTokens: 999999 }));
  assert.equal(calls[0].url, "https://api.sarvam.ai/v1/chat/completions");
  assert.equal(calls[0].headers["api-subscription-key"], "test-key");
  assert.equal(calls[0].body.model, "sarvam-30b");
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].body.max_tokens, 16384);
}));

test("without a model chosen, the configured default is used", withFetch([{ status: 200, body: "data: [DONE]\n\n" }], async (calls) => {
  await sarvam.generateStream([{ role: "user", content: "hi" }]);
  assert.equal(calls[0].body.model, "sarvam-105b");
}));

test("a rejected request fails with Sarvam's status, so the fallback chain takes over", withFetch([{ status: 401, body: '{"error":{"message":"Invalid API key"}}' }], async () => {
  await assert.rejects(sarvam.generateStream([{ role: "user", content: "hi" }]), (err) => err.statusCode === 401 || /401/.test(err.message));
}));

test("no key, no request", async () => {
  const saved = config.sarvamApiKey;
  config.sarvamApiKey = "";
  try {
    await assert.rejects(sarvam.generateStream([{ role: "user", content: "hi" }]), /not configured/);
  } finally {
    config.sarvamApiKey = saved;
  }
});

test("Sarvam 105B counts as a balanced model, 30B as a fast one", () => {
  assert.equal(tierFor("Sarvam 105B").tier, "standard");
  assert.equal(tierFor("Sarvam 30B").tier, "light");
});

test("a chat with Sarvam 30B picked is answered by Sarvam, end to end", async (t) => {
  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const saved = config.sarvamApiKey;
  const realFetch = global.fetch;
  const sent = [];
  config.sarvamApiKey = "test-key";
  global.fetch = async (url, init) => {
    if (!String(url).startsWith("https://api.sarvam.ai/")) return realFetch(url, init);
    sent.push(JSON.parse(init.body));
    const frames = ["வணக்கம்! ", "நான் VetroAI."].map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
    return new Response(frames.join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  t.after(() => { global.fetch = realFetch; config.sarvamApiKey = saved; });

  const res = await realFetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: "Say hello in Tamil", provider: "Sarvam 30B", modelLabel: "Sarvam 30B", mode: "normal" }),
  });
  const body = await res.text();
  const events = body.split("\n").filter((l) => l.startsWith("data:")).map((l) => { try { return JSON.parse(l.slice(5)); } catch { return null; } }).filter(Boolean);
  const text = events.filter((e) => e.type === "content").map((e) => e.data).join("");

  assert.ok(sent.length >= 1, "Sarvam was called");
  assert.equal(sent[0].model, "sarvam-30b");
  assert.match(text, /வணக்கம்! நான் VetroAI\./);
  assert.ok(events.some((e) => e.type === "model" && /Sarvam/.test(JSON.stringify(e.data))), "the answering model is reported as Sarvam");
});
