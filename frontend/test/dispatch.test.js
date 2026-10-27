import test from "node:test";
import assert from "node:assert/strict";

import {
  DOC_TEXT_BYTES, ONLINE_WINDOW_MS, clipToBytes, describeDispatch, deviceLabel, formatAgo, isOnline, nextQueued, orphanedRuns, summarizeForPhone, toDispatchUpdate,
} from "../src/lib/dispatchCore.js";

const NOW = 1_800_000_000_000;

test("a computer is online only while it accepts tasks and was heard from recently", () => {
  assert.equal(isOnline({ accepting: true, lastSeen: NOW - 10_000 }, NOW), true);
  assert.equal(isOnline({ accepting: true, lastSeen: NOW - ONLINE_WINDOW_MS - 1 }, NOW), false);
  assert.equal(isOnline({ accepting: false, lastSeen: NOW }, NOW), false);
  assert.equal(isOnline(null, NOW), false);
});

test("computers get a plain name", () => {
  assert.equal(deviceLabel("win32", true), "Windows PC");
  assert.equal(deviceLabel("darwin", true), "Mac");
  assert.equal(deviceLabel("MacIntel", false), "Mac (browser)");
  assert.equal(deviceLabel("Linux x86_64", false), "Linux PC (browser)");
});

test("the oldest queued request for this computer goes first", () => {
  const list = [
    { id: "c", status: "queued", createdAt: 3 },
    { id: "a", status: "queued", createdAt: 1, target: "other" },
    { id: "b", status: "queued", createdAt: 2, target: "me" },
    { id: "z", status: "running", createdAt: 0 },
    { id: "y", status: "queued", createdAt: 0, cancelRequested: true },
  ];
  assert.equal(nextQueued(list, "me").id, "b");
  assert.equal(nextQueued(list, "other").id, "a");
  assert.equal(nextQueued([], "me"), null);
});

test("runs this computer lost track of are found, not the one it is doing", () => {
  const list = [
    { id: "1", status: "running", claimedBy: "me" },
    { id: "2", status: "claimed", claimedBy: "me" },
    { id: "3", status: "running", claimedBy: "other" },
    { id: "4", status: "done", claimedBy: "me" },
  ];
  assert.deepEqual(orphanedRuns(list, "me", "2").map((d) => d.id), ["1"]);
});

test("a website is described; everything else reaches the phone in full", () => {
  const site = summarizeForPhone("Here it is.\n\n```html\n<!doctype html><html>…</html>\n```\n\nEnjoy!");
  assert.equal(site.website, true);
  assert.match(site.text, /Website built/);
  assert.doesNotMatch(site.text, /doctype/);

  const cut = summarizeForPhone("```html\n<html><body>still going");
  assert.equal(cut.website, true);

  // No limit on code or length of our own.
  const code = "print(1)\n".repeat(3000);
  assert.ok(summarizeForPhone(`Script:\n\`\`\`python\n${code}\`\`\``).text.includes(code.trim()));
  const long = "word ".repeat(30000).trim();
  assert.equal(summarizeForPhone(long).text, long);
});

test("only Firestore's document cap can cut a result, and never mid-letter", () => {
  const tamil = "வணக்கம் ".repeat(60000); // ~1.3 MB in UTF-8, over one document
  const { text } = summarizeForPhone(tamil);
  assert.ok(new TextEncoder().encode(text).length <= DOC_TEXT_BYTES);
  assert.match(text, /The rest is on your computer/);
  assert.doesNotMatch(text, /�/);
  assert.equal(clipToBytes("short"), "short");
});

test("a task's progress and result become the phone's update", () => {
  assert.equal(toDispatchUpdate({ status: "ready", steps: [], messages: [] }), null);

  const running = toDispatchUpdate({
    status: "running",
    steps: [{ label: "Plan", status: "done" }, { label: "Research", detail: "Reading 4 sources", status: "active" }, { label: "Review", status: "pending" }],
    messages: [],
  });
  assert.deepEqual(running, { status: "running", progress: "Research — Reading 4 sources", stepsDone: 1, stepsTotal: 3 });

  const done = toDispatchUpdate({
    status: "completed",
    steps: [{ status: "done" }],
    messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "**All done.**", finishedAt: 5 }],
  });
  assert.equal(done.status, "done");
  assert.equal(done.result, "**All done.**");
  assert.equal(done.finishedAt, 5);
  assert.equal(done.progress, "");

  assert.equal(toDispatchUpdate({ status: "stopped", steps: [], messages: [] }).status, "cancelled");
  assert.equal(toDispatchUpdate({ status: "failed", steps: [], messages: [] }).status, "failed");
});

test("the phone says where a request stands", () => {
  const pc = { id: "pc", name: "Windows PC", accepting: true, lastSeen: NOW };
  const off = { ...pc, lastSeen: NOW - ONLINE_WINDOW_MS * 2 };
  assert.match(describeDispatch({ status: "queued" }, [pc], NOW), /start it in a moment/);
  assert.match(describeDispatch({ status: "queued" }, [off], NOW), /Waiting for your computer/);
  assert.match(describeDispatch({ status: "queued", target: "pc" }, [off], NOW), /Waiting for Windows PC/);
  assert.equal(describeDispatch({ status: "running", claimedBy: "pc", progress: "Writing" }, [pc], NOW), "Writing");
  assert.match(describeDispatch({ status: "running", claimedBy: "pc" }, [off], NOW), /went offline/);
  assert.equal(describeDispatch({ status: "done", claimedBy: "pc" }, [pc], NOW), "Done on Windows PC");
  assert.equal(describeDispatch({ status: "failed", error: "Nope" }, [], NOW), "Nope");
});

test("times on the thread read as past", () => {
  assert.equal(formatAgo(NOW - 20_000, NOW), "just now");
  assert.equal(formatAgo(NOW - 5 * 60_000, NOW), "5 min ago");
  assert.equal(formatAgo(NOW - 3 * 3_600_000, NOW), "3 hr ago");
  assert.equal(formatAgo(0, NOW), "");
});
