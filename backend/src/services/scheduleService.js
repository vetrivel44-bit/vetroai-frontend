const mongoose = require("mongoose");
const logger = require("../utils/logger");
const { config } = require("../config/env");
const { searchWeb } = require("../controllers/searchController");
const { defaultThinker } = require("./agenticSearchService");
const { describeClock } = require("./clockService");

// Scheduled tasks for VetroAI Computer: work that runs while the user is away
// — "every morning at 8, today's top news and the cricket scores", "tell me
// when the iPhone 17 drops below ₹70,000". Each run searches the web, has a
// model write the update (or check the condition), keeps the result for the
// user's Scheduled inbox and, when email is set up, mails it.
//
// Stored in MongoDB, so schedules survive restarts and a sleeping free
// instance. Without a database they are kept in memory only — the API says
// so (`durable: false`) and the app tells the user.

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const MAX_RUNS_KEPT = 20;
const MAX_ACTIVE_PER_USER = 10;
const MIN_INTERVAL_HOURS = 1;

// ── When a task runs next ────────────────────────────────────────────────────

/** Minutes east of UTC for a time zone at a moment ("Asia/Kolkata" → 330). */
function tzOffsetMinutes(timeZone, at) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(at)).filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
    return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

const validZone = (tz) => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
};

/**
 * Cleans a schedule from the client: { every: "day" | "week" | "hours",
 * time: "HH:MM", day: 0–6 (Sunday = 0), hours: n, tz }. Null if unusable.
 */
function normalizeSchedule(raw = {}) {
  const every = ["day", "week", "hours"].includes(raw.every) ? raw.every : null;
  if (!every) return null;
  const tz = typeof raw.tz === "string" && validZone(raw.tz) ? raw.tz : "UTC";
  if (every === "hours") {
    const hours = Math.round(Number(raw.hours));
    if (!Number.isFinite(hours) || hours < MIN_INTERVAL_HOURS || hours > 168) return null;
    return { every, hours, tz };
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw.time || ""));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const time = `${m[1].padStart(2, "0")}:${m[2]}`;
  if (every === "week") {
    const day = Number(raw.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) return null;
    return { every, time, day, tz };
  }
  return { every, time, tz };
}

