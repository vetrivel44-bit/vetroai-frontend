const test = require("node:test");
const assert = require("node:assert/strict");

const dictation = require("../src/services/dictationService");
const app = require("../src/app");

async function startServer(t) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

const upload = (baseUrl, { bytes = 2048, type = "audio/webm;codecs=opus", language } = {}) => {
  const form = new FormData();
  if (bytes) form.append("audio", new Blob([new Uint8Array(bytes).fill(7)], { type }), "voice");
  if (language) form.append("language", language);
  return fetch(`${baseUrl}/api/transcribe`, { method: "POST", body: form });
};

test("the browser's recording type is read without its codec", () => {
  assert.equal(dictation.baseType("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(dictation.isAudioType("audio/webm;codecs=opus"), true);
  assert.equal(dictation.isAudioType("audio/mp4"), true);
  assert.equal(dictation.isAudioType("audio/ogg; codecs=opus"), true);
  assert.equal(dictation.isAudioType("application/pdf"), false);
  assert.equal(dictation.isAudioType(""), false);
});

test("segments Whisper wrote over silence are left out", () => {
  assert.equal(dictation.spokenText({
    text: "Open my notes. Thank you.",
    segments: [
      { text: " Open my notes.", no_speech_prob: 0.01, avg_logprob: -0.2 },
      { text: " Thank you.", no_speech_prob: 0.9, avg_logprob: -1.4 },
    ],
  }), "Open my notes.");
  // Nothing but a phantom "Thank you." that Whisper doubted.
  assert.equal(dictation.spokenText({ text: "Thank you.", segments: [{ text: " Thank you.", no_speech_prob: 0.45, avg_logprob: -0.6 }] }), "");
  // Someone who really says it gets it typed.
  assert.equal(dictation.spokenText({ text: "Thank you.", segments: [{ text: " Thank you.", no_speech_prob: 0.02, avg_logprob: -0.1 }] }), "Thank you.");
  // Replies without segments keep their text.
  assert.equal(dictation.spokenText({ text: "  வணக்கம் எப்படி இருக்கீங்க  " }), "வணக்கம் எப்படி இருக்கீங்க");
});

test("without a Groq key the server says voice typing isn't set up, so the app can use the browser's", async (t) => {
  const { config } = require("../src/config/env");
  const saved = config.groqApiKey;
  config.groqApiKey = "";
  t.after(() => { config.groqApiKey = saved; });
  const baseUrl = await startServer(t);

  const check = await fetch(`${baseUrl}/api/transcribe`);
  assert.equal(check.status, 200);
  assert.equal((await check.json()).data.available, false);

  const response = await upload(baseUrl);
  const body = await response.json();
  assert.equal(response.status, 501);
  assert.equal(body.data.code, "ASR_NOT_CONFIGURED");
});

test("a recording comes back as text, in the language it was spoken", async (t) => {
  const seen = [];
  dictation.setRecogniser(async (input) => {
    seen.push(input);
    return { text: "chennai la weather eppadi", language: "tamil", duration: 2.4, segments: [{ text: " chennai la weather eppadi", no_speech_prob: 0.02, avg_logprob: -0.3 }] };
  });
  const baseUrl = await startServer(t);
  assert.equal((await (await fetch(`${baseUrl}/api/transcribe`)).json()).data.available, true);
  const response = await upload(baseUrl);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.text, "chennai la weather eppadi");
  assert.equal(body.data.duration, 2.4);
  assert.equal(seen[0].type, "audio/webm");
  assert.equal(seen[0].filename, "dictation.webm");
  assert.equal(seen[0].language, undefined, "the language is left to Whisper unless one was chosen");
  assert.equal(seen[0].buffer.length, 2048);
});

test("Safari's mp4 recordings are named so Whisper reads them, and a chosen language is passed on", async (t) => {
  const seen = [];
  dictation.setRecogniser(async (input) => { seen.push(input); return { text: "hello" }; });
  const baseUrl = await startServer(t);
  const response = await upload(baseUrl, { type: "audio/mp4", language: "EN" });
  assert.equal(response.status, 200);
  assert.equal(seen[0].filename, "dictation.mp4");
  assert.equal(seen[0].language, "en");
});

test("silence comes back as empty text, not an error", async (t) => {
  dictation.setRecogniser(async () => ({ text: "Thanks for watching!", segments: [{ text: " Thanks for watching!", no_speech_prob: 0.7, avg_logprob: -0.8 }] }));
  const baseUrl = await startServer(t);
  const response = await upload(baseUrl);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.text, "");
});

test("bad uploads get a clear answer", async (t) => {
  dictation.setRecogniser(async () => ({ text: "never" }));
  const baseUrl = await startServer(t);

  const none = await upload(baseUrl, { bytes: 0 });
  assert.equal(none.status, 400);
  assert.equal((await none.json()).data.code, "AUDIO_REQUIRED");

  const pdf = await upload(baseUrl, { type: "application/pdf" });
  assert.equal(pdf.status, 415);
  assert.equal((await pdf.json()).data.code, "AUDIO_FORMAT");
});

test("when Whisper is busy or fails the reply says so", async (t) => {
  const baseUrl = await startServer(t);

  dictation.setRecogniser(async () => { const e = new Error("rate"); e.status = 429; throw e; });
  const busy = await upload(baseUrl);
  assert.equal(busy.status, 429);
  assert.equal((await busy.json()).data.code, "ASR_BUSY");

  dictation.setRecogniser(async () => { throw new Error("boom"); });
  const failed = await upload(baseUrl);
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).data.code, "ASR_FAILED");
});
