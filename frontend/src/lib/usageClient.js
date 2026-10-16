// The app's side of usage limits (backend: services/usageService.js).
// The server counts every message; this sends who is asking, lets browser
// models check in before they answer, and words reset times.

/** Authorization for the signed-in user (a Firebase ID token), if any. */
export function authHeaders(storage = globalThis.localStorage) {
  let token = null;
  try { token = storage?.getItem("token"); } catch { /* storage unavailable */ }
  return token && !token.startsWith("local_") ? { Authorization: `Bearer ${token}` } : {};
}

/** A message refused because a usage limit is used up. */
export class UsageLimitError extends Error {
  constructor(message, limit) {
    super(message);
    this.name = "UsageLimitError";
    this.usageLimit = limit; // { window, resetsAt, model }
  }
}

/**
 * Asks whether a model that answers in the browser may answer now. Nothing is
 * counted yet: it may still fail (out of credits) and hand the message to
 * another model. Throws UsageLimitError when a limit is used up. If the
 * server can't be reached the message goes ahead: a usage check must never
 * take chat down.
 */
export async function checkUsage(api, model, { fetchImpl = globalThis.fetch, signal } = {}) {
  let res;
  try {
    res = await fetchImpl(`${api}/usage/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ model }),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return null;
  }
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    if (body?.code === "USAGE_LIMIT") throw new UsageLimitError(body.message || "You've reached your usage limit.", { ...body.block, model });
  }
  return res.ok ? (await res.json().catch(() => null))?.data || null : null;
}

/** Counts a message once a browser model has actually answered it. */
export function recordUsage(api, model, { fetchImpl = globalThis.fetch } = {}) {
  return fetchImpl(`${api}/usage/record`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ model }),
    keepalive: true,
  }).catch(() => null);
}

/** "2 hr 14 min" until `resetsAt`. */
export function formatResetIn(resetsAt, now = Date.now()) {
  const mins = Math.max(1, Math.ceil((resetsAt - now) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours < 24) return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${days} day${days === 1 ? "" : "s"} ${h} hr` : `${days} day${days === 1 ? "" : "s"}`;
}

/** "4:30 PM" today, "tomorrow 9:05 AM", else "Fri, Oct 23, 5:23 PM". */
export function formatResetAt(resetsAt, now = Date.now(), locale) {
  const at = new Date(resetsAt);
  const time = at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const today = new Date(now);
  if (today.toDateString() === at.toDateString()) return time;
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (tomorrow.toDateString() === at.toDateString()) return `tomorrow ${time}`;
  return `${at.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

export const WINDOW_TITLES = {
  session: "5-hour limit",
  weekly: "Weekly limit",
  premium: "Weekly limit · most capable models",
};
