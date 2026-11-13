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
  assert.equal(body.data.language, "ta", "Whisper's language name comes back as an ISO code");
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

test("languages are read as ISO codes, whatever name they come under", () => {
  assert.equal(dictation.languageCode("Tamil"), "ta");
  assert.equal(dictation.languageCode("hindi"), "hi");
  assert.equal(dictation.languageCode("ta-IN"), "ta");
  assert.equal(dictation.languageCode("fil-PH"), "tl");
  assert.equal(dictation.languageCode("Cantonese"), "yue");
  assert.equal(dictation.languageCode("klingon"), null);
  assert.equal(Object.keys(dictation.LANGUAGES).length, 100);
  assert.deepEqual(dictation.parseHints("ta-IN, en-US, en, xx, hi"), ["ta", "en", "hi"]);
});

test("a short clip is heard again only when Whisper's pick is a neighbour of the person's language, or it was unsure", () => {
  const { recheckLanguage } = dictation;
  // Hindi written in Urdu script, Tamil heard as Malayalam: heard again.
  assert.equal(recheckLanguage({ detected: "ur", hints: ["en", "hi"], duration: 3, sureness: -0.3 }), "hi");
  assert.equal(recheckLanguage({ detected: "ml", hints: ["ta"], duration: 4, sureness: -0.2 }), "ta");
  // A confident pick of an unrelated language in the same script stands: the person spoke it.
  assert.equal(recheckLanguage({ detected: "de", hints: ["en"], duration: 4, sureness: -0.25 }), null);
  // Someone who types in English, heard as Tamil or Hindi (an Indian accent):
  // heard again in English, and the surer reading is kept.
  assert.equal(recheckLanguage({ detected: "ta", hints: ["en"], duration: 3, sureness: -0.3 }), "en");
  assert.equal(recheckLanguage({ detected: "hi", hints: ["en", "ta"], duration: 5, sureness: -0.2 }), "en");
  // Tamil they've dictated before: kept when Whisper is fairly sure, checked when not.
  assert.equal(recheckLanguage({ detected: "ta", hints: ["en", "ta"], duration: 3, sureness: -0.3 }), null);
  assert.equal(recheckLanguage({ detected: "ta", hints: ["en", "ta"], duration: 3, sureness: -0.6 }), "en");
  // Someone who types in Tamil and says something in English gets English.
  assert.equal(recheckLanguage({ detected: "en", hints: ["ta", "en"], duration: 3, sureness: -0.6 }), null);
  // An unsure one is checked against their main language.
  assert.equal(recheckLanguage({ detected: "cy", hints: ["en"], duration: 2, sureness: -1.1 }), "en");
  // Their own language, a long clip, or no hints: left alone.
  assert.equal(recheckLanguage({ detected: "ta", hints: ["ta", "en"], duration: 3, sureness: -1.2 }), null);
  assert.equal(recheckLanguage({ detected: "ur", hints: ["hi"], duration: 45, sureness: -0.3 }), null);
  assert.equal(recheckLanguage({ detected: "ur", hints: [], duration: 3, sureness: -0.3 }), null);
});

test("Hindi that Whisper first writes in Urdu script comes back in Hindi when that reading is surer", async (t) => {
  const seen = [];
  dictation.setRecogniser(async ({ language }) => {
    seen.push(language);
    return language === "hi"
      ? { text: "मुझे कल का मौसम बताओ", language: "hindi", duration: 2.5, segments: [{ text: " मुझे कल का मौसम बताओ", start: 0, end: 2.5, no_speech_prob: 0.02, avg_logprob: -0.18 }] }
      : { text: "مجھے کل کا موسم بتاؤ", language: "urdu", duration: 2.5, segments: [{ text: " مجھے کل کا موسم بتاؤ", start: 0, end: 2.5, no_speech_prob: 0.02, avg_logprob: -0.42 }] };
  });
  const baseUrl = await startServer(t);
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(900)], { type: "audio/webm" }), "voice.webm");
  form.append("hints", "en,hi");
  const body = await (await fetch(`${baseUrl}/api/transcribe`, { method: "POST", body: form })).json();
  assert.deepEqual(seen, [undefined, "hi"]);
  assert.equal(body.data.text, "मुझे कल का मौसम बताओ");
  assert.equal(body.data.language, "hi");
});

