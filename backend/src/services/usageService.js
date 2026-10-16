const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mongoose = require("mongoose");
const logger = require("../utils/logger");
const { SESSION_MS, WEEK_MS, tierFor, limitsFor } = require("../config/usageLimits");

// Real usage, counted by the server for every message it answers (and every
// message a browser model answers, which checks in first — /api/usage/consume).
//
// Per person: when their current 5-hour session and 7-day week started, and
// each message in the week (model, units, time). A window starts with the
// first message after the previous one ended, exactly like Claude's limits,
// so "resets at" is always a real time.
//
// Stored in MongoDB when the server has one (MONGO_URI), so limits survive
// restarts and every instance agrees. Without it, in memory and in a JSON file
// (USAGE_STORE_FILE), which survives restarts but not a fresh disk.

const UsageRecord = mongoose.models.UsageRecord || mongoose.model("UsageRecord", new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  sessionStart: { type: Number, default: null },
  weekStart: { type: Number, default: null },
  events: { type: [{ m: String, u: Number, t: Number, _id: false }], default: [] },
}, { timestamps: true }));

const STORE_FILE = process.env.USAGE_STORE_FILE || path.join(os.tmpdir(), "vetroai-usage.json");
const memory = new Map();
let fileLoaded = false;
let saveTimer = null;

const emptyDoc = () => ({ sessionStart: null, weekStart: null, events: [] });
const mongoReady = () => mongoose.connection.readyState === 1;

function loadFile() {
  if (fileLoaded) return;
  fileLoaded = true;
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    for (const [key, doc] of Object.entries(data || {})) memory.set(key, doc);
  } catch (err) {
    if (err.code !== "ENOENT") logger.warn("usage.storeLoadFailed", { error: err.message });
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(STORE_FILE, JSON.stringify(Object.fromEntries(memory)));
    } catch (err) {
      logger.warn("usage.storeSaveFailed", { error: err.message });
    }
  }, 1000);
  saveTimer.unref?.();
}

async function load(key) {
  if (mongoReady()) {
    const rec = await UsageRecord.findOne({ key }).lean();
    return rec ? { sessionStart: rec.sessionStart, weekStart: rec.weekStart, events: rec.events || [] } : emptyDoc();
  }
  loadFile();
  return memory.get(key) || emptyDoc();
}

async function save(key, doc) {
  if (mongoReady()) {
    await UsageRecord.updateOne({ key }, { $set: doc }, { upsert: true });
    return;
  }
  memory.set(key, doc);
  scheduleSave();
}

