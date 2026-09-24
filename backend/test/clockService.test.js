const test = require("node:test");
const assert = require("node:assert/strict");

const { detectClockQuestion, describeClock, clientClock, clockLine, validTimeZone } = require("../src/services/clockService");

test("the user's own date/day/time questions are recognised", () => {
  for (const q of ["what is todays date", "What is today's date?", "whats the date", "date today", "today's date please", "hey what's the date today", "what is the current date"]) {
    assert.deepEqual(detectClockQuestion(q), { kind: "date", place: null }, q);
  }
  for (const q of ["what day is it", "what day is today?", "What day is it today?", "which day is today", "what is today"]) {
    assert.deepEqual(detectClockQuestion(q), { kind: "day", place: null }, q);
  }
  for (const q of ["what time is it", "what's the time now", "current time", "time now", "what is the time"]) {
    assert.deepEqual(detectClockQuestion(q), { kind: "time", place: null }, q);
  }
  assert.deepEqual(detectClockQuestion("what is the date and time"), { kind: "datetime", place: null });
});

test("time or date in a named place is recognised with the place", () => {
  assert.deepEqual(detectClockQuestion("what time is it in London?"), { kind: "time", place: "london" });
  assert.deepEqual(detectClockQuestion("current time in New York"), { kind: "time", place: "new york" });
  assert.deepEqual(detectClockQuestion("what's the date in Tokyo"), { kind: "date", place: "tokyo" });
});

test("questions that merely mention today are not clock questions", () => {
  for (const q of ["what is today's weather", "today's news", "what happened today in cricket", "what is the date of diwali 2026", "time complexity of quicksort", "what time does the match start", "date night ideas"]) {
    assert.equal(detectClockQuestion(q), null, q);
  }
});

test("dates are written in the user's timezone, not the server's", () => {
  // 19:17 UTC on the 24th is 00:47 on the 25th in India.
  const now = new Date("2026-09-24T19:17:00Z");
  const india = describeClock({ timeZone: "Asia/Kolkata", now });
  assert.equal(india.date, "Friday, 25 September 2026");
  assert.equal(india.time, "12:47 AM");
  assert.equal(india.isoDate, "2026-09-25");
  assert.equal(india.offset, "UTC+05:30");
  assert.equal(describeClock({ timeZone: "UTC", now }).date, "Thursday, 24 September 2026");
});

test("an invalid or missing timezone falls back to UTC and says so", () => {
  assert.equal(validTimeZone("Not/AZone"), null);
  const c = clientClock({ clientTimeZone: "Not/AZone" });
  assert.equal(c.timeZone, "UTC");
  assert.equal(c.known, false);
  assert.match(clockLine(c), /timezone is unknown/);
  assert.equal(clientClock({ clientTimeZone: "Asia/Kolkata" }).known, true);
});

test("the chat system prompt states the user's date, not the server's", async () => {
  const orchestrator = require("../src/services/AIOrchestrator");
  const prompt = await orchestrator.buildSystemPrompt("normal", {
    userQuery: "what is todays date",
    clock: { timeZone: "Asia/Kolkata", known: true, now: new Date("2026-09-24T19:17:00Z") },
  });
  assert.match(prompt, /Today is Friday, 25 September 2026; the user's local time is 12:47 AM \(Asia\/Kolkata, UTC\+05:30\)/);
});
