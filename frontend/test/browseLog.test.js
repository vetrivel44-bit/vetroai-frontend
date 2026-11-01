import test from "node:test";
import assert from "node:assert/strict";

import { mergeBrowseEvent, citationNumbers, browseSummary, outcomeText, isFinal, wasRead } from "../src/lib/browseLog.js";

// A run as the backend streams it (browseService.js).
const EVENTS = [
  { id: "search-0", kind: "search", query: "Pixel 10 Pro reviews", status: "searching" },
  { id: "search-0", kind: "search", query: "Pixel 10 Pro reviews", status: "done", found: 6 },
  { id: "page-0", kind: "visit", url: "https://reviews.test/a", domain: "reviews.test", title: "Review", status: "loading" },
  { id: "page-1", kind: "visit", url: "https://www.youtube.com/watch?v=abcdefghijk", domain: "youtube.com", title: "Video", status: "loading" },
  { id: "page-2", kind: "visit", url: "https://walled.test/", domain: "walled.test", title: "Walled", status: "loading" },
  { id: "page-1", kind: "visit", url: "https://www.youtube.com/watch?v=abcdefghijk", domain: "youtube.com", title: "Pixel 10 Pro — 3 months later", status: "partial", reason: "YouTube asked to sign in to confirm it's not a bot, so only the title and channel could be read", excerpt: "YouTube video: Pixel 10 Pro — 3 months later\nChannel: MKBHD" },
  { id: "page-2", kind: "visit", url: "https://walled.test/", domain: "walled.test", title: "Walled", status: "blocked", reason: "a bot check (Cloudflare) stopped the visit" },
  { id: "page-0", kind: "visit", url: "https://reviews.test/a", domain: "reviews.test", title: "Review", status: "read", excerpt: "The camera is sharper." },
];
const replay = (n = EVENTS.length) => EVENTS.slice(0, n).reduce(mergeBrowseEvent, []);

test("events merge into one entry per step, in the order the steps started", () => {
  const log = replay();
  assert.deepEqual(log.map((e) => `${e.id}:${e.status}`), ["search-0:done", "page-0:read", "page-1:partial", "page-2:blocked"]);
  assert.equal(log[0].found, 6);
  assert.equal(log[2].title, "Pixel 10 Pro — 3 months later", "an update replaces what it changes");
  assert.deepEqual(mergeBrowseEvent(log, { status: "read" }), log, "an event without an id is ignored");
  assert.deepEqual(mergeBrowseEvent(undefined, EVENTS[0]), [EVENTS[0]]);
});

test("pages are cited in the order they were opened, among those that gave content", () => {
  assert.deepEqual([...citationNumbers(replay())], [["page-0", 1], ["page-1", 2]]);
  // Mid-run, a page still loading has no number yet, and the walled one never gets one.
  assert.deepEqual([...citationNumbers(replay(6))], [["page-1", 1]]);
});

test("the summary counts what happened and knows when everything has an outcome", () => {
  assert.deepEqual(browseSummary(replay(5)), { searches: 1, opened: 3, read: 0, partial: 0, blocked: 0, failed: 0, loading: 3, finished: false });
  assert.deepEqual(browseSummary(replay()), { searches: 1, opened: 3, read: 1, partial: 1, blocked: 1, failed: 0, loading: 0, finished: true });
  assert.equal(browseSummary([]).finished, false);
});

test("each outcome reads as a plain sentence, and blocked pages are said to be unused", () => {
  const log = replay();
  assert.equal(outcomeText(EVENTS[0]), "Searching “Pixel 10 Pro reviews”");
  assert.equal(outcomeText(log[0]), "6 results for “Pixel 10 Pro reviews”");
  assert.equal(outcomeText(EVENTS[2]), "Opening reviews.test…");
  assert.equal(outcomeText(log[1]), "Read reviews.test");
  assert.match(outcomeText(log[2]), /^Partly read youtube\.com: YouTube asked to sign in/);
  assert.equal(outcomeText(log[3]), "walled.test blocked the visit: a bot check (Cloudflare) stopped the visit. Not used.");
  assert.equal(outcomeText({ kind: "visit", domain: "slow.test", status: "failed", reason: "the page took too long to load" }), "Couldn't open slow.test: the page took too long to load. Not used.");
  assert.equal(isFinal(EVENTS[2]), false);
  assert.equal(wasRead(log[3]), false);
});
