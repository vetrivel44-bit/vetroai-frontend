import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  FEELINGS_PATTERN, LIVE_INFO_PATTERNS, CHAT_REFERENCE_PATTERNS, LOOKUP_PATTERNS, TIMELESS_PATTERNS, TIMELESS_MODES,
  CHAT_SPEAK, PLAIN_SPEAK, ABOUT_SELF, ABOUT_SELF_SHORT, SMALL_TALK, FOLLOW_UP_REQUEST,
  isAboutSelf, isSmallTalk, isFollowUpRequest, normalizeChatSpeak, plainReading, needsLiveInfo,
} from "../src/lib/liveInfoIntent.js";

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
  assert.equal(String(ABOUT_SELF_SHORT), String(backend.ABOUT_SELF_SHORT));
  assert.equal(String(SMALL_TALK), String(backend.SMALL_TALK));
  assert.deepEqual(CHAT_SPEAK, backend.CHAT_SPEAK);
  assert.deepEqual([...PLAIN_SPEAK], [...backend.PLAIN_SPEAK]);
  assert.equal(String(FOLLOW_UP_REQUEST), String(backend.FOLLOW_UP_REQUEST));
  assert.equal(String(FEELINGS_PATTERN), String(backend.FEELINGS_PATTERN));
});

// "Ur name" was searched for browser models too (and, in Web Search mode with
// Auto, answered straight from a search about the ancient city of Ur).
test("browser models never search questions to VetroAI about itself, or small talk", () => {
  const notLookups = ["Ur name", "wat is ur name", "who r u", "who are you", "which model r u", "r u chatgpt", "r u a doctor", "are u alive", "how's ur health", "tera naam kya hai", "un peru enna", "how r u", "thank u so much", "r u there", "u r smart", "gud mrng"];
  for (const q of notLookups) {
    assert.equal(isAboutSelf(q) || isSmallTalk(q), true, q);
    assert.equal(needsLiveInfo(q), false, q);
    assert.equal(isAboutSelf(q), backend.isAboutSelf(q), q);
    assert.equal(isSmallTalk(q), backend.isSmallTalk(q), q);
  }
  for (const q of ["what model is the iphone 17", "which ai is best for coding", "ancient city of ur", "hi, who won the match today"]) {
    assert.equal(isAboutSelf(q) || isSmallTalk(q), false, q);
    assert.equal(needsLiveInfo(q), true, q);
  }
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

// Browser models read short follow-ups and shorthand the same way.
test("follow-ups and shorthand read the same in the app and the backend", () => {
  for (const q of ["in tamil", "give eg", "y?", "in 2 lines", "make it shorter", "in 2025?", "in tamil nadu", "diff b/w tcp n udp", "ipl score 2day", "ancient city of ur", "hru"]) {
    assert.equal(isFollowUpRequest(q), backend.isFollowUpRequest(q), q);
    assert.equal(normalizeChatSpeak(q), backend.normalizeChatSpeak(q), q);
    assert.equal(plainReading(q), backend.plainReading(q), q);
    assert.equal(needsLiveInfo(q), backend.needsLiveInfo(q), q);
  }
  assert.equal(needsLiveInfo("in tamil"), false);
  assert.equal(plainReading("ipl score 2day"), "ipl score today");
});
