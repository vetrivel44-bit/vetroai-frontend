const crypto = require("node:crypto");
const schedules = require("../services/scheduleService");
const usage = require("../services/usageService");
const { config } = require("../config/env");
const { limitsFor, PLAN_LIMITS } = require("../config/usageLimits");

// /api/schedules — the signed-in user's scheduled tasks (VetroAI Computer).

function identity(req) {
  const id = usage.identityOf(req);
  if (!id.signedIn) {
    const err = new Error("Sign in to VetroAI to schedule tasks.");
    err.status = 401;
    throw err;
  }
  return id;
}
const ownerOf = (req) => identity(req).key;

/** How many scheduled tasks this plan can have running at once. */
const activeLimit = (plan) => Math.min(limitsFor(plan).scheduledActive ?? schedules.MAX_ACTIVE_PER_USER, schedules.MAX_ACTIVE_PER_USER * 2);
function limitReached(plan, limit) {
  const err = new Error(plan === "free"
    ? `Free accounts can have ${limit} scheduled task running. Pause or delete it first — or upgrade to Pro for ${PLAN_LIMITS.pro.scheduledActive}.`
    : `You can have ${limit} scheduled tasks running. Pause or delete one first.`);
  err.status = 429;
  err.code = "SCHEDULE_LIMIT";
  return err;
}

const view = (task) => task && ({
  id: task.id,
  title: task.title,
  prompt: task.prompt,
  kind: task.kind,
  condition: task.condition,
  schedule: task.schedule,
  when: schedules.describeSchedule(task.schedule),
  active: task.active,
  nextRunAt: task.active ? task.nextRunAt : null,
  lastRunAt: task.lastRunAt,
  unread: task.unread || 0,
  runs: task.runs || [],
});

const fail = (res, err) => res.status(err.status || 400).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}) });

async function ownTask(req, res) {
  const owner = ownerOf(req);
  const task = await schedules.store.get(req.params.id);
  if (!task || task.owner !== owner) {
    res.status(404).json({ success: false, message: "That scheduled task doesn't exist." });
    return null;
  }
  return task;
}

async function list(req, res) {
  try {
    const id = identity(req);
    const owner = id.key;
    const tasks = await schedules.store.list(owner);
    res.json({
      success: true,
      data: {
        durable: schedules.store.durable(),
        email: Boolean(config.resendApiKey && config.mailFrom),
        tasks: tasks.map(view),
        unread: tasks.reduce((n, t) => n + (t.unread || 0), 0),
        plan: id.plan,
        activeLimit: activeLimit(id.plan),
      },
    });
  } catch (err) { fail(res, err); }
}

async function create(req, res) {
  try {
    const id = identity(req);
    const owner = id.key;
    const input = schedules.cleanInput(req.body);
    const limit = activeLimit(id.plan);
    if (await schedules.store.countActive(owner) >= limit) throw limitReached(id.plan, limit);
    const task = await schedules.store.create({
      ...input,
      owner,
      email: String(req.user?.email || ""),
      active: true,
      nextRunAt: schedules.nextRunAt(input.schedule),
    });
    res.status(201).json({ success: true, data: view(task) });
  } catch (err) { fail(res, err); }
}

async function update(req, res) {
  try {
    const task = await ownTask(req, res);
    if (!task) return;
    const patch = schedules.cleanInput({ ...req.body, kind: req.body.kind ?? task.kind, condition: req.body.condition ?? task.condition }, { partial: true });
    const { plan } = identity(req);
    const limit = activeLimit(plan);
    if (patch.active === true && !task.active && await schedules.store.countActive(task.owner) >= limit) throw limitReached(plan, limit);
    if (patch.schedule || patch.active === true) patch.nextRunAt = schedules.nextRunAt(patch.schedule || task.schedule);
    res.json({ success: true, data: view(await schedules.store.update(task.id, patch)) });
  } catch (err) { fail(res, err); }
}

async function remove(req, res) {
  try {
    const task = await ownTask(req, res);
    if (!task) return;
    await schedules.store.remove(task.id);
    res.json({ success: true });
  } catch (err) { fail(res, err); }
}

async function runNow(req, res) {
  try {
    const task = await ownTask(req, res);
    if (!task) return;
    res.json({ success: true, data: view(await schedules.runTask(task)) });
  } catch (err) { fail(res, err); }
}

async function markRead(req, res) {
  try {
    const task = await ownTask(req, res);
    if (!task) return;
    res.json({ success: true, data: view(await schedules.store.update(task.id, { unread: 0 })) });
  } catch (err) { fail(res, err); }
}

// Called by the scheduler outside the server, with CRON_SECRET.
async function runDue(req, res) {
  const given = String(req.headers["x-cron-secret"] || "");
  const ok = config.cronSecret && given.length === config.cronSecret.length
    && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(config.cronSecret));
  if (!ok) return res.status(403).json({ success: false, message: "Forbidden" });
  res.json({ success: true, data: await schedules.runDue() });
}

module.exports = { list, create, update, remove, runNow, markRead, runDue, view };