/** The first run time strictly after `from` (ms). */
function nextRunAt(schedule, from = Date.now()) {
  if (schedule.every === "hours") return from + schedule.hours * HOUR;
  const [hh, mm] = schedule.time.split(":").map(Number);
  const offset = tzOffsetMinutes(schedule.tz, from);
  // The user's local calendar date "now", as a UTC-based date.
  const local = new Date(from + offset * 60000);
  for (let add = 0; add <= 8; add++) {
    const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + add, hh, mm));
    if (schedule.every === "week" && day.getUTCDay() !== schedule.day) continue;
    // Local wall time → UTC, with the offset at that moment (summer time).
    let at = day.getTime() - offset * 60000;
    at = day.getTime() - tzOffsetMinutes(schedule.tz, at) * 60000;
    if (at > from) return at;
  }
  return from + DAY;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function describeSchedule(s) {
  if (!s) return "";
  if (s.every === "hours") return s.hours === 1 ? "Every hour" : `Every ${s.hours} hours`;
  const [h, m] = s.time.split(":").map(Number);
  const clock = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  return s.every === "week" ? `Every ${DAY_NAMES[s.day]} at ${clock}` : `Every day at ${clock}`;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const runSchema = new mongoose.Schema({ at: Number, ok: Boolean, text: String, met: Boolean, value: String, error: String }, { _id: false });
const ScheduledTask = mongoose.models.ScheduledTask || mongoose.model("ScheduledTask", new mongoose.Schema({
  owner: { type: String, required: true, index: true },
  email: { type: String, default: "" },
  title: { type: String, required: true },
  prompt: { type: String, required: true },
  kind: { type: String, enum: ["brief", "watch"], default: "brief" },
  condition: { type: String, default: "" },
  schedule: { type: mongoose.Schema.Types.Mixed, required: true },
  active: { type: Boolean, default: true, index: true },
  nextRunAt: { type: Number, index: true },
  lastRunAt: { type: Number, default: null },
  unread: { type: Number, default: 0 },
  runs: { type: [runSchema], default: [] },
}, { timestamps: true }));

const mongoReady = () => mongoose.connection.readyState === 1;
const memory = new Map();
let memorySeq = 0;
const plain = (doc) => (doc ? { ...(doc.toObject ? doc.toObject() : doc), id: String(doc._id || doc.id) } : null);

const store = {
  durable: () => mongoReady(),
  async list(owner) {
    if (mongoReady()) return (await ScheduledTask.find({ owner }).sort({ createdAt: -1 }).lean()).map(plain);
    return [...memory.values()].filter((t) => t.owner === owner).sort((a, b) => b.createdAt - a.createdAt).map(plain);
  },
  async get(id) {
    if (mongoReady()) return mongoose.isValidObjectId(id) ? plain(await ScheduledTask.findById(id).lean()) : null;
    return plain(memory.get(String(id)) || null);
  },
  async create(doc) {
    if (mongoReady()) return plain((await ScheduledTask.create(doc)).toObject());
    const id = `m${++memorySeq}`;
    const task = { ...doc, _id: id, unread: 0, runs: [], lastRunAt: null, createdAt: Date.now() };
    memory.set(id, task);
    return plain(task);
  },
  async update(id, patch) {
    if (mongoReady()) return plain(await ScheduledTask.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean());
    const task = memory.get(String(id));
    if (!task) return null;
    Object.assign(task, patch);
    return plain(task);
  },
  async remove(id) {
    if (mongoReady()) return void (await ScheduledTask.deleteOne({ _id: id }));
    memory.delete(String(id));
  },
  async countActive(owner) {
    if (mongoReady()) return ScheduledTask.countDocuments({ owner, active: true });
    return [...memory.values()].filter((t) => t.owner === owner && t.active).length;
  },
  /** Claims due tasks by moving their next run on first, so two callers can't both run one. */
  async claimDue(now, limit) {
    const due = mongoReady()
      ? (await ScheduledTask.find({ active: true, nextRunAt: { $lte: now } }).sort({ nextRunAt: 1 }).limit(limit).lean()).map(plain)
      : [...memory.values()].filter((t) => t.active && t.nextRunAt <= now).sort((a, b) => a.nextRunAt - b.nextRunAt).slice(0, limit).map(plain);
    const claimed = [];
    for (const task of due) {
      const next = nextRunAt(task.schedule, now);
      if (mongoReady()) {
        const res = await ScheduledTask.updateOne({ _id: task.id, nextRunAt: task.nextRunAt }, { $set: { nextRunAt: next } });
        if (res.modifiedCount === 1) claimed.push({ ...task, nextRunAt: next });
      } else {
        memory.get(task.id).nextRunAt = next;
        claimed.push({ ...task, nextRunAt: next });
      }
    }
    return claimed;
  },
  _memory: memory,
};

// ── Running a task ───────────────────────────────────────────────────────────

const BRIEF_PROMPT = (task, clock, context) => [
  `${clock}`,
  `You are VetroAI, running a scheduled task the user set up: "${task.prompt}".`,
  "Using the web results below, write the update they asked for: short and scannable Markdown (at most ~200 words), the key facts, numbers and names first, today's information only.",
  "Cite sources inline as [n] using the numbers of the results. If the results don't answer part of it, say so in one line instead of guessing.",
  "",
  "WEB RESULTS:",
  context || "(no results)",
].join("\n");

const WATCH_PROMPT = (task, clock, context) => [
  `${clock}`,
  `You are VetroAI, checking a condition the user is watching: "${task.condition || task.prompt}" (task: "${task.prompt}").`,
  "Using only the web results below, decide whether the condition is true right now.",
  'Reply with ONLY JSON: {"met": true or false, "value": "the current value you found, e.g. ₹68,999 on Amazon", "summary": "one or two sentences with the evidence, citing [n]"}.',
  'If the results don\'t show the current value, use "met": false and say so in summary.',
  "",
  "WEB RESULTS:",
  context || "(no results)",
].join("\n");

function parseWatch(text) {
  const src = String(text || "");
  try {
    const data = JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
    return { met: data.met === true, value: String(data.value || "").slice(0, 200), summary: String(data.summary || "").slice(0, 1200) };
  } catch {
    return { met: false, value: "", summary: src.slice(0, 600) };
  }
}

async function sendEmail(to, subject, text) {
  if (!config.resendApiKey || !config.mailFrom || !to) return false;
  try {
    const html = `<div style="font:15px/1.6 system-ui,sans-serif;color:#1F1E1D;max-width:620px">${String(text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}<p style="margin-top:20px;color:#78746E;font-size:12px">From your scheduled tasks in VetroAI Computer.</p></div>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.mailFrom, to: [to], subject, html }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (err) {
    logger.warn("schedule.emailFailed", { error: err.message });
    return false;
  }
}

/** Runs one task now: search, write, keep the result. `deps` is for tests. */
async function runTask(task, { now = Date.now(), search = searchWeb, think = defaultThinker(), email = sendEmail } = {}) {
  const tz = task.schedule?.tz || "UTC";
  const clockText = (() => {
    const c = describeClock({ timeZone: tz, now: new Date(now) });
    return `Today is ${c.date}; the user's local time is ${c.time} (${tz}).`;
  })();
  let run;
  try {
    if (!think) throw new Error("No AI model is configured on the server (GROQ_API_KEY or AIROUTER_API_KEY).");
    const { context } = await search(task.kind === "watch" ? task.condition || task.prompt : task.prompt, { clock: { timeZone: tz, now: new Date(now) } });
    const text = await think((task.kind === "watch" ? WATCH_PROMPT : BRIEF_PROMPT)(task, clockText, context), task.kind === "watch" ? 400 : 900);
    if (task.kind === "watch") {
      const w = parseWatch(text);
      run = { at: now, ok: true, met: w.met, value: w.value, text: w.summary };
    } else {
      if (!String(text || "").trim()) throw new Error("The model returned nothing.");
      run = { at: now, ok: true, text: String(text).slice(0, 6000) };
    }
  } catch (err) {
    run = { at: now, ok: false, error: err.message };
  }
  const notify = run.ok && (task.kind !== "watch" || run.met);
  const patch = {
    lastRunAt: now,
    runs: [run, ...(task.runs || [])].slice(0, MAX_RUNS_KEPT),
    unread: (task.unread || 0) + (notify ? 1 : 0),
  };
  // A watched condition that came true has done its job.
  if (task.kind === "watch" && run.met) patch.active = false;
  const saved = await store.update(task.id, patch);
  if (notify) {
    const subject = task.kind === "watch" ? `✅ ${task.title}: ${run.value || "it happened"}` : `${task.title} — ${new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(new Date(now))}`;
    await email(task.email, subject, run.text || "");
  }
  return saved;
}

