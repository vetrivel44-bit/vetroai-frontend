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

test("emoji, emoticons and source numbers are never read out", () => {
  assert.equal(speakableText("Haha that's so cool 😂😂! Congrats 🎉"), "Haha that's so cool! Congrats");
  assert.equal(speakableText("👨‍👩‍👧 Family time ❤️ and 🇮🇳 India 👍🏽 ok"), "Family time and India ok");
  assert.equal(speakableText("India won by 5 wickets [1]. Kohli scored 82 [2, 3]."), "India won by 5 wickets. Kohli scored 82.");
  assert.equal(speakableText("Nice one :) see you <3"), "Nice one see you");
  // Words and numbers stay.
  assert.equal(speakableText("It costs ₹500 (about $6)."), "It costs ₹500 (about $6).");
});

test("the opening words go out at the first clause of a long first sentence", async () => {
  const { firstClauseCut } = await import("../src/lib/voiceStream.js");
  assert.equal(firstClauseCut("Oh, hi"), 0, "too short to start on");
  const long = "So the thing about the new phone launch, honestly, is that it";
  assert.equal(long.slice(0, firstClauseCut(long)), "So the thing about the new phone launch, honestly,");
  assert.equal(firstClauseCut("A sentence with no clause break at all yet but plenty of words"), 0);
});

test("a reply's first sentence is spoken on its own, however short", () => {
  assert.deepEqual(splitSentences("Oh nice! That is a great idea for sure. Yes.", { first: true }), ["Oh nice!", "That is a great idea for sure.", "Yes."]);
  assert.deepEqual(splitSentences("Oh nice! That is a great idea for sure. Yes."), ["Oh nice! That is a great idea for sure.", "Yes."]);
});

test("voice mode can say a short line before the reply, and turn itself down while the person talks", async () => {
  const { createStreamingSpeaker } = await import("../src/lib/voiceStream.js");
  const saved = { window: globalThis.window, fetch: globalThis.fetch, Audio: globalThis.Audio, URL: globalThis.URL.createObjectURL };
  const requests = [];
  const audios = [];
  globalThis.window = {};
  globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true, blob: async () => ({ size: 1 }) }; };
  globalThis.URL.createObjectURL = () => "blob:x";
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.Audio = class { constructor() { this.volume = 1; audios.push(this); } play() { setTimeout(() => this.onended?.(), 5); return Promise.resolve(); } pause() {} };
  try {
    await new Promise((resolve) => {
      const speaker = createStreamingSpeaker({ apiBase: "/api", rate: "+6%", onDone: resolve, onStop: resolve });
      speaker.say("One sec, let me check. 🔎");
      speaker.duck(true);
      speaker.finish("Looks like India won by six wickets [1]. 🎉");
    });
    assert.deepEqual(requests.map((r) => r.text), ["One sec, let me check.", "Looks like India won by six wickets."]);
    assert.ok(requests.every((r) => r.rate === "+6%"));
    assert.ok(audios.every((a) => a.volume < 0.5), "ducked while the person talks");

    // Once the reply has started, no extra line is slipped in.
    requests.length = 0;
    await new Promise((resolve) => {
      const speaker = createStreamingSpeaker({ apiBase: "/api", onDone: resolve, onStop: resolve });
      speaker.push("Sure thing. ");
      speaker.say("One sec, let me check.");
      speaker.finish("Sure thing. Here you go.");
    });
    assert.ok(!requests.some((r) => r.text.startsWith("One sec")));
    assert.equal(requests[0].rate, undefined);
  } finally {
    globalThis.window = saved.window; globalThis.fetch = saved.fetch; globalThis.Audio = saved.Audio; globalThis.URL.createObjectURL = saved.URL;
  }
});
