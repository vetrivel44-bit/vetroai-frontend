import test from "node:test";
import assert from "node:assert/strict";

import { detectClockQuestion, clockAnswer, clockParts, clockPromptLine } from "../src/utils/clock.js";

// 19:17 UTC on 24 Sept is 00:47 on 25 Sept in India — the case from the bug report.
const NOW = new Date("2026-09-24T19:17:00Z");

test("date, day and time questions are recognised; others are not", () => {
  assert.deepEqual(detectClockQuestion("what is todays date"), { kind: "date", place: null });
  assert.deepEqual(detectClockQuestion("What day is it today?"), { kind: "day", place: null });
  assert.deepEqual(detectClockQuestion("what time is it"), { kind: "time", place: null });
  assert.deepEqual(detectClockQuestion("time in new york"), { kind: "time", place: "new york" });
  for (const q of ["what is today's weather", "today's news", "what is the date of diwali 2026", "time complexity of quicksort"]) {
    assert.equal(detectClockQuestion(q), null, q);
  }
});

test("the answer uses the user's timezone, not UTC", () => {
  assert.equal(clockParts("Asia/Kolkata", NOW).date, "Friday, 25 September 2026");
  assert.equal(clockAnswer({ kind: "date" }, { timeZone: "Asia/Kolkata", now: NOW }), "Today is **Friday, 25 September 2026**.");
  assert.match(clockAnswer({ kind: "time" }, { timeZone: "Asia/Kolkata", now: NOW }), /^It's \*\*12:47 AM\*\* — Friday, 25 September 2026\./);
  assert.match(clockAnswer({ kind: "time" }, { timeZone: "Europe/London", now: NOW, where: "London" }), /It's \*\*8:17 PM\*\* in \*\*London\*\* — Thursday, 24 September 2026/);
});

test("the prompt line for browser models carries the user's date", () => {
  assert.match(clockPromptLine("Asia/Kolkata", NOW), /^Today is Friday, 25 September 2026; the user's local time is 12:47 AM \(India Standard Time, Asia\/Kolkata\)/);
});
