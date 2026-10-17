import { authHeaders } from "./usageClient.js";

// The app's side of scheduled tasks (backend: services/scheduleService.js):
// the API, and reading "every morning at 8, send me…" into a schedule.

async function call(api, path, { method = "GET", body } = {}) {
  const res = await fetch(`${api}/schedules${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || `Server error: ${res.status}`);
  return data.data;
}

export const schedulesApi = (api) => ({
  list: () => call(api, ""),
  create: (task) => call(api, "", { method: "POST", body: task }),
  update: (id, patch) => call(api, `/${id}`, { method: "PATCH", body: patch }),
  remove: (id) => call(api, `/${id}`, { method: "DELETE" }),
  runNow: (id) => call(api, `/${id}/run`, { method: "POST" }),
  markRead: (id) => call(api, `/${id}/read`, { method: "POST" }),
});

export const SCHEDULE_REQUEST = /\b(every\s+(day|morning|evening|night|afternoon|week|hour|\d+\s*(hours?|hrs?)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|weekly|hourly|each (morning|day|evening)|(tell|alert|notify|ping|email) me (when|if|once)|let me know (when|if|once)|keep (an eye|watching)|watch (the|for))\b/i;

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const PART_OF_DAY = { morning: "08:00", noon: "12:00", afternoon: "13:00", evening: "18:00", night: "21:00", tonight: "21:00" };
const pad = (n) => String(n).padStart(2, "0");

/**
 * "Every morning at 8, send me today's top news" →
 * { kind: "brief", prompt: "Send me today's top news", schedule: { every: "day", time: "08:00", tz } }.
 * "Tell me when the iPhone 17 drops below ₹70,000" → a "watch" checked every 6 hours.
 */
export function parseScheduleText(text, tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC") {
  const t = String(text || "").trim();
  let time = null;
  const clock = /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(t) || /\bat\s+(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:%|hours?|hrs?|km|kg|₹|rs))/i.exec(t);
  if (clock) {
    let h = Number(clock[1]) % 24;
    const ampm = (clock[3] || "").toLowerCase().replace(/\./g, "");
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    if (!ampm && /\b(evening|night|tonight|afternoon)\b/i.test(t) && h < 12) h += 12;
    time = `${pad(h)}:${pad(Math.min(59, Number(clock[2] || 0)))}`;
  } else {
    const part = /\b(morning|noon|afternoon|evening|night|tonight)\b/i.exec(t);
    if (part) time = PART_OF_DAY[part[1].toLowerCase()];
  }
  const watch = /\b(tell|alert|notify|ping|email) me (when|if|once)\b|\blet me know (when|if|once)\b|\bkeep (an eye|watching)\b|\bwatch (the|for)\b/i.test(t);
  let schedule;
  const hours = /\bevery\s+(\d+)\s*(?:hours?|hrs?)\b/i.exec(t);
  const day = new RegExp(`\\b(?:every|each|on)\\s+(${DAYS.join("|")})s?\\b`, "i").exec(t);
  if (hours) schedule = { every: "hours", hours: Math.max(1, Math.min(168, Number(hours[1]))), tz };
  else if (/\b(every hour|hourly)\b/i.test(t)) schedule = { every: "hours", hours: 1, tz };
  else if (day || /\b(weekly|every week)\b/i.test(t)) schedule = { every: "week", day: day ? DAYS.indexOf(day[1].toLowerCase()) : 1, time: time || "09:00", tz };
  else if (watch && !time) schedule = { every: "hours", hours: 6, tz };
  else schedule = { every: "day", time: time || "08:00", tz };

  const condition = watch ? (/(?:when|if|once)\s+(.+)$/i.exec(t)?.[1] || "").replace(/[.!?]+$/, "").trim() : "";
  const prompt = t
    .replace(/\b(every|each)\s+(day|morning|evening|night|afternoon|week|hour|\d+\s*(?:hours?|hrs?)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/gi, " ")
    .replace(/\b(daily|weekly|hourly)\b/gi, " ")
    .replace(/\b(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)/gi, " ")
    .replace(/\bat\s+\d{1,2}(?::\d{2})?\b/gi, " ")
    .replace(/\b(in the|on)\s+(morning|evening|afternoon|night)\b/gi, " ")
    .replace(/^[\s,:;-]+|[\s,:;-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/^[,.\s]+/, "");
  const cleaned = prompt ? prompt.charAt(0).toUpperCase() + prompt.slice(1) : t;
  const title = (watch ? condition || cleaned : cleaned).replace(/^(send me|give me|tell me|show me|get me)\s+/i, "").replace(/[.!?]+$/, "");
  return {
    kind: watch ? "watch" : "brief",
    prompt: watch ? (condition || cleaned) : cleaned,
    condition,
    title: (title.charAt(0).toUpperCase() + title.slice(1)).slice(0, 60),
    schedule,
  };
}

/** "in 3 hr", "tomorrow 8:00 AM", "Mon 6:30 PM". */
export function formatWhen(ts, now = Date.now()) {
  if (!ts) return "";
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const mins = Math.round((ts - now) / 60000);
  if (mins >= 0 && mins < 60) return `in ${Math.max(1, mins)} min`;
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return `today ${time}`;
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `yesterday ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}
