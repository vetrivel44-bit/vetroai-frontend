import { test } from "node:test";
import assert from "node:assert/strict";
import { speakableText, stableCut, splitSentences } from "../src/lib/voiceStream.js";

test("speakable text drops code, markdown, links and math", () => {
  const raw = "## Hello **there**\n\nSee [the docs](https://x.y/z) and `npm i`.\n```js\nconst a = 1;\n```\nDone, $x^2$ too.";
  assert.equal(speakableText(raw), "Hello there. See the docs and. Done, math too.");
});

test("an unclosed code fence is not read out", () => {
  assert.equal(speakableText("Here is code:\n```python\nprint("), "Here is code:");
});

test("stable cut stops at the last finished sentence", () => {
  const raw = "First sentence. Second one is still stream";
  assert.equal(raw.slice(0, stableCut(raw)), "First sentence.");
});

test("stable cut waits while inline code or a link is half-written", () => {
  assert.equal(stableCut("Use `npm. Run it"), 0);
  assert.equal(stableCut("Read [this](https://a.b/c. More"), 0);
  const raw = "Use `npm i`. Then run it. And";
  assert.equal(raw.slice(0, stableCut(raw)), "Use `npm i`. Then run it.");
});

test("speakable prefixes grow without changing what was already spoken", () => {
  const full = "Sure! Here's the plan. First, open the app. Then tap Start.";
  let spoken = "";
  for (let i = 1; i <= full.length; i++) {
    const partial = full.slice(0, i);
    const next = speakableText(partial.slice(0, stableCut(partial)));
    assert.ok(next.startsWith(spoken), `"${next}" should extend "${spoken}"`);
    spoken = next;
  }
});

test("short sentences are merged so speech is not choppy", () => {
  assert.deepEqual(splitSentences("Hi. Okay. This is a longer sentence here. End."), [
    "Hi. Okay. This is a longer sentence here.",
    "End.",
  ]);
});
