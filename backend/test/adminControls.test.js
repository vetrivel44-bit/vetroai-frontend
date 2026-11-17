const test = require("node:test");
const assert = require("node:assert/strict");

// Firebase's signature check needs Google's live keys: stand in for it, with
// the uid taken from the token so each test can be a different person.
const firebaseToken = require("../src/utils/firebaseToken");
firebaseToken.isFirebaseIdToken = () => true;
firebaseToken.verifyFirebaseIdToken = async (token) => {
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  return { sub: payload.sub, email: `${payload.sub}@example.com`, firebase: { sign_in_provider: "google.com" } };
};

const moderation = require("../src/services/moderationService");
const { describeAgent } = require("../src/controllers/deviceController");
const app = require("../src/app");

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const tokenFor = (uid) => `${b64url({ alg: "RS256", kid: "k" })}.${b64url({ iss: "https://securetoken.google.com/vetroai", sub: uid })}.sig`;

// A pretend Firestore: path → document fields (already in REST form).
function fakeFirestore(docs) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const path = decodeURIComponent(String(url).split("/documents/")[1] || "").split("?")[0];
    if (!(path in docs)) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ fields: docs[path] }), { status: 200 });
  };
  return { fetchImpl, calls };
}

async function startServer(t) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("a made-up local_ token no longer counts as a signed-in user", async (t) => {
  moderation._reset({ enabled: false });
  const base = await startServer(t);
  const res = await fetch(`${base}/api/billing/me`, { headers: { Authorization: "Bearer local_anything" } });
  assert.equal(res.status, 401);
});

test("a blocked account is refused on signed-in routes, even ones open to visitors", async (t) => {
  const { fetchImpl } = fakeFirestore({ "moderation/bad-user": { blocked: { booleanValue: true }, reason: { stringValue: "spam" } } });
  moderation._reset({ enabled: true, fetchImpl });
  const base = await startServer(t);

  const res = await fetch(`${base}/api/billing/me`, { headers: { Authorization: `Bearer ${tokenFor("bad-user")}` } });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.data?.code, "ACCOUNT_BLOCKED");

  // Usage is open to visitors (optionalAuth): a blocked account must not
  // fall back to being one.
  const usage = await fetch(`${base}/api/usage`, { headers: { Authorization: `Bearer ${tokenFor("bad-user")}` } });
  assert.equal(usage.status, 403);

  const ok = await fetch(`${base}/api/billing/me`, { headers: { Authorization: `Bearer ${tokenFor("good-user")}` } });
  assert.equal(ok.status, 200);
});

test("a Firestore outage lets people through instead of locking everyone out", async (t) => {
  moderation._reset({ enabled: true, fetchImpl: async () => { throw new Error("network down"); } });
  const base = await startServer(t);
  const res = await fetch(`${base}/api/billing/me`, { headers: { Authorization: `Bearer ${tokenFor("anyone")}` } });
  assert.equal(res.status, 200);
});

test("maintenance mode answers 503 to everyone but admins, and health checks still pass", async (t) => {
  const { fetchImpl } = fakeFirestore({
    "config/app": { maintenance: { mapValue: { fields: { on: { booleanValue: true }, message: { stringValue: "Back at 6pm" } } } } },
    "admins/the-admin": { addedBy: { stringValue: "console" } },
  });
  moderation._reset({ enabled: true, fetchImpl });
  const base = await startServer(t);

  const visitor = await fetch(`${base}/api/usage`);
  assert.equal(visitor.status, 503);
  assert.equal((await visitor.json()).message, "Back at 6pm");

  const user = await fetch(`${base}/api/billing/me`, { headers: { Authorization: `Bearer ${tokenFor("someone")}` } });
  assert.equal(user.status, 503);

  const adminRes = await fetch(`${base}/api/billing/me`, { headers: { Authorization: `Bearer ${tokenFor("the-admin")}` } });
  assert.equal(adminRes.status, 200);

  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test("the admin API is for admins only", async (t) => {
  const { fetchImpl } = fakeFirestore({ "admins/the-admin": { addedBy: { stringValue: "console" } } });
  moderation._reset({ enabled: true, fetchImpl });
  const base = await startServer(t);

  assert.equal((await fetch(`${base}/api/admin/status`)).status, 401);
  const notAdmin = await fetch(`${base}/api/admin/status`, { headers: { Authorization: `Bearer ${tokenFor("someone")}` } });
  assert.equal(notAdmin.status, 403);

  const res = await fetch(`${base}/api/admin/status`, { headers: { Authorization: `Bearer ${tokenFor("the-admin")}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.serviceAccount, false);

  // Account controls explain what they need instead of failing vaguely.
  const disable = await fetch(`${base}/api/admin/users/someone/disable`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor("the-admin")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ disabled: true }),
  });
  assert.equal(disable.status, 501);
  assert.equal((await disable.json()).data?.code, "NO_SERVICE_ACCOUNT");
});

test("devices are described in plain words and IPs become safe document ids", () => {
  assert.deepEqual(describeAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"), { browser: "Chrome", os: "Windows", mobile: false });
  assert.deepEqual(describeAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), { browser: "Safari", os: "iOS", mobile: true });
  assert.equal(moderation.ipKey("::ffff:203.0.113.9"), "203_0_113_9");
  assert.equal(moderation.ipKey("2001:DB8::1"), "2001_db8__1");
});
