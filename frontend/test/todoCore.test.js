import test from "node:test";
import assert from "node:assert/strict";

import {
  CLAUDE_MODEL, errorMessage, ordersBetween, parseSteps, renderMarkdown,
  sortTodos, stepSlot, stepsOf, stepsPrompt, visibleTodos,
} from "../public/todo/todo-core.js";

const task = (id, order, extra = {}) => ({ id, text: id, done: false, createdAt: order, order, ...extra });

test("asks Claude Opus 5.5", () => {
  assert.equal(CLAUDE_MODEL, "anthropic/claude-opus-5-5");
});

test("tasks without an order field fall back to when they were created", () => {
  const older = { id: "old", text: "old", createdAt: 5 };
  assert.deepEqual(sortTodos([task("b", 10), older, task("a", 1)]).map((t) => t.id), ["a", "old", "b"]);
});

test("filters keep the list order", () => {
  const todos = [task("c", 3, { done: true }), task("a", 1), task("b", 2, { done: true })];
  assert.deepEqual(visibleTodos(todos, "all").map((t) => t.id), ["a", "b", "c"]);
  assert.deepEqual(visibleTodos(todos, "active").map((t) => t.id), ["a"]);
  assert.deepEqual(visibleTodos(todos, "done").map((t) => t.id), ["b", "c"]);
});

test("step orders fall strictly between their neighbours", () => {
  const orders = ordersBetween(10, 20, 3);
  assert.equal(orders.length, 3);
  assert.ok(orders.every((o, i) => o > 10 && o < 20 && (i === 0 || o > orders[i - 1])));
  assert.deepEqual(ordersBetween(100, undefined, 2), [101, 102]);
});

test("new steps go under the task, after any steps it already has", () => {
  const parent = task("p", 10);
  const todos = [parent, task("s1", 11, { parentId: "p" }), task("next", 20), task("s2", 12, { parentId: "p" })];
  assert.deepEqual(stepSlot(todos, parent), { after: 12, before: 20 });
  assert.deepEqual(stepSlot([parent], parent), { after: 10, before: undefined });

  const { after, before } = stepSlot(todos, parent);
  const placed = [...todos, ...ordersBetween(after, before, 2).map((o, i) => task(`new${i}`, o, { parentId: "p" }))];
  assert.deepEqual(sortTodos(placed).map((t) => t.id), ["p", "s1", "s2", "new0", "new1", "next"]);
  assert.deepEqual(stepsOf(placed, "p").map((t) => t.id).sort(), ["new0", "new1", "s1", "s2"]);
});

test("the steps prompt carries the task and asks for a JSON array", () => {
  const prompt = stepsPrompt("Plan a birthday party");
  assert.match(prompt, /To-do: Plan a birthday party$/);
  assert.match(prompt, /JSON array/);
});

test("steps are read from a JSON array, even with text around it", () => {
  assert.deepEqual(
    parseSteps('Sure! Here you go:\n```json\n["Pick a date", "Book a venue", "Send invites"]\n```'),
    ["Pick a date", "Book a venue", "Send invites"],
  );
  assert.deepEqual(parseSteps('[{"step": "One"}, {"title": "Two"}]'), ["One", "Two"]);
});

test("steps fall back to a Markdown list when the reply isn't JSON", () => {
  assert.deepEqual(
    parseSteps("Here's a plan:\n1. **Pick** a date\n2) Book a venue\n- Send invites\n\nGood luck!"),
    ["Pick a date", "Book a venue", "Send invites"],
  );
});

test("steps are trimmed, de-duplicated, capped in length and count", () => {
  const steps = parseSteps(JSON.stringify(["  A  ", "a", "", "B", "x".repeat(300), ...Array.from({ length: 10 }, (_, i) => `S${i}`)]));
  assert.deepEqual(steps.slice(0, 2), ["A", "B"]);
  assert.equal(steps[2].length, 200);
  assert.equal(steps.length, 8);
  assert.deepEqual(parseSteps(""), []);
});

test("Claude's Markdown renders without letting markup through", () => {
  const html = renderMarkdown("# Title\nQubits are **weird** and *fast*.\n- one\n- `two`\n1. first\n<img src=x onerror=alert(1)>\n```\n<b>code</b>\n```");
  assert.match(html, /<h3>Title<\/h3>/);
  assert.match(html, /<strong>weird<\/strong> and <em>fast<\/em>/);
  assert.match(html, /<ul><li>one<\/li><li><code>two<\/code><\/li><\/ul><ol><li>first<\/li><\/ol>/);
  assert.match(html, /<p>&lt;img src=x onerror=alert\(1\)&gt;<\/p>/);
  assert.match(html, /<pre><code>&lt;b&gt;code&lt;\/b&gt;<\/code><\/pre>/);
  assert.doesNotMatch(html, /<img|<b>/);
});

test("error messages are read from Puter's plain-object rejections", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage({ error: { message: "quota" } }), "quota");
  assert.equal(errorMessage({ error: "popup_blocked", msg: "The popup was blocked" }), "popup_blocked");
  assert.equal(errorMessage({ msg: "closed" }), "closed");
  assert.equal(errorMessage("plain"), "plain");
  assert.equal(errorMessage(undefined), "Something went wrong");
});
