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

/**
 * Starts a VetroAI Computer run against this week's allowance:
 * { allowed, computer: {used, limit, resetsAt}, plan, message }. If the
 * server can't be reached the run goes ahead.
 */
export async function startComputerRun(api, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  // The server may be waking up (a free host sleeps when idle). Don't hold the
  // task back waiting on it: no answer in a few seconds lets the run go ahead.
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  let timer;
  const timedOut = new Promise((resolve) => { timer = setTimeout(() => { controller?.abort(); resolve(null); }, timeoutMs); });
  try {
    const answer = await Promise.race([
      (async () => {
        const res = await fetchImpl(`${api}/usage/computer`, { method: "POST", headers: { ...authHeaders() }, signal: controller?.signal });
        return { res, body: await res.json().catch(() => ({})) };
      })(),
      timedOut,
    ]);
    if (!answer) return { allowed: true, computer: null, plan: null };
    const { res, body } = answer;
    if (res.status === 429 && body.code === "COMPUTER_LIMIT") {
      return { allowed: false, computer: body.data?.computer || null, plan: body.data?.plan || "free", message: body.message || "You've used this week's VetroAI Computer tasks.", resetsAt: body.block?.resetsAt || null };
    }
    return { allowed: true, computer: body.data?.computer || null, plan: body.data?.plan || null };
  } catch {
    return { allowed: true, computer: null, plan: null };
  } finally {
    clearTimeout(timer);
  }
}