let running = false;
/** Runs every task that is due (at most `limit` per call). */
async function runDue({ now = Date.now(), limit = 10, deps } = {}) {
  if (running) return { ran: 0, busy: true };
  running = true;
  try {
    const due = await store.claimDue(now, limit);
    for (const task of due) {
      try { await runTask(task, { now, ...deps }); } catch (err) { logger.warn("schedule.runFailed", { id: task.id, error: err.message }); }
    }
    return { ran: due.length };
  } finally {
    running = false;
  }
}

/** The fields a user may set, checked. Throws a message for the user when something is wrong. */
function cleanInput(body = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || body.prompt !== undefined) {
    const prompt = String(body.prompt || "").trim();
    if (prompt.length < 4) throw new Error("Say what the task should do.");
    out.prompt = prompt.slice(0, 1000);
  }
  if (!partial || body.title !== undefined) out.title = String(body.title || body.prompt || "Scheduled task").trim().slice(0, 80);
  if (!partial || body.kind !== undefined) out.kind = body.kind === "watch" ? "watch" : "brief";
  if (!partial || body.condition !== undefined) out.condition = String(body.condition || "").trim().slice(0, 300);
  if ((out.kind === "watch") && !out.condition) throw new Error("Say what to watch for, e.g. “the price drops below ₹40,000”.");
  if (!partial || body.schedule !== undefined) {
    const schedule = normalizeSchedule(body.schedule);
    if (!schedule) throw new Error("Choose when it should run.");
    out.schedule = schedule;
  }
  if (body.active !== undefined) out.active = Boolean(body.active);
  return out;
}

module.exports = {
  store, runTask, runDue, nextRunAt, normalizeSchedule, describeSchedule, tzOffsetMinutes, parseWatch, cleanInput, sendEmail,
  MAX_ACTIVE_PER_USER,
};
