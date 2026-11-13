const test = require("node:test");
const assert = require("node:assert/strict");

const { config } = require("../src/config/env");
const sarvamTts = require("../src/services/sarvamTtsService");
const edgeTts = require("../src/services/edgeTtsService");
const freeTts = require("../src/services/freeTtsService");
const ttsService = require("../src/services/ttsService");
const dictation = require("../src/services/dictationService");

// A tiny MP3 (an ID3 header and padding) and WAV, as Sarvam would send them.
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(400, 1)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(400, 1)]);

function withSarvamKey(t) {
  const saved = config.sarvamApiKey;
  config.sarvamApiKey = "test-key";
  t.after(() => { config.sarvamApiKey = saved; });
}

// ── Premium voices (Bulbul) ──────────────────────────────────────────────────

test("Premium voices speak as Sarvam's expressive personas, and the first ids still work", () => {
  assert.equal(sarvamTts.isSarvamVoice("sarvam-aparna"), true);
  assert.equal(sarvamTts.isSarvamVoice("en-US-JennyNeural"), false);
  assert.equal(sarvamTts.personaFor("sarvam-aparna", "en"), "aparna_en_companion");
  assert.equal(sarvamTts.personaFor("sarvam-dev", "ta"), "gokul_ta_narration");
  assert.equal(sarvamTts.personaFor("sarvam-ratan", "en"), "dev_en_conversational", "Ratan became Dev");
  assert.equal(sarvamTts.personaFor("sarvam-ishita", "en"), "aparna_en_companion", "Ishita became Aparna");
  assert.equal(sarvamTts.personaFor("sarvam-aparna", "ta"), null, "no female Tamil persona: v3");
  assert.equal(sarvamTts.personaFor("sarvam-dev", "ml"), null, "no Malayalam personas yet: v3");
  assert.equal(sarvamTts.v3SpeakerFor("sarvam-aparna", "ta"), "ishita");
  assert.equal(sarvamTts.v3SpeakerFor("sarvam-sanchita", "ta"), "ritu");
  assert.equal(sarvamTts.sarvamVoice("sarvam-nobody").gender, "female", "an unknown id still speaks");
  // Expressive personas in every language Sarvam has them for, same gender.
  for (const [voice, code, persona] of [
    ["sarvam-aparna", "te", "kavitha_te_conversation"], ["sarvam-aparna", "kn", "chaitra_kn_conversation"], ["sarvam-aparna", "bn", "roopa_bn_conversational"],
    ["sarvam-aparna", "mr", "ishita_mr_conversational"], ["sarvam-aparna", "gu", "pooja_gu_conversational"], ["sarvam-aparna", "pa", "harpreet_pa_narration"],
    ["sarvam-dev", "te", "tarun_te_narration"], ["sarvam-dev", "kn", "chetan_kn_conversation"], ["sarvam-dev", "bn", "arnab_bn_conversation"],
    ["sarvam-dev", "mr", "nilesh_mr_conversation"], ["sarvam-dev", "gu", "bhavik_gu_conversation"], ["sarvam-dev", "pa", "anand_pa_conversation"],
  ]) assert.equal(sarvamTts.personaFor(voice, code), persona, `${voice} ${code}`);
});

test("the text's language picks Bulbul's language, by the app's code or the script", () => {
  assert.equal(sarvamTts.sarvamLanguage("ta", "anything"), "ta-IN");
  assert.equal(sarvamTts.sarvamLanguage("or", ""), "od-IN", "Odia's ISO code is Sarvam's od");
  assert.equal(sarvamTts.sarvamLanguage("", "Hello there"), "en-IN", "Latin text is Indian English");
  assert.equal(sarvamTts.sarvamLanguage("", "வணக்கம், எப்படி இருக்கீங்க?"), "ta-IN");
  assert.equal(sarvamTts.sarvamLanguage("", "नमस्ते दोस्त"), "hi-IN");
  assert.equal(sarvamTts.sarvamLanguage("fr", "Bonjour"), null, "Bulbul doesn't speak French");
});

