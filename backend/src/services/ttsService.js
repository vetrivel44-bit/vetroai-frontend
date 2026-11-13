"use strict";

// One text-to-speech entry point for chat voice mode, news and narration.
// Everything here is free:
//   • "…Neural" voices (Jenny, Aria, Guy, Sonia, Ryan, Neerja…) → Microsoft
//     Edge's free neural voices, so each picker option really sounds different.
//   • "google-<lang>" voices → Google's free voice with that accent.
// Each falls back to the other, then (only if their keys are ever set) to
// Google Cloud TTS or RapidAPI. The browser's own voice is the last resort,
// in the frontend.
//   • "sarvam-<speaker>" voices (the Premium ones) → Sarvam's Bulbul, paid,
//     made for Indian English and Indian languages. If Sarvam fails, the
//     Edge voice of the same gender and language reads it, then Google.

const { config } = require("../config/env");
const logger = require("../utils/logger");
const freeTts = require("./freeTtsService");
const edgeTts = require("./edgeTtsService");
const sarvamTts = require("./sarvamTtsService");
const { nativeVoiceFor, cleanLang, NATIVE_VOICES } = require("./ttsLanguage");

// The Edge voices that stand in for a Premium voice in Indian English.
const INDIAN_ENGLISH = { female: "en-IN-NeerjaExpressiveNeural", male: "en-IN-PrabhatNeural" };

/**
 * The Edge voices to try when Sarvam can't read `text` in `lang`, best first:
 * the native voice of the same gender for an Indian language, Indian English
 * otherwise (Neerja's expressive voice, then her classic one, then Jenny).
 */
function sarvamFallbackVoices(voice, code) {
  const { gender } = sarvamTts.sarvamVoice(voice);
  const pair = code && code !== "en" ? NATIVE_VOICES[code] : null;
  if (pair) return [pair[gender === "male" ? 1 : 0]];
  return edgeTts.voiceFallbacks(INDIAN_ENGLISH[gender] || INDIAN_ENGLISH.female);
}

/** "en-GB-SoniaNeural" / "google-en-IN" / "hi-IN" → "en-GB" / "en-IN" / "hi-IN" */
const voiceLanguage = (voice) => {
  const match = String(voice || "").replace(/^google-/, "").match(/^([a-z]{2,3}-[A-Z]{2})/);
  return match ? match[1] : "en-US";
};

async function googleCloud(text, languageCode) {
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(config.googleTtsApiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: { text }, voice: { languageCode }, audioConfig: { audioEncoding: "MP3" } }),
  });
  if (!res.ok) throw new Error(`Google Cloud TTS returned ${res.status}`);
  const body = await res.json();
  if (!body?.audioContent) throw new Error("Google Cloud TTS returned no audio");
  return { buffer: Buffer.from(body.audioContent, "base64"), contentType: "audio/mpeg", provider: "google-cloud" };
}

// rate: speaking speed for Edge voices ("+6%"), as voice mode talks.
async function synthesizeSpeech({ text, voice, languageCode, lang: textLang, rate }) {
  const requested = String(voice || "en-US-AvaMultilingualNeural");
  if (sarvamTts.isSarvamVoice(requested)) return premiumSpeech({ text, voice: requested, lang: textLang, rate });
  // Text in another language than the picked voice is read by a native voice.
  const native = nativeVoiceFor(textLang, requested);
  const lang = native?.languageCode || languageCode || voiceLanguage(requested);
  const edgeVoice = edgeTts.isEdgeVoice(requested) ? requested : null;
  const attempts = [];
  if (native) {
    if (native.edgeVoice) attempts.push(["edge-neural", () => edgeTts.synthesize(text, { voice: native.edgeVoice, rate })]);
    attempts.push(["google-free", () => freeTts.synthesize(text, { languageCode: lang })]);
  } else if (requested.startsWith("google-")) {
    attempts.push(["google-free", () => freeTts.synthesize(text, { languageCode: lang })]);
    attempts.push(["edge-neural", () => edgeTts.synthesize(text, { voice: lang.startsWith("en-GB") ? "en-GB-SoniaNeural" : "en-US-AvaMultilingualNeural", rate })]);
  } else {
    for (const name of edgeVoice ? edgeTts.voiceFallbacks(edgeVoice) : []) {
      attempts.push([`edge-neural:${name}`, () => edgeTts.synthesize(text, { voice: name, rate })]);
    }
    attempts.push(["google-free", () => freeTts.synthesize(text, { languageCode: lang })]);
  }
  if (config.googleTtsApiKey) attempts.push(["google-cloud", () => googleCloud(text, lang)]);
  if (config.chatgptApiKey && !native) { // English-only voices: no use for other languages
    attempts.push(["rapidapi", async () => ({ ...(await require("./medicalService").synthesizeSpeech(text, edgeVoice || "en-US-JennyNeural")), provider: "rapidapi" })]);
  }
  return firstThatSpeaks(attempts);
}

// A Premium (Sarvam) voice: Bulbul in the text's language, then the Edge
// voice of the same gender, then Google's free voice, then Google Cloud.
async function premiumSpeech({ text, voice, lang, rate }) {
  // The language Sarvam would read it in: the app's, else the text's script.
  const sarvamCode = sarvamTts.sarvamLanguage(lang, text);
  const code = sarvamCode ? sarvamCode.slice(0, 2) : cleanLang(lang) || "en";
  const googleCode = code === "od" ? "or-IN" : sarvamCode || code;
  const attempts = [];
  if (sarvamTts.available() && sarvamCode) attempts.push(["sarvam", () => sarvamTts.synthesize(text, { voice, lang: code, rate })]);
  for (const name of sarvamFallbackVoices(voice, code)) {
    attempts.push([`edge-neural:${name}`, () => edgeTts.synthesize(text, { voice: name, rate })]);
  }
  attempts.push(["google-free", () => freeTts.synthesize(text, { languageCode: googleCode })]);
  if (config.googleTtsApiKey) attempts.push(["google-cloud", () => googleCloud(text, googleCode)]);
  return firstThatSpeaks(attempts);
}

async function firstThatSpeaks(attempts) {
  let lastError = null;
  for (const [name, run] of attempts) {
    try {
      return await run();
    } catch (err) {
      lastError = err;
      logger.warn("tts.provider.failed", { provider: name, error: err?.message });
    }
  }
  throw lastError || new Error("No text-to-speech provider is available.");
}

module.exports = { synthesizeSpeech, voiceLanguage, sarvamFallbackVoices };
