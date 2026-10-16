const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

process.env.USAGE_STORE_FILE = path.join(os.tmpdir(), `vetroai-usage-test-${process.pid}.json`);
const usage = require("../src/services/usageService");
const { SESSION_MS, WEEK_MS, limitsFor, tierFor } = require("../src/config/usageLimits");

const T0 = Date.UTC(2026, 9, 16, 9, 0); // 16 Oct 2026, 09:00 UTC
const HOUR = 3600e3;
let n = 0;
const key = () => `test:${process.pid}:${++n}`;

test("models are weighted by how heavy they are", () => {
  assert.deepEqual(["Groq", "GPT-5.6 Luna", "Claude Haiku 4.5", "Auto"].map((m) => tierFor(m).weight), [1, 1, 1, 1]);
  assert.deepEqual(["Claude Sonnet 5", "GPT-5.6 Terra", "DeepSeek V4 Pro"].map((m) => tierFor(m).weight), [2, 2, 2]);
  assert.deepEqual(["Claude Opus 5", "GPT-5.6 Sol", "DeepSearch", "Claude Fable 5"].map((m) => tierFor(m).tier), ["premium", "premium", "premium", "premium"]);
});

test("a session starts with the first message and resets 5 hours later", async () => {
  const k = key();
  const before = await usage.check(k, "free", "Groq", T0);
  assert.equal(before.summary.session.used, 0);
  assert.equal(before.summary.session.resetsAt, null, "no window until a message is sent");

  await usage.record(k, "free", "Groq", T0);
  const s = await usage.record(k, "free", "Claude Sonnet 5", T0 + HOUR);
  assert.equal(s.session.used, 3);
  assert.equal(s.session.resetsAt, T0 + SESSION_MS, "from the first message, not the latest");
  assert.equal(s.weekly.resetsAt, T0 + WEEK_MS);
  assert.deepEqual(s.models.map((m) => [m.model, m.messages]), [["Claude Sonnet 5", 1], ["Groq", 1]]);

  // After the reset, the session is empty again but the week still counts.
  const later = (await usage.check(k, "free", "Groq", T0 + SESSION_MS + 1)).summary;
  assert.equal(later.session.used, 0);
  assert.equal(later.session.resetsAt, null);
  assert.equal(later.weekly.used, 3);
  const next = await usage.record(k, "free", "Groq", T0 + 6 * HOUR);
  assert.equal(next.session.resetsAt, T0 + 6 * HOUR + SESSION_MS, "a new session starts with the next message");
});

test("hitting the session limit blocks until it resets, and says when", async () => {
  const k = key();
  const { session } = limitsFor("free");
  for (let i = 0; i < session; i++) await usage.record(k, "free", "Groq", T0 + i * 1000);
  const blocked = await usage.check(k, "free", "Groq", T0 + HOUR);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.block.window, "session");
  assert.equal(blocked.block.resetsAt, T0 + SESSION_MS);
  assert.equal(usage.limitMessage(blocked.block, "Groq", T0 + HOUR), "You've reached your 5-hour usage limit. It resets in 4 hr.");
  assert.equal((await usage.check(k, "free", "Groq", T0 + SESSION_MS)).allowed, true, "free again at the reset time");
});

test("the most capable models share their own weekly cap", async () => {
  const k = key();
  const { premiumWeekly } = limitsFor("free");
  // Spread over several sessions so only the premium cap is reached.
  for (let i = 0; i < premiumWeekly / 4; i++) await usage.record(k, "free", "Claude Opus 5", T0 + i * 6 * HOUR);
  const now = T0 + (premiumWeekly / 4) * 6 * HOUR;
  const opus = await usage.check(k, "free", "Claude Opus 5", now);
  assert.equal(opus.allowed, false);
  assert.equal(opus.block.window, "premium");
  assert.match(usage.limitMessage(opus.block, "Claude Opus 5", now), /weekly limit for the most capable models.*lighter model than Claude Opus 5/);
  assert.equal((await usage.check(k, "free", "Groq", now)).allowed, true, "lighter models still work");
});

test("consume checks and counts in one step", async () => {
  const k = key();
  const first = await usage.consume(k, "free", "GPT-5.6 Luna", T0);
  assert.equal(first.allowed, true);
  assert.equal(first.summary.session.used, 1);
  const { session } = limitsFor("free");
  for (let i = 1; i < session; i++) await usage.consume(k, "free", "GPT-5.6 Luna", T0 + i);
  const last = await usage.consume(k, "free", "GPT-5.6 Luna", T0 + 2 * HOUR);
  assert.equal(last.allowed, false);
  assert.equal(last.summary.session.used, session, "a refused message isn't counted");
});