test("Edge's speaking speed becomes Bulbul's pace, within its 0.5–2 range", () => {
  assert.equal(sarvamTts.paceFor("+6%"), 1.06);
  assert.equal(sarvamTts.paceFor("-10%"), 0.9);
  assert.equal(sarvamTts.paceFor("+300%"), 2);
  assert.equal(sarvamTts.paceFor(undefined), 1);
});

test("Sarvam's audio is sent with the type the browser needs", () => {
  assert.equal(sarvamTts.audioType(MP3), "audio/mpeg");
  assert.equal(sarvamTts.audioType(WAV), "audio/wav");
});

test("a Premium voice asks Sarvam for MP3 in the reply's language, as its v4 persona", async (t) => {
  withSarvamKey(t);
  const sent = [];
  const restore = sarvamTts.setRequester(async (body) => { sent.push(body); return { audios: [MP3.toString("base64")] }; });
  t.after(() => sarvamTts.setRequester(restore));
  const audio = await ttsService.synthesizeSpeech({ text: "Vanakkam! எப்படி இருக்கீங்க?", voice: "sarvam-dev", lang: "ta", rate: "+6%" });
  assert.equal(audio.provider, "sarvam");
  assert.equal(audio.contentType, "audio/mpeg");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].model, "bulbul:v4-flash");
  assert.equal(sent[0].speaker, "gokul_ta_narration");
  assert.equal(sent[0].language_code, "ta-IN");
  assert.equal(sent[0].output_audio_codec, "mp3");
  assert.equal(sent[0].pace, 1.06);
  assert.equal(sent[0].temperature, undefined, "v4 ignores temperature");
  assert.equal(audio.voice, "bulbul:v4-flash/gokul_ta_narration");
});

test("where there's no persona, the voice speaks on v3 with a little more feeling", async (t) => {
  withSarvamKey(t);
  const sent = [];
  const restore = sarvamTts.setRequester(async (body) => { sent.push(body); return { audios: [MP3.toString("base64")] }; });
  t.after(() => sarvamTts.setRequester(restore));
  await sarvamTts.synthesize("വണക്കം", { voice: "sarvam-aparna", lang: "ml" });
  assert.equal(sent[0].model, "bulbul:v3");
  assert.equal(sent[0].speaker, "ishita");
  assert.equal(sent[0].temperature, 0.85);
});

test("a persona Sarvam turns down is spoken by the same voice on v3", async (t) => {
  withSarvamKey(t);
  const sent = [];
  const restore = sarvamTts.setRequester(async (body) => {
    sent.push(body);
    if (body.model === "bulbul:v4-flash") { const err = new Error("400 invalid speaker"); err.status = 400; throw err; }
    return { audios: [MP3.toString("base64")] };
  });
  t.after(() => sarvamTts.setRequester(restore));
  const audio = await sarvamTts.synthesize("Hello there", { voice: "sarvam-aparna" });
  assert.equal(audio.provider, "sarvam");
  assert.deepEqual(sent.map((b) => [b.model, b.speaker]), [["bulbul:v4-flash", "aparna_en_companion"], ["bulbul:v3", "ishita"]]);
  assert.equal(audio.voice, "bulbul:v3/ishita", "says which voice really read it");
});

test("if Sarvam ignores the codec and sends WAV, it goes out as audio/wav", async (t) => {
  withSarvamKey(t);
  const restore = sarvamTts.setRequester(async () => ({ audios: [WAV.toString("base64")] }));
  t.after(() => sarvamTts.setRequester(restore));
  const audio = await ttsService.synthesizeSpeech({ text: "Hello", voice: "sarvam-ishita" });
  assert.equal(audio.contentType, "audio/wav");
});

