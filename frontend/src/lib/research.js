// DeepSearch's activity log, as the backend streams it (`research` events,
// see backend/src/services/agenticSearchService.js): a snapshot of
// { phase, angles, steps: [{ id, label, detail, status }], sources,
// pagesRead, queries, elapsedMs }, replaced whole on every event.

const FINISHED = new Set(["done", "failed"]);

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Still researching (or writing) right now. */
export function isResearching(research, live) {
  return Boolean(live && research && !FINISHED.has(research.phase));
}

/** The panel's one-line summary. */
export function researchHeadline(research, { live = false, elapsedMs } = {}) {
  if (!research) return "";
  if (isResearching(research, live)) {
    return `${research.phase === "writing" ? "Writing the report" : "Researching"} · ${formatDuration(elapsedMs ?? research.elapsedMs)}`;
  }
  const time = formatDuration(research.elapsedMs);
  if (research.phase === "done") {
    const n = Number(research.sources) || 0;
    return `Researched ${n} ${n === 1 ? "source" : "sources"} in ${time}`;
  }
  return `Research stopped after ${time}`;
}

/** "9 searches · 14 pages read" */
export function researchStats(research) {
  if (!research) return "";
  const parts = [];
  const q = Number(research.queries) || 0;
  const p = Number(research.pagesRead) || 0;
  if (q) parts.push(`${q} ${q === 1 ? "search" : "searches"}`);
  if (p) parts.push(`${p} ${p === 1 ? "page" : "pages"} read`);
  return parts.join(" · ");
}

/**
 * Closes the log: the steps still running end as done or failed. Used when
 * the browser writes the report itself, and when a turn ends without the
 * server's final event (stopped, or the connection dropped).
 */
export function settleResearch(research, phase = "done") {
  if (!research || FINISHED.has(research.phase)) return research;
  return {
    ...research,
    phase,
    steps: (research.steps || []).map((step) => (step.status === "active" ? { ...step, status: phase === "done" ? "done" : "failed" } : step)),
  };
}
