// Dispatch: hand a task to VetroAI on your computer from your phone, and come
// back to the finished work. The phone writes a request to Firestore, the
// computer (VetroAI open in Computer, "Accept tasks" on) picks it up, runs it
// as an ordinary Computer task and writes its progress and result back.
//
// This file is the part with no Firebase in it, so it can be tested on its own.
// The Firestore side is lib/dispatch.js.

/** How often a computer that accepts tasks says it is still there. */
export const HEARTBEAT_MS = 25_000;
/** A computer not heard from for this long counts as offline. */
export const ONLINE_WINDOW_MS = 75_000;
// No limits of our own on a task, its result or its progress. The one cap that
// can't go is Firestore's: a document holds at most 1 MiB. Text is measured in
// UTF-8 bytes (a Tamil or Hindi letter is 3), leaving room for the other fields.
export const DOC_TEXT_BYTES = 900_000;

/** `text`, cut only if it would not fit in a Firestore document. */
export function clipToBytes(text = "", maxBytes = DOC_TEXT_BYTES, note = "") {
  const s = String(text || "");
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) return s;
  const room = maxBytes - new TextEncoder().encode(note).length;
  // fatal: false drops a character split at the cut instead of throwing.
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, Math.max(0, room))).replace(/�$/, "").trimEnd() + note;
}

/** queued → (awaiting_approval →) claimed → running → done | failed | cancelled */
export const DISPATCH_STATUSES = ["queued", "awaiting_approval", "claimed", "running", "done", "failed", "cancelled"];
export const FINISHED = new Set(["done", "failed", "cancelled"]);

export const isOnline = (device, now = Date.now()) =>
  Boolean(device?.accepting) && Number(device?.lastSeen) > 0 && now - Number(device.lastSeen) < ONLINE_WINDOW_MS;

export function deviceLabel(platform = "", desktopApp = false) {
  const p = String(platform).toLowerCase();
  const name = p.startsWith("win") ? "Windows PC" : p === "darwin" || p.includes("mac") ? "Mac" : p.includes("linux") ? "Linux PC" : "Computer";
  return desktopApp ? name : `${name} (browser)`;
}

/**
 * The next request this computer should take: the oldest one still queued that
 * was sent to it or to any computer.
 */
export function nextQueued(dispatches, deviceId) {
  return [...(dispatches || [])]
    .filter((d) => d?.status === "queued" && !d.cancelRequested && (!d.target || d.target === "any" || d.target === deviceId))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0] || null;
}

/**
 * Requests this computer took and then lost track of — the app was closed or
 * reloaded mid-run. Left alone they would read "working…" on the phone forever.
 */
export function orphanedRuns(dispatches, deviceId, currentId = null) {
  return (dispatches || []).filter((d) => d?.claimedBy === deviceId && ["claimed", "running"].includes(d.status) && d.id !== currentId);
}

/**
 * The whole result goes to the phone, code included. A website's raw HTML is
 * the one thing left out: it can't be previewed on the phone, so the phone is
 * told it was built instead.
 */
export function summarizeForPhone(content = "") {
  let text = String(content || "");
  let website = false;
  text = text.replace(/```html[\s\S]*?(?:```|$)/gi, () => {
    website = true;
    return "\n_🌐 Website built — open it on your computer to preview or publish it._\n";
  });
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  text = clipToBytes(text, DOC_TEXT_BYTES, "…\n\n_The rest is on your computer (too large for one sync)._");
  return { text, website };
}

const TASK_TO_DISPATCH = { running: "running", completed: "done", failed: "failed", stopped: "cancelled", paused: "cancelled" };

/**
 * What the phone should see for a Computer task that came from a dispatch,
 * or null while there is nothing to say yet (the task is still being set up).
 */