test("the older target_language_code field is tried if Sarvam rejects language_code", async (t) => {
  withSarvamKey(t);
  const sent = [];
  const restore = sarvamTts.setRequester(async (body) => {
    sent.push(body);
    if (body.language_code) { const err = new Error("422"); err.status = 422; throw err; }
    return { audios: [MP3.toString("base64")] };
  });
  t.after(() => sarvamTts.setRequester(restore));
  await sarvamTts.synthesize("Hello", { voice: "sarvam-sanchita" });
  assert.equal(sent.at(-1).target_language_code, "en-IN");
  assert.equal(sent.at(-1).language_code, undefined);
});

test("when Sarvam fails, a Premium voice falls back to the Edge voice of its gender, then Google", async (t) => {
  withSarvamKey(t);
  const restoreSarvam = sarvamTts.setRequester(async () => { const err = new Error("Sarvam TTS returned 500"); err.status = 500; throw err; });
  const savedEdge = edgeTts.synthesize;
  const savedFree = freeTts.synthesize;
  t.after(() => { sarvamTts.setRequester(restoreSarvam); edgeTts.synthesize = savedEdge; freeTts.synthesize = savedFree; });
  const edgeTried = [];
  edgeTts.synthesize = async (text, { voice }) => { edgeTried.push(voice); throw new Error("edge down"); };
  const freeTried = [];
  freeTts.synthesize = async (text, { languageCode }) => { freeTried.push(languageCode); return { buffer: MP3, contentType: "audio/mpeg", provider: "google-free" }; };

  const tamil = await ttsService.synthesizeSpeech({ text: "வணக்கம்", voice: "sarvam-ratan", lang: "ta" });
  assert.equal(tamil.provider, "google-free");
  assert.deepEqual(edgeTried, ["ta-IN-ValluvarNeural"], "a male voice falls back to the male Tamil voice");
  assert.deepEqual(freeTried, ["ta-IN"]);

  edgeTried.length = 0;
  edgeTts.synthesize = async (text, { voice }) => { edgeTried.push(voice); return { buffer: MP3, contentType: "audio/mpeg", provider: "edge-neural" }; };
  const english = await ttsService.synthesizeSpeech({ text: "Hello there", voice: "sarvam-aparna" });
  assert.equal(english.provider, "edge-neural");
  assert.deepEqual(edgeTried, ["en-IN-NeerjaExpressiveNeural"], "Indian English, female");
});

test("without a Sarvam key a Premium voice still speaks, through Edge", async (t) => {
  const saved = config.sarvamApiKey;
  config.sarvamApiKey = "";
  const savedEdge = edgeTts.synthesize;
  t.after(() => { config.sarvamApiKey = saved; edgeTts.synthesize = savedEdge; });
  const restore = sarvamTts.setRequester(async () => { throw new Error("should not be called"); });
  t.after(() => sarvamTts.setRequester(restore));
  edgeTts.synthesize = async (text, { voice }) => ({ buffer: MP3, contentType: "audio/mpeg", provider: `edge:${voice}` });
  const audio = await ttsService.synthesizeSpeech({ text: "Hello", voice: "sarvam-shubh" });
  assert.equal(audio.provider, "edge:en-IN-PrabhatNeural");
});

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

test("a sure Whisper reading, and other languages, stay with Whisper", async (t) => {
  const calls = stubBoth(t, {
    whisper: whisperSays("Remind me to call mum at six.", "english"),
    sarvam: async () => { throw new Error("should not be called"); },
  });
  const english = await dictation.transcribeDictation({ ...clip, hints: "en" });
  assert.equal(english.text, "Remind me to call mum at six.");
  dictation.setRecogniser(whisperSays("வணக்கம்", "tamil", -0.1));
  const sureTamil = await dictation.transcribeDictation({ ...clip, hints: "en" });
  assert.equal(sureTamil.text, "வணக்கம்");
  assert.equal(calls.sarvam.length, 0);
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
  assert.equal(dictation.sarvamAfter({ detected: "ml", sureness: -0.8 }), true);
  assert.equal(dictation.sarvamAfter({ detected: "ml", sureness: -0.1 }), false);
  assert.equal(dictation.sarvamAfter({ detected: "fr", sureness: -0.9 }), false);
});
