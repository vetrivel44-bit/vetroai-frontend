import test from "node:test";
import assert from "node:assert/strict";

import { createVad, downsample, encodeWav, levelDb, looksLikeEcho } from "../src/lib/voiceListener.js";

const FRAME = 43;
const run = (vad, pattern, opts = {}) => {
  const events = [];
  for (const [db, ms] of pattern) {
    for (let t = 0; t < ms; t += FRAME) {
      const result = vad.feed(db, { frameMs: FRAME, ...opts });
      if (result) events.push(result);
    }
  }
  return events;
};

test("loudness is measured in dBFS", () => {
  assert.equal(levelDb(new Float32Array(100)), -100);
  assert.ok(Math.abs(levelDb(new Float32Array(100).fill(0.5)) - -6.02) < 0.05);
});

test("speech after quiet starts an utterance, and a pause ends it", () => {
  const vad = createVad();
  const events = run(vad, [[-70, 1500], [-20, 1200], [-70, 1200]]);
  assert.deepEqual(events, ["start", "end"]);
});

test("a click or a cough is dropped, not sent", () => {
  const vad = createVad();
  assert.deepEqual(run(vad, [[-70, 1000], [-20, 200], [-70, 1500]]), ["start", "cancel"]);
  assert.deepEqual(run(vad, [[-20, 86], [-70, 600]]), [], "too short to even start");
});

test("a short pause mid-sentence doesn't cut the person off", () => {
  const vad = createVad();
  const events = run(vad, [[-70, 1000], [-20, 1500], [-70, 500], [-20, 1000], [-70, 1200]]);
  assert.deepEqual(events, ["start", "end"]);
});

test("the detector learns the room: steady background noise isn't speech", () => {
  const vad = createVad();
  assert.deepEqual(run(vad, [[-45, 6000]]), [], "a fan or traffic");
  assert.ok(vad.noiseFloor > -50);
  assert.deepEqual(run(vad, [[-18, 1200], [-45, 1500]]), ["start", "end"], "talking over it");
});

test("while VetroAI is speaking it takes a louder, longer sound to count as the person", () => {
  const vad = createVad();
  run(vad, [[-70, 1000]]);
  // Leftover echo at a moderate level.
  assert.deepEqual(run(vad, [[-46, 1500]], { assistantSpeaking: true }), []);
  // The person talking over it.
  assert.deepEqual(run(vad, [[-18, 1200], [-70, 1500]], { assistantSpeaking: true }), ["start", "end"]);
});

test("a tap sends what was said so far", () => {
  const vad = createVad();
  run(vad, [[-70, 800], [-20, 600]]);
  assert.equal(vad.speaking, true);
  assert.equal(vad.flush(), "end");
  assert.equal(vad.speaking, false);
  assert.equal(vad.flush(), null);
});

test("audio is resampled to 16 kHz and written as a WAV Whisper reads", async () => {
  const second = new Float32Array(48000).map((_, i) => Math.sin(i / 10) * 0.5);
  const out = downsample([second.subarray(0, 24000), second.subarray(24000)], 48000);
  assert.equal(out.length, 16000);
  const wav = encodeWav(out);
  assert.equal(wav.type, "audio/wav");
  const bytes = new Uint8Array(await wav.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), "WAVE");
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(24, true), 16000, "sample rate");
  assert.equal(view.getUint32(40, true), 32000, "one second of 16-bit samples");
  assert.equal(downsample([new Float32Array(10)], 16000).length, 10, "already 16 kHz");
});

test("VetroAI's own voice coming back through the mic is told apart from the person", () => {
  const said = "Looks like India won by six wickets, and Kohli made eighty two.";
  assert.equal(looksLikeEcho("india won by six wickets", said), true);
  assert.equal(looksLikeEcho("wait, what about the weather tomorrow", said), false);
  assert.equal(looksLikeEcho("stop", said), false);
  assert.equal(looksLikeEcho("", said), true, "nothing heard");
  assert.equal(looksLikeEcho("hello", ""), false);
});
