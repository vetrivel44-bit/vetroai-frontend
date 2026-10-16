import test from "node:test";
import assert from "node:assert/strict";

import { UsageLimitError, authHeaders, consumeUsage, formatResetAt, formatResetIn } from "../src/lib/usageClient.js";

const store = (token) => ({ getItem: () => token });

test("sends the signed-in user's token, never a local or demo one", () => {
  assert.deepEqual(authHeaders(store("eyJhbGc.x.y")), { Authorization: "Bearer eyJhbGc.x.y" });
  assert.deepEqual(authHeaders(store("local_123")), {});
  assert.deepEqual(authHeaders(store(null)), {});
  assert.deepEqual(authHeaders({ getItem: () => { throw new Error("blocked"); } }), {});
});

test("a browser model checks in, and a used-up limit stops it with the reset time", async () => {
  const ok = await consumeUsage("/api", "GPT-5.6 Luna", { fetchImpl: async (url, opts) => {
    assert.equal(url, "/api/usage/consume");
    assert.deepEqual(JSON.parse(opts.body), { model: "GPT-5.6 Luna" });
    return { ok: true, status: 200, json: async () => ({ success: true, data: { session: { used: 1 } } }) };
  } });
  assert.equal(ok.session.used, 1);

  const resetsAt = Date.now() + 3600e3;
  await assert.rejects(
    consumeUsage("/api", "GPT-5.6 Sol", { fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ code: "USAGE_LIMIT", message: "You've reached your 5-hour usage limit. It resets in 1 hr.", block: { window: "session", resetsAt } }) }) }),
    (err) => err instanceof UsageLimitError && err.usageLimit.resetsAt === resetsAt && err.usageLimit.model === "GPT-5.6 Sol" && /resets in 1 hr/.test(err.message),
  );
});

test("an unreachable usage server never blocks chat", async () => {
  assert.equal(await consumeUsage("/api", "GPT-5.6 Luna", { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }), null);
  assert.equal(await consumeUsage("/api", "GPT-5.6 Luna", { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }), null);
});

test("reset times", () => {
  const now = new Date(2026, 9, 16, 10, 0).getTime();
  assert.equal(formatResetIn(now + 30e3, now), "1 min");
  assert.equal(formatResetIn(now + 134 * 60e3, now), "2 hr 14 min");
  assert.equal(formatResetIn(now + 5 * 3600e3, now), "5 hr");
  assert.equal(formatResetIn(now + 50 * 3600e3, now), "2 days 2 hr");
  assert.equal(formatResetAt(new Date(2026, 9, 16, 16, 30).getTime(), now, "en-US"), "4:30 PM");
  assert.equal(formatResetAt(new Date(2026, 9, 17, 9, 5).getTime(), now, "en-US"), "tomorrow 9:05 AM");
  assert.equal(formatResetAt(new Date(2026, 9, 23, 17, 23).getTime(), now, "en-US"), "Fri, Oct 23, 5:23 PM");
});
