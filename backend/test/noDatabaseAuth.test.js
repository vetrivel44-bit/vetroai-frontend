const test = require("node:test");
const assert = require("node:assert/strict");

// Stand in for Firebase's signature check (it needs Google's live keys), so
// the request looks like a real signed-in user's. Set before the middleware
// is loaded, since it takes these functions when it is required.
const firebaseToken = require("../src/utils/firebaseToken");
firebaseToken.isFirebaseIdToken = () => true;
firebaseToken.verifyFirebaseIdToken = async () => ({
  sub: "firebase-uid-1",
  email: "someone@example.com",
  name: "Someone",
  firebase: { sign_in_provider: "google.com" },
});

const mongoose = require("mongoose");
const app = require("../src/app");

async function startServer(t) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const token = `${b64url({ alg: "RS256", kid: "k" })}.${b64url({ iss: "https://securetoken.google.com/vetroai", sub: "firebase-uid-1" })}.sig`;

test("without a database, a signed-in request goes straight through instead of waiting 10 s", async (t) => {
  assert.notEqual(mongoose.connection.readyState, 1, "this test runs with no database connected");
  const baseUrl = await startServer(t);

  const started = Date.now();
  const res = await fetch(`${baseUrl}/api/billing/me`, { headers: { Authorization: `Bearer ${token}` } });
  const elapsed = Date.now() - started;
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.data.offline, true);
  assert.ok(elapsed < 2000, `answered in ${elapsed} ms`);
});

test("queries against a missing database fail at once rather than queueing", async () => {
  const User = require("../src/models/User");
  const started = Date.now();
  await assert.rejects(User.findOne({ email: "x@example.com" }));
  assert.ok(Date.now() - started < 1000);
});
