const test = require("node:test");
const assert = require("node:assert/strict");

// Dictation (speech to text): Sarvam Saaras reads Indian languages far better
// than Whisper alone. These lived with the old robot-voice tests, which went
// with the move to openai/tts-1.
const dictation = require("../src/services/dictationService");

// ── Dictation (Saaras) ───────────────────────────────────────────────────────

const clip = { buffer: Buffer.alloc(2048, 7), mimetype: "audio/webm;codecs=opus" };
const whisperSays = (text, language, avg_logprob = -0.2) => async () => ({
  text, language, duration: 3.2, segments: [{ text, start: 0, end: 3.2, avg_logprob, no_speech_prob: 0.01 }],
});

function stubBoth(t, { whisper, sarvam }) {
  const calls = { whisper: [], sarvam: [] };
  dictation.setRecogniser(async (input) => { calls.whisper.push(input.language); return whisper(input); });
  const restore = dictation.setSarvamRecogniser(async (input) => { calls.sarvam.push(input.language); return sarvam(input); });
  t.after(restore);
  return calls;
}

test("Sarvam is used first for a picked Indian language, in that language", async (t) => {
  const calls = stubBoth(t, {
    whisper: whisperSays("should not be needed", "tamil"),
    sarvam: async () => ({ transcript: "நாளைக்கு meeting இருக்கா?", language_code: "ta-IN", timestamps: { end_time_seconds: [1.2, 2.75] } }),
  });
  const result = await dictation.transcribeDictation({ ...clip, language: "ta" });
  assert.deepEqual(result, { text: "நாளைக்கு meeting இருக்கா?", language: "ta", duration: 2.75 });
  assert.deepEqual(calls.sarvam, ["ta"]);
  assert.equal(calls.whisper.length, 0);
});

test("when the person types in an Indian language, Sarvam tells which language they spoke", async (t) => {
  const calls = stubBoth(t, {
    whisper: whisperSays("should not be needed", "english"),
    sarvam: async () => ({ transcript: "Book a table for two at eight.", language_code: "en-IN" }),
  });
  const result = await dictation.transcribeDictation({ ...clip, hints: "ta,en" });
  assert.equal(result.text, "Book a table for two at eight.");
  assert.equal(result.language, "en");
  assert.deepEqual(calls.sarvam, [undefined], "auto-detect, so English comes out as English");
});

test("an unsure Whisper reading in an Indian language is read again by Sarvam", async (t) => {
  const calls = stubBoth(t, {
    whisper: whisperSays("நான் வீட்டுக்கு போறேன்", "tamil", -0.9),
    sarvam: async () => ({ transcript: "நான் office-க்கு போறேன்", language_code: "ta-IN" }),
  });
  const result = await dictation.transcribeDictation({ ...clip, hints: "en" });
  assert.equal(result.text, "நான் office-க்கு போறேன்");
  assert.equal(result.language, "ta");
  assert.equal(result.duration, 3.2, "Whisper's duration when Sarvam has none");
  assert.equal(calls.sarvam.length, 1);
});

test("English and other languages stay with Whisper", async (t) => {
  const calls = stubBoth(t, {
    whisper: whisperSays("Remind me to call mum at six.", "english"),
    sarvam: async () => { throw new Error("should not be called"); },
  });
  const english = await dictation.transcribeDictation({ ...clip, hints: "en" });
  assert.equal(english.text, "Remind me to call mum at six.");
  dictation.setRecogniser(whisperSays("¿Dónde está la estación?", "spanish"));
  const spanish = await dictation.transcribeDictation({ ...clip, hints: "en" });
  assert.equal(spanish.language, "es");
  assert.equal(calls.sarvam.length, 0);
});

