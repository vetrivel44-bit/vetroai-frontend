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
    sarvam.resetReplacements();
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
  // Sarvam retired sarvam-30b; a tab still showing "Sarvam 30B" gets 105B.
  assert.equal(sarvam.modelFor("Sarvam 30B"), "sarvam-105b");
  assert.equal(sarvam.modelFor("Sarvam 105B"), "sarvam-105b");
  assert.equal(sarvam.modelFor("Sarvam 105B Chat"), "sarvam-105b-conversations");
  assert.equal(sarvam.modelFor("sarvam"), config.sarvamModel || "sarvam-105b");
  // Any other model leaves the field unset, so no other provider gets it.
  assert.equal(sarvam.modelFor("Mistral"), null);
  assert.equal(sarvam.modelFor(""), null);
});

test("picking Sarvam routes to the sarvam provider once its key is set", () => {
  const saved = config.sarvamApiKey;
  config.sarvamApiKey = "test-key";
  try {
    assert.equal(providerManager.getBestProvider("chat", "Sarvam 105B"), "sarvam");
    assert.equal(providerManager.getBestProvider("chat", "Sarvam 105B Chat"), "sarvam");
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
  assert.ok(await sarvam.generateStream([{ role: "user", content: "vanakkam" }], { sarvamModel: "sarvam-105b", maxTokens: 999999 }));
  assert.equal(calls[0].url, "https://api.sarvam.ai/v1/chat/completions");
  assert.equal(calls[0].headers["api-subscription-key"], "test-key");
  assert.equal(calls[0].body.model, "sarvam-105b");
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

test("Sarvam 105B counts as a balanced model", () => {
  assert.equal(tierFor("Sarvam 105B").tier, "standard");
});

// Sarvam's real reply when sarvam-30b was retired (Render logs, 19 Oct 2026).
const RETIRED_30B = { status: 400, body: '{"error":{"message":"Model \'sarvam-30b\' has been deprecated. Please use one of the available models instead: sarvam-105b, sarvam-105b-conversations.","code":"invalid_request_error","request_id":"20261019_1a31c3cb"}}' };
const OK = { status: 200, body: "data: [DONE]\n\n" };

test("a retired model is swapped for the one Sarvam names, and remembered", withFetch([RETIRED_30B, OK, OK], async (calls) => {
  assert.ok(await sarvam.generateStream([{ role: "user", content: "hi" }], { sarvamModel: "sarvam-30b" }));
  assert.deepEqual(calls.map((c) => c.body.model), ["sarvam-30b", "sarvam-105b"]);
  // The next chat goes straight to the replacement.
  await sarvam.generateStream([{ role: "user", content: "hi again" }], { sarvamModel: "sarvam-30b" });
  assert.deepEqual(calls.map((c) => c.body.model), ["sarvam-30b", "sarvam-105b", "sarvam-105b"]);
}));

test("other 400s are not mistaken for a retired model", withFetch([{ status: 400, body: '{"error":{"message":"messages: first message must be from the user"}}' }], async (calls) => {
  await assert.rejects(sarvam.generateStream([{ role: "user", content: "hi" }]), /400/);
  assert.equal(calls.length, 1);
}));

test("a chat with Sarvam 105B picked is answered by Sarvam, end to end", async (t) => {
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
    body: JSON.stringify({ input: "Say hello in Tamil", provider: "Sarvam 105B", modelLabel: "Sarvam 105B", mode: "normal" }),
  });
  const body = await res.text();
  const events = body.split("\n").filter((l) => l.startsWith("data:")).map((l) => { try { return JSON.parse(l.slice(5)); } catch { return null; } }).filter(Boolean);
  const text = events.filter((e) => e.type === "content").map((e) => e.data).join("");

  assert.ok(sent.length >= 1, "Sarvam was called");
  assert.equal(sent[0].model, "sarvam-105b");
  assert.match(text, /வணக்கம்! நான் VetroAI\./);
  assert.ok(events.some((e) => e.type === "model" && /Sarvam/.test(JSON.stringify(e.data))), "the answering model is reported as Sarvam");
});

test("picked again after failing or timing out, Sarvam is tried first again", () => {
  const saved = config.sarvamApiKey;
  config.sarvamApiKey = "test-key";
  const sarvamState = providerManager.providers.sarvam;
  try {
    // A model or key problem parks a provider for a long time…
    providerManager.suspendProvider("sarvam", "Configuration problem: bad_model", 30 * 60 * 1000);
    assert.equal(sarvamState.isSuspended, true);
    // …but a message sent with Sarvam picked still starts with Sarvam.
    assert.equal(providerManager.getBestProvider("chat", "Sarvam 105B"), "sarvam");
    assert.equal(sarvamState.isSuspended, false);

    // Five timeouts in a row suspend it too; the next pick still tries it.
    for (let i = 0; i < 5; i++) providerManager.updateMetrics("sarvam", false, 30000);
    assert.equal(sarvamState.isSuspended, true);
    assert.equal(providerManager.getBestProvider("chat", "Sarvam 105B"), "sarvam");
  } finally {
    config.sarvamApiKey = saved;
    sarvamState.isSuspended = false;
    sarvamState.consecutiveErrors = 0;
  }
});

test("Auto still skips a Sarvam that is failing", () => {
  const saved = { sarvam: config.sarvamApiKey, cohere: config.cohereApiKey };
  config.sarvamApiKey = "test-key";
  config.cohereApiKey = "test-key";
  const sarvamState = providerManager.providers.sarvam;
  try {
    providerManager.suspendProvider("sarvam", "Configuration problem: bad_model", 30 * 60 * 1000);
    assert.notEqual(providerManager.getBestProvider("chat", "Auto"), "sarvam");
  } finally {
    config.sarvamApiKey = saved.sarvam;
    config.cohereApiKey = saved.cohere;
    sarvamState.isSuspended = false;
    sarvamState.consecutiveErrors = 0;
  }
});

// /api/chat with Sarvam picked, Sarvam's replies scripted one per call. Cohere
// is configured too, so a test can see that no other model was asked.
async function chatWithSarvam(t, replies) {
  const orchestrator = require("../src/services/AIOrchestrator");
  orchestrator.setPickedAloneRetryDelay(1);
  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const saved = { sarvam: config.sarvamApiKey, cohere: config.cohereApiKey };
  const realFetch = global.fetch;
  const calls = { sarvam: 0, other: [] };
  config.sarvamApiKey = "test-key";
  config.cohereApiKey = "test-key";
  sarvam.resetReplacements();
  global.fetch = async (url, init) => {
    const href = String(url);
    if (href.startsWith("http://127.0.0.1")) return realFetch(url, init);
    if (!href.startsWith("https://api.sarvam.ai/")) { calls.other.push(href); throw new Error("no other model should be asked"); }
    const reply = replies[calls.sarvam++];
    return reply();
  };
  t.after(() => {
    global.fetch = realFetch;
    config.sarvamApiKey = saved.sarvam;
    config.cohereApiKey = saved.cohere;
    orchestrator.setPickedAloneRetryDelay(1000);
    const s = providerManager.providers.sarvam;
    s.isSuspended = false;
    s.consecutiveErrors = 0;
  });

  const res = await realFetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: "Hi", provider: "Sarvam 105B", modelLabel: "Sarvam 105B", mode: "normal" }),
  });
  const events = (await res.text()).split("\n").filter((l) => l.startsWith("data:"))
    .map((l) => { try { return JSON.parse(l.slice(5)); } catch { return null; } }).filter(Boolean);
  return {
    calls,
    text: events.filter((e) => e.type === "content").map((e) => e.data).join(""),
    statuses: events.filter((e) => e.type === "status").map((e) => String(e.data)),
    error: events.find((e) => e.type === "error")?.data || "",
  };
}

