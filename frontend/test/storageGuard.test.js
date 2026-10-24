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