test("Tamil from someone who types in English comes back in Tamil, not translated", async (t) => {
  const calls = stubBoth(t, {
    // Whisper's own Tamil, and the English it would have made if asked.
    whisper: async ({ language }) => (language === "en"
      ? { text: "Tell me tomorrow's weather.", language: "english", duration: 2, segments: [{ text: " Tell me tomorrow's weather.", start: 0, end: 2, avg_logprob: -0.15, no_speech_prob: 0.01 }] }
      : { text: "நாளைக்கு வானிலை சொல்லு", language: "tamil", duration: 2, segments: [{ text: " நாளைக்கு வானிலை சொல்லு", start: 0, end: 2, avg_logprob: -0.3, no_speech_prob: 0.01 }] }),
    sarvam: async () => ({ transcript: "நாளைக்கு weather சொல்லு", language_code: "ta-IN" }),
  });
  const result = await dictation.transcribeDictation({ ...clip, hints: "en" });
  assert.equal(result.text, "நாளைக்கு weather சொல்லு");
  assert.equal(result.language, "ta");
  assert.deepEqual(calls.sarvam, [undefined], "Sarvam is left to say which language it was");
  assert.deepEqual(calls.whisper, [undefined], "no second reading in English");
});

test("English with an Indian accent that Whisper hears as Tamil comes back in English", async (t) => {
  stubBoth(t, {
    whisper: whisperSays("புக் எ டேபிள் ஃபார் டூ", "tamil", -0.35),
    sarvam: async () => ({ transcript: "Book a table for two.", language_code: "en-IN" }),
  });
  const result = await dictation.transcribeDictation({ ...clip, hints: "en" });
  assert.equal(result.text, "Book a table for two.");
  assert.equal(result.language, "en");
});

test("without Sarvam, a sure Tamil reading from Whisper stays Tamil", async (t) => {
  const seen = [];
  dictation.setRecogniser(async ({ language }) => { seen.push(language); return whisperSays("வணக்கம் எப்படி இருக்கீங்க", "tamil", -0.3)(); });
  const restore = dictation.setSarvamRecogniser(null);
  t.after(restore);
  const result = await dictation.transcribeDictation({ ...clip, hints: "en" });
  assert.equal(result.text, "வணக்கம் எப்படி இருக்கீங்க");
  assert.equal(result.language, "ta");
  assert.deepEqual(seen, [undefined], "not read again in English");
});

test("if Sarvam fails, Whisper types it out instead", async (t) => {
  stubBoth(t, {
    whisper: whisperSays("नमस्ते", "hindi"),
    sarvam: async () => { const err = new Error("Sarvam speech-to-text returned 503"); err.status = 503; throw err; },
  });
  const result = await dictation.transcribeDictation({ ...clip, language: "hi" });
  assert.deepEqual(result, { text: "नमस्ते", language: "hi", duration: 3.2 });
});

test("which clips go to Sarvam, and when", () => {
  assert.equal(dictation.sarvamFirst({ forced: "ta", hints: [] }), "ta");
  assert.equal(dictation.sarvamFirst({ forced: "fr", hints: ["ta"] }), null, "a picked non-Indian language wins");
  assert.equal(dictation.sarvamFirst({ forced: undefined, hints: ["hi", "en"] }), "");
  assert.equal(dictation.sarvamFirst({ forced: undefined, hints: ["en", "ta"] }), null);
  // Anything Whisper hears as an Indian language, sure or not: Sarvam tells
  // Indian English from Tamil or Hindi far better.
  assert.equal(dictation.sarvamAfter({ detected: "ml", sureness: -0.8 }), true);
  assert.equal(dictation.sarvamAfter({ detected: "ta", sureness: -0.1 }), true);
  assert.equal(dictation.sarvamAfter({ detected: "fr", sureness: -0.9 }), false);
  // Doubtful English from someone who speaks an Indian language (Tanglish).
  assert.equal(dictation.sarvamAfter({ detected: "en", sureness: -0.7, hints: ["en", "ta"] }), true);
  assert.equal(dictation.sarvamAfter({ detected: "en", sureness: -0.2, hints: ["en", "ta"] }), false);
  assert.equal(dictation.sarvamAfter({ detected: "en", sureness: -0.9, hints: ["en"] }), false);
});