test("messages sent at the same moment can't both slip under the limit", async () => {
  const k = key();
  const { session } = limitsFor("free");
  for (let i = 0; i < session - 1; i++) await usage.record(k, "free", "Groq", T0 + i);
  const results = await Promise.all([1, 2, 3].map(() => usage.consume(k, "free", "Groq", T0 + HOUR)));
  assert.deepEqual(results.map((r) => r.allowed), [true, false, false]);
});

test("pro plans get more room", () => {
  assert.ok(limitsFor("pro").session > limitsFor("free").session);
  assert.deepEqual(limitsFor("nonsense"), limitsFor("free"));
});

test("signed-in people are counted by account, visitors by address", () => {
  assert.deepEqual(usage.identityOf({ user: { _id: "507f1f77bcf86cd799439011", plan: "pro" }, headers: {} }), { key: "user:507f1f77bcf86cd799439011", plan: "pro", signedIn: true, cloud: null });
  assert.deepEqual(usage.identityOf({ user: { id: "firebaseUid123", isFirebase: true }, headers: {} }), { key: "uid:firebaseUid123", plan: "free", signedIn: true, cloud: null });
  assert.deepEqual(usage.identityOf({ user: { id: "firebaseUid123", isFirebase: true }, firebaseAuth: { uid: "firebaseUid123", token: "t" }, headers: {} }).cloud, { uid: "firebaseUid123", token: "t" });
  assert.equal(usage.identityOf({ user: null, headers: {}, ip: "203.0.113.9" }).key, "ip:203.0.113.9");
  assert.equal(usage.identityOf({ user: { id: "offline_user", isOffline: true }, headers: { "cf-connecting-ip": "1.2.3.4" }, ip: "198.51.100.2" }).key, "ip:198.51.100.2", "a client-set header is ignored");
});

test("reset times read naturally", () => {
  assert.equal(usage.relative(30 * 1000), "1 min");
  assert.equal(usage.relative(42 * 60000), "42 min");
  assert.equal(usage.relative(134 * 60000), "2 hr 14 min");
  assert.equal(usage.relative(26 * HOUR), "1 day 2 hr");
});

// ── HTTP ───────────────────────────────────────────────────────────────────

async function startServer(t) {
  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("GET /api/usage and POST /api/usage/consume", async (t) => {
  const base = await startServer(t);
  const ip = `192.0.2.${(process.pid % 200) + 1}`;
  const headers = { "Content-Type": "application/json", "X-Forwarded-For": ip };
  usage._memory.delete(`ip:${ip}`);
  const empty = await (await fetch(`${base}/api/usage`, { headers })).json();
  assert.equal(empty.success, true);
  assert.equal(empty.data.signedIn, false);
  assert.equal(empty.data.plan, "free");
  assert.equal(empty.data.session.used, 0);
  assert.ok(empty.data.tiers.length >= 3);

  const ok = await fetch(`${base}/api/usage/consume`, { method: "POST", headers, body: JSON.stringify({ model: "GPT-5.6 Sol" }) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).data.session.used, 4);

  usage._memory.set(`ip:${ip}`, { sessionStart: Date.now(), weekStart: Date.now(), events: [{ m: "Groq", u: limitsFor("free").session, t: Date.now() }] });
  const refused = await fetch(`${base}/api/usage/consume`, { method: "POST", headers, body: JSON.stringify({ model: "Groq" }) });
  assert.equal(refused.status, 429);
  const body = await refused.json();
  assert.equal(body.code, "USAGE_LIMIT");
  assert.match(body.message, /5-hour usage limit\. It resets in 5 hr/);
  assert.ok(body.block.resetsAt > Date.now());
});

test("chat refuses a message once the limit is used up, with the reset time", async (t) => {
  const base = await startServer(t);
  const ip = "192.0.2.250";
  usage._memory.set(`ip:${ip}`, { sessionStart: Date.now() - HOUR, weekStart: Date.now() - HOUR, events: [{ m: "Groq", u: limitsFor("free").session, t: Date.now() - HOUR }] });
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ input: "Hello", provider: "Groq", modelLabel: "Groq", mode: "normal" }),
  });
  const text = await res.text();
  const event = JSON.parse(text.match(/data: (.*)/)[1]);
  assert.equal(event.type, "error");
  assert.equal(event.code, "USAGE_LIMIT");
  assert.match(event.data, /It resets in 4 hr/);
  assert.equal(event.usage.window, "session");
  assert.equal(event.usage.model, "Groq");
});

