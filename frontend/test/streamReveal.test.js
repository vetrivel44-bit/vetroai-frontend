import test from "node:test";
import assert from "node:assert/strict";

import { nextRevealLength, rehypeStreamWords } from "../src/lib/streamReveal.js";

test("the reveal moves forward steadily and lands on word boundaries", () => {
  const text = "Marina Beach is a natural urban beach along the Bay of Bengal.";
  const next = nextRevealLength(text, 0);
  assert.ok(next > 0 && next < text.length);
  // Stops at the end of a word, never inside one.
  assert.match(text[next] ?? " ", /[\s.,]/);
  // Reaches the end and stays there.
  let shown = 0;
  for (let i = 0; i < 200 && shown < text.length; i++) shown = nextRevealLength(text, shown);
  assert.equal(shown, text.length);
  assert.equal(nextRevealLength(text, text.length), text.length);
});

test("a large backlog is caught up quickly", () => {
  const text = "word ".repeat(400); // 2000 chars arrived at once
  let shown = 0;
  let ticks = 0;
  while (shown < text.length && ticks < 200) { shown = nextRevealLength(text, shown); ticks++; }
  assert.equal(shown, text.length);
  assert.ok(ticks <= 35, `took ${ticks} ticks`); // ~1.1s at 32ms per tick
});

test("while text is still arriving, a half-received last word is held back", () => {
  const partial = "Here is Marina Beach on the ma";
  let shown = 0;
  for (let i = 0; i < 50; i++) shown = nextRevealLength(partial, shown, false);
  assert.equal(partial.slice(0, shown), "Here is Marina Beach on the");
  // Once the reply is complete, the last word is released.
  assert.equal(nextRevealLength(partial, shown, true), partial.length);
});

test("an emoji (surrogate pair) is never split", () => {
  const text = "Great job 🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉 done";
  for (let shown = 0; shown < text.length;) {
    shown = nextRevealLength(text, shown);
    const code = text.charCodeAt(shown - 1);
    assert.ok(!(code >= 0xd800 && code <= 0xdbff), `cut inside an emoji at ${shown}`);
  }
});

const el = (tagName, children, properties = {}) => ({ type: "element", tagName, properties, children });
const txt = (value) => ({ type: "text", value });

test("only the last block's words are wrapped, and code/math are left alone", () => {
  const tree = {
    type: "root",
    children: [
      el("p", [txt("Finished paragraph.")]),
      txt("\n"),
      el("p", [
        txt("New words "),
        el("strong", [txt("bold bit")]),
        txt(" and "),
        el("code", [txt("x = 1")]),
        el("span", [txt("E=mc^2")], { className: ["katex"] }),
      ]),
    ],
  };
  rehypeStreamWords()(tree);
  // The finished paragraph is untouched.
  assert.deepEqual(tree.children[0].children, [txt("Finished paragraph.")]);
  const last = tree.children[2];
  const words = [];
  const walk = (n) => {
    if (n.type === "element" && n.properties?.className?.includes?.("vai-w")) words.push(n.children[0].value);
    else n.children?.forEach(walk);
  };
  walk(last);
  assert.deepEqual(words, ["New", "words", "bold", "bit", "and"]);
  // Code and KaTeX keep their original text nodes.
  assert.deepEqual(last.children.find((c) => c.tagName === "code").children, [txt("x = 1")]);
  assert.deepEqual(last.children.find((c) => c.tagName === "span" && c.properties.className[0] === "katex").children, [txt("E=mc^2")]);
});

test("a code block as the last block is not wrapped", () => {
  const tree = { type: "root", children: [el("pre", [el("code", [txt("const a = 1;")])])] };
  rehypeStreamWords()(tree);
  assert.deepEqual(tree.children[0].children[0].children, [txt("const a = 1;")]);
});
