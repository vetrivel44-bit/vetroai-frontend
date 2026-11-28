const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("stream");

const { config } = require("../src/config/env");
const tts = require("../src/services/airouterTtsService");

// The real fetch, kept before any test replaces global.fetch: the route tests
// still need it to talk to their own local server.
const clientFetch = global.fetch;

// A stand-in for AI Router: records what was asked and sends back `body`.
function fakeRouter(t, { body = Buffer.from("ID3audio"), status = 200, headers = { "content-type": "audio/mpeg" }, stream = false } = {}) {
  const sent = [];
  const real = global.fetch;
  global.fetch = async (url, init = {}) => {
    sent.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body || "{}") });
    if (status !== 200) {
      return { ok: false, status, headers: { get: () => null }, text: async () => "voice unavailable" };
    }
    if (stream) {
      const chunks = [body.subarray(0, 4), body.subarray(4)];
      return { ok: true, status, headers: { get: (name) => headers[String(name).toLowerCase()] ?? null }, body: Readable.toWeb(Readable.from(chunks)) };
    }
    return {
      ok: true, status,
      headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
      body: null,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };
  t.after(() => { global.fetch = real; });
  return sent;
}

function withKey(t, key = "test-key") {
  const saved = config.airouterApiKey;
  config.airouterApiKey = key;
  t.after(() => { config.airouterApiKey = saved; });
}

const apiBase = () => String(config.airouterBaseUrl || "https://api.airouter.in/v1").replace(/\/+$/, "");

test("default TTS is Voxtral: no voice, no speed, opus format", async (t) => {
  withKey(t);
  const sent = fakeRouter(t, { body: Buffer.concat([Buffer.from("OggS"), Buffer.alloc(400, 1)]), headers: { "content-type": "audio/ogg" } });
  const audio = await tts.synthesize({ text: "Hello there.", voice: "nova", rate: "+6%" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, `${apiBase()}/audio/speech`);
  assert.equal(sent[0].body.model, "mistral/voxtral-mini-tts-3");
  assert.equal(sent[0].body.input, "Hello there.");
  assert.equal(sent[0].body.voice, undefined, "Voxtral rejects voice");
  assert.equal(sent[0].body.speed, undefined, "Voxtral rejects speed");
  assert.equal(sent[0].body.response_format, "opus");
  assert.equal(audio.contentType, "audio/ogg");
  assert.equal(audio.provider, "airouter");
  assert.equal(audio.honorsRate, false, "frontend must apply playback speed");
});

test("the text goes out as full UTF-8: Indian languages are not stripped or transliterated", async (t) => {
  withKey(t);
  const sent = fakeRouter(t, { body: Buffer.concat([Buffer.from("ID3"), Buffer.alloc(400, 1)]) });
  const text = "வணக்கம்! नमस्ते, ధన్యవాదాలు, ಧನ್ಯವಾದಗಳು, നന്ദി. That's all five.";
  await tts.synthesize({ text, voice: "shimmer" });
  assert.equal(sent[0].body.input, text);
});

test("old saved voices move to the closest tts-1 voice", () => {
  assert.equal(tts.voiceFor("nova"), "nova");
  assert.equal(tts.voiceFor("onyx"), "onyx");
  assert.equal(tts.voiceFor("en-US-AvaMultilingualNeural"), "nova", "Ava was the old default");
  assert.equal(tts.voiceFor("google-en-IN"), "nova");
  assert.equal(tts.voiceFor("en-US-JennyNeural"), "shimmer");
  assert.equal(tts.voiceFor("en-GB-SoniaNeural"), "shimmer");
  assert.equal(tts.voiceFor("sarvam-dev"), "onyx");
  assert.equal(tts.voiceFor("sarvam-aparna"), "nova");
  assert.equal(tts.voiceFor(""), "nova");
  assert.equal(tts.voiceFor("<script>"), "nova");
});

test("a speaking speed becomes tts-1's speed, within its own range", () => {
  assert.equal(tts.speedFor("+6%"), 1.06);
  assert.equal(tts.speedFor("-10%"), 0.9);
  assert.equal(tts.speedFor(undefined), 1);
  assert.equal(tts.speedFor("+300%"), 4);
  assert.equal(tts.speedFor("fast"), 1);
  assert.equal(tts.speedFor("+50%", 1.5), 2.25, "the listener's speed multiplies");
});

test("/api/tts streams the audio back as it arrives", async (t) => {
  withKey(t);
  const app = require("../src/app");
  const audio = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(900, 7)]);
  const sent = fakeRouter(t, { body: audio, stream: true, headers: { "content-type": "audio/ogg" } });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const res = await clientFetch(`http://127.0.0.1:${server.address().port}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Vanakkam, எப்படி இருக்கீங்க?", voice: "nova", rate: "+6%", lang: "ta" }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/ogg");
  assert.equal(res.headers.get("x-tts-provider"), "airouter");
  assert.equal(res.headers.get("x-tts-voice"), "mistral/voxtral-mini-tts-3/voxtral");
  assert.equal(res.headers.get("x-tts-honors-rate"), "false", "Voxtral ignores speed");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const back = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(back, audio, "every byte of the audio reached the browser");
  assert.equal(sent[0].body.input, "Vanakkam, எப்படி இருக்கீங்க?", "the script is sent as it is");
  assert.equal(sent[0].body.speed, undefined, "Voxtral rejects speed");
});

test("/api/tts accepts a long read-aloud burst without running out of requests", async (t) => {
  withKey(t);
  const app = require("../src/app");
  fakeRouter(t, { body: Buffer.concat([Buffer.from("ID3"), Buffer.alloc(400, 1)]) });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/tts`;
  const statuses = [];
  for (let i = 0; i < 45; i++) {
    const res = await clientFetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `Sentence ${i}.` }) });
    statuses.push(res.status);
    await res.arrayBuffer();
  }
  assert.ok(statuses.every((s) => s === 200), `statuses: ${[...new Set(statuses)].join(", ")}`);
});

test("without an AI Router key /api/tts says so instead of failing silently", async (t) => {
  withKey(t, "");
  const app = require("../src/app");
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const res = await clientFetch(`http://127.0.0.1:${server.address().port}/api/tts`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hello" }),
  });
  assert.equal(res.status, 503);
  assert.match((await res.json()).message, /AIROUTER_API_KEY/);
});

test("a rate that isn't a speaking speed is ignored, and so is junk text", async (t) => {
  withKey(t);
  const app = require("../src/app");
  const sent = fakeRouter(t, { body: Buffer.concat([Buffer.from("ID3"), Buffer.alloc(400, 1)]) });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/tts`;
  const say = (body) => clientFetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await say({ text: "hi", rate: "fast\"><evil/>" })).status, 200);
  assert.equal(sent[0].body.speed, undefined);
  assert.equal((await say({ text: "   " })).status, 400);
});
