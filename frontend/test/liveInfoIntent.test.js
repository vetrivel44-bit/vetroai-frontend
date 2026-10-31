import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { LIVE_INFO_PATTERNS, CHAT_REFERENCE_PATTERNS, LOOKUP_PATTERNS, TIMELESS_PATTERNS, TIMELESS_MODES, ABOUT_SELF, needsLiveInfo } from "../src/lib/liveInfoIntent.js";

const require = createRequire(import.meta.url);
const backend = require("../../backend/src/services/liveInfoIntent.js");

test("current-events questions search; timeless ones don't", () => {
  for (const q of ["is TTV Vasan in bigg boss season 10", "bigg boss tamil season 10 contestants", "who is the chief minister of tamil nadu", "when is the next ipl match", "tell about gemini argon", "have you heard of nano banana"]) {
    assert.equal(needsLiveInfo(q), true, q);
  }
  for (const q of ["hi", "what is DBMS", "write a poem about rain", "explain photosynthesis"]) {
    assert.equal(needsLiveInfo(q), false, q);
  }
});

test("the app and the backend use the same patterns", () => {
  assert.deepEqual(LIVE_INFO_PATTERNS.map(String), backend.LIVE_INFO_PATTERNS.map(String));
  assert.deepEqual(CHAT_REFERENCE_PATTERNS.map(String), backend.CHAT_REFERENCE_PATTERNS.map(String));
  assert.deepEqual(LOOKUP_PATTERNS.map(String), backend.LOOKUP_PATTERNS.map(String));
  assert.deepEqual(TIMELESS_PATTERNS.map(String), backend.TIMELESS_PATTERNS.map(String));
  assert.deepEqual([...TIMELESS_MODES], [...backend.TIMELESS_MODES]);
  assert.equal(String(ABOUT_SELF), String(backend.ABOUT_SELF));
});

test("browser models search questions without a time word too, as the backend does", () => {
  for (const q of ["best phones under 30000", "tamil nadu cm", "zephyr x9 review", "what is zephyr x9"]) {
    assert.equal(needsLiveInfo(q), true, q);
    assert.equal(needsLiveInfo(q), backend.needsLiveInfo(q), q);
  }
  for (const q of ["what is DBMS", "review my essay", "translate hello to tamil", "solve x^2 - 4 = 0"]) {
    assert.equal(needsLiveInfo(q), false, q);
  }
  assert.equal(needsLiveInfo("best laptop for coding", { mode: "debugger" }), false);
});
