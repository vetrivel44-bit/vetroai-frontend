// What VetroAI Computer's browser really did, as the backend reported it
// (backend browseService.js, "browse" events): the search, then each page it
// opened, first as loading and then as read, partly read, blocked or failed.
// LiveBrowser shows this log as it arrives; nothing on screen is invented.

const FINAL = new Set(["done", "read", "partial", "blocked", "failed"]);

/** Whether an entry's outcome is known (it is no longer searching or loading). */
export const isFinal = (entry) => Boolean(entry) && FINAL.has(entry.status);

/** Whether the page gave content the answer could use. */
export const wasRead = (entry) => entry?.kind === "visit" && (entry.status === "read" || entry.status === "partial");

/**
 * The log with one more event: a new entry is added at the end, an update to
 * an entry already there (same id) replaces it in place.
 */
export function mergeBrowseEvent(log, event) {
  if (!event?.id || !event.kind) return log || [];
  const list = log || [];
  const at = list.findIndex((e) => e.id === event.id);
  if (at === -1) return [...list, event];
  const next = list.slice();
  next[at] = { ...list[at], ...event };
  return next;
}

/**
 * The [n] each read page is cited as: pages that gave content, numbered in the
 * order they were opened (as the backend numbers them for the answer).
 */
export function citationNumbers(log) {
  const numbers = new Map();
  for (const entry of log || []) if (wasRead(entry)) numbers.set(entry.id, numbers.size + 1);
  return numbers;
}

/** Counts for the footer, and whether everything has an outcome. */
export function browseSummary(log) {
  const visits = (log || []).filter((e) => e.kind === "visit");
  const count = (status) => visits.filter((e) => e.status === status).length;
  return {
    searches: (log || []).filter((e) => e.kind === "search").length,
    opened: visits.length,
    read: count("read"),
    partial: count("partial"),
    blocked: count("blocked"),
    failed: count("failed"),
    loading: visits.filter((e) => !isFinal(e)).length,
    finished: (log || []).length > 0 && (log || []).every(isFinal),
  };
}

/** One line for an entry's outcome, as the browser shows it. */
export function outcomeText(entry) {
  if (!entry) return "";
  if (entry.kind === "search") {
    if (entry.status !== "done") return `Searching “${entry.query}”`;
    return `${entry.found ?? 0} ${entry.found === 1 ? "result" : "results"} for “${entry.query}”`;
  }
  switch (entry.status) {
    case "loading": return `Opening ${entry.domain}…`;
    case "read": return `Read ${entry.domain}`;
    case "partial": return `Partly read ${entry.domain}: ${entry.reason}`;
    case "blocked": return `${entry.domain} blocked the visit: ${entry.reason}. Not used.`;
    case "failed": return `Couldn't open ${entry.domain}: ${entry.reason}. Not used.`;
    default: return entry.domain || "";
  }
}
