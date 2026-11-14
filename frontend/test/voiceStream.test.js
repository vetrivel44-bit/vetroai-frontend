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

test("lists, headings and tables are read as separate phrases, not run together", () => {
  assert.equal(speakableText("## Best places\n- Ooty\n- Kodaikanal\n- Munnar"), "Best places. Ooty. Kodaikanal. Munnar");
  assert.equal(speakableText("Steps:\n1. Open the app\n2. Tap Start"), "Steps: Open the app. Tap Start");
  assert.equal(speakableText("| City | Temp |\n|---|---|\n| Chennai | 36°C |\n| Ooty | 18°C |"), "City, Temp. Chennai, 36°C. Ooty, 18°C");
  assert.equal(speakableText("Chennai → Bangalore takes 6 hours, e.g. by car.\n\n---\n\nDone."), "Chennai to Bangalore takes 6 hours, for example by car. Done.");
});

test("sentences end at a full stop and a space, not inside numbers or after Dr.", async () => {
  const { sentencesOf } = await import("../src/lib/voiceStream.js");
  assert.deepEqual(sentencesOf("It costs 3.5 lakh. Dr. Rao said so! Visit vetroai.com today? Yes").map((s) => s.trim()), [
    "It costs 3.5 lakh.", "Dr. Rao said so!", "Visit vetroai.com today?", "Yes",
  ]);
});

test("Read aloud puts a few sentences in each clip after the first, so it flows", () => {
  const text = Array.from({ length: 30 }, (_, i) => `This is sentence number ${i} of the answer.`).join(" ");
  const sizes = (i) => (i === 1 ? 220 : 420);
  const chunks = splitSentences(text, { first: true, target: sizes });
  assert.equal(chunks[0], "This is sentence number 0 of the answer.", "the first sentence on its own, to start quickly");
  assert.ok(chunks[1].length <= 220 && chunks[1].length > 150, `second clip: ${chunks[1].length}`);
  for (const chunk of chunks.slice(2, -1)) assert.ok(chunk.length <= 420 && chunk.length > 330, `clip: ${chunk.length}`);
  assert.equal(chunks.join(" "), text, "nothing lost or repeated");
  assert.ok(chunks.length < 12, `${chunks.length} clips instead of 30`);
});

test("the silence around each clip is trimmed, keeping a breath of it", async () => {
  const { speechBounds } = await import("../src/lib/voiceStream.js");
  const rate = 1000;
  const samples = new Float32Array(3000); // 3 s: silence, 1 s of speech, silence
  for (let i = 500; i < 1500; i++) samples[i] = Math.sin(i) * 0.3;
  const { start, end } = speechBounds(samples, rate);
  assert.ok(Math.abs(start - 0.47) < 0.02, `start ${start}`);
  assert.ok(Math.abs(end - 1.58) < 0.02, `end ${end}`);
  assert.deepEqual(speechBounds(new Float32Array(1000), rate), { start: 0, end: 1 }, "all silence: left as it is");
});

test("the pause after a clip is a sentence's or a clause's", async () => {
  const { pauseAfter } = await import("../src/lib/voiceStream.js");
  assert.ok(pauseAfter("That's it.") > 0.2 && pauseAfter("That's it.") < 0.35);
  assert.ok(pauseAfter("So the thing is,") < 0.15);
  assert.ok(pauseAfter("Really?\"") > 0.2);
});

// A stand-in for the Web Audio API: records when each clip is started.
function fakeAudioContext(log) {
  return class {
    constructor() { this.state = "running"; this.currentTime = 10; this.destination = {}; }
    resume() { this.state = "running"; return Promise.resolve(); }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    decodeAudioData(_data, ok) {
      const samples = new Float32Array(2000); // 2 s at 1 kHz: 0.5 s silence each side
      for (let i = 500; i < 1500; i++) samples[i] = 0.4;
      const buffer = { sampleRate: 1000, duration: 2, getChannelData: () => samples };
      ok?.(buffer);
      return Promise.resolve(buffer);
    }
    createBufferSource() {
      const ctx = this;
      const source = {
        connect() {}, disconnect() {},
        start(when, offset, duration) { log.push({ when: when - ctx.currentTime, offset, duration }); setTimeout(() => source.onended?.(), 1); },
        stop() {},
      };
      return source;
    }
  };
}

test("clips play back to back without their silence, with a short pause between sentences", async () => {
  const { createStreamingSpeaker } = await import("../src/lib/voiceStream.js");
  const saved = { window: globalThis.window, fetch: globalThis.fetch };
  const log = [];
  globalThis.window = { AudioContext: fakeAudioContext(log) };
  globalThis.fetch = async () => ({ ok: true, status: 200, blob: async () => ({ size: 10, arrayBuffer: async () => new ArrayBuffer(8) }) });
  try {
    await new Promise((resolve) => createStreamingSpeaker({ apiBase: "/api", maxChars: 20000, onDone: resolve, onStop: resolve })
      .finish("First sentence here. Then the second one comes along. And a third to finish."));
    assert.ok(log.length >= 2, `${log.length} clips`);
    assert.equal(log[0].when, 0, "the first starts at once");
    for (const clip of log) {
      assert.ok(Math.abs(clip.offset - 0.47) < 0.02, `starts at the speech (${clip.offset})`);
      assert.ok(clip.duration < 1.2, `ends with the speech (${clip.duration})`);
    }
    for (const clip of log.slice(1)) assert.ok(clip.when > 0.2 && clip.when < 0.35, `pause ${clip.when}`);
  } finally {
    globalThis.window = saved.window; globalThis.fetch = saved.fetch;
  }
});