const sarvamSays = (text) => () => new Response(
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
  { status: 200, headers: { "content-type": "text/event-stream" } },
);
const timesOut = () => { throw new TypeError("fetch failed: Connect Timeout Error"); };
const busy = () => new Response('{"error":{"message":"Too many requests"}}', { status: 429 });

test("picked, a Sarvam timeout is retried on Sarvam — no other model", async (t) => {
  const r = await chatWithSarvam(t, [timesOut, sarvamSays("வணக்கம்!")]);
  assert.equal(r.calls.sarvam, 2);
  assert.deepEqual(r.calls.other, []);
  assert.equal(r.text, "வணக்கம்!");
  assert.ok(r.statuses.some((s) => /Sarvam timed out\. Trying Sarvam again/.test(s)), r.statuses.join(" | "));
});

test("picked, a busy Sarvam is retried on Sarvam too", async (t) => {
  const r = await chatWithSarvam(t, [busy, timesOut, sarvamSays("Hello!")]);
  assert.equal(r.calls.sarvam, 3);
  assert.deepEqual(r.calls.other, []);
  assert.equal(r.text, "Hello!");
});

test("picked, after three failed tries the user is told — still no other model", async (t) => {
  const r = await chatWithSarvam(t, [timesOut, timesOut, timesOut]);
  assert.equal(r.calls.sarvam, 3);
  assert.deepEqual(r.calls.other, []);
  assert.match(r.error, /Sarvam didn't answer after 3 tries/);
});

test("picked, a key problem is reported at once instead of retried", async (t) => {
  const r = await chatWithSarvam(t, [() => new Response('{"error":{"message":"Invalid API key"}}', { status: 401 })]);
  assert.equal(r.calls.sarvam, 1);
  assert.deepEqual(r.calls.other, []);
  assert.ok(r.error, "an error is shown");
});
