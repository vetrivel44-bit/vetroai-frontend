import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { LIVE_INFO_PATTERNS, needsLiveInfo } from "../src/lib/liveInfoIntent.js";

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
});
