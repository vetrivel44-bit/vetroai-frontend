// What time it is — for the user, not for the server.
//
// The server runs in UTC. Every "Today is …" line used to come from the
// server's clock, so a user in India asking "what is today's date" at
// 12:47 AM on the 25th was told it was the 24th. The browser now sends its
// IANA timezone with each request; dates in prompts and search context are
// written in that zone, and questions that are *only* about the date or time
// are recognised so they can be answered from the clock instead of from web
// pages (which were written in some other timezone, on some other day).

const { find: findTimezone } = require("geo-tz");

const GEOCODE_URL = "https://nominatim.openstreetmap.org/search";

/** The IANA zone if the runtime knows it, else null. */
function validTimeZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** "UTC+05:30" for a zone at an instant. */
function utcOffset(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(now);
  const name = parts.find((p) => p.type === "timeZoneName")?.value || "GMT";
  return name === "GMT" ? "UTC+00:00" : name.replace("GMT", "UTC");
}

/**
 * The user's clock from a request body: `clientTimeZone` (IANA) is trusted
 * only if valid. Falls back to UTC, flagged so prompts can say so.
 */
function clientClock(body = {}, now = new Date()) {
  const timeZone = validTimeZone(body.clientTimeZone || body.timeZone);
  return { timeZone: timeZone || "UTC", known: !!timeZone, now };
}

/** { date: "Friday, 25 September 2026", time: "12:47 AM", offset, timeZone, isoDate } */
function describeClock({ timeZone = "UTC", now = new Date() } = {}) {
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(now);
  const isoDate = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return { date, time, isoDate, timeZone, offset: utcOffset(timeZone, now) };
}

/** One line for prompts and search context. */
function clockLine(clock) {
  const c = describeClock(clock);
  const zone = clock?.known === false ? "server time, UTC — the user's timezone is unknown" : `${c.timeZone}, ${c.offset}`;
  return `Today is ${c.date}; the user's local time is ${c.time} (${zone}).`;
}

// ─── recognising date/time questions ────────────────────────────────────────
// Deliberately narrow: only a question that is *just* about the date, day or
// time. "What is today's weather" or "today's news" must still search.
const LEAD = /^(hey|hi|hello|ok|okay|so|vetro(ai)?|please|pls|can you tell me|could you tell me|tell me|do you know|may i know|i want to know)\s+/;
const TAIL = /\s+(please|pls|now|right now|currently|exactly)$/;

function normalizeQuestion(q) {
  let s = String(q || "").toLowerCase().replace(/[’`]/g, "'").replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) s = s.replace(LEAD, "").replace(TAIL, "").trim();
  return s;
}

const WHAT = "(?:what(?:'s| is)?\\s+|whats\\s+)?(?:the\\s+)?";
const DATE_RE = new RegExp(`^(?:${WHAT}(?:today'?s|todays|current|present)\\s+date|${WHAT}date(?:\\s+(?:today|is it|is it today|is today))?|what date is (?:it|today)|today'?s?\\s+date|date today|today date)$`);
const DAY_RE = /^(?:what day (?:is it(?: today)?|is today|of the week is (?:it|today)(?: today)?)|which day is (?:it|today)|what(?:'s| is) today|today is what day|what day today)$/;
const TIME_RE = new RegExp(`^(?:${WHAT}(?:current\\s+|exact\\s+|local\\s+)?time(?:\\s+(?:is it|now))?|what time is it|time now|current time)$`);
const DATETIME_RE = new RegExp(`^(?:${WHAT}(?:current\\s+)?date and time|${WHAT}time and date)$`);
const PLACE_RE = new RegExp(`^(?:${WHAT}(?:current\\s+|local\\s+|exact\\s+)?(time|date|day|date and time)(?:\\s+(?:is it|now|today))?|what time is it|what day is it|what date is it)\\s+(?:in|at)\\s+([a-z][a-z .'-]{1,60})$`);

/**
 * { kind: "date" | "day" | "time" | "datetime", place: string|null } when the
 * question is only asking for the date/day/time (here or in a named place),
 * else null.
 */
function detectClockQuestion(query) {
  const s = normalizeQuestion(query);
  if (!s || s.length > 90) return null;
  const place = PLACE_RE.exec(s);
  if (place) {
    const word = place[1] || (/day/.test(s) ? "day" : /date/.test(s) ? "date" : "time");
    const kind = word === "date and time" ? "datetime" : word;
    const where = place[2].replace(/\s+(right now|now|today)$/, "").trim();
    if (!where || /^(the )?(world|morning|evening|night|future|past)$/.test(where)) return null;
    return { kind, place: where };
  }
  if (DATETIME_RE.test(s)) return { kind: "datetime", place: null };
  if (DATE_RE.test(s)) return { kind: "date", place: null };
  if (DAY_RE.test(s)) return { kind: "day", place: null };
  if (TIME_RE.test(s)) return { kind: "time", place: null };
  return null;
}

// ─── time somewhere else ────────────────────────────────────────────────────
const placeCache = new Map();

/** IANA zone for a place name via Nominatim + geo-tz (cached). */
async function timeZoneForPlace(place, fetchFn = fetch) {
  const key = String(place || "").trim().toLowerCase();
  if (!key) return null;
  if (placeCache.has(key)) return placeCache.get(key);
  const res = await fetchFn(`${GEOCODE_URL}?format=json&limit=1&q=${encodeURIComponent(key)}`, {
    headers: { "User-Agent": "VetroAI/1.0 (world-clock)" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Geocoding error ${res.status}`);
  const results = await res.json();
  if (!results?.length) {
    placeCache.set(key, null);
    return null;
  }
  const [timeZone] = findTimezone(parseFloat(results[0].lat), parseFloat(results[0].lon));
  const value = timeZone ? { timeZone, name: String(results[0].display_name || place).split(",")[0].trim() } : null;
  placeCache.set(key, value);
  return value;
}

module.exports = {
  validTimeZone,
  clientClock,
  describeClock,
  clockLine,
  detectClockQuestion,
  normalizeQuestion,
  timeZoneForPlace,
};