test("a clip in a language the person doesn't usually use is kept as spoken", async (t) => {
  const seen = [];
  dictation.setRecogniser(async ({ language }) => {
    seen.push(language);
    // Forced into English, Whisper translates, and is less sure of it.
    return language === "en"
      ? { text: "What's the weather in Tokyo?", language: "english", duration: 2, segments: [{ text: " What's the weather in Tokyo?", start: 0, end: 2, no_speech_prob: 0.01, avg_logprob: -0.7 }] }
      : { text: "東京の天気は？", language: "japanese", duration: 2, segments: [{ text: " 東京の天気は？", start: 0, end: 2, no_speech_prob: 0.01, avg_logprob: -0.2 }] };
  });
  const baseUrl = await startServer(t);
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(900)], { type: "audio/webm" }), "voice.webm");
  form.append("hints", "en");
  const body = await (await fetch(`${baseUrl}/api/transcribe`, { method: "POST", body: form })).json();
  assert.deepEqual(seen, [undefined, "en"], "checked against the language they type in");
  assert.equal(body.data.text, "東京の天気は？");
  assert.equal(body.data.language, "ja");
});

test("English said with an Indian accent and heard as Tamil comes back in English", async (t) => {
  const seen = [];
  dictation.setRecogniser(async ({ language }) => {
    seen.push(language);
    return language === "en"
      ? { text: "Book a table for two at seven.", language: "english", duration: 2.4, segments: [{ text: " Book a table for two at seven.", start: 0, end: 2.4, no_speech_prob: 0.01, avg_logprob: -0.15 }] }
      : { text: "புக் எ டேபிள் ஃபார் டூ அட் செவன்", language: "tamil", duration: 2.4, segments: [{ text: " புக் எ டேபிள் ஃபார் டூ அட் செவன்", start: 0, end: 2.4, no_speech_prob: 0.01, avg_logprob: -0.38 }] };
  });
  const baseUrl = await startServer(t);
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(900)], { type: "audio/webm" }), "voice.webm");
  form.append("hints", "en");
  const body = await (await fetch(`${baseUrl}/api/transcribe`, { method: "POST", body: form })).json();
  assert.deepEqual(seen, [undefined, "en"]);
  assert.equal(body.data.text, "Book a table for two at seven.");
  assert.equal(body.data.language, "en");
});

test("a language picked by hand is used as is, with no second reading", async (t) => {
  const seen = [];
  dictation.setRecogniser(async ({ language }) => {
    seen.push(language);
    return { text: "வணக்கம்", language: "tamil", duration: 1.2, segments: [{ text: " வணக்கம்", start: 0, end: 1.2, no_speech_prob: 0.01, avg_logprob: -0.9 }] };
  });
  const baseUrl = await startServer(t);
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(900)], { type: "audio/webm" }), "voice.webm");
  form.append("language", "ta");
  form.append("hints", "en");
  const body = await (await fetch(`${baseUrl}/api/transcribe`, { method: "POST", body: form })).json();
  assert.deepEqual(seen, ["ta"]);
  assert.equal(body.data.language, "ta");
});

test("the second reading is dropped when it is less sure", async (t) => {
  dictation.setRecogniser(async ({ language }) => (language === "ta"
    ? { text: "translated words", language: "tamil", duration: 2, segments: [{ text: " translated words", start: 0, end: 2, no_speech_prob: 0.05, avg_logprob: -1.3 }] }
    : { text: "എന്റെ പേര്", language: "malayalam", duration: 2, segments: [{ text: " എന്റെ പേര്", start: 0, end: 2, no_speech_prob: 0.02, avg_logprob: -0.3 }] }));
  const baseUrl = await startServer(t);
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(900)], { type: "audio/webm" }), "voice.webm");
  form.append("hints", "ta");
  const body = await (await fetch(`${baseUrl}/api/transcribe`, { method: "POST", body: form })).json();
  assert.equal(body.data.text, "എന്റെ പേര്");
  assert.equal(body.data.language, "ml");
});
