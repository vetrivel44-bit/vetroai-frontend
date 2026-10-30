import { test } from "node:test";
import assert from "node:assert/strict";
import { installStorageGuard } from "../src/lib/storageGuard.js";

// Minimal Storage with a byte quota, mirroring the browser's QuotaExceededError.
function makeStorage(quota) {
  class FakeStorage {
    constructor() { this.map = new Map(); }
    get length() { return this.map.size; }
    key(i) { return [...this.map.keys()][i] ?? null; }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    removeItem(k) { this.map.delete(k); }
    setItem(k, v) {
      const used = [...this.map].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0);
      if (used + k.length + String(v).length > quota) {
        const err = new Error("exceeded the quota"); err.name = "QuotaExceededError"; throw err;
      }
      this.map.set(k, String(v));
    }
  }
  installStorageGuard(FakeStorage);
  return new FakeStorage();
}

test("evicts disposable caches to make room", () => {
  const s = makeStorage(200);
  s.setItem("vsj_company_logo_v1", "x".repeat(150));
  s.setItem("vetroai_userinfo", JSON.stringify({ email: "a@b.c", plan: "pro" }));
  assert.equal(s.getItem("vsj_company_logo_v1"), null);
  assert.match(s.getItem("vetroai_userinfo"), /a@b\.c/);
});

test("never throws when nothing can be evicted, and keeps user data", () => {
  const s = makeStorage(120);
  s.setItem("vetroai_sessions_me", "c".repeat(90));
  assert.doesNotThrow(() => s.setItem("vetroai_userinfo", "y".repeat(50)));
  assert.equal(s.getItem("vetroai_sessions_me").length, 90);
});

// ── other accounts' caches ────────────────────────────────────────────────────
import { evictOtherAccounts, looksLikeJwt } from "../src/lib/storageGuard.js";

const memoryStore = (entries) => {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    removeItem(k) { map.delete(k); },
    has: (k) => map.has(k),
  };
};

test("other accounts' and token-keyed caches are evicted, the writer's are kept", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.sig_part";
  const store = memoryStore({
    "vetroai_sessions_me@x.com": "a".repeat(10),
    "vetroai_artifacts_me@x.com": "a",
    "vetroai_sessions_other@x.com": "b".repeat(50),
    [`vetroai_sessions_${jwt}`]: "c".repeat(20),
    "token": "keep",
  });
  const removed = evictOtherAccounts(store, "vetroai_sessions_me@x.com", store.removeItem, null);
  assert.deepEqual(removed, ["vetroai_sessions_other@x.com", `vetroai_sessions_${jwt}`]);
  assert.ok(store.has("vetroai_sessions_me@x.com") && store.has("vetroai_artifacts_me@x.com") && store.has("token"));
});

test("with no known account only token-keyed caches go", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.sig_part";
  const store = memoryStore({ "vetroai_sessions_a@x.com": "a", [`vetroai_spaces_${jwt}`]: "b", "vetroai_userinfo": "{}" });
  assert.deepEqual(evictOtherAccounts(store, "vetroai_userinfo", store.removeItem, null), [`vetroai_spaces_${jwt}`]);
});

test("looksLikeJwt", () => {
  assert.equal(looksLikeJwt("eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.abc"), true);
  assert.equal(looksLikeJwt("me@x.com"), false);
  assert.equal(looksLikeJwt("local_1779301676484_VmV0cm9AZ21haWwuY29t"), false);
});
