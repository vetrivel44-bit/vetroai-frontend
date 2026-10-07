import test from "node:test";
import assert from "node:assert/strict";

import {
  RESEARCH_STAGES, formatDuration, isResearching, researchMeta, researchStats, researchTitle,
  settleResearch, stageProgress, stepKind,
} from "../src/lib/research.js";

const step = (id, status, label = id) => ({ id, label, detail: "", status, items: [] });
const log = (phase, steps, extra = {}) => ({
  phase,
  angles: ["A", "B"],
  angleSources: [6, 4],
  domains: ["seci.gov.in", "reuters.com"],
  steps,
  sources: 18,
  sites: 11,
  pagesRead: 14,
  queries: 11,
  elapsedMs: 72000,
  ...extra,
});

const SEARCHING = log("searching", [step("plan", "done"), step("search-0", "active", "Searching 2 angles")]);
const WRITING = log("writing", [step("plan", "done"), step("search-0", "done"), step("read", "done"), step("write", "active", "Writing the report")]);
const DONE = settleResearch(WRITING, "done");

test("durations read like a stopwatch", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(42400), "42s");
  assert.equal(formatDuration(72000), "1m 12s");
  assert.equal(formatDuration(605000), "10m 05s");
  assert.equal(formatDuration(undefined), "0s");
});

test("the title follows the research from running to finished", () => {
  assert.equal(researchTitle(SEARCHING, true), "Researching");
  assert.equal(researchTitle(WRITING, true), "Writing the report");
  assert.equal(researchTitle(DONE), "Research complete");
  assert.equal(researchTitle(settleResearch(SEARCHING, "failed")), "Research stopped");
  // A log that never got its final event (page reloaded mid-research) isn't complete.
  assert.equal(researchTitle(SEARCHING, false), "Research stopped");
  assert.equal(researchTitle(null), "");
});

test("the meta line says what's happening now, then what was done", () => {
  assert.equal(researchMeta(SEARCHING, { live: true, elapsedMs: 9000 }), "Searching 2 angles · 18 sources · 9s");
  assert.equal(researchMeta(DONE), "18 sources · 11 searches · 1m 12s");
  assert.equal(researchMeta(log("done", [step("plan", "done")], { sources: 1, queries: 1 })), "1 source · 1 search · 1m 12s");
  assert.equal(researchMeta(null), "");
});

test("only a live, unfinished log counts as researching", () => {
  assert.equal(isResearching(SEARCHING, true), true);
  assert.equal(isResearching(WRITING, true), true);
  assert.equal(isResearching(SEARCHING, false), false);
  assert.equal(isResearching(DONE, true), false);
  assert.equal(isResearching(null, true), false);
});

test("steps are sorted into kinds for their icons", () => {
  assert.deepEqual(["plan", "search-0", "search-2", "read", "reflect", "verify", "verify-search", "write", "odd"].map(stepKind),
    ["plan", "search", "search", "read", "reflect", "verify", "verify", "write", "search"]);
});

test("the stage bar moves forward through plan, search, read, check and write, and never back", () => {
  assert.deepEqual(RESEARCH_STAGES, ["Plan", "Search", "Read", "Check", "Write"]);
  assert.deepEqual(stageProgress(SEARCHING, true), { reached: 1, current: 1 });
  // After a gap the research searches again, but the bar keeps what it reached.
  const followUp = log("searching", [step("plan", "done"), step("search-0", "done"), step("read", "done"), step("reflect", "done"), step("search-1", "active")]);
  assert.deepEqual(stageProgress(followUp, true), { reached: 3, current: 1 });
  assert.deepEqual(stageProgress(WRITING, true), { reached: 4, current: 4 });
  assert.deepEqual(stageProgress(DONE, false), { reached: 5, current: -1 });
  assert.deepEqual(stageProgress(SEARCHING, false), { reached: 1, current: -1 }, "a stopped log has nothing current");
});

test("stats count searches and pages read", () => {
  assert.equal(researchStats(DONE), "11 searches · 14 pages read");
  assert.equal(researchStats(log("done", [], { queries: 1, pagesRead: 0 })), "1 search");
  assert.equal(researchStats(null), "");
});

test("settling closes the running steps, and leaves a finished log alone", () => {
  assert.equal(DONE.phase, "done");
  assert.deepEqual(DONE.steps.map((s) => s.status), ["done", "done", "done", "done"]);
  const stopped = settleResearch(SEARCHING, "failed");
  assert.deepEqual(stopped.steps.map((s) => s.status), ["done", "failed"]);
  assert.equal(settleResearch(DONE, "failed"), DONE);
  assert.equal(settleResearch(undefined), undefined);
});
