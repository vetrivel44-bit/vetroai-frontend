const test = require("node:test");
const assert = require("node:assert/strict");

const edgeTts = require("../src/services/edgeTtsService");
const freeTts = require("../src/services/freeTtsService");
const ttsService = require("../src/services/ttsService");
const { nativeVoiceFor } = require("../src/services/ttsLanguage");

test("the conversational voices fall back to the classic voice of the same name, then Jenny", () => {
  assert.deepEqual(edgeTts.voiceFallbacks("en-US-AvaMultilingualNeural"), ["en-US-AvaMultilingualNeural", "en-US-AvaNeural", "en-US-JennyNeural"]);
  assert.deepEqual(edgeTts.voiceFallbacks("en-GB-SoniaNeural"), ["en-GB-SoniaNeural", "en-US-JennyNeural"]);
  assert.deepEqual(edgeTts.voiceFallbacks("ta-IN-PallaviNeural"), ["ta-IN-PallaviNeural"]);
  assert.equal(edgeTts.isEdgeVoice("en-US-BrianMultilingualNeural"), true);
});

test("a male conversational voice reads other languages in a male native voice", () => {
  assert.equal(nativeVoiceFor("ta", "en-US-AndrewMultilingualNeural").edgeVoice, "ta-IN-ValluvarNeural");
  assert.equal(nativeVoiceFor("ta", "en-US-AvaMultilingualNeural").edgeVoice, "ta-IN-PallaviNeural");
  assert.equal(nativeVoiceFor("en", "en-US-AvaMultilingualNeural"), null);
});

test("speech is made with the picked voice at the asked speed, and falls back voice by voice", async (t) => {
  const savedEdge = edgeTts.synthesize;
  const savedFree = freeTts.synthesize;
  t.after(() => { edgeTts.synthesize = savedEdge; freeTts.synthesize = savedFree; });
  const tried = [];
  edgeTts.synthesize = async (text, { voice, rate }) => {
    tried.push({ voice, rate });
    if (voice.includes("Multilingual")) throw new Error("voice not offered");
    return { buffer: Buffer.alloc(400), contentType: "audio/mpeg", provider: "edge-neural" };
  };
  freeTts.synthesize = async () => { throw new Error("should not be needed"); };
  const audio = await ttsService.synthesizeSpeech({ text: "Oh nice!", voice: "en-US-AvaMultilingualNeural", rate: "+6%" });
  assert.equal(audio.provider, "edge-neural");
  assert.deepEqual(tried, [{ voice: "en-US-AvaMultilingualNeural", rate: "+6%" }, { voice: "en-US-AvaNeural", rate: "+6%" }]);
});

test("/api/tts passes a speaking speed through, and ignores anything that isn't one", async (t) => {
  const app = require("../src/app");
  const saved = ttsService.synthesizeSpeech;
  const seen = [];
  ttsService.synthesizeSpeech = async (args) => { seen.push(args); return { buffer: Buffer.from("RIFF"), contentType: "audio/wav", provider: "test" }; };
  const server = app.listen(0, "127.0.0.1");
  t.after(() => { ttsService.synthesizeSpeech = saved; return new Promise((resolve) => server.close(resolve)); });
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/tts`;
  const say = (body) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await say({ text: "hi", rate: "+6%" })).status, 200);
  assert.equal((await say({ text: "hi", rate: "fast\"><evil/>" })).status, 200);
  assert.equal((await say({ text: "hi" })).status, 200);
  assert.equal(seen[0].rate, "+6%");
  assert.equal(seen[1].rate, undefined);
  assert.equal(seen[2].voice, "en-US-AvaMultilingualNeural", "the new default voice");
});

test("reading a long reply aloud isn't cut off by the chat limit", async (t) => {
  const app = require("../src/app");
  const saved = ttsService.synthesizeSpeech;
  ttsService.synthesizeSpeech = async () => ({ buffer: Buffer.from("RIFF"), contentType: "audio/wav", provider: "test" });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => { ttsService.synthesizeSpeech = saved; return new Promise((resolve) => server.close(resolve)); });
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/tts`;
  // More clips in a minute than chat's 40 requests: Read aloud of a long
  // answer, or reading straight after chatting, must not run out.
  const statuses = [];
  for (let i = 0; i < 45; i++) {
    const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `Sentence ${i}.` }) });
    statuses.push(res.status);
    await res.arrayBuffer();
  }
  assert.ok(statuses.every((s) => s === 200), `statuses: ${[...new Set(statuses)].join(", ")}`);
});

test("Read aloud's Google voice reads Tamil with Google too, never a paid voice", async (t) => {
  const savedEdge = edgeTts.synthesize;
  const savedFree = freeTts.synthesize;
  t.after(() => { edgeTts.synthesize = savedEdge; freeTts.synthesize = savedFree; });
  const used = [];
  freeTts.synthesize = async (text, { languageCode }) => { used.push(`google:${languageCode}`); return { buffer: Buffer.alloc(400), contentType: "audio/mpeg", provider: "google-free" }; };
  edgeTts.synthesize = async (text, { voice }) => { used.push(`edge:${voice}`); return { buffer: Buffer.alloc(400), contentType: "audio/mpeg", provider: "edge-neural" }; };
  await ttsService.synthesizeSpeech({ text: "வணக்கம்", voice: "google-en-IN", lang: "ta" });
  await ttsService.synthesizeSpeech({ text: "Hello there.", voice: "google-en-IN" });
  await ttsService.synthesizeSpeech({ text: "வணக்கம்", voice: "google-ta-IN", lang: "ta" });
  assert.deepEqual(used, ["google:ta-IN", "google:en-IN", "google:ta-IN"]);
});
