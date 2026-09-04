const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const app = require("../src/app");

function clearProviderKeys() {
  for (const key of [
    "chatgptApiKey",
    "groqApiKey",
    "mistralApiKey",
    "agnesApiKey",
    "sambanovaApiKey",
    "geminiApiKey",
  ]) config[key] = "";
}

async function startServer(t) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("chat returns a clear SSE error when no AI provider is configured", async (t) => {
  clearProviderKeys();
  const baseUrl = await startServer(t);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: "Hello", provider: "Auto", mode: "normal" }),
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  assert.match(body, /not configured with an AI provider/i);
});

test("title and follow-up endpoints remain usable without Groq", async (t) => {
  clearProviderKeys();
  const baseUrl = await startServer(t);

  const titleResponse = await fetch(`${baseUrl}/api/generate-title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstMessage: "Explain operating system deadlock prevention" }),
  });
  const titleBody = await titleResponse.json();
  assert.equal(titleResponse.status, 200);
  assert.match(titleBody.data.title, /deadlock prevention/i);

  const followUpResponse = await fetch(`${baseUrl}/api/follow-ups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lastMessage: "A deadlock occurs when processes wait forever.", userQuery: "What is deadlock?" }),
  });
  const followUpBody = await followUpResponse.json();
  assert.equal(followUpResponse.status, 200);
  assert.deepEqual(followUpBody.data.suggestions, []);
});

test("processRequest reports failure when no provider is configured, so the turn is not billed", async () => {
  clearProviderKeys();
  config.fableRapidApiKey = "";
  config.plugskyApiKey = "";
  const orchestrator = require("../src/services/AIOrchestrator");

  const written = [];
  const res = { write: (chunk) => written.push(chunk), end: () => {}, writableEnded: false };

  const answered = await orchestrator.processRequest("test_req", {
    messages: [{ role: "user", content: "Hello" }],
    mode: "normal",
    options: { temperature: 0.7, maxTokens: 256 },
  }, res);

  assert.equal(answered, false, "an unanswered turn must not report success");
  assert.match(written.join(""), /not configured with an AI provider/i);
});
