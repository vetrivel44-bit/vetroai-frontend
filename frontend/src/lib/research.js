// DeepSearch's activity log, as the backend streams it (`research` events,
// see backend/src/services/agenticSearchService.js): a snapshot of
// { phase, angles, angleSources, domains, steps: [{ id, label, detail,
// status, items }], sources, pagesRead, queries, elapsedMs }, replaced whole
// on every event.

const FINISHED = new Set(["done", "failed"]);

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Still researching (or writing) right now. */
export function isResearching(research, live) {
  return Boolean(live && research && !FINISHED.has(research.phase));
}

/** "Researching", "Writing the report", "Research complete" or "Research stopped". */
export function researchTitle(research, live = false) {
  if (!research) return "";
  if (isResearching(research, live)) return research.phase === "writing" ? "Writing the report" : "Researching";
  return research.phase === "done" ? "Research complete" : "Research stopped";
}

/** The line under the title: what's happening now, or what was done. */
export function researchMeta(research, { live = false, elapsedMs } = {}) {
  if (!research) return "";
  const sources = Number(research.sources) || 0;
  const queries = Number(research.queries) || 0;
  if (isResearching(research, live)) {
    const active = [...(research.steps || [])].reverse().find((s) => s.status === "active");
    return [active?.label, sources ? plural(sources, "source") : "", formatDuration(elapsedMs ?? research.elapsedMs)].filter(Boolean).join(" · ");
  }
  return [sources ? plural(sources, "source") : "", queries ? plural(queries, "search", "searches") : "", formatDuration(research.elapsedMs)].filter(Boolean).join(" · ");
}

/** "9 searches · 14 pages read" */
export function researchStats(research) {
  if (!research) return "";
  const parts = [];
  const q = Number(research.queries) || 0;
  const p = Number(research.pagesRead) || 0;
  if (q) parts.push(plural(q, "search", "searches"));
  if (p) parts.push(`${plural(p, "page")} read`);
  return parts.join(" · ");
}

// The five stages the progress bar shows, and which steps belong to each.
export const RESEARCH_STAGES = ["Plan", "Search", "Read", "Check", "Write"];

/** What kind of step this is, for its icon: plan, search, read, reflect, verify or write. */
export function stepKind(id = "") {
  if (id === "plan") return "plan";
  if (id.startsWith("search")) return "search";
  if (id === "read") return "read";
  if (id === "reflect") return "reflect";
  if (id.startsWith("verify")) return "verify";
  if (id === "write") return "write";
  return "search";
}

const STAGE_OF_KIND = { plan: 0, search: 1, read: 2, reflect: 3, verify: 3, write: 4 };

/**
 * Where the research is on the five stages: `reached` is the furthest stage
 * any step got to (the research loops back to searching after a gap, but the
 * bar doesn't move backwards), `current` the stage working right now, or -1.
 * A finished log has reached the end.
 */
export function stageProgress(research, live = false) {
  const steps = research?.steps || [];
  if (research?.phase === "done") return { reached: RESEARCH_STAGES.length, current: -1 };
  const reached = steps.reduce((max, s) => Math.max(max, STAGE_OF_KIND[stepKind(s.id)] ?? 0), -1);
  const active = isResearching(research, live) ? [...steps].reverse().find((s) => s.status === "active") : null;
  return { reached, current: active ? STAGE_OF_KIND[stepKind(active.id)] : -1 };
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
