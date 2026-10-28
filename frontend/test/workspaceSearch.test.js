import test from "node:test";
import assert from "node:assert/strict";

import { searchWorkspace, ago } from "../src/lib/workspaceSearch.js";

const sessions = [
  { id: "1700000000000", title: "Trip to Kerala", messages: [{ role: "user", content: "plan a 3 day trip" }, { role: "assistant", content: "Day 1: **Munnar** tea gardens and Eravikulam park." }] },
  { id: "1800000000000", title: "Python loops", messages: [{ role: "user", content: "why does my loop throw IndexError" }] },
  { id: "1900000000000", title: "Munnar hotels", messages: [] },
];
const spaces = [{ id: "s1", name: "Startup plan", description: "Pitch deck and finances", files: [{ name: "deck.pdf" }] }];
const artifacts = [{ id: "a1", title: "Budget sheet", language: "csv", code: "item,cost\nrent,2000", createdAt: 1750000000000 }];

test("an empty query finds nothing", () => {
  assert.deepEqual(searchWorkspace({ query: "  ", sessions, spaces, artifacts }), { chats: [], spaces: [], artifacts: [] });
});

test("chats match by title or message text, title matches first", () => {
  const { chats } = searchWorkspace({ query: "munnar", sessions });
  assert.deepEqual(chats.map((c) => c.title), ["Munnar hotels", "Trip to Kerala"]);
  assert.equal(chats[0].snippet, "");
  assert.match(chats[1].snippet, /Munnar tea gardens/);
  assert.doesNotMatch(chats[1].snippet, /\*\*/);
});

test("every word must appear, in any order and case", () => {
  assert.deepEqual(searchWorkspace({ query: "INDEXERROR loop", sessions }).chats.map((c) => c.id), ["1800000000000"]);
  assert.equal(searchWorkspace({ query: "loop kerala", sessions }).chats.length, 0);
});

test("projects and artifacts are searched too", () => {
  const r = searchWorkspace({ query: "deck", sessions, spaces, artifacts });
  assert.deepEqual(r.spaces.map((s) => s.id), ["s1"]);
  assert.deepEqual(searchWorkspace({ query: "rent", artifacts }).artifacts.map((a) => a.id), ["a1"]);
});

test("ago() reads naturally", () => {
  const now = 1_000_000_000_000;
  assert.equal(ago(now - 10_000, now), "just now");
  assert.equal(ago(now - 5 * 60_000, now), "5m ago");
  assert.equal(ago(now - 3 * 3_600_000, now), "3h ago");
  assert.equal(ago(now - 2 * 86_400_000, now), "2d ago");
});
