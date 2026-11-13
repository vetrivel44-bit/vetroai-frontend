import test from "node:test";
import assert from "node:assert/strict";

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

test("the listener's speed is asked of the voice, on top of voice mode's own", async () => {
  const { combinedRate } = await import("../src/lib/voiceStream.js");
  assert.equal(combinedRate(undefined, 1), undefined, "the voice's own speed asks for nothing");
  assert.equal(combinedRate(undefined, 1.25), "+25%");
  assert.equal(combinedRate(undefined, 0.8), "-20%");
  assert.equal(combinedRate("+6%", 1), "+6%");
  assert.equal(combinedRate("+6%", 1.5), "+59%");
  assert.equal(combinedRate(undefined, 5), "+99%", "the server takes two digits at most");
});

test("the sentence being heard is judged from how far into the clip it is", async () => {
  const { sentenceAt, fractionBefore } = await import("../src/lib/voiceStream.js");
  const parts = ["Short one.", "This second sentence is a good deal longer than the first."];
  assert.equal(sentenceAt(parts, 0), 0);
  assert.equal(sentenceAt(parts, 0.1), 0);
  assert.equal(sentenceAt(parts, 0.5), 1);
  assert.equal(sentenceAt(parts, 1.4), 1, "past the end is the last sentence");
  assert.equal(fractionBefore(parts, 0), 0);
  assert.ok(Math.abs(fractionBefore(parts, 1) - parts[0].length / (parts[0].length + parts[1].length)) < 0.001);
});

test("a skip into a clip starts at the pause before the sentence, not mid-word", async () => {
  const { seekPoint } = await import("../src/lib/voiceStream.js");
  // 4 s at 1 kHz: speech from 0.5 s to 3.5 s with a breath at 1.9–2.1 s.
  const samples = new Float32Array(4000);
  for (let i = 500; i < 3500; i++) samples[i] = i >= 1900 && i < 2100 ? 0 : 0.4;
  const bounds = { start: 0.47, end: 3.58 };
  assert.equal(seekPoint(samples, 1000, bounds, 0), 0.47);
  const at = seekPoint(samples, 1000, bounds, 0.42); // estimate ≈ 1.78 s
  assert.ok(at >= 1.9 && at <= 2.1, `starts in the breath (${at})`);
});

// <audio> elements the test ends by hand.
function fakeBrowser() {
  const audios = [];
  const requests = [];
  globalThis.window = {};
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    return { ok: true, status: 200, headers: { get: () => "edge-neural" }, blob: async () => ({ size: 1, text: body.text }) };
  };
  globalThis.URL.createObjectURL = (blob) => blob.text;
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.Audio = class {
    constructor(url) { this.url = url; this.volume = 1; this.playbackRate = 1; this.paused = true; audios.push(this); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    end() { this.onended?.(); }
  };
  const playing = () => audios.filter((a) => !a.paused && !a.done).at(-1);
  const finishCurrent = async () => { const a = playing(); if (a) { a.done = true; a.end(); } await tick(); };
  return { audios, requests, playing, finishCurrent };
}

function withFakes(t) {
  const saved = { window: globalThis.window, fetch: globalThis.fetch, Audio: globalThis.Audio, create: globalThis.URL.createObjectURL, revoke: globalThis.URL.revokeObjectURL };
  t.after(() => {
    globalThis.window = saved.window; globalThis.fetch = saved.fetch; globalThis.Audio = saved.Audio;
    globalThis.URL.createObjectURL = saved.create; globalThis.URL.revokeObjectURL = saved.revoke;
  });
  return fakeBrowser();
}

const REPLY = "First comes the opening line. Then a second sentence follows it. A third one closes the reply.";

test("pause holds the reading and resume carries on from the same place", async (t) => {
  const fake = withFakes(t);
  const { createStreamingSpeaker } = await import("../src/lib/voiceStream.js");
  let done = false;
  const speaker = createStreamingSpeaker({ apiBase: "/api", maxChars: 20000, chunkChars: 40, onDone: () => { done = true; } });
  speaker.finish(REPLY);
  await tick();
  const first = fake.playing();
  assert.equal(first.url, "First comes the opening line.");
  speaker.pause();
  assert.equal(speaker.paused, true);
  assert.equal(first.paused, true, "the element is paused, not stopped");
  first.done = true; first.end(); // it had been at its last word
  await tick(20);
  assert.equal(fake.playing(), undefined, "the next clip waits while paused");
  speaker.resume();
  await tick();
  assert.equal(fake.playing().url, "Then a second sentence follows it.");
  await fake.finishCurrent();
  await fake.finishCurrent();
  assert.equal(done, true);
});