test("a busy server is asked again instead of switching to the robotic browser voice", async () => {
  const { createStreamingSpeaker } = await import("../src/lib/voiceStream.js");
  const saved = { window: globalThis.window, fetch: globalThis.fetch, Audio: globalThis.Audio, URL: globalThis.URL.createObjectURL };
  let calls = 0;
  const spokenByBrowser = [];
  globalThis.window = { speechSynthesis: { speak: (u) => { spokenByBrowser.push(u.text); u.onend?.(); }, cancel() {}, getVoices: () => [] } };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.fetch = async () => (++calls === 1 ? { ok: false, status: 503 } : { ok: true, status: 200, blob: async () => ({ size: 1 }) });
  globalThis.URL.createObjectURL = () => "blob:x";
  globalThis.URL.revokeObjectURL = () => {};
  const played = [];
  globalThis.Audio = class { play() { played.push(1); setTimeout(() => this.onended?.(), 0); return Promise.resolve(); } pause() {} };
  try {
    await new Promise((resolve) => createStreamingSpeaker({ apiBase: "/api", onDone: resolve, onStop: resolve }).finish("Just one sentence to say."));
    assert.equal(calls, 2, "asked again");
    assert.equal(played.length, 1);
    assert.deepEqual(spokenByBrowser, []);
  } finally {
    globalThis.window = saved.window; globalThis.fetch = saved.fetch; globalThis.Audio = saved.Audio; globalThis.URL.createObjectURL = saved.URL;
    delete globalThis.SpeechSynthesisUtterance;
  }
});

test("Read aloud asks for a few clips ahead of the one playing, not all of them at once", async () => {
  const { createStreamingSpeaker } = await import("../src/lib/voiceStream.js");
  const saved = { window: globalThis.window, fetch: globalThis.fetch, Audio: globalThis.Audio, URL: globalThis.URL.createObjectURL };
  let requested = 0;
  let maxAheadSeen = 0;
  let played = 0;
  globalThis.window = {};
  globalThis.fetch = async () => { requested++; maxAheadSeen = Math.max(maxAheadSeen, requested - played); return { ok: true, status: 200, blob: async () => ({ size: 1 }) }; };
  globalThis.URL.createObjectURL = () => "blob:x";
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.Audio = class { play() { setTimeout(() => { played++; this.onended?.(); }, 2); return Promise.resolve(); } pause() {} };
  const reply = Array.from({ length: 200 }, (_, i) => `This is sentence number ${i} of a very long answer.`).join(" ");
  try {
    await new Promise((resolve) => createStreamingSpeaker({ apiBase: "/api", maxChars: 20000, chunkChars: 420, onDone: resolve, onStop: resolve }).finish(reply));
    assert.ok(maxAheadSeen <= 4, `at most 4 clips requested ahead of playback, saw ${maxAheadSeen}`);
    assert.equal(requested, played, "every clip asked for was played");
  } finally {
    globalThis.window = saved.window; globalThis.fetch = saved.fetch; globalThis.Audio = saved.Audio; globalThis.URL.createObjectURL = saved.URL;
  }
});

test("a reply that is retried from scratch never plays a clip from before", async () => {
  const { createStreamingSpeaker } = await import("../src/lib/voiceStream.js");
  const saved = { window: globalThis.window, fetch: globalThis.fetch, Audio: globalThis.Audio, URL: globalThis.URL.createObjectURL };
  const played = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.window = {};
  globalThis.fetch = async (_url, init) => {
    const { text } = JSON.parse(init.body);
    if (text.startsWith("Old")) await gate;
    return { ok: true, status: 200, blob: async () => ({ size: 1, text }) };
  };
  globalThis.URL.createObjectURL = (blob) => blob.text;
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.Audio = class { constructor(url) { this.url = url; } play() { played.push(this.url); setTimeout(() => this.onended?.(), 0); return Promise.resolve(); } pause() {} };
  try {
    await new Promise((resolve) => {
      const speaker = createStreamingSpeaker({ apiBase: "/api", onDone: resolve, onStop: resolve });
      speaker.push("Old answer that was cut off. ");
      speaker.restart();
      release();
      speaker.finish("New answer from the retry.");
    });
    assert.deepEqual(played, ["New answer from the retry."]);
  } finally {
    globalThis.window = saved.window; globalThis.fetch = saved.fetch; globalThis.Audio = saved.Audio; globalThis.URL.createObjectURL = saved.URL;
  }
});

test("Read aloud always uses Google's free voice, in the reply's language", async () => {
  const { freeReadAloudVoice } = await import("../src/lib/voiceStream.js");
  assert.equal(freeReadAloudVoice(undefined), "google-en-IN");
  assert.equal(freeReadAloudVoice("en"), "google-en-IN");
  assert.equal(freeReadAloudVoice("ta"), "google-ta-IN");
  assert.equal(freeReadAloudVoice("hi"), "google-hi-IN");
  assert.equal(freeReadAloudVoice("es"), "google-es-US");
  assert.equal(freeReadAloudVoice("sarvam-aparna"), "google-en-IN", "anything odd: the English voice");
});
