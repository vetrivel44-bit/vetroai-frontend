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

test("Read aloud can speak a whole long reply (maxChars), voice mode stays capped", async () => {
  const { createStreamingSpeaker } = await import("../src/lib/voiceStream.js");
  const saved = { window: globalThis.window, fetch: globalThis.fetch, Audio: globalThis.Audio, URL: globalThis.URL.createObjectURL };
  const spoken = [];
  globalThis.window = {};
  globalThis.fetch = async (_url, init) => { spoken.push(JSON.parse(init.body).text); return { ok: true, blob: async () => ({ size: 1 }) }; };
  globalThis.URL.createObjectURL = () => "blob:x";
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.Audio = class { play() { setTimeout(() => this.onended?.(), 0); return Promise.resolve(); } pause() {} };
  const reply = Array.from({ length: 120 }, (_, i) => `This is sentence number ${i} of a long answer.`).join(" ");
  try {
    for (const [opts, expectAll] of [[{ maxChars: 20000 }, true], [{}, false]]) {
      spoken.length = 0;
      await new Promise((resolve) => createStreamingSpeaker({ apiBase: "/api", ...opts, onDone: resolve, onStop: resolve }).finish(reply));
      const total = spoken.reduce((n, s) => n + s.length, 0);
      if (expectAll) assert.ok(total >= reply.length - 200, `read ${total} of ${reply.length}`);
      else assert.ok(total <= 1500, `voice mode read ${total}`);
    }
  } finally {
    globalThis.window = saved.window; globalThis.fetch = saved.fetch; globalThis.Audio = saved.Audio; globalThis.URL.createObjectURL = saved.URL;
  }
});
