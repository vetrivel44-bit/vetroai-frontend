const test = require("node:test");
const assert = require("node:assert/strict");

const schedules = require("../src/services/scheduleService");
const controller = require("../src/controllers/scheduleController");

const IST = "Asia/Kolkata";
const at = (iso) => new Date(iso).getTime();

test("the next run is the next matching local time, in the user's time zone", () => {
  assert.equal(schedules.tzOffsetMinutes(IST, at("2026-10-17T00:00:00Z")), 330);
  const daily = schedules.normalizeSchedule({ every: "day", time: "8:00", tz: IST });
  assert.deepEqual(daily, { every: "day", time: "08:00", tz: IST });
  // 07:00 IST → 08:00 IST the same day (02:30 UTC).
  assert.equal(new Date(schedules.nextRunAt(daily, at("2026-10-17T01:30:00Z"))).toISOString(), "2026-10-17T02:30:00.000Z");
  // 09:00 IST → 08:00 IST tomorrow.
  assert.equal(new Date(schedules.nextRunAt(daily, at("2026-10-17T03:30:00Z"))).toISOString(), "2026-10-18T02:30:00.000Z");
  // Weekly on Monday 18:30 IST, asked on Saturday 17 Oct 2026.
  const weekly = schedules.normalizeSchedule({ every: "week", day: 1, time: "18:30", tz: IST });
  assert.equal(new Date(schedules.nextRunAt(weekly, at("2026-10-17T03:30:00Z"))).toISOString(), "2026-10-19T13:00:00.000Z");
  // Summer time: 08:00 in New York is 12:00 UTC in July and 13:00 UTC in January.
  const ny = schedules.normalizeSchedule({ every: "day", time: "08:00", tz: "America/New_York" });
  assert.equal(new Date(schedules.nextRunAt(ny, at("2026-07-01T00:00:00Z"))).toISOString(), "2026-07-01T12:00:00.000Z");
  assert.equal(new Date(schedules.nextRunAt(ny, at("2026-01-10T00:00:00Z"))).toISOString(), "2026-01-10T13:00:00.000Z");
  const every6 = schedules.normalizeSchedule({ every: "hours", hours: 6, tz: IST });
  assert.equal(schedules.nextRunAt(every6, 1000), 1000 + 6 * 3600e3);
  assert.equal(schedules.describeSchedule(daily), "Every day at 8:00 AM");
  assert.equal(schedules.describeSchedule(weekly), "Every Monday at 6:30 PM");
  assert.equal(schedules.describeSchedule(every6), "Every 6 hours");
  assert.equal(schedules.normalizeSchedule({ every: "hours", hours: 0 }), null, "at least hourly");
  assert.equal(schedules.normalizeSchedule({ every: "day", time: "25:00" }), null);
  assert.equal(schedules.normalizeSchedule({ every: "day", time: "07:00", tz: "Not/AZone" }).tz, "UTC");
});

test("a daily brief searches the web, writes the update, keeps it and emails it", async () => {
  const task = await schedules.store.create({ owner: "uid:t1", email: "a@b.c", title: "Morning news", prompt: "Today's top news in India and the cricket scores", kind: "brief", condition: "", schedule: { every: "day", time: "08:00", tz: IST }, active: true, nextRunAt: 0 });
  const calls = {};
  const saved = await schedules.runTask(task, {
    now: at("2026-10-17T02:30:00Z"),
    search: async (q, opts) => { calls.query = q; calls.tz = opts.clock.timeZone; return { context: "[1] India beat Australia by 5 wickets" }; },
    think: async (prompt) => { calls.prompt = prompt; return "**India beat Australia** by 5 wickets [1]."; },
    email: async (to, subject, text) => { calls.email = { to, subject, text }; return true; },
  });
  assert.equal(calls.query, task.prompt);
  assert.equal(calls.tz, IST);
  assert.match(calls.prompt, /Today is Saturday, 17 October 2026/);
  assert.equal(saved.runs[0].ok, true);
  assert.match(saved.runs[0].text, /India beat Australia/);
  assert.equal(saved.unread, 1);
  assert.equal(calls.email.to, "a@b.c");
  assert.match(calls.email.subject, /^Morning news — 17 Oct$/);
});