test("a reply from a fallback model is counted against the model that answered", async (t) => {
  const orchestrator = require("../src/services/AIOrchestrator");
  const original = orchestrator.processRequest;
  orchestrator.processRequest = async (_id, _params, res) => {
    // GPT-5.6 Terra was picked, but Groq is the one that answered.
    res.locals.answeredBy = "Groq";
    res.write(`data: ${JSON.stringify({ type: "content", data: "Hi" })}\n\n`);
    res.end();
    return true;
  };
  t.after(() => { orchestrator.processRequest = original; });
  const base = await startServer(t);
  const ip = "192.0.2.240";
  usage._memory.delete(`ip:${ip}`);
  await (await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ input: "Hello", provider: "GPT-5.6 Terra", modelLabel: "GPT-5.6 Terra", mode: "normal" }),
  })).text();
  await new Promise((r) => setTimeout(r, 50));
  const data = (await (await fetch(`${base}/api/usage`, { headers: { "X-Forwarded-For": ip } })).json()).data;
  assert.deepEqual(data.models.map((m) => [m.model, m.messages]), [["Groq", 1]]);
  assert.equal(data.session.used, 1, "charged at Groq's weight, not Terra's");
});

test("browser models are checked first and counted only once they answer", async (t) => {
  const base = await startServer(t);
  const ip = "192.0.2.241";
  const headers = { "Content-Type": "application/json", "X-Forwarded-For": ip };
  usage._memory.delete(`ip:${ip}`);
  const check = await fetch(`${base}/api/usage/check`, { method: "POST", headers, body: JSON.stringify({ model: "GPT-5.6 Terra" }) });
  assert.equal(check.status, 200);
  assert.equal((await check.json()).data.session.used, 0, "a check counts nothing");
  const rec = await fetch(`${base}/api/usage/record`, { method: "POST", headers, body: JSON.stringify({ model: "GPT-5.6 Terra" }) });
  assert.equal((await rec.json()).data.session.used, 2);

  usage._memory.set(`ip:${ip}`, { sessionStart: Date.now(), weekStart: Date.now(), events: [{ m: "Groq", u: limitsFor("free").session, t: Date.now() }] });
  const refused = await fetch(`${base}/api/usage/check`, { method: "POST", headers, body: JSON.stringify({ model: "GPT-5.6 Terra" }) });
  assert.equal(refused.status, 429);
  assert.equal((await refused.json()).code, "USAGE_LIMIT");
});

test("a signed-in person's usage survives a server restart, from their own Firestore space", async () => {
  const k = key();
  const cloud = { uid: `u${n}`, token: "id-token" };
  const stored = new Map();
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push([opts.method || "GET", String(url), opts.headers?.Authorization]);
    if (opts.method === "PATCH") { stored.set(String(url), JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({}) }; }
    const doc = stored.get(String(url));
    return doc ? { ok: true, status: 200, json: async () => doc } : { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    await usage.record(k, "free", "Groq", T0, cloud);
    await usage.record(k, "free", "Groq", T0 + HOUR, cloud);
    await new Promise((r) => setImmediate(r));
    assert.ok(calls.some(([m, url, auth]) => m === "PATCH" && url.endsWith(`/documents/users/${cloud.uid}/prefs/usage`) && auth === "Bearer id-token"));

    // A restart: the server's own copy is gone.
    usage._memory.delete(k);
    usage._cloudChecked.delete(k);
    const after = await usage.check(k, "free", "Groq", T0 + 2 * HOUR, cloud);
    assert.equal(after.summary.models[0].model, "Groq");
    assert.equal(after.summary.models[0].messages, 2);
    assert.equal(after.summary.session.resetsAt, T0 + SESSION_MS);
  } finally {
    global.fetch = original;
  }
});

test("an unreachable Firestore never blocks or slows every message", async () => {
  const k = key();
  let reads = 0;
  const original = global.fetch;
  global.fetch = async (url, opts = {}) => { if (!opts.method) reads++; throw new TypeError("fetch failed"); };
  try {
    await usage.record(k, "free", "Groq", T0, { uid: "x", token: "t" });
    const s = await usage.record(k, "free", "Groq", T0 + 1000, { uid: "x", token: "t" });
    assert.equal(s.session.used, 2);
    assert.equal(reads, 1, "a failed read waits before trying again");
  } finally {
    global.fetch = original;
  }
});