test("skip goes back and forward a sentence, and the highlight follows", async (t) => {
  const fake = withFakes(t);
  const { createStreamingSpeaker } = await import("../src/lib/voiceStream.js");
  const heard = [];
  let done = false;
  const speaker = createStreamingSpeaker({ apiBase: "/api", maxChars: 20000, chunkChars: 40, onSentence: (i, text) => heard.push([i, text]), onDone: () => { done = true; } });
  speaker.finish(REPLY);
  await tick();
  await fake.finishCurrent();
  assert.equal(fake.playing().url, "Then a second sentence follows it.");
  assert.deepEqual(heard.map(([i]) => i), [0, 1]);

  speaker.skip(-1);
  await tick();
  assert.equal(fake.playing().url, "First comes the opening line.", "back to the sentence before");
  assert.equal(speaker.sentence, 0);

  speaker.skip(1);
  speaker.skip(1);
  await tick();
  assert.equal(fake.playing().url, "A third one closes the reply.");
  assert.deepEqual(heard.at(-1), [2, "A third one closes the reply."]);

  speaker.skip(1); // past the last sentence: the reading ends
  await tick();
  assert.equal(done, true);
});

test("a skip into the middle of a clip starts the clip at that sentence", async (t) => {
  const fake = withFakes(t);
  const { createStreamingSpeaker } = await import("../src/lib/voiceStream.js");
  const speaker = createStreamingSpeaker({ apiBase: "/api", maxChars: 20000, chunkChars: 420, onSentence: () => {} });
  speaker.finish(REPLY + " A fourth sentence to make it longer.");
  await tick();
  await fake.finishCurrent(); // the opening sentence goes out on its own
  const clip = fake.playing();
  assert.match(clip.url, /^Then a second sentence/);
  speaker.skip(1);
  await tick();
  const again = fake.playing();
  assert.equal(again.url, clip.url, "the same clip...");
  again.duration = 10;
  again.onloadedmetadata?.();
  assert.ok(again.currentTime > 2 && again.currentTime < 6, `...from its second sentence (${again.currentTime} s)`);
  speaker.stop();
});

test("speed: the playing clip speeds up at once, the rest are asked for at the new speed", async (t) => {
  const fake = withFakes(t);
  const { createStreamingSpeaker } = await import("../src/lib/voiceStream.js");
  const speaker = createStreamingSpeaker({ apiBase: "/api", maxChars: 20000, chunkChars: 40, speed: 1 });
  speaker.finish(REPLY);
  await tick();
  assert.equal(fake.requests[0].rate, undefined);
  speaker.setSpeed(1.5);
  assert.equal(speaker.speed, 1.5);
  assert.equal(fake.playing().playbackRate, 1.5, "the clip already playing");
  await tick();
  assert.ok(fake.requests.some((r) => r.rate === "+50%"), "later clips are made at 1.5×");
  await fake.finishCurrent();
  assert.equal(fake.playing().playbackRate, 1, "made at 1.5× by the voice, so played as is");
  speaker.stop();
});

test("a voice with no speed of its own is sped up by the browser", async (t) => {
  const fake = withFakes(t);
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    fake.requests.push(body);
    return { ok: true, status: 200, headers: { get: () => "google-free" }, blob: async () => ({ size: 1, text: body.text }) };
  };
  const { createStreamingSpeaker } = await import("../src/lib/voiceStream.js");
  const speaker = createStreamingSpeaker({ apiBase: "/api", maxChars: 20000, chunkChars: 40, speed: 1.25 });
  speaker.finish(REPLY);
  await tick();
  assert.equal(fake.playing().playbackRate, 1.25);
  speaker.stop();
});

test("the sentence being read is found in the reply's visible text, word by word", async () => {
  const { locateSentence } = await import("../src/lib/readAloudHighlight.js");
  // What the page shows, and what the voice was sent (markdown and citations out).
  const page = "Chennai weather. It's 34°C today [1], with humid air. Carry water, e.g. a bottle. நாளை மழை வரலாம்.";
  const first = locateSentence(page, "Chennai weather.");
  assert.equal(page.slice(first.start, first.end), "Chennai weather");
  const second = locateSentence(page, "It's 34°C today, with humid air.", first.end);
  assert.equal(page.slice(second.start, second.end), "It's 34°C today [1], with humid air");
  const third = locateSentence(page, "Carry water, for example a bottle.", second.end);
  assert.equal(page.slice(third.start, third.end), "Carry water, e.g. a bottle");
  const tamil = locateSentence(page, "நாளை மழை வரலாம்.", third.end);
  assert.equal(page.slice(tamil.start, tamil.end), "நாளை மழை வரலாம்");
  assert.equal(locateSentence(page, "Not in the reply at all."), null);
});
