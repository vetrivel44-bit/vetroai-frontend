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
export const MAX_DISPATCH_TEXT = 4000;
const MAX_RESULT = 6000;

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
 * A phone screen can't show a whole website's HTML or a long code dump, and a
 * Firestore document has a size cap. Keep the words, say what was built.
 */
export function summarizeForPhone(content = "") {
  let text = String(content || "");
  let website = false;
  text = text.replace(/```html[\s\S]*?(?:```|$)/gi, () => {
    website = true;
    return "\n_🌐 Website built — open it on your computer to preview or publish it._\n";
  });
  text = text.replace(/```(\w*)\n([\s\S]*?)(?:```|$)/g, (block, lang, body) =>
    body.length > 1500 ? `\n_📄 ${lang ? `${lang} ` : ""}code (${body.split("\n").length} lines) — on your computer._\n` : block);
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (text.length > MAX_RESULT) text = `${text.slice(0, MAX_RESULT).trimEnd()}…\n\n_The full result is on your computer._`;
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
    progress: status === "running" && active ? [active.label, active.detail].filter(Boolean).join(" — ").slice(0, 240) : "",
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
