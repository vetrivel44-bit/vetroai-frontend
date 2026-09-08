const test = require("node:test");
const assert = require("node:assert/strict");

const app = require("../src/app");

async function startServer(t) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

const post = (baseUrl, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("config reports the phase and which providers are usable", async (t) => {
  const baseUrl = await startServer(t);
  const response = await fetch(`${baseUrl}/api/call-assistant/config`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.phase, 1);
  assert.equal(body.data.mode, "post-call-analysis");
  assert.equal(body.data.capabilities.analysis.available, true);
});

test("analysis works with no provider configured and returns a redacted transcript", async (t) => {
  const baseUrl = await startServer(t);
  const response = await post(baseUrl, "/api/call-assistant/analyze", {
    turns: [
      { speaker: "caller", text: "This is your bank, share the OTP now or your account will be blocked in 5 minutes" },
      { speaker: "user", text: "it is 4 5 8 2 1 9" },
    ],
    callerNumber: "+919994777865",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.riskLevel, "critical");
  assert.equal(body.data.action, "mute_outbound");
  assert.equal(body.data.turns[1].text.includes("4"), false);
  assert.equal(JSON.stringify(body).includes("458219"), false);
});

test("analyze rejects a request with no turns", async (t) => {
  const baseUrl = await startServer(t);
  const response = await post(baseUrl, "/api/call-assistant/analyze", { turns: [] });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.data.code, "TURNS_REQUIRED");
});

test("translate refuses text that still carries a code, before any provider call", async (t) => {
  const baseUrl = await startServer(t);
  const response = await post(baseUrl, "/api/call-assistant/translate", {
    texts: ["the otp is 4 5 8 2 1 9"],
    targetLanguage: "ta",
  });
  const body = await response.json();

  // 422 from the guard, not 501 from the missing key: the refusal to transmit
  // is checked before the provider is even considered.
  assert.equal(response.status, 422);
  assert.equal(body.data.code, "SENSITIVE_TEXT_BLOCKED");
});
