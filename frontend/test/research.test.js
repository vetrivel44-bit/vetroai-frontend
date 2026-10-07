import test from "node:test";
import assert from "node:assert/strict";

import { formatDuration, isResearching, researchHeadline, researchStats, settleResearch } from "../src/lib/research.js";

const log = (phase, extra = {}) => ({
  phase,
  angles: ["A", "B"],
  steps: [
    { id: "plan", label: "Planning the research", detail: "2 angles", status: "done" },
    { id: "search-0", label: "Searching 2 angles", detail: "", status: phase === "searching" ? "active" : "done" },
    ...(phase === "writing" || phase === "done" ? [{ id: "write", label: "Writing the report", detail: "", status: phase === "done" ? "done" : "active" }] : []),
  ],
  sources: 18,
  pagesRead: 14,
  queries: 11,
  elapsedMs: 72000,
  ...extra,
});

test("durations read like a stopwatch", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(42400), "42s");
  assert.equal(formatDuration(72000), "1m 12s");
  assert.equal(formatDuration(605000), "10m 05s");
  assert.equal(formatDuration(undefined), "0s");
});

test("the headline follows the research from running to finished", () => {
  assert.equal(researchHeadline(log("searching"), { live: true, elapsedMs: 9000 }), "Researching · 9s");
  assert.equal(researchHeadline(log("writing"), { live: true, elapsedMs: 80000 }), "Writing the report · 1m 20s");
  assert.equal(researchHeadline(log("done")), "Researched 18 sources in 1m 12s");
  assert.equal(researchHeadline(log("done", { sources: 1 })), "Researched 1 source in 1m 12s");
  assert.equal(researchHeadline(log("failed")), "Research stopped after 1m 12s");
  // A log that never got its final event (page reloaded mid-research) isn't "researched".
  assert.equal(researchHeadline(log("searching"), { live: false }), "Research stopped after 1m 12s");
  assert.equal(researchHeadline(null), "");
});

test("only a live, unfinished log counts as researching", () => {
  assert.equal(isResearching(log("searching"), true), true);
  assert.equal(isResearching(log("writing"), true), true);
  assert.equal(isResearching(log("searching"), false), false);
  assert.equal(isResearching(log("done"), true), false);
  assert.equal(isResearching(null, true), false);
});

test("stats count searches and pages read", () => {
  assert.equal(researchStats(log("done")), "11 searches · 14 pages read");
  assert.equal(researchStats(log("done", { queries: 1, pagesRead: 0 })), "1 search");
  assert.equal(researchStats(null), "");
});

test("settling closes the running steps, and leaves a finished log alone", () => {
  const done = settleResearch(log("writing"), "done");
  assert.equal(done.phase, "done");
  assert.deepEqual(done.steps.map((s) => s.status), ["done", "done", "done"]);

  const stopped = settleResearch(log("searching"), "failed");
  assert.deepEqual(stopped.steps.map((s) => s.status), ["done", "failed"]);

  const finished = log("done");
  assert.equal(settleResearch(finished, "failed"), finished);
  assert.equal(settleResearch(undefined), undefined);
});
