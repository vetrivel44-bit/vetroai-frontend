// Date and time questions, answered from the user's own clock.
//
// "What is today's date" used to go to the web search, whose summary was
// written on a server in another timezone — so around midnight in India it
// gave yesterday's date, and it took seconds to do it. The device knows the
// answer exactly and instantly. "Time in <place>" asks the backend's
// /api/time, which looks the place's timezone up rather than reading pages.
//
// The question patterns mirror backend/src/services/clockService.js.

export const userTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
};

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

/** { kind: "date"|"day"|"time"|"datetime", place } or null. */
export function detectClockQuestion(query) {
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

/** Date, day, time and zone name for a timezone at an instant. */
export function clockParts(timeZone = userTimeZone(), now = new Date()) {
  const fmt = (opts) => new Intl.DateTimeFormat("en-GB", { timeZone, ...opts }).format(now);
  const zoneName = (() => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "long" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value || timeZone;
    } catch { return timeZone; }
  })();
  return {
    date: fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    weekday: fmt({ weekday: "long" }),
    dayMonthYear: fmt({ day: "numeric", month: "long", year: "numeric" }),
    time: new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(now),
    zoneName,
  };
}

/** The markdown answer to a clock question, for here (`where` null) or a named place. */
export function clockAnswer({ kind }, { timeZone = userTimeZone(), now = new Date(), where = null } = {}) {
  const c = clockParts(timeZone, now);
  const at = where ? ` in **${where}**` : "";
  const zone = ` _(${c.zoneName})_`;
  if (kind === "time") return `It's **${c.time}**${at} — ${c.date}.${zone}`;
  if (kind === "day") return `${where ? `In **${where}** it's` : "Today is"} **${c.weekday}**, ${c.dayMonthYear}.${where ? zone : ""}`;
  if (kind === "datetime") return `${where ? `In **${where}** it's` : "It's"} **${c.date}**, **${c.time}**.${zone}`;
  return `${where ? `In **${where}**, today is` : "Today is"} **${c.date}**.${where ? zone : ""}`;
}

/** "Today is Friday, 25 September 2026; local time 12:47 AM (India Standard Time)." for prompts. */
export function clockPromptLine(timeZone = userTimeZone(), now = new Date()) {
  const c = clockParts(timeZone, now);
  return `Today is ${c.date}; the user's local time is ${c.time} (${c.zoneName}, ${timeZone}). Use this for anything about today's date, day or time — never a date from search results.`;
}
