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

// ── Firebase ID tokens ────────────────────────────────────────────────────────
// The frontend signs in with Firebase Authentication, so these are the tokens
// protected routes actually receive. A Firebase token is identified by its
// issuer; the danger is treating that issuer claim as proof of anything, since
// the issuer sits in the unsigned payload where anyone can write it.

function forgedFirebaseToken(overrides = {}) {
  const header = b64url({ alg: "RS256", kid: "forged", typ: "JWT" });
  const payload = b64url({
    iss: "https://securetoken.google.com/vetroai",
    aud: "vetroai",
    sub: "attacker-uid",
    email: "victim@example.com",
    name: "Attacker",
    auth_time: Math.floor(Date.now() / 1000),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  });
  return `${header}.${payload}.${"c".repeat(342)}`;
}

test("a forged Firebase ID token is rejected on protected routes", async (t) => {
  const baseUrl = await startServer(t);

  const response = await fetch(`${baseUrl}/api/billing/me`, {
    headers: { Authorization: `Bearer ${forgedFirebaseToken()}` },
  });

  assert.equal(
    response.status,
    401,
    "a token claiming the Firebase issuer must still have its signature verified"
  );
  const body = await response.json();
  assert.equal(body.success, false);
});

test("an alg:none Firebase token is rejected", async (t) => {
  const baseUrl = await startServer(t);

  // The classic JWT downgrade: drop the signature and declare the token
  // unsigned. Verification must reject on the algorithm, before any lookup.
  const header = b64url({ alg: "none", kid: "forged", typ: "JWT" });
  const payload = forgedFirebaseToken().split(".")[1];

  const response = await fetch(`${baseUrl}/api/billing/me`, {
    headers: { Authorization: `Bearer ${header}.${payload}.` },
  });

  assert.equal(response.status, 401);
});

test("a Firebase token issued for another project is rejected", async (t) => {
  const baseUrl = await startServer(t);

  // Valid signature or not, a token minted for someone else's Firebase project
  // must never authenticate here. It fails the issuer match and falls through
  // to the backend's own JWT verifier, which rejects it.
  const response = await fetch(`${baseUrl}/api/billing/me`, {
    headers: {
      Authorization: `Bearer ${forgedFirebaseToken({
        iss: "https://securetoken.google.com/some-other-project",
        aud: "some-other-project",
      })}`,
    },
  });

  assert.equal(response.status, 401);
});
