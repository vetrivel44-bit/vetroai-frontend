import test from "node:test";
import assert from "node:assert/strict";

import { SCHEDULE_REQUEST, parseScheduleText } from "../src/lib/schedules.js";

const TZ = "Asia/Kolkata";

test("a daily brief is read from the request", () => {
  const p = parseScheduleText("Every morning at 8, send me today's top news and the cricket scores", TZ);
  assert.deepEqual(p.schedule, { every: "day", time: "08:00", tz: TZ });
  assert.equal(p.kind, "brief");
  assert.equal(p.prompt, "Send me today's top news and the cricket scores");
  assert.equal(p.title, "Today's top news and the cricket scores");
  assert.deepEqual(parseScheduleText("every evening at 7 tell me the weather in Chennai", TZ).schedule, { every: "day", time: "19:00", tz: TZ });
  assert.deepEqual(parseScheduleText("daily 6:30 pm market summary", TZ).schedule, { every: "day", time: "18:30", tz: TZ });
  assert.deepEqual(parseScheduleText("every Monday morning, a summary of AI news", TZ).schedule, { every: "week", day: 1, time: "08:00", tz: TZ });
  assert.deepEqual(parseScheduleText("every 4 hours check the Bitcoin price", TZ).schedule, { every: "hours", hours: 4, tz: TZ });
});

test("a watch is read from the request", () => {
  const p = parseScheduleText("Tell me when the iPhone 17 drops below ₹70,000", TZ);
  assert.equal(p.kind, "watch");
  assert.equal(p.condition, "the iPhone 17 drops below ₹70,000");
  assert.deepEqual(p.schedule, { every: "hours", hours: 6, tz: TZ });
  assert.equal(parseScheduleText("let me know once the PS6 is in stock in India", TZ).condition, "the PS6 is in stock in India");
});

test("which requests are about scheduling", () => {
  assert.ok(SCHEDULE_REQUEST.test("Every morning at 8 send me the news"));
  assert.ok(SCHEDULE_REQUEST.test("alert me when gold falls under 6000"));
  assert.ok(!SCHEDULE_REQUEST.test("Build a website for my bakery"));
  assert.ok(!SCHEDULE_REQUEST.test("Research electric scooters and make a deck"));
});
