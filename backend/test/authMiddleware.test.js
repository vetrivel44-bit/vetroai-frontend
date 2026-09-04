const test = require("node:test");
const assert = require("node:assert/strict");

const app = require("../src/app");

async function startServer(t) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

// A JWT nobody signed, claiming to come from Google. The old middleware
// base64-decoded the payload and trusted it, so this authenticated the bearer
// as victim@example.com on every protected route.
function forgedGoogleToken(email) {
  const header = b64url({ alg: "RS256", kid: "forged", typ: "JWT" });
  const payload = b64url({
    iss: "https://accounts.google.com",
    sub: "999999999999999999",
    email,
    name: "Attacker",
    aud: "whatever",
    exp: Math.floor(Date.now() / 1000) + 3600,
    padding: "x".repeat(400), // clears the old length>400 heuristic
  });
  return `${header}.${payload}.${"c".repeat(342)}`;
}

test("a forged Google ID token is rejected on protected routes", async (t) => {
  const baseUrl = await startServer(t);

  const response = await fetch(`${baseUrl}/api/billing/me`, {
    headers: { Authorization: `Bearer ${forgedGoogleToken("victim@example.com")}` },
  });

  assert.equal(response.status, 401, "an unsigned Google-issuer token must not authenticate");
  const body = await response.json();
  assert.equal(body.success, false);
});

test("a garbage bearer token is rejected", async (t) => {
  const baseUrl = await startServer(t);

  const response = await fetch(`${baseUrl}/api/billing/me`, {
    headers: { Authorization: "Bearer not-a-real-token" },
  });

  assert.equal(response.status, 401);
});

test("a missing Authorization header is rejected", async (t) => {
  const baseUrl = await startServer(t);

  const response = await fetch(`${baseUrl}/api/billing/me`);

  assert.equal(response.status, 401);
});
