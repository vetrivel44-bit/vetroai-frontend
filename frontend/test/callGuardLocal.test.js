import test from "node:test";
import assert from "node:assert/strict";

import {
  parseTranscript,
  maskDigits,
  looksSensitive,
  splitRedactions,
  SPEAKERS,
} from "../src/utils/callGuardLocal.js";

test("labelled lines are attributed to the right speaker", () => {
  const turns = parseTranscript("Caller: share the OTP\nMe: no\nThem: hello\nUser: bye");
  assert.deepEqual(turns.map((t) => t.speaker), [
    SPEAKERS.CALLER, SPEAKERS.USER, SPEAKERS.CALLER, SPEAKERS.USER,
  ]);
  assert.equal(turns[0].text, "share the OTP");
});

test("unlabelled lines default to the caller", () => {
  const turns = parseTranscript("hello there\n\n  is this Mr Kumar  ");
  assert.deepEqual(turns, [
    { speaker: SPEAKERS.CALLER, text: "hello there" },
    { speaker: SPEAKERS.CALLER, text: "is this Mr Kumar" },
  ]);
});

test("empty and non-string input parses to nothing", () => {
  assert.deepEqual(parseTranscript(""), []);
  assert.deepEqual(parseTranscript(null), []);
  assert.deepEqual(parseTranscript("\n\n   \n"), []);
});

test("digit runs are masked before anything is written to disk", () => {
  assert.equal(maskDigits("the otp is 4 5 8 2 1 9"), "the otp is [REDACTED:NUMERIC_SEQUENCE]");
  assert.equal(maskDigits("card 4539-5787-6362-1486"), "card [REDACTED:NUMERIC_SEQUENCE]");
  assert.equal(maskDigits("meet me at 5"), "meet me at 5");
  assert.equal(maskDigits(undefined), "");
});

test("looksSensitive is stable across repeated calls", () => {
  const text = "the code is 458219";
  assert.equal(looksSensitive(text), true);
  assert.equal(looksSensitive(text), true, "the global regex must not carry lastIndex between calls");
  assert.equal(looksSensitive("see you at 7"), false);
});

test("redaction markers become renderable segments", () => {
  const parts = splitRedactions("it is [REDACTED:OTP] ok");
  assert.deepEqual(parts, [
    { type: "text", value: "it is " },
    { type: "redacted", value: "one-time code" },
    { type: "text", value: " ok" },
  ]);
  assert.deepEqual(splitRedactions("nothing here"), [{ type: "text", value: "nothing here" }]);
});