test("a watch only notifies when the condition comes true, then stops", async () => {
  const task = await schedules.store.create({ owner: "uid:t2", email: "", title: "iPhone price", prompt: "iPhone 17 price on Amazon India", kind: "watch", condition: "the price drops below ₹70,000", schedule: { every: "hours", hours: 6, tz: IST }, active: true, nextRunAt: 0 });
  const emails = [];
  const deps = (reply) => ({ search: async () => ({ context: "[1] iPhone 17 at ₹72,900" }), think: async () => reply, email: async (...a) => emails.push(a) });
  let saved = await schedules.runTask(task, deps('{"met": false, "value": "₹72,900", "summary": "Still ₹72,900 [1]."}'));
  assert.equal(saved.unread, 0);
  assert.equal(saved.active, true);
  assert.equal(emails.length, 0);
  saved = await schedules.runTask(saved, deps('```json\n{"met": true, "value": "₹68,999 on Amazon", "summary": "Dropped to ₹68,999 [1]."}\n```'));
  assert.equal(saved.unread, 1);
  assert.equal(saved.active, false, "done once it happened");
  assert.equal(saved.runs[0].value, "₹68,999 on Amazon");
  assert.equal(emails.length, 1);
});

test("a failed run is kept as a failure and never crashes the scheduler", async () => {
  const task = await schedules.store.create({ owner: "uid:t3", title: "x", prompt: "news", kind: "brief", condition: "", schedule: { every: "hours", hours: 1, tz: "UTC" }, active: true, nextRunAt: 1 });
  const saved = await schedules.runTask(task, { search: async () => { throw new Error("search down"); }, think: async () => "x", email: async () => {} });
  assert.equal(saved.runs[0].ok, false);
  assert.match(saved.runs[0].error, /search down/);
  assert.equal(saved.unread, 0);
});

test("due tasks run once each, and their next run moves on", async () => {
  schedules.store._memory.clear();
  const now = at("2026-10-17T02:30:00Z");
  const a = await schedules.store.create({ owner: "uid:due", title: "a", prompt: "a news", kind: "brief", condition: "", schedule: { every: "hours", hours: 2, tz: "UTC" }, active: true, nextRunAt: now - 1000 });
  await schedules.store.create({ owner: "uid:due", title: "b", prompt: "b news", kind: "brief", condition: "", schedule: { every: "hours", hours: 2, tz: "UTC" }, active: true, nextRunAt: now + 3600e3 });
  let thinks = 0;
  const deps = { search: async () => ({ context: "" }), think: async () => { thinks++; return "ok"; }, email: async () => {} };
  const first = await schedules.runDue({ now, deps });
  assert.equal(first.ran, 1);
  assert.equal((await schedules.store.get(a.id)).nextRunAt, now + 2 * 3600e3);
  const again = await schedules.runDue({ now, deps });
  assert.equal(again.ran, 0, "not run twice");
  assert.equal(thinks, 1);
});

// ── The API, through the controller (signed-in identity stubbed) ────────────

function call(handler, { user = { id: "fbUser1", isFirebase: true, email: "me@x.com" }, body = {}, params = {}, headers = {} } = {}) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(data) { resolve({ status: this.statusCode, body: data }); } };
    handler({ user, body, params, headers, ip: "127.0.0.1" }, res);
  });
}

test("scheduled tasks need an account, are checked, and only the owner can touch them", async () => {
  const visitor = await call(controller.list, { user: null });
  assert.equal(visitor.status, 401);

  const bad = await call(controller.create, { body: { prompt: "news", schedule: { every: "day", time: "99:00" } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /when it should run/);
  const noCondition = await call(controller.create, { body: { prompt: "iPhone price", kind: "watch", schedule: { every: "hours", hours: 6 } } });
  assert.match(noCondition.body.message, /what to watch for/);

  const created = await call(controller.create, { body: { prompt: "Top tech news", title: "Tech news", schedule: { every: "day", time: "08:00", tz: IST } } });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.when, "Every day at 8:00 AM");
  assert.ok(created.body.data.nextRunAt > Date.now());
  const id = created.body.data.id;

  const listed = await call(controller.list);
  assert.equal(listed.body.data.durable, false, "no database in tests");
  assert.ok(listed.body.data.tasks.some((t) => t.id === id));

  const other = await call(controller.remove, { user: { id: "someoneElse", isFirebase: true }, params: { id } });
  assert.equal(other.status, 404, "another account can't see it");

  const paused = await call(controller.update, { params: { id }, body: { active: false } });
  assert.equal(paused.body.data.active, false);
  assert.equal(paused.body.data.nextRunAt, null);

  const gone = await call(controller.remove, { params: { id } });
  assert.equal(gone.status, 200);
  assert.equal((await call(controller.list)).body.data.tasks.some((t) => t.id === id), false);
});

test("the outside scheduler needs the secret", async () => {
  const denied = await call(controller.runDue, { headers: { "x-cron-secret": "nope" } });
  assert.equal(denied.status, 403);
});
