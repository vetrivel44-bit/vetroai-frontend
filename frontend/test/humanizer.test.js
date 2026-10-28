import test from "node:test";
import assert from "node:assert/strict";

import { isHumanizeRequest, humanizeSource, buildHumanizePrompt, HUMANIZE_TEXT_LIMIT } from "../src/lib/humanizer.js";

const ESSAY = "Artificial intelligence has transformed many industries by automating repetitive tasks and enabling new insights.";

test("recognises requests to humanize text", () => {
  for (const q of [
    "humanize this",
    "Humanise my essay",
    `humanize this: ${ESSAY}`,
    "can you humanize the attached document",
    "make it sound more human",
    "make this less robotic",
    "rewrite this so it sounds human",
    "remove the AI tone from my answer",
  ]) assert.equal(isHumanizeRequest(q), true, q);
});

test("leaves questions about humanizers and unrelated messages to the model", () => {
  for (const q of [
    "what is an AI humanizer",
    "explain how AI humanizers work",
    "is humanizing AI text ethical",
    "what is DBMS",
    "write a poem about rain",
  ]) assert.equal(isHumanizeRequest(q), false, q);
});

test("finds the text: document, then pasted text, then the previous answer", () => {
  assert.deepEqual(humanizeSource({ query: "humanize this", docText: ESSAY }), { text: ESSAY, from: "document", request: "humanize this" });

  assert.deepEqual(humanizeSource({ query: `Humanize this in a casual tone: ${ESSAY}` }), { text: ESSAY, from: "message", request: "Humanize this in a casual tone" });
  assert.equal(humanizeSource({ query: `humanize the following\n${ESSAY}` }).text, ESSAY);
  assert.equal(humanizeSource({ query: `${ESSAY}\n\nhumanize this` }).text, ESSAY);

  const history = [{ role: "user", content: "write about AI" }, { role: "assistant", content: ESSAY }];
  assert.deepEqual(humanizeSource({ query: "humanize that", history }), { text: ESSAY, from: "answer", request: "humanize that" });

  assert.equal(humanizeSource({ query: "humanize this" }).from, "none");
});

test("the brief carries the text, the user's wording and the rewrite rules", () => {
  const prompt = buildHumanizePrompt({ text: ESSAY, request: "Humanize this in a casual tone" });
  assert.match(prompt, /"Humanize this in a casual tone"/);
  assert.match(prompt, /Keep the meaning, facts, names, numbers/);
  assert.match(prompt, /Reply with only the rewritten text/);
  assert.ok(prompt.includes(`"""\n${ESSAY}\n"""`));

  const long = buildHumanizePrompt({ text: "x".repeat(HUMANIZE_TEXT_LIMIT + 500) });
  assert.ok(long.length < HUMANIZE_TEXT_LIMIT + 2000);
});