// One read-modify-write at a time per person, so two messages sent together
// can't both slip under a limit.
const queues = new Map();
function serialize(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

const active = (start, length, now) => start != null && now < start + length;

function window(doc, events, field, length, limit, now, filter = () => true) {
  const start = doc[field];
  if (!active(start, length, now)) return { used: 0, limit, percent: 0, resetsAt: null, startedAt: null };
  const used = events.filter((e) => e.t >= start && filter(e)).reduce((n, e) => n + e.u, 0);
  return { used, limit, percent: Math.min(100, Math.round((used / limit) * 100)), resetsAt: start + length, startedAt: start };
}

/** Everything the Usage page shows, at `now`. */
function summarize(doc, plan, now = Date.now()) {
  const limits = limitsFor(plan);
  const events = doc.events || [];
  const session = window(doc, events, "sessionStart", SESSION_MS, limits.session, now);
  const weekly = window(doc, events, "weekStart", WEEK_MS, limits.weekly, now);
  const premium = window(doc, events, "weekStart", WEEK_MS, limits.premiumWeekly, now, (e) => tierFor(e.m).tier === "premium");
  const inWeek = active(doc.weekStart, WEEK_MS, now) ? events.filter((e) => e.t >= doc.weekStart) : [];
  const byModel = new Map();
  for (const e of inWeek) {
    const row = byModel.get(e.m) || { model: e.m, tier: tierFor(e.m).tier, weight: tierFor(e.m).weight, messages: 0, units: 0, sessionMessages: 0, lastUsedAt: 0 };
    row.messages += 1;
    row.units += e.u;
    if (session.startedAt != null && e.t >= session.startedAt) row.sessionMessages += 1;
    row.lastUsedAt = Math.max(row.lastUsedAt, e.t);
    byModel.set(e.m, row);
  }
  const models = [...byModel.values()]
    .map((r) => ({ ...r, share: weekly.used ? Math.round((r.units / weekly.used) * 100) : 0 }))
    .sort((a, b) => b.units - a.units);
  return { plan, limits, session, weekly, premium, models, serverTime: now };
}

// Which limit a message to `model` would run into, if any. A limit is hit
// once its usage reaches 100%, so the message that crosses it still goes
// through (as with Claude); the next one waits for the reset.
function blockedBy(summary, model) {
  const premium = tierFor(model).tier === "premium";
  const hits = [
    summary.session.used >= summary.session.limit && { window: "session", resetsAt: summary.session.resetsAt },
    summary.weekly.used >= summary.weekly.limit && { window: "weekly", resetsAt: summary.weekly.resetsAt },
    premium && summary.premium.used >= summary.premium.limit && { window: "premium", resetsAt: summary.premium.resetsAt },
  ].filter(Boolean);
  // The one that lifts last is when they can actually send again.
  return hits.sort((a, b) => b.resetsAt - a.resetsAt)[0] || null;
}

/** { allowed, summary, block } — without recording anything. */
async function check(key, plan, model, now = Date.now()) {
  const doc = await load(key);
  const summary = summarize(doc, plan, now);
  const block = blockedBy(summary, model);
  return { allowed: !block, summary, block };
}

// The document after one more message to `model`: windows that have ended
// start again now, and events from before this week are dropped.
function withMessage(doc, model, now) {
  const sessionStart = active(doc.sessionStart, SESSION_MS, now) ? doc.sessionStart : now;
  const weekStart = active(doc.weekStart, WEEK_MS, now) ? doc.weekStart : now;
  const events = (doc.events || []).filter((e) => e.t >= weekStart);
  events.push({ m: String(model).slice(0, 60), u: tierFor(model).weight, t: now });
  return { sessionStart, weekStart, events };
}

/** Counts one message to `model`. Returns the new summary. */
function record(key, plan, model, now = Date.now()) {
  return serialize(key, async () => {
    const next = withMessage(await load(key), model, now);
    await save(key, next);
    return summarize(next, plan, now);
  });
}

/** Check and record together — for browser models that ask before answering. */
function consume(key, plan, model, now = Date.now()) {
  return serialize(key, async () => {
    const doc = await load(key);
    const block = blockedBy(summarize(doc, plan, now), model);
    if (block) return { allowed: false, summary: summarize(doc, plan, now), block };
    const next = withMessage(doc, model, now);
    await save(key, next);
    return { allowed: true, summary: summarize(next, plan, now), block: null };
  });
}

const WINDOW_NAMES = { session: "5-hour usage limit", weekly: "weekly usage limit", premium: "weekly limit for the most capable models" };

function relative(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours < 24) return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${days} day${days === 1 ? "" : "s"} ${h} hr` : `${days} day${days === 1 ? "" : "s"}`;
}

/** "You've reached your 5-hour usage limit. It resets in 2 hr 14 min." */
function limitMessage(block, model, now = Date.now()) {
  const which = WINDOW_NAMES[block.window] || "usage limit";
  const extra = block.window === "premium" ? ` You can keep chatting with a lighter model than ${model}.` : "";
  return `You've reached your ${which}. It resets in ${relative(block.resetsAt - now)}.${extra}`;
}

// Who is asking: the signed-in account, or the visitor's IP address.
function identityOf(req) {
  const u = req.user;
  if (u && !u.isOffline && (u._id || u.id)) {
    const id = String(u._id || u.id);
    const plan = typeof u.plan === "string" ? u.plan : "free";
    return { key: mongoose.isValidObjectId(id) ? `user:${id}` : `uid:${id}`, plan, signedIn: true };
  }
  // req.ip honours the app's "trust proxy" setting; a header the client
  // could set itself (CF-Connecting-IP) would let anyone dodge the limits.
  const ip = String(req.ip || "unknown");
  return { key: `ip:${ip}`, plan: "free", signedIn: false };
}

const persistence = () => (mongoReady() ? "database" : "server");

module.exports = { summarize, blockedBy, check, record, consume, limitMessage, relative, identityOf, persistence, _memory: memory };
