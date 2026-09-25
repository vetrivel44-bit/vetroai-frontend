import test from "node:test";
import assert from "node:assert/strict";

import { choiceReply, findChoices, parseChoices } from "../src/lib/choices.js";

test("options may be strings or {label, description}; Other is on by default", () => {
  const c = parseChoices('{"question": "Which?", "options": ["Mitosis", {"label": "Meiosis", "description": "Sex cells"},]}');
  assert.deepEqual(c.options, [{ label: "Mitosis", description: "" }, { label: "Meiosis", description: "Sex cells" }]);
  assert.equal(c.multi, false);
  assert.equal(c.other, true);
});

test("a question needs text and two options", () => {
  assert.throws(() => parseChoices('{"options": ["a", "b"]}'), /question/);
  assert.throws(() => parseChoices('{"question": "x", "options": ["a"]}'), /2 options/);
});

test("the reply is the picked labels plus anything typed", () => {
  const opts = [{ label: "Maths" }, { label: "Physics" }, { label: "Chemistry" }];
  assert.equal(choiceReply(opts, [2, 0], ""), "Maths, Chemistry");
  assert.equal(choiceReply(opts, [1], " biology "), "Physics, biology");
});

test("the newest choices block in a reply is found for the docked panel", () => {
  const reply = 'Which one?\n\n```choices\n{"question": "Pick", "options": ["A", "B"]}\n```';
  assert.equal(findChoices(reply).question, "Pick");
  assert.equal(findChoices("no question here"), null);
  assert.equal(findChoices("```choices\n{broken\n```"), null);
});