export function toDispatchUpdate(task) {
  const status = TASK_TO_DISPATCH[task?.status];
  if (!status) return null;
  const active = (task.steps || []).find((s) => s.status === "active");
  const done = (task.steps || []).filter((s) => s.status === "done").length;
  const update = {
    status,
    progress: status === "running" && active ? [active.label, active.detail].filter(Boolean).join(" — ") : "",
    stepsDone: done,
    stepsTotal: (task.steps || []).length,
  };
  if (FINISHED.has(status)) {
    const reply = [...(task.messages || [])].reverse().find((m) => m.role === "assistant");
    const { text, website } = summarizeForPhone(reply?.content || "");
    update.result = text || (status === "done" ? "Done." : "");
    update.website = website;
    update.finishedAt = reply?.finishedAt || Date.now();
  }
  return update;
}

/** "just now", "5 min ago", "3 hr ago", then the date. */
export function formatAgo(ts, now = Date.now()) {
  if (!ts) return "";
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} hr ago`;
  return new Date(ts).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** What the phone shows under a request, in plain words. */
export function describeDispatch(d, devices = [], now = Date.now()) {
  const device = devices.find((x) => x.id === (d.claimedBy || d.target));
  const anyOnline = devices.some((x) => isOnline(x, now));
  const name = device?.name || "your computer";
  switch (d.status) {
    case "queued":
      if (d.target && d.target !== "any") return isOnline(device, now) ? `Sent to ${name} — starting soon` : `Waiting for ${name} to come online`;
      return anyOnline ? "Sent — your computer will start it in a moment" : "Waiting for your computer to come online";
    case "awaiting_approval": return "Needs your OK before it starts";
    case "claimed": return `${name} picked this up`;
    case "running": return device && !isOnline(device, now) ? `${name} went offline while working on this` : d.progress || `Working on ${name}…`;
    case "done": return `Done on ${name}`;
    case "failed": return d.error || "Couldn't finish this";
    case "cancelled": return "Cancelled";
    default: return "";
  }
}

// ─── Pairing a phone with a computer ──────────────────────────────────────
// The computer shows a QR code of a link to this app. Opening it on the phone
// goes straight to Dispatch, aimed at that computer. Both ends still sign in
// with the same VetroAI account — that is what lets the phone reach it — so
// the link carries a short account tag to catch a phone signed in as someone
// else, and a masked email to say who to sign in as.

export const PAIR_PARAM = "dispatch";

/** "vel21873@gmail.com" → "ve•••@gmail.com" */
export function maskEmail(email = "") {
  const [name, domain] = String(email).split("@");
  if (!name || !domain) return "";
  return `${name.slice(0, 2)}•••@${domain}`;
}

const acctTag = (uid) => String(uid || "").slice(0, 10);

export function pairLink(origin, { deviceId, uid, email }) {
  const params = new URLSearchParams({ [PAIR_PARAM]: deviceId, acct: acctTag(uid) });
  const hint = maskEmail(email);
  if (hint) params.set("as", hint);
  return `${String(origin).replace(/\/+$/, "")}/?${params}`;
}

/** The pairing in a URL's query string, or null. */
export function readPairLink(search = "") {
  const params = new URLSearchParams(search);
  const deviceId = params.get(PAIR_PARAM);
  if (!deviceId || !/^dev_[\w-]{1,80}$/.test(deviceId)) return null;
  return { deviceId, acct: params.get("acct") || "", as: params.get("as") || "" };
}

/** Whether the phone's account is the one the computer showed the code for. */
export const pairMatchesAccount = (pair, uid) => !pair?.acct || acctTag(uid) === pair.acct;

export function phoneLabel(userAgent = "") {
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) return "Android phone";
  return "Phone";
}

/** Computers only — a paired phone also has a device document. */
export const isComputerDevice = (d) => d?.kind !== "phone";

// The link is consumed on load (and removed from the address bar), then kept
// for the tab until Dispatch opens — signing in first doesn't lose it.
const PAIR_KEY = "vetroai_dispatch_pair";
export function stashPair(pair) {
  try { sessionStorage.setItem(PAIR_KEY, JSON.stringify(pair)); } catch { /* storage unavailable */ }
}
export function peekPair() {
  try { return JSON.parse(sessionStorage.getItem(PAIR_KEY) || "null"); } catch { return null; }
}
export function clearPair() {
  try { sessionStorage.removeItem(PAIR_KEY); } catch { /* storage unavailable */ }
}
